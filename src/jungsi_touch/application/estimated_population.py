"""Private estimation workflow. No HTTP route or student-controlled approval."""
from copy import deepcopy
from dataclasses import dataclass
from typing import Protocol
import re
import numpy as np

from ..exam_pack import ExamPack
from ..university_conversion import ConversionRule
from ..admission_result_percentile import UniversityScoreDistribution,numeric
from ..estimated_profiles import generate_candidate_profiles,digest,require,complete_mask
from ..estimated_fitting import fit_estimated_joint,validate_policy_context
from ..estimated_validation import validate_estimate,reference_residuals,reference_feasibility_certificate,validate_serialized_weights
from ..estimated_curves import build_total_model,build_university_distribution,serialize_cohort_weights,decimal_string
from .overall_analysis import _identifier


@dataclass(frozen=True)
class EstimationInputs:
    pack: dict
    policy: dict
    scenarios: tuple[dict,...]
    complete_count: int | str
    total_metadata: dict
    reference: dict | None = None
    independent_references: tuple[dict,...] = ()
    universities: tuple[dict,...] = ()
    source_manifest: dict | None = None


class EstimationInputProvider(Protocol):
    def get_estimation_inputs(self,version: str) -> EstimationInputs: ...


class EstimationArtifactStore(Protocol):
    def begin(self,run_id: str,manifest: dict) -> None: ...
    def append(self,run_id: str,name: str,payload: dict) -> dict: ...


class EstimateApprovalProvider(Protocol):
    def get_estimate_approval(self,run_id: str) -> dict | None: ...


def scenario_dimensions(base,other):
    dimensions=[]
    if base['seed']!=other['seed']:dimensions.append('seed')
    if base['n']!=other['n']:dimensions.append('size')
    if base['proposal']!=other['proposal']:dimensions.append('assumptions')
    if base.get('reference_mode','included')!=other.get('reference_mode','included'):dimensions.append('reference_exclusion')
    require(bool(dimensions),'sensitivity_scenario_unchanged')
    return dimensions


def reference_feasibility(pack,reference,policy,count,scenario):
    """Record necessary bounds before fitting; reference never becomes hard."""
    target=pack._data['participants']['target_population']
    require(target['count_lower_bound']<=float(count)<=target['count_upper_bound'],'model_population_mismatch')
    if reference is not None:
        from ..estimated_fitting import reference_context
        points=reference_context(pack,reference)
        selected=[points[k] for k in policy['calibration']['point_ids']]
        selected.sort(key=lambda r:r['score'])
        monotone=all(float(a['top_fraction'])>=float(b['top_fraction']) for a,b in zip(selected,selected[1:]))
    else:monotone=None
    from ..estimated_profiles import input_structure
    certificate=reference_feasibility_certificate(pack,reference,count,input_structure(pack,scenario['proposal'].get('vocational_common_subject'))) if reference is not None else None
    if policy['validation'].get('reference_validation_role')=='diagnostic_excluded_incompatible':
        require(certificate is not None and certificate['status']=='incompatible' and
            policy['validation'].get('reference_exclusion_evidence',{}).get('certificate_hash')==digest(certificate),
            'reference_exclusion_unverified')
    return dict(status='reference_soft_only',population_bounds_verified=True,reference_training_tail_monotone=monotone,
        mean_bounds_certificate=certificate,
        source_definition_verified=False,reference_hard_constraints_adopted=False,
        meaning='참고 공동분포는 공식 주변도수로 식별되지 않는다. 참고값은 soft 보정/독립 평가만 허용한다.')


