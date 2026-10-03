"""Invented control-flow fixtures only; no student, admission or production data.

Approval/official flags intentionally exercise existing production guards using
fabricated in-memory inputs. They are never a publishable release or model.
"""
from copy import deepcopy
from datetime import timedelta
from threading import RLock
from uuid import uuid4
from test_overall_analysis_service import synthetic_pack, synthetic_model
from jungsi_touch.application.platform_ports import CatalogRelease, OfferingAnalysis, PlatformError, VerifiedSession
from jungsi_touch.application.ports import TotalModelBinding, ReportAccessRecord
from jungsi_touch.application.time_contract import utc_instant, utc_text
from jungsi_touch.year_equating import RankDistribution, BridgePolicy
from jungsi_touch.university_conversion import ConversionRelease
from jungsi_touch.admission_result_percentile import UniversityScoreDistribution, MATCH_FIELDS
from jungsi_touch.percentile import POPULATION_ID


class FrozenClock:
    def __init__(self):self.value=utc_instant('2026-10-03T12:00:00Z')
    def now(self):return self.value
    def advance(self,seconds=1):self.value+=timedelta(seconds=seconds)


class SyntheticRepository:
    production_allowed=False
    def __init__(self):
        self.profiles={};self.reports={};self.revisions={};self.requests={};self.entitlements={};self.audit=[];self.access_calls=[];self._lock=RLock()
    def active_paid(self,owner,now):
        row=self.entitlements.get(owner)
        return bool(row and row['active'] and row['starts_at']<=now<row['expires_at'])
    def get_profile(self,owner,pid):
        p=self.profiles.get(pid)
        return deepcopy(p) if p and p['owner_id']==owner else None
    def create_profile(self,owner,scores,confirmed,now,key,digest,operation='score-profile.create'):
        with self._lock:
            old=self.replay(owner,operation,key,digest)
            if old is not None:return old
            p=dict(profile_id='profile-'+uuid4().hex,owner_id=owner,scores=deepcopy(scores),confirmed=confirmed,created_at=utc_text(now))
            self.profiles[p['profile_id']]=p;self.remember(owner,operation,key,digest,p);return deepcopy(p)
    def lookup_access(self,rid):
        self.access_calls.append(rid)
        r=self.reports.get(rid)
        return ReportAccessRecord(r['owner_id'],self.profiles[r['profile_id']]['confirmed']) if r else None
    def get_report(self,owner,rid):
        r=self.reports.get(rid)
        return deepcopy(r) if r and r['owner_id']==owner else None
    def replay(self,owner,operation,key,digest):
        old=self.requests.get((owner,operation,key))
        if old:
            if old[0]!=digest:raise PlatformError('idempotency_conflict',409)
            return deepcopy(old[1])
        return None
    def remember(self,owner,operation,key,digest,record):
        self.requests[(owner,operation,key)]=(digest,deepcopy(record));self.audit.append((owner,operation,record.get('revision',1)))
    def write_report(self,owner,rid,pid,body,expected,now,operation,key,digest,*,no_op=False):
        with self._lock:
            old=self.replay(owner,operation,key,digest)
            if old is not None:return old
            if self.get_profile(owner,pid) is None:raise PlatformError('profile_not_found',404)
            if rid:
                existing=self.get_report(owner,rid)
                if not existing:raise PlatformError('report_not_found',404)
                if existing['revision']!=expected:raise PlatformError('revision_conflict',409)
                if no_op:
                    self.remember(owner,operation,key,digest,existing)
                    return existing
                version=existing['revision']+1
            else:rid='report-'+uuid4().hex;version=1
            record=dict(report_id=rid,owner_id=owner,profile_id=pid,revision=version,body=deepcopy(body),updated_at=utc_text(now))
            self.reports[rid]=record;self.revisions[(rid,version)]=deepcopy(record)
            self.remember(owner,operation,key,digest,record);return deepcopy(record)
    def active_reports(self):return deepcopy(list(self.reports.values()))


