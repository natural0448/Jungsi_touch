"""Forecast lifecycle with server authority, CAS and pinned approvals."""
from copy import deepcopy
from uuid import uuid4
from ..forecasting import digest,generate,require,number,validate_result,validate_ranges,validate_policy_result,policy_decimal
from .forecast_dto import draft_dto,result_dto,public_context
from .platform_ports import PlatformError
from .platform import identifier,shape,revision
from .time_contract import utc_text
from .forecast_ports import publication_ids

class ForecastPolicyService:
    def __init__(self,repository,inputs,clock):self.repository,self.inputs,self.clock=repository,inputs,clock
    def authority(self,actor,operation,record=None):
        require(actor.subject_id is not None,'authentication_required',401)
        caps=self.repository.capabilities(actor.subject_id)
        # The repository keeps active staff roles and school scope authoritative.
        # Verified AAL strengthens management access only; it neither grants a
        # role nor synthesizes a paid pass, and published student reads are exempt.
        if operation!='forecast.published.read' and (caps.get('edit') is True or caps.get('approve') is True):
            require(actor.assurance_level=='aal2','management_mfa_required',403)
            require(actor.account_status is not None,'management_account_state_unverified',503)
            require(actor.account_status=='active','management_account_inactive',403)
        required='approve' if operation in ('forecast.approve','forecast.publish') else 'edit'
        if operation not in ('forecast.published.read','forecast.capabilities'):
            require(caps.get(required) is True or (operation in ('forecast.read','forecast.list') and caps.get('approve') is True),'forecast_forbidden',403)
        if record is not None:
            scope=caps.get('university_ids',[]) if operation in ('forecast.read','forecast.list') else caps.get(required+'_university_ids',caps.get('university_ids',[]))
            require(record['context'].get('university_id') in scope,'forecast_not_found',404)
        return caps
    def preauthorize(self,operation,actor,params):
        caps=self.authority(actor,operation)
        if operation=='forecast.published.read':require(actor.paid_active,'paid_required',403)
        if params.get('draft_id'):
            record=self.repository.get(params['draft_id']);require(record is not None,'forecast_not_found',404)
            self.authority(actor,operation,record)
        return caps
    def execute(self,operation,actor,*,body=None,query=None,params=None,key=None):
        params=params or {};body={} if body is None else body;query=query or {}
        caps=self.preauthorize(operation,actor,params)
        if operation=='forecast.capabilities':
            shape(body);shape(query);return dict(format='jungsi.forecast-capabilities/v1',capabilities=[role for role,field in [('editor','edit'),('approver','approve')] if caps.get(field) is True],university_ids=caps.get('university_ids',[]))
        if operation=='forecast.published.read':
            shape(body);shape(query);require(actor.paid_active,'paid_required',403)
            release=self.validated_release(identifier(params.get('offering_id')))
            if release is None:return self.pending(params['offering_id'],'forecast_release_missing')
            try:public_context(release['context'])
            except PlatformError as error:return self.pending(params['offering_id'],error.code)
            return self.public(release)
        if operation=='forecast.list':
            shape(body);shape(query,(),('university_id',))
            return dict(format='jungsi.forecast-list/v1',items=[self.draft_dto(r) for r in self.repository.list() if r['context'].get('university_id') in caps.get('university_ids',[]) and (not query.get('university_id') or r['context']['university_id']==query['university_id'])])
        if operation=='forecast.read':shape(body);shape(query);return self.draft_dto(self.repository.get(params['draft_id']))
        shape(query);identifier(key)
        request_hash=digest(dict(body=body,params=params))
        return self.repository.transact(actor.subject_id,operation,key,request_hash,lambda store:self.mutate(store,operation,actor,body,params))
    def mutate(self,store,operation,actor,body,params):
        now=utc_text(self.clock.now())
        if operation=='forecast.create':
            shape(body,('input_id','input_version','policy_id','policy_version'))
            oid=identifier(params.get('offering_id'));inputs=self.inputs.inputs(oid,identifier(body['input_id']),identifier(body['input_version']));policy=self.inputs.policy(identifier(body['policy_id']),identifier(body['policy_version']))
            require(inputs.get('version')==body['input_version'] and policy.get('version')==body['policy_version'],'forecast_base_version_conflict',409)
            result=generate(inputs,policy);require(result['context']['offering_id']==oid,'forecast_offering_mismatch')
            require(result['context'].get('input_version')==body['input_version'] and result['context'].get('policy_version')==body['policy_version'],'forecast_base_version_conflict',409)
            require(result['context']==self.inputs.current_context(oid),'forecast_base_version_conflict',409)
            record=dict(draft_id='forecast-'+uuid4().hex,revision=1,status='draft',context=result['context'],input_id=body['input_id'],policy_id=body['policy_id'],input_version=inputs['version'],input_hash=digest(inputs),policy_version=policy['version'],policy_hash=digest(policy),base_result=deepcopy(result),base_result_hash=digest(result),result=result,contributors=[actor.subject_id],adjustments=[],validation=None,approval=None,created_at=now,updated_at=now,created_by=actor.subject_id,events=[dict(action='create',actor=actor.subject_id,at=now)])
            self.authority(actor,operation,record)
            transactional_caps=store.capabilities(actor.subject_id)
            require(transactional_caps.get('edit') is True and record['context'].get('university_id') in transactional_caps.get('edit_university_ids',transactional_caps.get('university_ids',[])),'forecast_forbidden',403)
        else:
            record=store.get(params['draft_id']);require(record is not None,'forecast_not_found',404);self.authority(actor,operation,record)
            transactional_caps=store.capabilities(actor.subject_id)
            role='approve' if operation in ('forecast.approve','forecast.publish') else 'edit'
            require(transactional_caps.get(role) is True and record['context'].get('university_id') in transactional_caps.get(role+'_university_ids',transactional_caps.get('university_ids',[])),'forecast_forbidden',403)
            required=('expected_revision','base_result_hash','policy_version')
            optional={'forecast.adjust':('target','replacement','reason','evidence_refs'),'forecast.validate':(), 'forecast.approve':('validation_receipt_hash','reason'),'forecast.publish':('approval_receipt_hash',)}
            shape(body,required,optional.get(operation,()))
            require(record['revision']==revision(body['expected_revision']),'revision_conflict',409)
            require(body['base_result_hash']==record['base_result_hash'],'forecast_base_version_conflict',409)
            require(record['status']!='published','forecast_already_published',409)
            require(body['policy_version']==record['policy_version'],'forecast_base_version_conflict',409)
            policy=self.inputs.policy(record['policy_id'],record['policy_version']);inputs=self.inputs.inputs(record['context']['offering_id'],record['input_id'],record['input_version'])
            require(digest(policy)==record['policy_hash'] and digest(inputs)==record['input_hash'] and self.inputs.current_context(record['context']['offering_id'])==record['context'],'forecast_base_version_conflict',409)
            if operation=='forecast.adjust':
                require(body.get('policy_version')==record['policy_version'],'forecast_base_version_conflict',409)
                target=body.get('target');require(target in policy.get('adjustable_targets',[]),'forecast_adjustment_forbidden')
                require(isinstance(body.get('reason'),str) and bool(body['reason'].strip()) and isinstance(body.get('evidence_refs'),list) and bool(body['evidence_refs']),'forecast_adjustment_evidence_missing')
                require(all(ref in inputs.get('approved_evidence_refs',[]) for ref in body['evidence_refs']),'forecast_adjustment_evidence_unapproved')
                replacement=deepcopy(body.get('replacement'));require(isinstance(replacement,dict),'forecast_adjustment_invalid')
                if target=='category_ranges':
                    shape(replacement,('ranges',));validate_ranges(replacement['ranges'])
                    for row in replacement['ranges']:shape(row,('category','lower','upper'))
                    record['result']['exact_values'][target]=deepcopy(replacement['ranges'])
                    spec=policy['acceptance_range']
                    record['result'][target]=[dict(category=r['category'],lower=policy_decimal(number(r['lower']),spec),upper=policy_decimal(number(r['upper']),spec)) for r in replacement['ranges']]
                else:
                    require(target in ('forecast_70','acceptance_range'),'forecast_adjustment_invalid')
                    shape(replacement,('value','unit') if target=='forecast_70' else ('lower','upper','unit'))
                    require(replacement['unit']==record['context']['unit'],'forecast_adjustment_unit_mismatch')
                    for field in ('value',) if target=='forecast_70' else ('lower','upper'):number(replacement[field])
                    result=record['result'][target];require(result['status']=='ready','forecast_adjustment_base_pending',409)
                    record['result']['exact_values'][target]=str(number(replacement['value'])) if target=='forecast_70' else {f:str(number(replacement[f])) for f in ('lower','upper')}
                    value_fields=('value',) if target=='forecast_70' else ('lower','upper')
                    result.update({f:policy_decimal(number(replacement[f]),policy[target]) for f in value_fields})
                validate_result(record['result']);record['contributors']=sorted(set(record['contributors']+[actor.subject_id]))
                record['adjustments'].append(dict(target=target,replacement=replacement,reason=body['reason'],evidence_refs=body['evidence_refs'],actor=actor.subject_id,at=now,base_result_hash=record['base_result_hash']))
                record.update(status='draft',validation=None,approval=None)
            elif operation=='forecast.validate':
                try:receipt=validate_policy_result(record['result'],policy)
                except PlatformError as error:receipt=dict(status='failed',reason_code=error.code,result_hash=digest(record['result']))
                receipt.update(validated_revision=record['revision']+1,input_hash=record['input_hash'],policy_hash=record['policy_hash'],at=now,actor=actor.subject_id)
                receipt['receipt_hash']=digest(receipt);record.update(validation=receipt,approval=None,status='validated' if receipt['status']=='passed' else 'draft')
            elif operation=='forecast.approve':
                receipt=record.get('validation');require(record['status']=='validated' and receipt and receipt['status']=='passed','forecast_validation_required',409)
                require(body.get('validation_receipt_hash')==receipt['receipt_hash'] and receipt['validated_revision']==record['revision'] and receipt['result_hash']==digest(record['result']),'forecast_validation_stale',409)
                require(type(policy.get('require_independent_approver')) is bool,'forecast_approval_policy_missing')
                require(not policy['require_independent_approver'] or actor.subject_id not in record['contributors'],'forecast_independent_approver_required',403)
                require(isinstance(body.get('reason'),str) and bool(body['reason'].strip()),'forecast_approval_reason_missing')
                approval=dict(approved_revision=record['revision']+1,result_hash=digest(record['result']),validation_hash=receipt['receipt_hash'],policy_hash=record['policy_hash'],actor=actor.subject_id,at=now,reason=body['reason'])
                approval['approval_hash']=digest(approval);record.update(status='approved',approval=approval)
            elif operation=='forecast.publish':
                approval=record.get('approval');require(record['status']=='approved' and approval,'forecast_approval_required',409)
                require(body.get('approval_receipt_hash')==approval['approval_hash'] and approval['approved_revision']==record['revision'] and approval['result_hash']==digest(record['result']),'forecast_approval_stale',409)
                release=dict(release_id='release-'+uuid4().hex,context=record['context'],result=deepcopy(record['result']),draft_id=record['draft_id'],draft_revision=record['revision'],base_result=deepcopy(record['base_result']),eligibility_policy=deepcopy(policy.get('eligibility_policy')),policy_id=record['policy_id'],policy_version=record['policy_version'],policy_hash=record['policy_hash'],input_id=record['input_id'],input_version=record['input_version'],input_hash=record['input_hash'],validation_hash=record['validation']['receipt_hash'],approval_hash=approval['approval_hash'],adjustments=deepcopy(record['adjustments']),published_at=now,published_by=actor.subject_id)
                release['release_hash']=digest(release);store.publish(release);record.update(status='published',release_id=release['release_id'])
            else:raise PlatformError('route_not_found',404)
            record['revision']+=1;record['updated_at']=now;record['events'].append(dict(action=operation,actor=actor.subject_id,at=now))
        store.put(record);return self.draft_dto(record)
    @staticmethod
    def draft_dto(record):
        return draft_dto(record)

    def validated_release(self,offering_id):
        return self._validated_release(offering_id,self.repository.published(offering_id))

    def validated_releases(self,offering_ids):
        selected=publication_ids(offering_ids)
        if not selected:return {}
        lookup=getattr(self.repository,'published_many',None)
        if not callable(lookup):raise PlatformError('forecast_not_configured',503)
        releases=lookup(selected)
        if type(releases) is not dict or set(releases)!=set(selected):
            raise PlatformError('forecast_release_invalid',503)
        result={}
        for offering in selected:
            release=releases[offering]
            if isinstance(release,PlatformError):result[offering]=release;continue
            try:result[offering]=self._validated_release(offering,release)
            except PlatformError as error:result[offering]=error
        return result

    def _validated_release(self,offering_id,release):
        if release is None:return None
        try:
            require(type(release) is dict,'forecast_release_invalid',503)
            pinned=deepcopy(release);claimed=pinned.pop('release_hash',None)
            require(claimed==digest(pinned) and release.get('approval_hash') and release.get('validation_hash'),'forecast_release_invalid',503)
            require(release['context']==self.inputs.current_context(offering_id),'forecast_base_version_conflict',409)
            require(release['context'].get('input_version')==release['input_version'] and release['context'].get('policy_version')==release['policy_version'],'forecast_base_version_conflict',409)
            inputs=self.inputs.inputs(offering_id,release['input_id'],release['input_version'])
            policy=self.inputs.policy(release['policy_id'],release['policy_version'])
            require(inputs.get('version')==release['input_version'] and policy.get('version')==release['policy_version'] and digest(inputs)==release['input_hash'] and digest(policy)==release['policy_hash'],'forecast_base_version_conflict',409)
            validate_policy_result(release['result'],policy)
        except PlatformError:raise
        except (KeyError,TypeError,ValueError):raise PlatformError('forecast_release_invalid',503)
        return release

    @staticmethod
    def pending(offering_id,reason):
        return dict(format='jungsi.forecast-public/v1',status='pending',reason_code=reason,offering_id=offering_id,release_version=None,context=None,policy_version=None,input_version=None,forecast_70=None,expected_acceptance_range=None,category_ranges=[],basis_summary=None,issue_summaries=[],recommendation_reasons=[],adjustment_summary=dict(applied=False,reason=None,version=None))

    @staticmethod
    def public(release):
        private=release['result'];result=result_dto(private)
        basis=private['basis_summary']
        reasons=[dict(code='approved_'+r['target'],text='승인된 '+r['target']+' 비교자료와 정책에 따라 기준을 산출했습니다.',evidence_refs=r['source_refs']) for r in basis]
        issues=[dict(issue_id=i['issue_id'],title=i.get('title',i['issue_id']),summary=i['explanation'],numeric_effect_applied=False) for i in private['issue_summaries']]
        adjustments=release['adjustments']
        return dict(format='jungsi.forecast-public/v1',status='published',reason_code=None,offering_id=release['context']['offering_id'],release_version=release['release_id'],context=public_context(release['context']),policy_version=release['policy_version'],input_version=release['input_version'],forecast_70=result['forecast_70'],expected_acceptance_range=result['acceptance_range'],category_ranges=result['category_ranges'],basis_summary=' / '.join(r['target']+': 승인된 비교자료 및 정책 적용' for r in basis) or None,issue_summaries=issues,recommendation_reasons=reasons,adjustment_summary=dict(applied=bool(adjustments),reason=' / '.join(a['reason'] for a in adjustments) or None,version=release['release_id'] if adjustments else None))
