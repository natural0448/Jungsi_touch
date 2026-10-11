"""Twelve authorized workflows. Adapters own HTTP, Supabase and Drive calls."""
from copy import deepcopy
import base64
import hashlib
import json
from fractions import Fraction
from urllib.parse import urlsplit, parse_qs
from .authorization import AccessController
from .overall_analysis import OverallAnalysisService, _identifier
from .offering_analysis import evaluate_offering
from .forecast_assessment import evaluate_release, blocked
from .university_scoring import UniversityScoringService
from .university_percentile import UniversityPercentileService
from .platform_ports import CatalogRelease, PlatformError
from .time_contract import utc_instant, utc_text, calendar_date

OFFERING_FIELDS = ('offering_id','academic_year','university_id','university_name','campus','department',
                   'track','group','region','wildcard_group')
HISTORY_FIELDS = OFFERING_FIELDS + ('metric_name','metric_definition','value','unit','original_scale',
                                   'publication_status','source_url','source_as_of')
RECRUITMENT_FIELDS = ('initial_count','rollover_change','final_count','count_status','changes','source_url','source_as_of','deadline','deadline_at')
CHANGE_FIELDS = ('kind','delta','announced_date','announced_at','source_url','status','reason','revision')
WRITES = {'score-profile.create','overall.analyze','university.analyze','candidates.build','shortlist.update'}


def shape(value, required=(), optional=()):
    if not isinstance(value, dict) or not set(required)<=set(value) or set(value)-set(required)-set(optional):
        raise PlatformError('invalid_request')
    return value


def identifier(value):
    if not _identifier(value): raise PlatformError('invalid_identifier')
    return value


def revision(value):
    if type(value) is not int or value<1: raise PlatformError('invalid_revision')
    return value


