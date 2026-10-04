"""Pinned Drive releases and append-only result uploads; no latest-file adoption."""
from hashlib import sha256
import json
from pathlib import Path
import re
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from uuid import uuid4
from ..application.platform_ports import CatalogRelease, OfferingAnalysis, PlatformError, UniversityConversionRelease
from ..application.ports import TotalModelBinding
from ..application.time_contract import utc_instant, utc_text, calendar_date
from ..exam_pack import ExamPack, ExamTotalModel
from ..percentile import DistributionMetadata, ScoreFrequency, TotalScoreDistribution
from ..year_equating import RankDistribution, BridgePolicy
from ..university_conversion import ConversionRelease
from ..admission_result_percentile import UniversityScoreDistribution


def drive_id(value):
    if not isinstance(value,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,200}',value):
        raise PlatformError('drive_identifier_invalid',503)
    return value


class MissingDataProvider:
    def get_exam_pack(self,exam_id): return None
    def get_total_model(self,exam_id,pack_version): return None
    def get_catalog(self): return None
    def get_analysis(self,offering_id): return None
    def get_conversion(self,offering_id): return None


class DriveClient:
    def __init__(self,token,input_folder,output_folder,*,opener=urlopen):
        self._token,self._input,self._output,self._open=token,input_folder,output_folder,opener

    def call(self,path,*,params=None,data=None,content_type='application/json'):
        if not self._token: raise PlatformError('drive_not_configured',503)
        url='https://www.googleapis.com/drive/v3/'+path
        if params:url+='?'+urlencode(params)
        request=Request(url,data=data,headers={'Authorization':'Bearer '+self._token,'Content-Type':content_type})
        try:
            with self._open(request,timeout=10) as response:
                content=response.read(32*1024*1024+1)
            if len(content)>32*1024*1024:raise PlatformError('drive_artifact_too_large',503)
            return content
        except OSError as error:raise PlatformError('drive_unavailable',503) from error

    def artifact(self,entry):
        fid=drive_id(entry['file_id']); folder=drive_id(self._input)
        metadata=json.loads(self.call('files/'+fid,params={'fields':'id,parents,trashed,mimeType,createdTime,modifiedTime,version'}))
        if metadata.get('trashed') or folder not in metadata.get('parents',[]):raise PlatformError('drive_folder_mismatch',503)
        if str(metadata.get('version'))!=str(entry['drive_version']):raise PlatformError('drive_version_mismatch',503)
        # Drive RFC3339 metadata has its own explicit instant, never Seoul-naive.
        created=utc_text(utc_instant(metadata['createdTime']))
        modified=utc_text(utc_instant(metadata['modifiedTime']))
        content=self.call('files/'+fid,params={'alt':'media'})
        if sha256(content).hexdigest()!=entry['sha256']:raise PlatformError('drive_hash_mismatch',503)
        return json.loads(content),dict(created_at=created,modified_at=modified,drive_version=str(metadata['version']))

    def append_result(self,owner_id,operation,request_key,content,now):
        folder=drive_id(self._output)
        if self._output==self._input:raise PlatformError('drive_output_scope_conflict',503)
        identity=sha256((owner_id+'\0'+operation+'\0'+request_key).encode()).hexdigest()
        payload=json.dumps(content,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()
        digest=sha256(payload).hexdigest()
        query="'"+folder+"' in parents and trashed=false and appProperties has { key='jungsi_request' and value='"+identity+"' }"
        found=json.loads(self.call('files',params={'q':query,'fields':'files(id,appProperties),nextPageToken','pageSize':100}))
        files=found.get('files',[])
        if found.get('nextPageToken') or len(files)>1:raise PlatformError('drive_duplicate_result',409)
        if files:
            if files[0].get('appProperties',{}).get('jungsi_sha256')!=digest:raise PlatformError('drive_result_conflict',409)
            return dict(file_id=files[0]['id'],sha256=digest,status='already_written')
        metadata=dict(name='result-'+identity[:16]+'.json',parents=[folder],mimeType='application/json',
                      appProperties=dict(jungsi_request=identity,jungsi_sha256=digest,jungsi_created=utc_text(now)))
        boundary='jungsi'+uuid4().hex
        multipart=(('--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+json.dumps(metadata)+'\r\n--'+boundary+'\r\nContent-Type: application/json\r\n\r\n').encode()+payload+('\r\n--'+boundary+'--\r\n').encode())
        if not self._token:raise PlatformError('drive_not_configured',503)
        request=Request('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',data=multipart,
                        headers={'Authorization':'Bearer '+self._token,'Content-Type':'multipart/related; boundary='+boundary})
        try:
            with self._open(request,timeout=10) as response:created=json.loads(response.read(65537))
        except OSError as error:raise PlatformError('drive_write_outcome_unknown_retry_same_key',503) from error
        return dict(file_id=created['id'],sha256=digest,status='created')


class DriveDataProvider:
    def __init__(self,client,registry):
        self.client=client
        if isinstance(registry,(str,Path)):
            p=Path(registry)
            protected=any(part.lower() in ('resource','data','datas','outputs') for part in p.parts) or p.name.lower().startswith('data_active')
            if not protected:raise PlatformError('registry_private_location_required',503)
            registry=json.loads(p.read_text(encoding='utf-8'))
        if registry.get('format')!='jungsi.data-registry/v1':raise PlatformError('registry_format_invalid',503)
        self.entries={}
        for entry in registry['entries']:
            identity=(entry['kind'],entry['key'])
            if identity in self.entries:raise PlatformError('registry_identity_conflict',503)
            if not re.fullmatch(r'[0-9a-f]{64}',entry['sha256']):raise PlatformError('registry_hash_invalid',503)
            self.entries[identity]=entry

    def load(self,kind,key):
        entry=self.entries.get((kind,key))
        if entry is None:return None,None
        if entry.get('status')!='approved':raise PlatformError('artifact_not_approved',503)
        payload,metadata=self.client.artifact(entry)
        if payload.get('version',payload.get('pack_version'))!=entry['version']:raise PlatformError('artifact_version_mismatch',503)
        # Preserve original source time/timezone separately in the private registry;
        # only the body's local naive time uses its explicit Seoul contract.
        if payload.get('as_of'):
            utc_instant(payload['as_of'],source_timezone=entry.get('source_timezone'))
        return payload,entry

    def get_exam_pack(self,exam_id):
        raw,entry=self.load('exam_pack',exam_id)
        if raw is None:return None
        pack=ExamPack(raw)
        if pack.exam_id!=exam_id:raise PlatformError('artifact_exam_mismatch',503)
        return pack

    def get_total_model(self,exam_id,pack_version):
        raw,entry=self.load('total_model',exam_id+':'+pack_version)
        if raw is None:return None
        model=ExamTotalModel(raw['exam_id'],raw['pack_version'],TotalScoreDistribution(
            DistributionMetadata(**raw['metadata']),[ScoreFrequency(r['total_score'],r['weight']) for r in raw['frequencies']]))
        return TotalModelBinding(model,entry['distribution_id'])

    def get_catalog(self):
        raw,entry=self.load('catalog','service')
        if raw is None:return None
        if raw.get('format')!='jungsi.catalog-release/v1' or raw.get('status')!='approved':raise PlatformError('catalog_release_invalid',503)
        for offering in raw['offerings']:
            recruitment=offering.get('recruitment')
            if not isinstance(recruitment,dict):continue
            if recruitment.get('deadline_at') is not None:
                recruitment['deadline_at']=utc_text(utc_instant(recruitment['deadline_at'],source_timezone=entry.get('source_timezone')))
            for change in recruitment.get('changes',[]):
                if change.get('announced_at') is not None:
                    change['announced_at']=utc_text(utc_instant(change['announced_at'],source_timezone=entry.get('source_timezone')))
        return CatalogRelease(raw['version'],raw['status'],utc_instant(raw['as_of'],source_timezone=entry.get('source_timezone')),
                              tuple(raw['offerings']),tuple(raw.get('history',[])))

    def get_conversion(self,offering_id):
        raw,entry=self.load('conversion',offering_id)
        if raw is None:return None
        if raw.get('format')!='jungsi.university-conversion-release/v1':raise PlatformError('conversion_release_invalid',503)
        try:
            return UniversityConversionRelease(raw['version'],raw['status'],raw['academic_year'],raw['exam_id'],
                raw['source_pack_version'],raw['exam_type'],ConversionRelease(raw['release_id'],raw['rules'],raw['bindings']),
                tuple(raw['bindings']),raw.get('mock_compatibility'))
        except (KeyError,TypeError,ValueError) as error:
            raise PlatformError('conversion_release_invalid',503) from error

    def get_analysis(self,offering_id):
        raw,entry=self.load('analysis',offering_id)
        if raw is None:return None
        if raw.get('format')!='jungsi.offering-analysis-release/v1':raise PlatformError('analysis_release_invalid',503)
        bridges={}
        for year,bridge in raw['bridges'].items():
            bridges[int(year)]={k:({area:RankDistribution(**values) for area,values in value.items()}
                                  if k in ('source','target') else RankDistribution(**value)) for k,value in bridge.items()}
        return OfferingAnalysis(raw['version'],raw['status'],raw['source_pack_version'],
            ConversionRelease(raw['release_id'],raw['rules'],raw['bindings']),
            {int(y):v for y,v in raw['offerings_by_year'].items()},bridges,BridgePolicy(**raw['policy']),
            {int(y):UniversityScoreDistribution(v) for y,v in raw['curves'].items()},
            {int(y):v for y,v in raw['decisions'].items()})