class EstimatedPopulationService:
    """Freeze inputs/policy first; retain failed fits and generate with this engine."""
    def __init__(self,inputs: EstimationInputProvider,store: EstimationArtifactStore):
        self.inputs,self.store=inputs,store

    def run(self,input_version,run_id,code_sha,progress=None):
        require(_identifier(input_version) and _identifier(run_id) and
            isinstance(code_sha,str) and re.fullmatch('[0-9a-f]{40}',code_sha),'invalid_estimation_run')
        inputs=deepcopy(self.inputs.get_estimation_inputs(input_version))
        require(isinstance(inputs,EstimationInputs) and bool(inputs.scenarios),'estimation_inputs_missing')
        pack=ExamPack(inputs.pack);validate_policy_context(pack,inputs.policy)
        require(len({s['version'] for s in inputs.scenarios})==len(inputs.scenarios),'duplicate_scenario_version')
        for scenario in inputs.scenarios[1:]:scenario_dimensions(inputs.scenarios[0],scenario)
        manifest=dict(format='jungsi.estimate-run/v1',version=run_id,input_version=input_version,code_sha=code_sha,
            policy=inputs.policy,policy_hash=digest(inputs.policy),input_hash=digest(inputs.pack),scenarios=inputs.scenarios,
            reference_hash=digest(inputs.reference),source_manifest=inputs.source_manifest,
            inputs_hash=digest(vars(inputs)),created_before_fit=True,data_kind='estimated_weights')
        self.store.begin(run_id,manifest)
        try:
            feasibility=reference_feasibility(pack,inputs.reference,inputs.policy,inputs.complete_count,inputs.scenarios[0])
            self.store.append(run_id,'feasibility.json',feasibility)
            results=[]
            for scenario in inputs.scenarios:
                if progress:progress(dict(stage='generating',scenario=scenario['version']))
                p,info=generate_candidate_profiles(pack,scenario)
                self.store.append(run_id,scenario['version']+'.candidates.json',
                    dict(info=info,columns={k:x.tolist() for k,x in p.items()}))
                w,fit=fit_estimated_joint(pack,p,info,inputs.reference,inputs.policy,inputs.complete_count,
                    (lambda item:progress(dict(item,stage='fitting',scenario=scenario['version']))) if progress else None)
                self.store.append(run_id,scenario['version']+'.fit.json',dict(fit=fit,normalized_weights=w.tolist()))
                validation=validate_estimate(pack,p,w,info,fit,inputs.reference,inputs.policy,
                    independent_references=inputs.independent_references)
                total,exact=build_total_model(pack,p,w,info,validation,inputs.total_metadata)
                curves=[]
                for item in inputs.universities:
                    rule=ConversionRule(item['rule'])
                    curve,ledger,checks=build_university_distribution(pack,p,w,info,rule,validation,item['metadata'],
                        mock_compatibility=item.get('mock_compatibility'))
                    self.store.append(run_id,scenario['version']+'.'+rule.data['rule_id']+'.replay.json',dict(profiles=checks,population_ledger=ledger))
                    curves.append(dict(curve=curve,population_ledger=ledger,metadata=item['metadata'],bindings=item.get('bindings',[])))
                results.append(dict(profiles=p,weights=w,info=info,fit=fit,validation=validation,total=total,curves=curves))
                self.store.append(run_id,scenario['version']+'.validation.json',validation)
            base=results[0];sensitivity=[]
            for scenario,result in zip(inputs.scenarios[1:],results[1:]):
                v=result['validation'];points=v['withheld_reference_residuals']
                deltas=[]
                for first,second in zip(base['curves'],result['curves']):
                    a=UniversityScoreDistribution(first['curve']);b=UniversityScoreDistribution(second['curve'])
                    for score in first['metadata'].get('validation_scores',[]):
                        deltas.append(float(abs(a.tail(numeric(score),inclusive=True)-b.tail(numeric(score),inclusive=True))*100))
                sensitivity.append(dict(status='validated_sensitivity' if v['checks']['official_constraints'] and result['fit']['converged'] else 'research_sensitivity',
                    proposal_hash=result['info']['proposal_hash'],candidate_hash=result['fit']['candidate_hash'],
                    weights_hash=result['fit']['weights_hash'],input_hash=result['info']['input_hash'],
                    policy_version=inputs.policy['version'],policy_hash=digest(inputs.policy),
                    official_constraints_verified=v['checks']['official_constraints'] and result['fit']['converged'],
                    dimensions=scenario_dimensions(inputs.scenarios[0],scenario),university_delta_pp=deltas,
                    point_estimates=[dict(point_id=r['point_id'],top_fraction=r['estimated_top_fraction']) for r in points]))
            validation=validate_estimate(pack,base['profiles'],base['weights'],base['info'],base['fit'],inputs.reference,
                inputs.policy,independent_references=inputs.independent_references,sensitivity=sensitivity)
            total,exact=build_total_model(pack,base['profiles'],base['weights'],base['info'],validation,inputs.total_metadata)
            curves=[]
            for item in inputs.universities:
                curve,ledger,checks=build_university_distribution(pack,base['profiles'],base['weights'],base['info'],
                    ConversionRule(item['rule']),validation,item['metadata'],mock_compatibility=item.get('mock_compatibility'))
                curves.append(dict(curve=curve,population_ledger=ledger,bindings=item.get('bindings',[])))
            mask=complete_mask(base['profiles']);other_count=numeric(pack._data['participants']['total'])-numeric(inputs.complete_count)
            other=serialize_cohort_weights(base['weights'],~mask,other_count) if other_count else tuple(numeric(0) for _ in exact)
            serialized=validate_serialized_weights(pack,base['profiles'],base['info'],tuple(a+b for a,b in zip(exact,other)),inputs.complete_count,inputs.policy)
            validation['serialized_validation']=serialized
            validation['checks']['serialized_official_constraints']=serialized['passed']
            validation['adoption_checks']['serialized_official_constraints']=serialized['passed']
            if not serialized['passed']:
                validation['status']='research_only';total['distribution']['metadata']['population_verified']=False
                for item in curves:item['curve']['metadata']['population_verified']=False
            joint=dict(format='jungsi.estimated-profiles/v1',data_kind='estimated_weights',info=base['info'],
                columns={k:x.tolist() for k,x in base['profiles'].items() if k!='prior'},
                weights=[decimal_string(a+b) for a,b in zip(exact,other)],
                complete_weights=[decimal_string(v) for v in exact],
                complete_population_weight=str(inputs.complete_count),all_population_weight=pack._data['participants']['total'])
            artifacts={}
            for name,raw in [('joint.json',joint),('total.json',total),('universities.json',dict(curves=curves)),('validation.json',validation)]:
                artifacts[name]=self.store.append(run_id,name,raw)
            receipt=dict(format='jungsi.estimate-run-receipt/v1',version=run_id,status=validation['status'],
                code_sha=code_sha,input_version=input_version,inputs_hash=manifest['inputs_hash'],policy_hash=manifest['policy_hash'],
                input_hash=manifest['input_hash'],candidate_hash=base['fit']['candidate_hash'],weights_hash=base['fit']['weights_hash'],
                validation=validation,artifacts=artifacts,source_manifest=inputs.source_manifest,
                publication_status='not_adopted',deleted_files=0)
            self.store.append(run_id,'receipt.json',receipt)
            return dict(receipt=receipt,total=total,curves=curves)
        except Exception as error:
            self.store.append(run_id,'failure.json',dict(status='failed_not_adopted',error_code=getattr(error,'code',type(error).__name__),
                code_sha=code_sha,policy_hash=manifest['policy_hash'],inputs_hash=manifest['inputs_hash']))
            raise