class SyntheticSessions:
    production_allowed=False
    def __init__(self,clock):self.clock=clock
    def verify(self,token,now):
        if token.startswith('SYNTHETIC-'):
            return VerifiedSession(token,self.clock.now()+timedelta(hours=1) if token!='SYNTHETIC-expired' else self.clock.now())
        return None


def rule(year,label):
    fields=('korean_standard_score','math_standard_score','inquiry1_standard_score','inquiry2_standard_score')
    return dict(format='jungsi.university-rule/v1',academic_year=year,rule_id='SYNTHETIC-'+label,
                rule_version='SYNTHETIC-'+label+'-'+str(year),review_status='calculation_verified',data_kind='official_rule',
                score_scope='csat_component',source_refs=['SYNTHETIC-CONTROL-FLOW-ONLY'],
                inputs={f:dict(type='number',min=1,max=9,integer=True) for f in fields},tables={},
                nodes={'total':{'op':'sum','args':[{'op':'input','field':f} for f in fields]}},output_node='total',
                display_places=2,official_max_score=36,non_csat_components=[])


class SyntheticData:
    production_allowed=False
    def __init__(self,clock):
        self.clock=clock;self.pack=synthetic_pack();self.model=synthetic_model(self.pack);self.calls=[]
        self.binding=TotalModelBinding(self.model,self.model.distribution.metadata.distribution_id)
        rows=[]
        for label in ('A','B','C'):
            for year in (2024,2025,2026,2027):
                rows.append(dict(offering_id=f'SYNTHETIC-{label}-{year}',academic_year=year,university_id='SYNTHETIC-'+label,
                    university_name='가상'+label+'대학교',campus='가상캠퍼스',department='가상간호' if label=='A' else '가상분석',
                    track='가상일반',group='가',region='가상지역',wildcard_group='nursing' if label=='A' else None,
                    practical_required=label=='C',recruitment=dict(initial_count=0,rollover_change=None,final_count=None,
                        count_status='not_published',changes=[],source_url='https://example.invalid/synthetic',source_as_of='2026-10-03',deadline='2027-01-01')))
        history=[dict(rows[0],metric_name='가상 발표 평균',metric_definition='가상 최종 등록자 평균 수능 부분점수',value='20',unit='점',
                      original_scale='가상척도',publication_status='published',source_url='https://example.invalid/synthetic',source_as_of='2026-10-03',verification_status='verified_official')]
        self.catalog=CatalogRelease('SYNTHETIC-catalog.v1','approved',clock.now(),tuple(rows),tuple(history))
        self.bundles={}
        for label in ('A','B'):
            bundle=self.bundle(label)
            for year in (2024,2025,2026,2027):self.bundles[f'SYNTHETIC-{label}-{year}']=bundle
    def get_exam_pack(self,exam_id):self.calls.append(('pack',exam_id));return self.pack
    def get_total_model(self,exam_id,version):self.calls.append(('model',exam_id,version));return self.binding
    def get_catalog(self):self.calls.append(('catalog',));return self.catalog
    def get_analysis(self,oid):self.calls.append(('analysis',oid));return self.bundles.get(oid)
    def bundle(self,label):
        years=(2024,2025,2026,2027)
        rules=[rule(y,label) for y in years];offers={y:f'SYNTHETIC-{label}-{y}' for y in years}
        release=ConversionRelease('SYNTHETIC-conversion.v1',rules,[dict(academic_year=y,offering_pk=offers[y],rule_version=r['rule_version']) for y,r in zip(years,rules)])
        definitions=dict(korean='국어',math='수학',inquiry1='가상탐구가',inquiry2='가상탐구나')
        def marginal(exam,year,version):
            return {area:RankDistribution(exam_id=exam,academic_year=year,subject_id=subject,version=version,
                        population_id='official_subject_population:'+subject,counts={s:1 for s in range(1,10)},expected_total=9,
                        kind='observed_counts',status='source_verified',source_refs=['SYNTHETIC'],
                        reported_scores={s:{'grade':10-s,'source_ref':'SYNTHETIC'} for s in range(1,10)}) for area,subject in definitions.items()}
        def total(exam,year,version):
            return RankDistribution(exam_id=exam,academic_year=year,subject_id='total',version=version,population_id=POPULATION_ID,
                counts={20:3,30:4,36:2},expected_total=9,kind='observed_counts',status='validated',source_refs=['SYNTHETIC'])
        bridges={};curves={};decisions={}
        for year,r in zip(years,rules):
            exam=f'SYNTHETIC-csat-{year}';target_version=f'SYNTHETIC-target-{year}'
            bridges[year]=dict(source=marginal(self.pack.exam_id,2027,self.pack.pack_version),target=marginal(exam,year,target_version),
                source_total=total(self.pack.exam_id,2027,self.model.distribution.metadata.distribution_id),target_total=total(exam,year,target_version))
            metadata=dict(academic_year=year,exam_id=exam,rule_id=r['rule_id'],rule_version=r['rule_version'],score_metric='university_converted_csat_score',
                score_scope='csat_component',score_scale_id='SYNTHETIC-scale',bonus_treatment='excluded',population_id=POPULATION_ID,
                population_definition='SYNTHETIC nine fictional examinees',curve_id=f'SYNTHETIC-{label}-{year}',curve_version=f'SYNTHETIC-curve-{label}-{year}',
                source_model_id='SYNTHETIC',source_model_version='SYNTHETIC-v1',status='approved',rule_review_status='calculation_verified',
                complete=True,population_verified=True,kind='observed_counts',score_min=4,score_max=36,expected_total_weight=9)
            curves[year]=UniversityScoreDistribution(dict(format='jungsi.university-score-distribution/v1',metadata=metadata,source_refs=['SYNTHETIC'],
                frequencies=[dict(converted_score=4,weight=2),dict(converted_score=20,weight=3),dict(converted_score=36,weight=4)]))
            decisions[year]=dict(status='approved',version=f'SYNTHETIC-policy-{label}-{year}',
                context=dict({k:metadata[k] for k in MATCH_FIELDS},offering_id=offers[year],curve_version=metadata['curve_version'],analysis_version='SYNTHETIC-analysis.v1'),
                eligibility_policy=dict(status='approved',version='SYNTHETIC-eligibility.v1',requirements=[dict(field='english_grade',operator='at_most',value=3)]),
                ranges=[dict(lower=0,upper=25,category='challenge'),dict(lower=25,upper=33,category='core'),dict(lower=33,upper=100,category='room')],
                baseline=dict(status='approved',version=target_version,academic_year=year,exam_id=exam,population_id=POPULATION_ID,tie_policy='include_equal'))
            decisions[year]['evidence']=dict(status='approved',version='SYNTHETIC-evidence.v1',context=deepcopy(decisions[year]['context']),
                historical_metrics=[dict(academic_year=2024,metric_name='가상 발표 평균',metric_definition='가상 등록자 평균',value='20',unit='점',original_scale='가상척도',publication_status='published',verification_status='verified_official',source_url='https://example.invalid/synthetic',source_as_of='2026-10-03')],
                forecast_70=dict(status='approved',version='SYNTHETIC-forecast.v1',value='26',unit='점',definition='가상 올해 등록자 예상 70% 기준선'),
                expected_acceptance_range=dict(status='approved',policy_version=decisions[year]['version'],lower='25',upper='33',unit='점',definition='가상 지원 판단용 채택 구간'))
        return OfferingAnalysis('SYNTHETIC-analysis.v1','approved',self.pack.pack_version,release,offers,bridges,
            BridgePolicy('SYNTHETIC-bridge.v1','validated','SYNTHETIC-validation',max_subject_rank_shift='0.2'),curves,decisions)


def score_input():
    return dict(exam_id='SYNTHETIC-mock',pack_version='SYNTHETIC-pack.v1',
        korean=dict(standard_score=9,choice='가상국어선택'),math=dict(standard_score=8,choice='가상수학선택'),
        inquiry=[dict(subject='가상탐구가',standard_score=7),dict(subject='가상탐구나',standard_score=6)],english_grade=3,korean_history_grade=2)