def payload_hash(body, params):
    return hashlib.sha256(json.dumps([body,params],sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()


def public(row, fields):
    return {key:deepcopy(row.get(key)) for key in fields}


def source_url(value):
    if value is None: return None
    if not isinstance(value,str): raise PlatformError('public_source_invalid',503)
    parsed=urlsplit(value)
    if parsed.scheme not in ('https','http') or not parsed.hostname or parsed.username or parsed.password or set(parse_qs(parsed.query)) & {'token','access_token','refresh_token','authorization','api_key'}:
        raise PlatformError('public_source_invalid',503)
    return value


def changes_dto(rows, *, source_timezone=None):
    if not isinstance(rows,list): raise PlatformError('recruitment_changes_invalid',503)
    result=[]
    for row in rows:
        if not isinstance(row,dict): raise PlatformError('recruitment_changes_invalid',503)
        item=public(row,CHANGE_FIELDS)
        if any(value is not None and type(value) not in (str,int) for value in item.values()): raise PlatformError('recruitment_changes_invalid',503)
        if item['announced_at'] is not None:item['announced_at']=utc_text(utc_instant(item['announced_at'],source_timezone=source_timezone))
        if item['announced_date'] is not None:item['announced_date']=calendar_date(item['announced_date']).isoformat()
        item['source_url']=source_url(item['source_url'])
        result.append(item)
    return result


class PlatformService:
    def __init__(self, repository, data, clock, forecast_repository=None, forecast_service=None, session_service=None):
        self.forecast_repository=forecast_repository
        self.forecast_service=forecast_service
        self.session_service=session_service
        self.repository, self.data, self.clock = repository, data, clock
        self.access = AccessController(repository)
        self.overall = OverallAnalysisService(self.access, data)
        self.scoring = UniversityScoringService(data)
        self.percentile = UniversityPercentileService(data)

    def execute(self, operation, actor, *, body=None, query=None, params=None, key=None):
        params, query = params or {}, query or {}
        if operation=='session.read':
            shape({} if body is None else body);shape(query)
            if self.session_service is None:raise PlatformError('auth_not_configured',503)
            return self.session_service.read(actor)
        if operation.startswith('forecast.'):
            if self.forecast_service is None:raise PlatformError('forecast_not_configured',503)
            return self.forecast_service.execute(operation,actor,body=body,query=query,params=params,key=key)
        # Policy lookup precedes shape validation, data access and replay lookup.
        decision = self.access.operation_access(operation, actor, report_id=params.get('report_id'))
        if not decision.allowed: raise PlatformError(decision.status, decision.http_status)
        body = {} if body is None else body
        if operation in WRITES:
            identifier(key)
            digest=payload_hash(body,params)
            replay=self.repository.replay(actor.subject_id,operation,key,digest)
            if replay is not None: return self.report_dto(actor,replay) if operation!='score-profile.create' else self.profile_dto(replay)
        else: digest=None
        if operation=='score-profile.create':
            shape(body,('scores','confirmed')); shape(query)
            if type(body['confirmed']) is not bool: raise PlatformError('invalid_confirmation')
            self.overall.analyze(actor,body['scores'])
            profile=self.repository.create_profile(actor.subject_id,deepcopy(body['scores']),body['confirmed'],
                                                    utc_instant(self.clock.now()),key,digest)
            return self.profile_dto(profile)
        if operation=='overall.analyze': return self.create_overall(actor,body,query,key,digest)
        if operation in {'history.search','offerings.search'}:
            shape(body); return self.search(operation,query)
        if operation in {'recruitment.read','offering.read'}:
            shape(body); shape(query)
            release=self.catalog()
            if release is None: return dict(status='pending',reason_code='catalog_release_missing',offering=None)
            row=self.offering(release,params.get('offering_id'))
            if operation=='offering.read': return dict(status='ready',reason_code=None,offering=public(row,OFFERING_FIELDS),catalog_version=release.version)
            recruit=row.get('recruitment')
            if not isinstance(recruit,dict): return dict(status='pending',reason_code='recruitment_not_published',offering=public(row,OFFERING_FIELDS),recruitment=None)
            result=public(recruit,RECRUITMENT_FIELDS)
            result['changes']=changes_dto(recruit.get('changes',[]),source_timezone=recruit.get('source_timezone'))
            result['source_url']=source_url(result['source_url'])
            if result['source_as_of'] is not None:result['source_as_of']=calendar_date(result['source_as_of']).isoformat()
            if any(result[field] is not None and type(result[field]) is not int for field in ('initial_count','rollover_change','final_count')):
                raise PlatformError('recruitment_count_invalid',503)
            if result['deadline'] is not None: result['deadline']=calendar_date(result['deadline']).isoformat()
            if result['deadline_at'] is not None:result['deadline_at']=utc_text(utc_instant(result['deadline_at'],source_timezone=recruit.get('source_timezone')))
            return dict(status='ready',reason_code=None,offering=public(row,OFFERING_FIELDS),recruitment=result,catalog_version=release.version)
        record=self.report(actor,params.get('report_id'))
        if operation=='report.read': shape(body);shape(query);return self.report_dto(actor,record)
        if operation=='report.export':
            shape(body);shape(query)
            return dict(format='jungsi.counseling-snapshot/v1',status='ready',snapshot_version=record['revision'],
                        generated_at=utc_text(self.clock.now()),report=self.report_dto(actor,record))
        if operation=='statistics.read': shape(body);shape(query);return self.statistics(record,params.get('offering_id'))
        shape(query)
        if operation in {'university.analyze','candidates.build'}:
            shape(body,('expected_version',),('offering_ids',) if operation=='university.analyze' else ())
            expected=revision(body['expected_version'])
            if record['revision']!=expected: raise PlatformError('revision_conflict',409)
            release=self.catalog()
            updated=deepcopy(record['body'])
            profile=self.repository.get_profile(actor.subject_id,record['profile_id'])
            if release is None:
                updated['analysis_status']=dict(status='pending',reason_code='catalog_release_missing')
            else:
                if operation=='university.analyze':
                    ids=body.get('offering_ids')
                    if not isinstance(ids,list) or not 1<=len(ids)<=100 or len(set(map(str,ids)))!=len(ids): raise PlatformError('invalid_offering_ids')
                    rows=[self.offering(release,oid) for oid in ids]
                else: rows=[row for row in self.service_rows(release) if row['academic_year']==updated['overall']['exam']['academic_year']]
                results={}
                for offering in rows:
                    conversion=self.scoring.calculate(offering,profile)
                    percentile=self.percentile.calculate(offering,conversion)
                    try: bundle=self.data.get_analysis(offering['offering_id'])
                    except PlatformError as error:
                        assessment=evaluate_offering(offering,profile,updated['overall'],None,conversion=conversion,percentile=percentile)
                        assessment['reason_code']=error.code
                    except (OSError,ValueError,TypeError,KeyError,AttributeError):
                        assessment=evaluate_offering(offering,profile,updated['overall'],None,conversion=conversion,percentile=percentile)
                        assessment['reason_code']='analysis_release_invalid'
                    else:assessment=evaluate_offering(offering,profile,updated['overall'],bundle,conversion=conversion,percentile=percentile)
                    if self.forecast_repository is not None:
                        try:
                            if self.forecast_service is None:raise PlatformError('forecast_not_configured',503)
                            published=self.forecast_service.validated_release(offering['offering_id'])
                            if published is not None:
                                history=assessment.get('decision_evidence',{}).get('historical_metrics',[])
                                newer=evaluate_release(offering,profile,conversion,percentile,published,historical_metrics=history)
                                newer['years']=assessment['years']
                                newer['advantage']=assessment.get('advantage') if percentile.population_scope=='whole_complete' else None
                                if newer['advantage'] is not None:
                                    newer['recommendation_reasons'].extend(deepcopy([r for r in assessment.get('recommendation_reasons',[]) if r['code'] in ('converted_score_position_gain','converted_score_position_loss','converted_score_position_equal')]))
                                assessment=newer
                        except PlatformError as error:
                            assessment.update(status='pending',category='pending',reason_code=error.code)
                    results[offering['offering_id']]=assessment
                updated['analyses'].update(results)
                updated['catalog_version']=release.version
                updated['analysis_status']=dict(status='ready' if any(r['status']=='ready' for r in results.values()) else 'pending',
                    reason_code=None if any(r['status']=='ready' for r in results.values()) else 'offering_analysis_pending')
                if operation=='candidates.build': updated['candidates']=self.candidates(rows,results,release.version)
                for oid,selection in updated['shortlist'].items():
                    selection['assessment_status']=updated['analyses'].get(oid,{}).get('status','pending')
            written=self.repository.write_report(actor.subject_id,record['report_id'],record['profile_id'],updated,
                expected,utc_instant(self.clock.now()),operation,key,digest)
            return self.report_dto(actor,written)
        if operation=='shortlist.update':
            shape(body,('selected','expected_version'))
            if type(body['selected']) is not bool: raise PlatformError('invalid_selection')
            expected=revision(body['expected_version'])
            if record['revision']!=expected: raise PlatformError('revision_conflict',409)
            oid=identifier(params.get('offering_id'))
            release=self.catalog()
            if release is None: raise PlatformError('catalog_release_missing',503)
            self.offering(release,oid)
            updated=deepcopy(record['body'])
            old=updated['shortlist'].get(oid)
            if old and old['selected']==body['selected']:
                written=self.repository.write_report(actor.subject_id,record['report_id'],record['profile_id'],updated,
                    expected,utc_instant(self.clock.now()),operation,key,digest,no_op=True)
                return self.report_dto(actor,written)
            updated['shortlist'][oid]=dict(selected=body['selected'],changed_at=utc_text(self.clock.now()),
                assessment_status=updated['analyses'].get(oid,{}).get('status','pending'),profile_id=record['profile_id'],catalog_version=release.version)
            written=self.repository.write_report(actor.subject_id,record['report_id'],record['profile_id'],updated,
                expected,utc_instant(self.clock.now()),operation,key,digest)
            return self.report_dto(actor,written)
        raise PlatformError('route_not_found',404)

    @staticmethod
    def profile_dto(profile):
        return dict(profile_id=profile['profile_id'],profile_version=profile['profile_id'],confirmed=profile['confirmed'],created_at=profile['created_at'])

    def create_overall(self,actor,body,query,key,digest):
        shape(query)
        if 'profile_id' not in body:
            # Preserve the DEV-001 direct-score input contract; persisted score editing
            # uses a newly created profile, never in-place modification of old scores.
            result=self.overall.analyze(actor,body)
            profile=self.repository.create_profile(actor.subject_id,deepcopy(body),False,utc_instant(self.clock.now()),key,digest,operation='overall.profile')
            report_id,expected=None,None
        else:
            shape(body,('profile_id',),('report_id','expected_version'))
            profile=self.repository.get_profile(actor.subject_id,identifier(body['profile_id']))
            if profile is None: raise PlatformError('profile_not_found',404)
            report_id=body.get('report_id');expected=None
            if report_id is not None:
                decision=self.access.operation_access('report.read',actor,report_id=report_id)
                if not decision.allowed: raise PlatformError(decision.status,decision.http_status)
                expected=revision(body.get('expected_version'))
            elif 'expected_version' in body: raise PlatformError('invalid_request')
            result=self.overall.analyze(actor,profile['scores'])
        previous=self.report(actor,report_id) if report_id else None
        shortlist=deepcopy(previous['body']['shortlist']) if previous else {}
        for row in shortlist.values(): row['assessment_status']='needs_revalidation'
        snapshot=dict(overall=result,analyses={},candidates=None,shortlist=shortlist,catalog_version=None,
                      analysis_status=dict(status='pending',reason_code='offering_analysis_not_requested'))
        written=self.repository.write_report(actor.subject_id,report_id,profile['profile_id'],snapshot,expected,
            utc_instant(self.clock.now()),'overall.analyze',key,digest)
        return self.report_dto(actor,written)

    def report(self,actor,report_id):
        result=self.repository.get_report(actor.subject_id,identifier(report_id))
        if result is None: raise PlatformError('report_not_found',404)
        return result

    @staticmethod
    def report_dto(actor,record):
        response=dict(format='jungsi.persisted-report/v1',report_id=record['report_id'],report_version=record['revision'],
                      profile_id=record['profile_id'],updated_at=record['updated_at'],overall=deepcopy(record['body']['overall']))
        if actor.paid_active:
            response.update(analyses=deepcopy(record['body']['analyses']),candidates=deepcopy(record['body']['candidates']),
                            shortlist=deepcopy(record['body']['shortlist']),analysis_status=deepcopy(record['body']['analysis_status']))
        return response

    def catalog(self):
        try: release=self.data.get_catalog()
        except OSError: raise PlatformError('catalog_unavailable',503)
        if release is None: return None
        if not isinstance(release,CatalogRelease): raise PlatformError('catalog_release_invalid',503)
        if release.status!='approved': raise PlatformError('catalog_release_not_approved',503)
        identifier(release.version);utc_instant(release.as_of)
        ids=[r['offering_id'] for r in release.offerings]
        if len(ids)!=len(set(ids)): raise PlatformError('catalog_identity_conflict',503)
        for row in release.offerings:
            if type(row.get('academic_year')) is not int or row['academic_year'] not in (2024,2025,2026,2027) or type(row.get('practical_required')) is not bool:
                raise PlatformError('catalog_scope_unverified',503)
            if any(row.get(k) is not None and not isinstance(row[k],str) for k in OFFERING_FIELDS if k!='academic_year'):
                raise PlatformError('catalog_field_invalid',503)
        for row in release.history:
            if row.get('verification_status')!='verified_official':continue
            if row.get('value') is not None and type(row['value']) not in (str,int):raise PlatformError('published_metric_invalid',503)
            for field in HISTORY_FIELDS:
                if field not in ('academic_year','value') and row.get(field) is not None and not isinstance(row[field],str):raise PlatformError('published_metric_invalid',503)
            source_url(row.get('source_url'))
            if row.get('source_as_of') is not None:calendar_date(row['source_as_of'])
        return release

    @staticmethod
    def service_rows(release):
        return [row for row in release.offerings if row.get('practical_required') is False]

    def offering(self,release,oid):
        identifier(oid)
        row=next((r for r in self.service_rows(release) if r['offering_id']==oid),None)
        if row is None: raise PlatformError('offering_not_found',404)
        return row

    def search(self,operation,query):
        shape(query,(),('academic_year','university_q','department_q','region','group','cursor','limit'))
        clean={}
        for field in ('university_q','department_q','region','group'):
            value=query.get(field,'')
            if not isinstance(value,str) or len(value)>100: raise PlatformError('invalid_query')
            clean[field]=value.casefold().strip()
        year=query.get('academic_year')
        if year is not None:
            if isinstance(year,str) and year.isdigit(): year=int(year)
            if type(year) is not int or year not in (2024,2025,2026,2027): raise PlatformError('invalid_year')
        limit=query.get('limit',50)
        if isinstance(limit,str) and limit.isdigit(): limit=int(limit)
        if type(limit) is not int or not 1<=limit<=100: raise PlatformError('invalid_limit')
        release=self.catalog()
        if release is None: return dict(status='pending',reason_code='catalog_release_missing',items=None,matching_offering_count=None,matching_school_count=None,next_cursor=None,catalog_version=None)
        rows=self.service_rows(release)
        if operation=='history.search':
            service_ids={r['offering_id'] for r in rows}
            rows=[r for r in release.history if r.get('offering_id') in service_ids and r.get('verification_status')=='verified_official']
        rows=[r for r in rows if (year is None or r['academic_year']==year) and
              clean['university_q'] in ((r.get('university_name') or '')+' '+(r.get('campus') or '')).casefold() and
              clean['department_q'] in (r.get('department') or '').casefold() and
              (not clean['region'] or clean['region']==(r.get('region') or '').casefold()) and
              (not clean['group'] or clean['group']==(r.get('group') or '').casefold())]
        rows.sort(key=lambda r:(r['academic_year'],r['university_id'],r['offering_id'],r.get('metric_name','')))
        signature=hashlib.sha256(json.dumps([operation,clean,year],sort_keys=True).encode()).hexdigest()[:16]
        start=0
        if query.get('cursor'):
            try:
                version,index,query_hash=json.loads(base64.urlsafe_b64decode(query['cursor']).decode())
                if version!=release.version or query_hash!=signature: raise PlatformError('cursor_version_mismatch',409)
                if type(index) is not int or not 0<=index<=len(rows): raise ValueError()
                start=index
            except PlatformError: raise
            except (ValueError,TypeError,UnicodeError): raise PlatformError('invalid_cursor')
        end=start+limit
        cursor=base64.urlsafe_b64encode(json.dumps([release.version,end,signature]).encode()).decode() if end<len(rows) else None
        fields=HISTORY_FIELDS if operation=='history.search' else OFFERING_FIELDS
        return dict(status='ready',reason_code=None,items=[public(r,fields) for r in rows[start:end]],
                    matching_offering_count=len({r['offering_id'] for r in rows}),matching_school_count=len({r['university_id'] for r in rows}),
                    catalog_version=release.version,as_of=utc_text(release.as_of),next_cursor=cursor)

    @staticmethod
    def candidates(rows,analyses,version):
        groups={};wildcards=[];pending=[];outside=[];ineligible=[]
        for row in rows:
            assessment=analyses[row['offering_id']]
            state=dict(offering_id=row['offering_id'],category=assessment['category'],reason_code=assessment['reason_code'])
            if assessment['status']=='ineligible':ineligible.append(state);continue
            if assessment['status']=='ready' and assessment['category']=='outside':outside.append(state);continue
            if assessment['status']!='ready' or assessment['category'] not in ('challenge','core','room'):
                pending.append(dict(offering_id=row['offering_id'],category=assessment['category'],reason_code=assessment['reason_code']));continue
            item=dict(offering=public(row,OFFERING_FIELDS),assessment=deepcopy(assessment))
            groups.setdefault(row['university_id'],dict(university_id=row['university_id'],university_name=row['university_name'],offerings=[]))['offerings'].append(item)
            if row.get('wildcard_group') in ('nursing','health','education'): wildcards.append(item)
        ready=bool(groups) or not pending
        return dict(status='ready' if ready else 'pending',reason_code=None if ready else 'approved_candidates_missing',
                    basic_university_groups=list(groups.values()),wildcards=wildcards,pending_offerings=pending,outside_offerings=outside,ineligible_offerings=ineligible,catalog_version=version)

    def statistics(self,record,oid):
        identifier(oid)
        own=record['body']['analyses'].get(oid)
        base=dict(status='pending',reason_code='compatible_analysis_missing',recommended_count=None,selected_count=None,
                  recommended_rank=None,selected_rank=None,updated_at=utc_text(self.clock.now()),scope='service_users_not_actual_university_applicants')
        if not own or own['status']!='ready': return base
        # Profile versions differ between students. Only the same adopted scoring
        # context is compared; each student's latest immutable report revision wins.
        context={k:v for k,v in own['versions'].items() if k!='profile'}
        students={}
        for report in sorted(self.repository.active_reports(),key=lambda r:(utc_instant(r['updated_at']),r['report_id'])):
            students[report['owner_id']]=report
        recommended,selected=[],[]
        for report in students.values():
            result=report['body']['analyses'].get(oid)
            if not result or result['status']!='ready' or {k:v for k,v in result['versions'].items() if k!='profile'}!=context: continue
            score=Fraction(result['converted_score'])
            candidates=report['body'].get('candidates') or {}
            listed={i['offering']['offering_id'] for g in candidates.get('basic_university_groups',[]) for i in g['offerings']}
            if oid in listed: recommended.append((report['owner_id'],score))
            selection=report['body']['shortlist'].get(oid,{})
            if selection.get('selected') and selection.get('profile_id')==report['profile_id'] and selection.get('assessment_status')=='ready': selected.append((report['owner_id'],score))
        def rank(rows):
            score=next((s for owner,s in rows if owner==record['owner_id']),None)
            if score is None: return None
            return dict(rank=1+sum(s>score for _,s in rows),tie_count=sum(s==score for _,s in rows),population_count=len(rows),tie_policy='competition')
        base.update(status='ready',reason_code=None,recommended_count=len(recommended),selected_count=len(selected),
                    recommended_rank=rank(recommended),selected_rank=rank(selected),versions=context)
        return base