class EstimatedReleaseService:
    """Adopt a fresh release only through a server-owned approval port."""
    def __init__(self,approvals: EstimateApprovalProvider,store: EstimationArtifactStore):
        self.approvals,self.store=approvals,store

    def adopt(self,run_id,result,release_version):
        from fractions import Fraction
        from ..exam_pack import ExamTotalModel
        from .university_scoring import CONTEXT_FIELDS
        require(_identifier(run_id) and _identifier(release_version) and run_id!=release_version,'new_estimate_release_required')
        result=deepcopy(result);receipt=result['receipt'];v=receipt['validation']
        approval=deepcopy(self.approvals.get_estimate_approval(run_id))
        require(isinstance(approval,dict) and approval.get('status')=='approved' and
            approval.get('run_id')==run_id and approval.get('release_version')==release_version and
            approval.get('run_receipt_hash')==digest(receipt) and approval.get('code_sha')==receipt['code_sha'],
            'estimate_server_approval_missing')
        require(receipt['status']=='self_validated_estimate' and v['status']=='self_validated_estimate' and
            bool(v['adoption_checks']) and all(value is True for value in v['adoption_checks'].values()),'estimate_validation_failed')
        require(digest(result['total'])==receipt['artifacts']['total.json']['sha256'] and
            digest(dict(curves=result['curves']))==receipt['artifacts']['universities.json']['sha256'] and
            digest(v)==receipt['artifacts']['validation.json']['sha256'],'estimate_output_hash_mismatch')
        self.store.begin(release_version,dict(format='jungsi.estimate-adoption/v1',version=release_version,
            parent_run_id=run_id,approval=approval,parent_receipt_hash=digest(receipt),code_sha=receipt['code_sha']))
        total=result['total']
        require(total['distribution']['metadata']['distribution_id']!=release_version+':total','new_estimate_release_required')
        total['distribution']['metadata'].update(distribution_id=release_version+':total',status='approved',population_verified=True)
        ExamTotalModel.from_json(__import__('json').dumps(total))
        artifacts={'total.json':self.store.append(release_version,'total.json',total)}
        releases=[]
        try:
            for item in result['curves']:
                curve=item['curve'];old=deepcopy(curve);m=curve['metadata'];rule_version=m['rule_version']
                review=approval.get('rule_reviews',{}).get(rule_version)
                require(isinstance(review,dict) and review.get('curve_hash')==digest(old) and
                    review.get('candidate_hash')==receipt['candidate_hash'] and review.get('weights_hash')==receipt['weights_hash'] and
                    review.get('independent_replay_passed') is True and type(review.get('independent_cases')) is int and
                    review['independent_cases']>0,'estimate_rule_replay_unverified')
                version=review.get('new_curve_version')
                require(_identifier(version) and len(version)<=100 and version!=m['curve_version'],'new_estimate_release_required')
                m.update(curve_version=version,status='approved',population_verified=True,source_model_version=release_version)
                checked=UniversityScoreDistribution(curve);ledger=deepcopy(item['population_ledger'])
                ledger.update(status='approved',curve_version=version,validation_receipt_version=version+':receipt')
                require(numeric(ledger['retained_weight'])==checked.total and
                    numeric(ledger['total_complete_weight'])==numeric(ledger['retained_weight'])+numeric(ledger['excluded_weight']),
                    'estimate_population_ledger_invalid')
                bindings=deepcopy(item['bindings']);seen=set()
                require(bool(bindings),'estimate_offering_binding_missing')
                for binding in bindings:
                    require(set(CONTEXT_FIELDS)|{'offering_pk','rule_version'}<=set(binding) and
                        binding['academic_year']==m['academic_year'] and binding['rule_version']==rule_version,
                        'estimate_offering_binding_mismatch')
                    key=(binding['academic_year'],binding['offering_pk']);require(key not in seen,'estimate_offering_binding_ambiguous');seen.add(key)
                    binding['curve_version']=version
                proof=dict(format='jungsi.estimate-release-receipt/v1',version=ledger['validation_receipt_version'],
                    status='approved',code_sha=receipt['code_sha'],validation_status=v['status'],validation_hash=digest(v),
                    validation_checks=v['adoption_checks'],reference_validation_role=v['reference_validation_role'],
                    reference_feasibility_certificate=v['reference_feasibility_certificate'],
                    source_model_version=release_version,curve_sha256=digest(curve),
                    required_input_fields=ledger['required_input_fields'],population_ledger=ledger,
                    checks=dict(model_validation=True,filter_complete=True,rule_replay=True,serialization=True),
                    **{k:ledger[k] for k in ('population_id','academic_year','exam_id','source_pack_version','rule_version','curve_version')})
                release=dict(format='jungsi.university-percentile-release/v1',version=release_version,status='approved',
                    release_id=release_version,academic_year=m['academic_year'],exam_id=m['exam_id'],
                    source_pack_version=m['source_pack_version'],exam_type=approval['exam_type'],rule_version=rule_version,
                    curve=curve,bindings=bindings)
                if ledger['scope']=='required_rule_inputs_present':
                    release['comparison_population']={k:ledger[k] for k in ('format','status','scope','population_id',
                        'base_population_id','academic_year','exam_id','source_pack_version','rule_version','curve_version',
                        'required_input_fields','validation_receipt_version')}
                name=version+'.release.json';proof_name=version+'.receipt.json'
                artifacts[name]=self.store.append(release_version,name,release);artifacts[proof_name]=self.store.append(release_version,proof_name,proof)
                releases.append(release)
            adoption=dict(format='jungsi.estimate-adoption-receipt/v1',version=release_version,status='approved',
                parent_run_id=run_id,code_sha=receipt['code_sha'],parent_receipt_hash=digest(receipt),artifacts=artifacts)
            self.store.append(release_version,'adoption.json',adoption)
            return dict(total=total,percentile_releases=releases,receipt=adoption)
        except Exception as error:
            self.store.append(release_version,'failure.json',dict(status='failed_not_registered',error_code=getattr(error,'code',type(error).__name__)))
            raise
