/** RM v2 qualification and source-free publisher dry-run. No SQL, source scan, sealing or publication. */
import { ANCESTRY, BASE29_FIELDS, BINDING, CHECKPOINT, CodecBudget, compareBytes, compareUtf8, COVERAGE, CURRENT35, DEPENDENCY_STATE, digestRecord, DISPLAY17, encodeRecord, FILTER, hexBytes, IMPACT, IMPACT_ENTRY, isClosedRecord, LEAF, REPRESENTATIVE as importedRepresentative, MEMBER32, merkleTree, MODEL_ROW, nullable, OBS, POP7, RAW, ReadModelError, RecordShape, recordOf, REF, Shape, ROOT, SCHOOL_TUPLE, SEAL, sha256Bytes, SOURCE_STATE, sortedWire, SCOPE, typedNode, encodeNode, arrayOf, bytesHex, wireContentDigests } from './current_review_model_codec.ts';
import { parseStrictJson, utcInstantMicros } from './official_history_display.ts';
import { validateCurrentScalar, validateCurrentWireJsonText } from './current_admission_review.ts';
import type { Json, Row } from './official_history_display.ts';
type Obj=Record<string,unknown>;
const fail=(code='current_review_model_not_ready')=>new ReadModelError(code);
const obj=(x:unknown):x is Obj=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const ints=(x:unknown):bigint=>{const s=typeof x==='number'&&Number.isSafeInteger(x)&&!Object.is(x,-0)?String(x):typeof x==='bigint'?String(x):x;if(typeof s!=='string'||!/^(?:0|[1-9][0-9]*)$/.test(s))throw fail();return BigInt(s);};
const eq=(shape:RecordShape,a:unknown,b:unknown,budget:CodecBudget)=>compareBytes(encodeRecord(shape,a,budget),encodeRecord(shape,b,budget))===0;
const noUnknown=(v:unknown):void=>{if(v===undefined||v==='UNKNOWN'||v==='NOT_READY')throw fail();if(Array.isArray(v))v.forEach(noUnknown);else if(obj(v))Object.values(v).forEach(noUnknown);};
export const MODEL_RECIPES={content:'current_review_content_wire_v2',row:'current_review_model_row_v2',binding:'current_review_model_binding_v2'} as const;
export const MODEL_CENSUS_ENTRY:RecordShape=[['canonical_result_id','T'],['observation',recordOf(OBS)]];
export const MODEL_FREQUENCY:RecordShape=[['school_id',nullable('T')],['university_code',nullable('T')],['multiplicity','I'],['frequency_evidence',recordOf(REF)]];
export const BASELINE_CHECKPOINT:RecordShape=[...CHECKPOINT,['canonical_ids',arrayOf('T')]];
export const BASELINE_CENSUS:RecordShape=[['manifest_version','T'],['baseline_id','U'],['tenant_key','T'],['tenant_mapping_sha256','H'],['target_state',recordOf(DEPENDENCY_STATE)],['scope',recordOf(SCOPE)],['coverage',recordOf(COVERAGE)],['census',arrayOf(recordOf(MODEL_CENSUS_ENTRY))],['school_frequencies',arrayOf(recordOf(MODEL_FREQUENCY))],['checkpoints',arrayOf(recordOf(BASELINE_CHECKPOINT))],['producer_actor','U'],['verifier_actor','U'],['verification_receipt',recordOf(REF)],['approval_receipt',recordOf(REF)]];
export const EVIDENCE_CLAIM:RecordShape=[['purpose','T'],['tenant_key','T'],['command_id','T'],['payload_sha256','H'],['definition_sha256','H'],['source_projection_sha256','H'],['model_projection_sha256','H'],['selection_scope_sha256','H'],['tenant_mapping_sha256','H'],['claim_domain','T'],['claim_digest','H'],['completeness_state_id','T'],['completeness_state_sha256','H'],['source_dependency_closure_sha256','H'],['content_recipe_sha256','H'],['model_row_recipe_sha256','H'],['binding_recipe_sha256','H'],['codec_spec_sha256','H']];
const SIGNED_EVIDENCE:RecordShape=[['format','T'],['evidence_id','T'],['evidence_kind','T'],['immutable_version','T'],['issuer_actor','U'],['recorded_at','Z'],['not_before','Z'],['expires_at','Z'],['revoked','B'],['claim',recordOf(EVIDENCE_CLAIM)]];
export interface EvidenceExpectation { reference:Obj;claim:Obj;requiredRole?:'qualifier'|'verifier'|'approver';requiredIssuer?:string;forbiddenIssuer?:string;requiredKind?:string }
export interface TrustedEvidenceVerifier { verifyBatch(expectations:EvidenceExpectation[],now:number):Promise<void> }
export interface EvidenceTrustPolicy {
 issuerRoles:ReadonlyMap<string,ReadonlySet<'qualifier'|'verifier'|'approver'|'revocation'>>;
 revocationIssuer:string;revocationPolicySha256:string;revocationSnapshotSha256:string;
 maximumRevocationValidityMicros:bigint;
 loadPinnedRevocationSnapshot():Promise<Uint8Array>;
}
export const REVOCATION_PAYLOAD:RecordShape=[['format','T'],['purpose','T'],['issuer_actor','U'],['as_of','Z'],['expires_at','Z'],['policy_sha256','H'],['revoked_receipt_sha256',arrayOf('H')],['revoked_issuer_actors',arrayOf('U')]];
export const SIGNED_EVIDENCE_PAYLOAD=SIGNED_EVIDENCE;
/** Independent server key/role/revocation pins are required. Caller receipts cannot authorize themselves. */
export function createPinnedEvidenceVerifier(issuerKeys:ReadonlyMap<string,CryptoKey>,resolveBatch:(references:readonly Obj[])=>Promise<readonly Uint8Array[]>,budget:CodecBudget,policy:EvidenceTrustPolicy):TrustedEvidenceVerifier {
 if(!issuerKeys.size||!policy||!policy.issuerRoles?.size||policy.maximumRevocationValidityMicros<=0n||typeof policy.loadPinnedRevocationSnapshot!=='function')throw fail('current_review_trusted_issuer_unavailable');
 hexBytes(policy.revocationPolicySha256,32);hexBytes(policy.revocationSnapshotSha256,32);
 for(const [issuer,key]of issuerKeys){typedNode('U',issuer);if(key.type!=='public'||key.algorithm.name!=='Ed25519'||!key.usages.includes('verify'))throw fail();}
 if(!issuerKeys.has(policy.revocationIssuer)||!policy.issuerRoles.get(policy.revocationIssuer)?.has('revocation'))throw fail();
 return {async verifyBatch(expectations,now){
  if(!Number.isSafeInteger(now)||expectations.length>budget.maxElements)throw fail();
  const revBytes=await policy.loadPinnedRevocationSnapshot();if(revBytes.length>budget.maxBytes||await sha256Bytes(revBytes)!==policy.revocationSnapshotSha256)throw fail('current_review_revocation_unverified');
  const env=parseStrictJson(new TextDecoder('utf-8',{fatal:true}).decode(revBytes)) as unknown;
  if(!obj(env)||Object.keys(env).length!==2||!obj(env.payload)||typeof env.signature_hex!=='string')throw fail();
  const rev=env.payload;encodeRecord(REVOCATION_PAYLOAD,rev,budget);
  const instant=BigInt(now)*1000n,start=utcInstantMicros(rev.as_of as string),end=utcInstantMicros(rev.expires_at as string);
  if(rev.format!=='jungsi.current-review-evidence-revocations/v2'||rev.purpose!=='current_admission_review'||rev.issuer_actor!==policy.revocationIssuer||rev.policy_sha256!==policy.revocationPolicySha256||start>instant||instant>=end||end<=start||end-start>policy.maximumRevocationValidityMicros||
    !await crypto.subtle.verify('Ed25519',issuerKeys.get(policy.revocationIssuer)!,new Uint8Array(hexBytes(env.signature_hex,64)).buffer,new Uint8Array(encodeRecord(REVOCATION_PAYLOAD,rev,budget)).buffer))throw fail('current_review_revocation_unverified');
  const revokedRefs=new Set(rev.revoked_receipt_sha256 as string[]),revokedIssuers=new Set(rev.revoked_issuer_actors as string[]);
  const raw=await resolveBatch(expectations.map(x=>x.reference));if(raw.length!==expectations.length)throw fail();
  for(let i=0;i<raw.length;i++){
   const e=expectations[i],ref=e.reference;encodeRecord(REF,ref,budget);
   if(raw[i].length>budget.maxBytes||ints(ref.bytes)!==BigInt(raw[i].length)||await sha256Bytes(raw[i])!==ref.sha256)throw fail('current_review_evidence_pin_mismatch');
   const decoded=parseStrictJson(new TextDecoder('utf-8',{fatal:true}).decode(raw[i])) as unknown;
   if(!obj(decoded)||Object.keys(decoded).length!==2||!obj(decoded.payload)||typeof decoded.signature_hex!=='string')throw fail();
   const payload=decoded.payload;encodeRecord(SIGNED_EVIDENCE,payload,budget);
   const issuer=payload.issuer_actor as string,key=issuerKeys.get(issuer),role=e.requiredRole??'qualifier';
   if(e.requiredKind!==undefined&&ref.evidence_kind!==e.requiredKind)throw fail('current_review_evidence_kind_mismatch');
   if(!key||!policy.issuerRoles.get(issuer)?.has(role)||e.requiredIssuer!==undefined&&issuer!==e.requiredIssuer||e.forbiddenIssuer===issuer||revokedIssuers.has(issuer)||revokedRefs.has(ref.sha256 as string))throw fail('current_review_evidence_authority_invalid');
   if(payload.format!=='jungsi.current-review-evidence/v2'||payload.evidence_id!==ref.evidence_id||payload.evidence_kind!==ref.evidence_kind||payload.immutable_version!==ref.immutable_version||issuer!==ref.issuer_actor||payload.recorded_at!==ref.recorded_at||payload.revoked!==false||!eq(EVIDENCE_CLAIM,payload.claim,e.claim,budget))throw fail('current_review_evidence_claim_mismatch');
   const from=utcInstantMicros(payload.not_before as string),until=utcInstantMicros(payload.expires_at as string);
   if(from>instant||instant>=until||until<=from)throw fail('current_review_evidence_expired');
   if(!await crypto.subtle.verify('Ed25519',key,new Uint8Array(hexBytes(decoded.signature_hex,64)).buffer,new Uint8Array(encodeRecord(SIGNED_EVIDENCE,payload,budget)).buffer))throw fail('current_review_evidence_signature_invalid');
  }
 }};
}
export interface QualifiedObservationInput {
  current:Obj;members:Obj[];population:Obj[];
  source29_receipt:Obj;native32_receipt:Obj;native32_expected_digest:string;component_policy_sha256:string;qualification_receipt:Obj;
}
export interface QualifiedObservation {
  canonicalId:string;filters:Obj;raw:Obj;representative:Obj;display:Obj;contentDigest:string;memberDigest:string;populationDigest:string;
  displayDigest:string;filterDigest:string;componentPolicySha256:string;qualificationReceipt:Obj;source29Receipt:Obj;native32Receipt:Obj;source29Digest:string;native32Digest:string;
}
function nonempty(v:unknown):v is string{return typeof v==='string'&&v.length>0;}
export async function qualifyModelObservation(input:QualifiedObservationInput,sourceProjection:string,modelProjection:string,budget:CodecBudget):Promise<QualifiedObservation> {
  const c=input.current;encodeRecord(CURRENT35,c,budget);hexBytes(input.component_policy_sha256,32);hexBytes(input.native32_expected_digest,32);
  if(!nonempty(c.canonical_result_id)||c.result_id!==c.canonical_result_id||![2024,2025,2026,2027].includes(Number(c.academic_year))||c.active_service!==true||!nonempty(c.source_result_id))throw fail();
  for(const k of ['recruit_group_raw','anchor_2027_pks','source_location','original_record_locator','field_presence_types','curation_fields','curation_evidence'])if(c[k]!==null)validateCurrentWireJsonText(c[k] as string);
  const members=await sortedWire(MEMBER32,input.members,budget),population=await sortedWire(POP7,input.population,budget);
  if(!members.length||ints(c.source_member_count)!==BigInt(members.length))throw fail();let rep:Obj|null=null;
  for(const m of members){
    if(m.canonical_result_id!==c.canonical_result_id||!nonempty(m.release_id)||!nonempty(m.result_id)||!nonempty(m.source_all29_sha256)||!nonempty(m.row_fingerprint))throw fail();
    hexBytes(m.source_all29_sha256 as string,32);hexBytes(m.row_fingerprint as string,32);
    for(const k of ['recruit_group_raw','anchor_2027_pks','source_location','original_record_locator','field_presence_types','curation_fields','curation_evidence'])if(m[k]!==null)validateCurrentWireJsonText(m[k] as string);
    if(m.is_representative===true){if(rep!==null)throw fail();rep=m;}
  }
  if(rep===null||rep.result_id!==c.source_result_id||rep.release_id!==c.release_id||rep.row_fingerprint!==c.source_row_fingerprint)throw fail();
  const scopes:Obj[]=[];for(const l of population){
    if(l.result_id!==c.canonical_result_id||l.academic_year!==c.academic_year||!nonempty(l.link_kind)||l.population_reference_year===null)throw fail();
    scopes.push({population_reference_year:l.population_reference_year,link_kind:l.link_kind,individual_offering_metric_inference_allowed:l.individual_offering_metric_inference_allowed});
  }
  const value=validateCurrentScalar(c.metric_value_literal as Json,c.metric_value_json_type as Json,c.metric_value_numeric as Json),held=['held','missing'].includes(value.availability);
  const reasons=['review_only_not_published','public_offering_mapping_not_qualified','official_metadata_not_qualified',...value.reasons];
  if(scopes.some(s=>s.individual_offering_metric_inference_allowed===false))reasons.push('aggregate_or_forward_reference');
  const display:Obj={academic_year:c.academic_year,university:c.university,department:c.department,track:c.track,recruit_group:c.recruit_group,metric_kind:c.metric_kind,metric_value_literal:held?null:c.metric_value_literal,metric_value_json_type:c.metric_value_json_type,metric_value_numeric_text:held?null:c.metric_value_numeric,cohort:c.cohort,statistic_label:c.statistic_label,source_member_count:c.source_member_count,link_scopes:scopes,official_metadata:{metric_definition:null,unit:null,original_scale:null,source_url:null,source_as_of:null,publication_status:null},review_status:'review_only',value_availability:value.availability,hold_reasons:reasons};
  const filters:Obj=Object.fromEntries(FILTER.map(([k])=>[k,c[k]])),raw:Obj={literal:c.metric_value_literal,json_type:c.metric_value_json_type,numeric_text:c.metric_value_numeric};
  const representative:Obj={release_id:c.release_id,result_id:c.source_result_id,source_row_fingerprint:c.source_row_fingerprint,effective_row_fingerprint:c.row_fingerprint,source_member_count:c.source_member_count};
  const hashes=await wireContentDigests(sourceProjection,c,members,population,budget);
  return {canonicalId:c.canonical_result_id as string,filters,raw,representative,display,contentDigest:hashes.content,memberDigest:hashes.members,populationDigest:hashes.population,displayDigest:await digestRecord('current_review_display17_v2',[['model_projection_sha256','H'],['display',recordOf(DISPLAY17)]],{model_projection_sha256:modelProjection,display},budget),filterDigest:await digestRecord('current_review_corrected_filter_v2',FILTER,filters,budget),componentPolicySha256:input.component_policy_sha256,qualificationReceipt:input.qualification_receipt,source29Receipt:input.source29_receipt,native32Receipt:input.native32_receipt,source29Digest:rep.source_all29_sha256 as string,native32Digest:input.native32_expected_digest};
}
export function assertModelDisplay(value:unknown,budget:CodecBudget):asserts value is Obj {
  encodeRecord(DISPLAY17,value,budget);const d=value as Obj;
  if(![2024,2025,2026,2027].includes(Number(d.academic_year))||ints(d.source_member_count)<1n||d.review_status!=='review_only'||!['present','actual_null','missing','held'].includes(String(d.value_availability))||!obj(d.official_metadata)||Object.values(d.official_metadata).some(v=>v!==null)||!Array.isArray(d.hold_reasons)||!['review_only_not_published','public_offering_mapping_not_qualified','official_metadata_not_qualified'].every(k=>(d.hold_reasons as unknown[]).includes(k)))throw fail();
  if(['held','missing'].includes(String(d.value_availability))){if(d.metric_value_literal!==null||d.metric_value_numeric_text!==null)throw fail();}
  else{const v=validateCurrentScalar(d.metric_value_literal as Json,d.metric_value_json_type as Json,d.metric_value_numeric_text as Json);if(v.availability!==d.value_availability)throw fail();}
}
export function validateModelAncestry(ancestry:Obj,budget:CodecBudget):void {
  encodeRecord(ANCESTRY,ancestry,budget);const entries=ancestry.entries as Obj[];
  if(entries.length<1||entries.length>5||entries[0].batch_id!==ancestry.head_batch_id)throw fail('current_review_ancestry_invalid');
  const seen=new Set<string>();for(let i=0;i<entries.length;i++){
    const e=entries[i];if(ints(e.depth)!==BigInt(i)||seen.has(e.batch_id as string)||!['baseline','delta'].includes(String(e.batch_kind))||(i===0?e.manifest_sha256!==null:e.manifest_sha256===null))throw fail();seen.add(e.batch_id as string);
    const next=entries[i+1];if(next){if(e.batch_kind!=='delta'||e.parent_batch_id!==next.batch_id||e.parent_manifest_sha256!==next.manifest_sha256)throw fail();}
    else if(e.batch_kind!=='baseline'||e.parent_batch_id!==null||e.parent_manifest_sha256!==null)throw fail();
  }
}
function sortedUnique(values:unknown):string[] {
  if(!Array.isArray(values)||values.some(v=>!nonempty(v)))throw fail();for(let i=1;i<values.length;i++)if(compareUtf8(values[i-1],values[i])>=0)throw fail();return values as string[];
}
function sameIds(a:string[],b:string[]):boolean{return a.length===b.length&&a.every((v,i)=>v===b[i]);}
// Typed facts omit all REF fields; receipt hashes never participate in their own signature claim.
const refShape=(type:Shape):boolean=>typeof type!=='string'&&('record'in type&&type.record===REF||'nullable'in type&&refShape(type.nullable));
function cleanShape(type:Shape):Shape {
 if(typeof type==='string')return type;
 if('nullable'in type)return nullable(cleanShape(type.nullable));
 if('array'in type)return arrayOf(cleanShape(type.array));
 return recordOf(type.record.filter(([,t])=>!refShape(t)).map(([k,t])=>[k,cleanShape(t)]as const));
}
function receiptFree(shape:RecordShape,value:Obj):{shape:RecordShape;value:Obj} {
 const facts:Obj={};const result:(readonly [string,Shape])[]=[];
 const cleanValue=(type:Shape,at:unknown):unknown=>{
  if(typeof type==='string'||at===null)return at;
  if('nullable'in type)return cleanValue(type.nullable,at);
  if('array'in type)return(at as unknown[]).map(x=>cleanValue(type.array,x));
  return receiptFree(type.record,at as Obj).value;
 };
 for(const[k,type]of shape){if(refShape(type))continue;result.push([k,cleanShape(type)]);facts[k]=cleanValue(type,value[k]);}
 return{shape:result,value:facts};
}
/** Exact typed parent facts and field path distinguish universe, domain, fence, registration,
 * checkpoint, tuple-frequency and per-row evidence. No generic 'COMPLETE' receipt substitutes them.
 */
export async function modelEvidenceExpectations(manifest:Obj,shape:RecordShape,budget:CodecBudget):Promise<EvidenceExpectation[]> {
 const result:EvidenceExpectation[]=[];
 const walk=async(s:RecordShape,v:Obj,path:string)=>{
  const clean=receiptFree(s,v),parentDigest=await digestRecord('current_review_receipt_subject_v2',[['path','T'],['facts',recordOf(clean.shape)]],{path,facts:clean.value},budget);
  for(const [k,t]of s){
   if(typeof t==='string')continue;
   const x=v[k],slot=path?path+'.'+k:k;
   if(refShape(t)){
    if(/^checkpoints\[[0-9]+\]\.lease_receipt$/.test(slot))continue; // Already signed once as writer_fence.lease_receipt; exact equality is checked for each checkpoint.
    if(x===null||['current_wire_receipt','original_source29_validation_receipt','native_canonical32_validation_receipt'].includes(k))continue;
    const ref=x as Obj,domain='current_review_evidence_slot_v2:'+slot,kind='current_review_'+slot.replaceAll('.','_').replace(/\[[0-9]+\]/g,'_entry');
    const state=path.startsWith('parent_state')?{...manifest,target_state:manifest.parent_state}:manifest;
    const role=slot==='verification_receipt'?'verifier':slot==='approval_receipt'?'approver':'qualifier';
    const subject=slot==='scope.canonical_universe_receipt'&&Array.isArray(manifest.census)?await idDigest(sortedUnique((manifest.census as Obj[]).map(e=>e.canonical_result_id)),budget):parentDigest;
    result.push({...expect(ref,claimBase(state),domain,subject),requiredRole:role,requiredKind:kind,forbiddenIssuer:manifest.producer_actor as string,...(role==='verifier'?{requiredIssuer:manifest.verifier_actor as string}:{})});continue;
   }
   const descend=async(type:import('./current_review_model_codec.ts').Shape,at:unknown,p:string):Promise<void>=>{
    if(typeof type==='string'||at===null)return;
    if('nullable'in type)return descend(type.nullable,at,p);
    if('record'in type)return walk(type.record,at as Obj,p);
    for(let i=0;i<(at as unknown[]).length;i++)await descend(type.array,(at as unknown[])[i],p+'['+i+']');
   };await descend(t,x,slot);
  }
 };await walk(shape,manifest,'');
 return result;
}
export async function observationEvidenceExpectations(manifest:Obj,q:QualifiedObservation,budget:CodecBudget):Promise<EvidenceExpectation[]> {
 const fields:RecordShape=[['canonical_result_id','T'],['representative',recordOf(importedRepresentative)],['content_digest','H'],['member_digest','H'],['population_digest','H'],['source29_digest','H'],['native32_digest','H'],['component_policy_sha256','H']];
 const facts={canonical_result_id:q.canonicalId,representative:q.representative,content_digest:q.contentDigest,member_digest:q.memberDigest,population_digest:q.populationDigest,source29_digest:q.source29Digest,native32_digest:q.native32Digest,component_policy_sha256:q.componentPolicySha256};
 const digest=await digestRecord('current_review_component_qualification_subject_v2',fields,facts,budget),base=claimBase(manifest);
 return [[q.qualificationReceipt,'current_review_content_wire_v2','current_review_current35_member32_pop7_qualification'],[q.source29Receipt,'current_review_source29_qualification_v2','current_review_original_source29_validation'],[q.native32Receipt,'current_review_native32_qualification_v2','current_review_native_canonical32_validation']].map(([reference,domain,kind])=>({...expect(reference as Obj,base,domain as string,digest),requiredRole:'qualifier',requiredKind:kind as string,forbiddenIssuer:manifest.producer_actor as string}));
}
export function validateCoverage(coverage:Obj,budget:CodecBudget):void {
  encodeRecord(COVERAGE,coverage,budget);noUnknown(coverage);
  for(const k of ['source_change','correction','curation','school_scope','member','population','flag','out_of_command'])if((coverage[k] as Obj).classification!=='COMPLETE')throw fail('current_review_completeness_unverified');
  const fence=coverage.writer_fence as Obj,registration=coverage.state_registration as Obj;
  if(!nonempty(fence.lease_id)||utcInstantMicros(fence.begin_at as string)>=utcInstantMicros(fence.end_at as string)||!nonempty(registration.mechanism_id))throw fail();
}
function claimBase(manifest:Obj):Obj {
  const state=manifest.target_state as Obj,scope=manifest.scope as Obj;
  return {purpose:'current_admission_review',tenant_key:manifest.tenant_key,command_id:state.command_id,payload_sha256:state.payload_sha256,definition_sha256:state.definition_sha256,source_projection_sha256:state.source_projection_sha256,model_projection_sha256:scope.model_projection_sha256,selection_scope_sha256:scope.selection_scope_sha256,tenant_mapping_sha256:manifest.tenant_mapping_sha256,...Object.fromEntries(['completeness_state_id','completeness_state_sha256','source_dependency_closure_sha256','content_recipe_sha256','model_row_recipe_sha256','binding_recipe_sha256','codec_spec_sha256'].map(k=>[k,state[k]]))};
}
function expect(reference:Obj,base:Obj,domain:string,digest:string):EvidenceExpectation{return {reference,claim:{...base,claim_domain:domain,claim_digest:digest}};}
async function idDigest(ids:string[],budget:CodecBudget):Promise<string>{return digestRecord('current_review_canonical_id_set_v2',[['ids',arrayOf('T')]],{ids},budget);}
function validateState(state:Obj,budget:CodecBudget){encodeRecord(DEPENDENCY_STATE,state,budget);noUnknown(state);if(state.content_recipe!==MODEL_RECIPES.content||state.model_row_recipe!==MODEL_RECIPES.row||state.binding_recipe!==MODEL_RECIPES.binding)throw fail('current_review_recipe_unapproved');}
function sourceState(manifest:Obj):Obj {
  const s=manifest.target_state as Obj,ref=s.coverage_receipt as Obj;return {command_id:s.command_id,payload_sha256:s.payload_sha256,definition_sha256:s.definition_sha256,source_projection_sha256:s.source_projection_sha256,completeness_state_id:s.completeness_state_id,completeness_state_sha256:s.completeness_state_sha256,coverage_receipt_sha256:ref.sha256,...Object.fromEntries(['source_dependency_closure_sha256','content_recipe_sha256','model_row_recipe_sha256','binding_recipe_sha256','codec_spec_sha256'].map(k=>[k,s[k]]))};
}
function validateScope(scope:Obj,budget:CodecBudget){encodeRecord(SCOPE,scope,budget);if(!Array.isArray(scope.allowed_years)||scope.allowed_years.length!==4||scope.allowed_years.some((v,i)=>ints(v)!==BigInt([2024,2025,2026,2027][i])))throw fail();}
export interface PublisherDryRunOptions {budget:CodecBudget;evidence:TrustedEvidenceVerifier;now:number;verificationPlanSha256:string;createdAt:string;maximumObservations:number;checkpointCoverage?:readonly {chunk_id:string;canonical_ids:string[]}[]}
export interface PublisherDryRunResult {status:'VALIDATED_DRY_RUN_ONLY';root:Obj;rootManifestSha256:string;rootManifestBytes:Uint8Array;binding:Obj;bindingSha256:string;ancestry:Obj;changes:Obj[];leaves:string[];proofs:string[][];deploymentAllowed:false;sealCreated:false}
async function finishDryRun(manifest:Obj,changes:Obj[],ancestry:Obj,transition:string,obsCount:bigint,schoolCount:bigint,options:PublisherDryRunOptions):Promise<PublisherDryRunResult> {
  const b=options.budget;validateModelAncestry(ancestry,b);changes.sort((a,c)=>compareUtf8(a.canonical_result_id as string,c.canonical_result_id as string));
  for(let i=1;i<changes.length;i++)if(changes[i-1].canonical_result_id===changes[i].canonical_result_id)throw fail();
  const leaves:string[]=[];for(let i=0;i<changes.length;i++)leaves.push(await digestRecord('current_review_leaf_v2',LEAF,{tenant_key:manifest.tenant_key,batch_id:ancestry.head_batch_id,leaf_index:i,canonical_result_id:changes[i].canonical_result_id,model_row_digest:await digestRecord(MODEL_RECIPES.row,MODEL_ROW,changes[i],b)},b));
  const tree=await merkleTree(leaves,manifest.tenant_key as string,ancestry.head_batch_id as string,b),state=sourceState(manifest),sd=await digestRecord('current_review_source_state_v2',SOURCE_STATE,state,b),ad=await digestRecord('current_review_ancestry_v2',ANCESTRY,ancestry,b),scope=manifest.scope as Obj,entry=(ancestry.entries as Obj[])[0];
  const root:Obj={tenant_key:manifest.tenant_key,batch_id:ancestry.head_batch_id,batch_kind:entry.batch_kind,parent_batch_id:entry.parent_batch_id,parent_manifest_sha256:entry.parent_manifest_sha256,source_state_digest:sd,model_projection_sha256:scope.model_projection_sha256,selection_scope_sha256:scope.selection_scope_sha256,tenant_mapping_sha256:manifest.tenant_mapping_sha256,content_recipe:MODEL_RECIPES.content,model_row_recipe:MODEL_RECIPES.row,binding_recipe:MODEL_RECIPES.binding,transition_manifest_sha256:transition,ancestry_digest:ad,staged_change_count:changes.length,upsert_count:changes.filter(x=>x.operation==='upsert').length,retract_count:changes.filter(x=>x.operation==='retract').length,expected_effective_observation_count:obsCount,expected_effective_school_tuple_count:schoolCount,change_merkle_root:tree.root,verification_plan_sha256:options.verificationPlanSha256,producer_actor:manifest.producer_actor,created_at:options.createdAt};
  const rh=await digestRecord('current_review_root_manifest_v2',ROOT,root,b),binding:Obj={tenant_key:manifest.tenant_key,tenant_mapping_sha256:manifest.tenant_mapping_sha256,source_state:state,model_projection_sha256:scope.model_projection_sha256,selection_scope_sha256:scope.selection_scope_sha256,head_batch_id:ancestry.head_batch_id,head_manifest_sha256:rh,ancestry_digest:ad,transition_manifest_sha256:transition,content_recipe:MODEL_RECIPES.content,model_row_recipe:MODEL_RECIPES.row,binding_recipe:MODEL_RECIPES.binding};
  return {status:'VALIDATED_DRY_RUN_ONLY',root,rootManifestSha256:rh,rootManifestBytes:encodeRecord(ROOT,root,b),binding,bindingSha256:await digestRecord(MODEL_RECIPES.binding,BINDING,binding,b),ancestry,changes,leaves,proofs:tree.proofs,deploymentAllowed:false,sealCreated:false};
}
async function qualifyInputs(manifest:Obj,inputs:QualifiedObservationInput[],options:PublisherDryRunOptions):Promise<Map<string,QualifiedObservation>> {
  if(!Number.isSafeInteger(options.maximumObservations)||options.maximumObservations<1||inputs.length>options.maximumObservations||!Number.isSafeInteger(options.now))throw fail();
  const state=manifest.target_state as Obj,scope=manifest.scope as Obj,map=new Map<string,QualifiedObservation>();
  for(const input of inputs){const q=await qualifyModelObservation(input,state.source_projection_sha256 as string,scope.model_projection_sha256 as string,options.budget);if(map.has(q.canonicalId))throw fail();map.set(q.canonicalId,q);}return map;
}
/** One canonical meaning for baseline and delta: counts and generated rows use the same
 * qualified corrected filters, representative and duplicate-preserving component multisets.
 */
function assertObservationMatchesQualified(o:Obj,q:QualifiedObservation,b:CodecBudget):void {
 encodeRecord(OBS,o,b);
 if(o.original_source29_validation_receipt===null||o.native_canonical32_validation_receipt===null||
   !eq(REF,o.current_wire_receipt,q.qualificationReceipt,b)||o.component_validation_policy_sha256!==q.componentPolicySha256||
   !eq(REF,o.original_source29_validation_receipt,q.source29Receipt,b)||!eq(REF,o.native_canonical32_validation_receipt,q.native32Receipt,b))throw fail('current_review_component_qualification_missing');
 if(o.in_approved_scope!==true||o.active_service!==true||ints(o.academic_year)!==ints(q.filters.academic_year)||
   o.school_id!==q.filters.school_id||o.university_code!==q.filters.university_code||
   o.content_digest!==q.contentDigest||o.corrected_filter_digest!==q.filterDigest||o.display17_digest!==q.displayDigest)throw fail('current_review_observation_meaning_mismatch');
 const rep=o.representative as Obj;
 for(const k of ['release_id','result_id','source_row_fingerprint','effective_row_fingerprint'])if(rep[k]!==q.representative[k])throw fail('current_review_observation_meaning_mismatch');
 const member=o.member_multiset as Obj,population=o.population_multiset as Obj;
 if(member.recipe!=='current_review_member_multiset_v2'||population.recipe!=='current_review_population_multiset_v2'||
   ints(member.element_count)!==ints(q.display.source_member_count)||member.exact_digest!==q.memberDigest||
   population.exact_digest!==q.populationDigest||ints(population.element_count)!==BigInt((q.display.link_scopes as unknown[]).length))throw fail('current_review_observation_meaning_mismatch');
}
function rowFromQualified(manifest:Obj,batch:string,q:QualifiedObservation,before:string|null,impactSha:string):Obj {
  return {tenant_key:manifest.tenant_key,batch_id:batch,canonical_result_id:q.canonicalId,operation:'upsert',filters:q.filters,raw:q.raw,representative:q.representative,content_digest:q.contentDigest,member_digest:q.memberDigest,population_digest:q.populationDigest,display:q.display,display_digest:q.displayDigest,before_content_digest:before,impact_entry_sha256:impactSha,qualification_receipt_sha256:q.qualificationReceipt.sha256};
}
/** Closed complete-census proposal. Signed facts alone do not bypass exact set/frequency/wire checks. */
export async function prepareBaselineDryRun(manifest:Obj,inputs:QualifiedObservationInput[],options:PublisherDryRunOptions):Promise<PublisherDryRunResult> {
  const b=options.budget;encodeRecord(BASELINE_CENSUS,manifest,b);noUnknown(manifest);
  if(manifest.manifest_version!=='current_review_baseline_census_v2'||manifest.producer_actor===manifest.verifier_actor||(manifest.verification_receipt as Obj).issuer_actor!==manifest.verifier_actor)throw fail();
  const state=manifest.target_state as Obj,scope=manifest.scope as Obj;validateState(state,b);validateScope(scope,b);validateCoverage(manifest.coverage as Obj,b);
  const qs=await qualifyInputs(manifest,inputs,options),census=manifest.census as Obj[],ids=sortedUnique(census.map(e=>e.canonical_result_id)),actual=[...qs.keys()].sort(compareUtf8);
  if(!sameIds(ids,actual))throw fail('current_review_census_incomplete');const expectations:EvidenceExpectation[]=await modelEvidenceExpectations(manifest,BASELINE_CENSUS,b);
  const frequency=new Map<string,bigint>(),changes:Obj[]=[];
  for(const e of census){
    const q=qs.get(e.canonical_result_id as string)!,o=e.observation as Obj;
    assertObservationMatchesQualified(o,q,b);
    const tupleShape:RecordShape=[['school_id',nullable('T')],['university_code',nullable('T')]],key=bytesHex(encodeRecord(tupleShape,{school_id:q.filters.school_id,university_code:q.filters.university_code},b));frequency.set(key,(frequency.get(key)??0n)+1n);
    const eh=await digestRecord('current_review_baseline_entry_v2',MODEL_CENSUS_ENTRY,e,b);changes.push(rowFromQualified(manifest,manifest.baseline_id as string,q,null,eh));
    expectations.push(...await observationEvidenceExpectations(manifest,q,b));
  }
  const seenTuples=new Set<string>();let sum=0n;for(const f of manifest.school_frequencies as Obj[]){
    const key=bytesHex(encodeRecord([['school_id',nullable('T')],['university_code',nullable('T')]],{school_id:f.school_id,university_code:f.university_code},b));
    if(seenTuples.has(key)||ints(f.multiplicity)<1n||frequency.get(key)!==ints(f.multiplicity))throw fail('current_review_school_frequency_incomplete');seenTuples.add(key);sum+=ints(f.multiplicity);
  }if(sum!==BigInt(ids.length)||seenTuples.size!==frequency.size)throw fail();
  const covered:string[]=[];let previous='';for(const cp of manifest.checkpoints as Obj[]){
    if(!nonempty(cp.chunk_id)||previous&&compareUtf8(previous,cp.chunk_id as string)>=0||cp.source_before_state_sha256!==state.completeness_state_sha256||cp.source_after_state_sha256!==state.completeness_state_sha256||cp.definition_sha256!==state.definition_sha256)throw fail();
    if(!eq(REF,cp.lease_receipt,((manifest.coverage as Obj).writer_fence as Obj).lease_receipt,b))throw fail('current_review_checkpoints_incomplete');
    previous=cp.chunk_id as string;const chunk=sortedUnique(cp.canonical_ids);if(cp.approved_ids_sha256!==await idDigest(chunk,b))throw fail();covered.push(...chunk);
    for(const k of ['bytes_read','bytes_written','elapsed_micros'])ints(cp[k]);
  }
  covered.sort(compareUtf8);if(!sameIds(covered,ids)||!(manifest.checkpoints as Obj[]).length)throw fail('current_review_checkpoints_incomplete');
  await options.evidence.verifyBatch(expectations,options.now);
  const ancestry:Obj={head_batch_id:manifest.baseline_id,entries:[{depth:0,batch_id:manifest.baseline_id,batch_kind:'baseline',manifest_sha256:null,parent_batch_id:null,parent_manifest_sha256:null}]};
  return finishDryRun(manifest,changes,ancestry,await digestRecord('current_review_baseline_census_v2',BASELINE_CENSUS,manifest,b),BigInt(ids.length),BigInt(frequency.size),options);
}
export async function prepareDeltaDryRun(manifest:Obj,inputs:QualifiedObservationInput[],ancestry:Obj,options:PublisherDryRunOptions):Promise<PublisherDryRunResult> {
  const b=options.budget;encodeRecord(IMPACT,manifest,b);noUnknown(manifest);
  if(manifest.manifest_version!=='current_review_dependency_impact_v2'||manifest.producer_actor===manifest.verifier_actor||(manifest.verification_receipt as Obj).issuer_actor!==manifest.verifier_actor)throw fail();
  validateState(manifest.parent_state as Obj,b);validateState(manifest.target_state as Obj,b);for(const k of ['definition_sha256','source_projection_sha256','source_dependency_closure_sha256','content_recipe','model_row_recipe','binding_recipe','content_recipe_sha256','model_row_recipe_sha256','binding_recipe_sha256','codec_spec_sha256'])if((manifest.parent_state as Obj)[k]!==(manifest.target_state as Obj)[k])throw fail('current_review_recipe_transition_unapproved');validateScope(manifest.scope as Obj,b);validateCoverage(manifest.coverage as Obj,b);validateModelAncestry(ancestry,b);
  const es=ancestry.entries as Obj[];if(es[0].batch_kind!=='delta'||es[0].parent_batch_id!==manifest.parent_batch_id||es[0].parent_manifest_sha256!==manifest.parent_batch_manifest_sha256)throw fail();
  const closure=manifest.dependency_closure as Obj,outside=manifest.outside_unchanged as Obj;
  if((closure.unknown_edges as unknown[]).length||(outside.exceptions as unknown[]).length)throw fail('current_review_dependency_closure_incomplete');
  const affected=sortedUnique(closure.affected_union_ids);if(closure.affected_union_sha256!==await idDigest(affected,b)||outside.excluded_affected_ids_sha256!==closure.affected_union_sha256)throw fail();
  const eventIds=new Set<string>();for(let i=0;i<(manifest.command_events as Obj[]).length;i++){
    const e=(manifest.command_events as Obj[])[i];if(e.command_id!==(manifest.target_state as Obj).command_id||e.command_payload_sha256!==(manifest.target_state as Obj).payload_sha256||ints(e.ordinal)!==BigInt(i)||eventIds.has(e.event_id as string)||!['source','correction','curation','school_scope','member','population','flag','out_of_command'].includes(e.change_type as string))throw fail();eventIds.add(e.event_id as string);
    for(const k of ['before_canonical_ids','after_canonical_ids','reason_codes'])sortedUnique(e[k]);
    if(i&&e.before_state_sha256!==(manifest.command_events as Obj[])[i-1].after_state_sha256)throw fail();
  }
  if(!sameIds(sortedUnique(closure.event_root_ids),[...eventIds].sort(compareUtf8)))throw fail('current_review_dependency_closure_incomplete');
  const beforeIds=sortedUnique(closure.before_canonical_ids),afterIds=sortedUnique(closure.after_canonical_ids),union=[...new Set([...beforeIds,...afterIds])].sort(compareUtf8);
  if(!sameIds(union,affected))throw fail('current_review_dependency_closure_incomplete');
  const qs=await qualifyInputs(manifest,inputs,options),changes:Obj[]=[],entries=manifest.impacts as Obj[],ids=sortedUnique(entries.map(e=>e.canonical_result_id));if(!sameIds(ids,affected))throw fail('current_review_impacts_incomplete');
  let added=0n,retracted=0n,replaced=0n;const expectations=await modelEvidenceExpectations(manifest,IMPACT,b);
  for(const e of entries){
    sortedUnique(e.reason_codes);const origin=sortedUnique(e.origin_event_ids);if(!origin.length||origin.some(id=>!eventIds.has(id)))throw fail();
    const before=e.before as Obj|null,after=e.after as Obj|null,eligible=(o:Obj|null)=>o!==null&&o.in_approved_scope===true&&o.active_service===true&&[2024,2025,2026,2027].includes(Number(o.academic_year));
    const op=eligible(after)?'upsert':eligible(before)?'retract':'no_model_change';if(e.operation!==op)throw fail();
    const ih=await digestRecord('current_review_impact_entry_v2',IMPACT_ENTRY,e,b);
    if(op==='upsert'){const q=qs.get(e.canonical_result_id as string);if(!q||!after)throw fail();assertObservationMatchesQualified(after,q,b);changes.push(rowFromQualified(manifest,ancestry.head_batch_id as string,q,eligible(before)?before!.content_digest as string:null,ih));if(eligible(before))replaced++;else added++;
      expectations.push(...await observationEvidenceExpectations(manifest,q,b));qs.delete(q.canonicalId);}
    else if(op==='retract'){retracted++;changes.push({tenant_key:manifest.tenant_key,batch_id:ancestry.head_batch_id,canonical_result_id:e.canonical_result_id,operation:'retract',filters:null,raw:null,representative:null,content_digest:null,member_digest:null,population_digest:null,display:null,display_digest:null,before_content_digest:before!.content_digest,impact_entry_sha256:ih,qualification_receipt_sha256:(e.qualification_receipt as Obj).sha256});}
    else if(before!==null&&after!==null&&!eq(OBS,before,after,b))throw fail();
    if(before!==null&&!beforeIds.includes(e.canonical_result_id as string)||after!==null&&!afterIds.includes(e.canonical_result_id as string))throw fail('current_review_dependency_closure_incomplete');
  }if(qs.size)throw fail('current_review_impacts_excess');
  const c=manifest.counts as Obj,p=ints(c.parent_observation_count),target=ints(c.target_observation_count);
  if(ints(c.upsert_new_count)!==added||ints(c.retract_old_count)!==retracted||ints(c.replaced_count)!==replaced||p+added<retracted||target!==p+added-retracted)throw fail('current_review_count_mismatch');
  const expectedTupleDelta=new Map<string,{removed:bigint;added:bigint}>();
  const tupleKey=(v:Obj)=>bytesHex(encodeRecord([['school_id',nullable('T')],['university_code',nullable('T')]],{school_id:v.school_id,university_code:v.university_code},b));
  for(const e of entries){const before=e.before as Obj|null,after=e.after as Obj|null,eligible=(v:Obj|null)=>v!==null&&v.in_approved_scope===true&&v.active_service===true&&[2024,2025,2026,2027].includes(Number(v.academic_year));
    if(e.operation==='no_model_change')continue;
    for(const [v,k]of [[before,'removed'],[after,'added']]as const)if(eligible(v)){const key=tupleKey(v!),change=expectedTupleDelta.get(key)??{removed:0n,added:0n};change[k]++;expectedTupleDelta.set(key,change);}
  }
  let schools=ints(c.parent_school_tuple_count),previousTuple:Uint8Array|null=null;
  for(const t of c.touched_school_tuples as Obj[]){
    const tuple=encodeRecord([['school_id',nullable('T')],['university_code',nullable('T')]],{school_id:t.school_id,university_code:t.university_code},b);if(previousTuple&&compareBytes(previousTuple,tuple)>=0)throw fail();previousTuple=tuple;
    const pm=ints(t.parent_multiplicity),rm=ints(t.removed_multiplicity),am=ints(t.added_multiplicity),tm=ints(t.target_multiplicity),expected=expectedTupleDelta.get(bytesHex(tuple));
    if(!expected||expected.removed!==rm||expected.added!==am)throw fail('current_review_school_frequency_incomplete');expectedTupleDelta.delete(bytesHex(tuple));if(pm+am<rm||tm!==pm-rm+am)throw fail();schools+=(tm>0n?1n:0n)-(pm>0n?1n:0n);
  }if(expectedTupleDelta.size||schools<0n||schools!==ints(c.target_school_tuple_count)||schools>target)throw fail();
  const checkpoints=manifest.checkpoints as Obj[],coverage=options.checkpointCoverage;
  if(!checkpoints.length||!coverage||coverage.length!==checkpoints.length)throw fail('current_review_checkpoints_incomplete');
  let checkpointPrevious='';const covered:string[]=[];for(let i=0;i<checkpoints.length;i++){const cp=checkpoints[i],chunk=coverage[i];
   if(!closed(chunk,['chunk_id','canonical_ids'])||chunk.chunk_id!==cp.chunk_id||!nonempty(cp.chunk_id)||checkpointPrevious&&compareUtf8(checkpointPrevious,cp.chunk_id as string)>=0||cp.approved_ids_sha256!==await idDigest(sortedUnique(chunk.canonical_ids),b)||cp.source_before_state_sha256!==(manifest.target_state as Obj).completeness_state_sha256||cp.source_after_state_sha256!==(manifest.target_state as Obj).completeness_state_sha256||cp.definition_sha256!==(manifest.target_state as Obj).definition_sha256||!eq(REF,cp.lease_receipt,(manifest.coverage as Obj).writer_fence&&((manifest.coverage as Obj).writer_fence as Obj).lease_receipt,b))throw fail('current_review_checkpoints_incomplete');
   covered.push(...chunk.canonical_ids);checkpointPrevious=cp.chunk_id as string;for(const k of ['bytes_read','bytes_written','elapsed_micros'])ints(cp[k]);}
  if(!sameIds(covered.sort(compareUtf8),affected))throw fail('current_review_checkpoints_incomplete');
  await options.evidence.verifyBatch(expectations,options.now);
  return finishDryRun(manifest,changes,ancestry,await digestRecord('current_review_dependency_impact_v2',IMPACT,manifest,b),target,schools,options);
}
/** Independent pinned root/binding/seal and exact full ancestry must be supplied by activation approval. */
export async function validateModelControl(root:Obj,binding:Obj,seal:Obj,ancestry:Obj,budget:CodecBudget):Promise<void> {
  encodeRecord(ROOT,root,budget);encodeRecord(BINDING,binding,budget);encodeRecord(SEAL,seal,budget);validateModelAncestry(ancestry,budget);
  const rh=await digestRecord('current_review_root_manifest_v2',ROOT,root,budget),bh=await digestRecord(MODEL_RECIPES.binding,BINDING,binding,budget),ad=await digestRecord('current_review_ancestry_v2',ANCESTRY,ancestry,budget),sd=await digestRecord('current_review_source_state_v2',SOURCE_STATE,binding.source_state,budget);
  const head=(ancestry.entries as Obj[])[0];if(root.batch_kind!==head.batch_kind||root.parent_batch_id!==head.parent_batch_id||root.parent_manifest_sha256!==head.parent_manifest_sha256)throw fail('current_review_ancestry_invalid');
  if(root.batch_id!==ancestry.head_batch_id||binding.head_batch_id!==root.batch_id||seal.batch_id!==root.batch_id||binding.head_manifest_sha256!==rh||seal.batch_manifest_sha256!==rh||seal.binding_sha256!==bh||root.ancestry_digest!==ad||binding.ancestry_digest!==ad||seal.ancestry_digest!==ad||root.source_state_digest!==sd||seal.source_state_digest!==sd||root.producer_actor!==seal.producer_actor||seal.producer_actor===seal.verifier_actor)throw fail();
  for(const k of ['tenant_key','tenant_mapping_sha256','transition_manifest_sha256'])if(root[k]!==binding[k]||root[k]!==seal[k])throw fail();
  for(const k of ['model_projection_sha256','selection_scope_sha256','content_recipe','model_row_recipe','binding_recipe'])if(root[k]!==binding[k])throw fail();
  if(root.content_recipe!==MODEL_RECIPES.content||root.model_row_recipe!==MODEL_RECIPES.row||root.binding_recipe!==MODEL_RECIPES.binding||ints(root.upsert_count)+ints(root.retract_count)!==ints(root.staged_change_count)||ints(root.expected_effective_school_tuple_count)>ints(root.expected_effective_observation_count))throw fail();
}



/** Narrow model application port. It never fabricates the original CURRENT35/member32/POP7 raw port. */
import { CurrentReviewQuery, parseCurrentReviewQuery, validateCurrentReviewQuery, CURRENT_REVIEW_PURPOSE, CURRENT_REVIEW_OPERATION, currentReviewSha256 } from './current_admission_review.ts';
import { CurrentKey, CurrentPageBinding, CURRENT_REVIEW_VIEW, EncryptedCurrentCursor, compareCurrentKeys, validateCurrentKey } from './current_admission_display.ts';
import { DisplayError, VerifiedReviewSession, utcText } from './official_history_display.ts';
import { decodeRecord, verifyMerkleProof, expandProof } from './current_review_model_codec.ts';
export interface ReadModelDescriptor {
  format:'jungsi.current-review-read-model/v2';purpose:'current_admission_review';environment:'local_verification'|'isolated_cloud_review';
  source_view:string;allowed_years:number[];projection_version:string;root:Obj;binding:Obj;seal:Obj;ancestry:Obj;ancestor_roots:Obj[];
  model_metadata_sha256:string;activation_receipt:Obj;
  approval:{status:'approved';approval_id:string;issued_at:string;expires_at:string;revoked:false;review_subjects:string[];operations:string[]};
  engine_approved:false;production_allowed:false;general_publication_allowed:false;nationwide_collection_complete:false;
}
export interface ReadModelSelectedRow { model_row_hex:string;leaf_index:string;proof_hex:string }
export interface ReadModelRawPage {
  root:Obj;binding:Obj;seal:Obj;ancestry:Obj;ancestorRoots:Obj[];currentSourceState:Obj;
  grantNotBefore:string;grantExpiresAt:string;asOf:string;matchingObservationCount:string;matchingSourceSchoolCount:string;rows:ReadModelSelectedRow[];
}
export interface ReadModelReviewPagePort {
  readPage(descriptor:ReadModelDescriptor,query:CurrentReviewQuery,after:CurrentKey|null,subject:string):Promise<ReadModelRawPage>;
}
export interface ReadModelReviewPorts extends ReadModelReviewPagePort {
  verifySession(token:string,now:number):Promise<VerifiedReviewSession|null>;
  loadDescriptor():Promise<ReadModelDescriptor>;
  evidence:TrustedEvidenceVerifier;
}
export interface ReadModelReviewTransport {
  relayToken:string;cursorKey:Uint8Array;pathPrefix:string;environment:ReadModelDescriptor['environment'];
  budget:CodecBudget;now?:()=>number;
}
const DESC_FIELDS=['format','purpose','environment','source_view','allowed_years','projection_version','root','binding','seal','ancestry','ancestor_roots','model_metadata_sha256','activation_receipt','approval','engine_approved','production_allowed','general_publication_allowed','nationwide_collection_complete'];
const APPROVAL_FIELDS=['status','approval_id','issued_at','expires_at','revoked','review_subjects','operations'];
const closed=(value:unknown,keys:string[]):value is Obj=>obj(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(v);
function publicInt(value:unknown):number {const n=ints(value);if(n>BigInt(Number.MAX_SAFE_INTEGER))throw fail();return Number(n);}
export async function modelActivationClaim(d:ReadModelDescriptor,budget:CodecBudget):Promise<Obj> {
  const a=d.approval,shape:RecordShape=[['purpose','T'],['environment','T'],['operation','T'],['approval_id','T'],['source_view','T'],['allowed_years',arrayOf('I')],['projection_version','T'],['root_sha256','H'],['binding_sha256','H'],['seal_sha256','H'],['ancestry_sha256','H'],['model_metadata_sha256','H'],['review_subjects',arrayOf('U')],['issued_at','Z'],['expires_at','Z']];
  const payload={purpose:d.purpose,environment:d.environment,operation:CURRENT_REVIEW_OPERATION,approval_id:a.approval_id,source_view:d.source_view,allowed_years:d.allowed_years,projection_version:d.projection_version,
    root_sha256:await digestRecord('current_review_root_manifest_v2',ROOT,d.root,budget),binding_sha256:await digestRecord(MODEL_RECIPES.binding,BINDING,d.binding,budget),
    seal_sha256:await digestRecord('current_review_validation_seal_v2',SEAL,d.seal,budget),ancestry_sha256:await digestRecord('current_review_ancestry_v2',ANCESTRY,d.ancestry,budget),
    model_metadata_sha256:d.model_metadata_sha256,review_subjects:a.review_subjects,issued_at:a.issued_at,expires_at:a.expires_at};
  const state=d.binding.source_state as Obj;return {purpose:d.purpose,tenant_key:d.root.tenant_key,command_id:state.command_id,payload_sha256:state.payload_sha256,definition_sha256:state.definition_sha256,source_projection_sha256:state.source_projection_sha256,model_projection_sha256:d.root.model_projection_sha256,selection_scope_sha256:d.root.selection_scope_sha256,tenant_mapping_sha256:d.root.tenant_mapping_sha256,...Object.fromEntries(['completeness_state_id','completeness_state_sha256','source_dependency_closure_sha256','content_recipe_sha256','model_row_recipe_sha256','binding_recipe_sha256','codec_spec_sha256'].map(k=>[k,state[k]])),claim_domain:'current_review_model_activation_v2',claim_digest:await digestRecord('current_review_model_activation_v2',shape,payload,budget)};
}
export async function validateReadModelDescriptor(d:ReadModelDescriptor,environment:string,now:number,budget:CodecBudget):Promise<void> {
  if(!closed(d,DESC_FIELDS)||d.format!=='jungsi.current-review-read-model/v2'||d.purpose!==CURRENT_REVIEW_PURPOSE||d.environment!==environment||d.source_view!==CURRENT_REVIEW_VIEW||
    !Array.isArray(d.allowed_years)||d.allowed_years.length!==4||d.allowed_years.some((x,i)=>x!==[2024,2025,2026,2027][i])||typeof d.projection_version!=='string'||!d.projection_version||d.projection_version.length>128||
    [d.engine_approved,d.production_allowed,d.general_publication_allowed,d.nationwide_collection_complete].some(x=>x!==false)||!closed(d.approval,APPROVAL_FIELDS))throw fail();
  const a=d.approval;if(a.status!=='approved'||a.revoked!==false||typeof a.approval_id!=='string'||!a.approval_id||!Array.isArray(a.review_subjects)||!a.review_subjects.length||a.review_subjects.some(x=>!uuid(x))||new Set(a.review_subjects).size!==a.review_subjects.length||!Array.isArray(a.operations)||a.operations.length!==1||a.operations[0]!==CURRENT_REVIEW_OPERATION)throw fail();
  const start=utcInstantMicros(a.issued_at),end=utcInstantMicros(a.expires_at),n=BigInt(now)*1000n;if(!Number.isSafeInteger(now)||start>n||n>=end||end<=start||end-start>86_400_000_000n)throw fail('current_review_model_approval_expired');
  hexBytes(d.model_metadata_sha256,32);encodeRecord(REF,d.activation_receipt,budget);await validateModelControl(d.root,d.binding,d.seal,d.ancestry,budget);
  const entries=d.ancestry.entries as Obj[];if(!Array.isArray(d.ancestor_roots)||d.ancestor_roots.length!==entries.length-1)throw fail();
  for(let i=1;i<entries.length;i++){const root=d.ancestor_roots[i-1];encodeRecord(ROOT,root,budget);
    if(root.batch_kind!==entries[i].batch_kind||root.parent_batch_id!==entries[i].parent_batch_id||root.parent_manifest_sha256!==entries[i].parent_manifest_sha256||root.content_recipe!==d.root.content_recipe||root.model_row_recipe!==d.root.model_row_recipe||root.binding_recipe!==d.root.binding_recipe||root.batch_id!==entries[i].batch_id||root.tenant_key!==d.root.tenant_key||await digestRecord('current_review_root_manifest_v2',ROOT,root,budget)!==entries[i].manifest_sha256||root.model_projection_sha256!==d.root.model_projection_sha256||root.selection_scope_sha256!==d.root.selection_scope_sha256||root.tenant_mapping_sha256!==d.root.tenant_mapping_sha256)throw fail();}
}
async function modelPageBinding(d:ReadModelDescriptor,q:CurrentReviewQuery,subject:string,expires:number,b:CodecBudget):Promise<CurrentPageBinding> {
  const state=await digestRecord('current_review_model_cursor_state_v2',[['binding_sha256','H'],['seal_sha256','H']],{binding_sha256:await digestRecord(MODEL_RECIPES.binding,BINDING,d.binding,b),seal_sha256:await digestRecord('current_review_validation_seal_v2',SEAL,d.seal,b)},b);
  const filter={academic_year:q.academic_year,university_q:q.university_q,department_q:q.department_q,track:q.track,group:q.group,metric_kind:q.metric_kind,cohort:q.cohort};
  return {subjectId:subject,sourceVersion:d.projection_version,sourceStateSha256:state,projectionSha256:d.root.model_projection_sha256 as string,operation:CURRENT_REVIEW_OPERATION,querySha256:await currentReviewSha256(filter),expiresAtMs:Math.min(expires,Number(utcInstantMicros(d.approval.expires_at)/1000n))};
}
const fold=(v:unknown)=>String(v??'').replace(/[A-Z]/g,c=>c.toLowerCase());
export async function closeReadModelPage(raw:ReadModelRawPage,d:ReadModelDescriptor,q:CurrentReviewQuery,binding:CurrentPageBinding,after:CurrentKey|null,secret:Uint8Array,budget:CodecBudget):Promise<Row> {
  validateCurrentReviewQuery(q);await validateModelControl(raw.root,raw.binding,raw.seal,raw.ancestry,budget);
  if(!eq(ROOT,raw.root,d.root,budget)||!eq(BINDING,raw.binding,d.binding,budget)||!eq(SEAL,raw.seal,d.seal,budget)||!eq(ANCESTRY,raw.ancestry,d.ancestry,budget)||!eq(SOURCE_STATE,raw.currentSourceState,d.binding.source_state,budget))throw new ReadModelError(q.cursor?'cursor_version_mismatch':'current_review_model_state_unapproved',q.cursor?409:503);
  if(!Array.isArray(raw.ancestorRoots)||raw.ancestorRoots.length!==d.ancestor_roots.length||raw.ancestorRoots.some((r,i)=>!eq(ROOT,r,d.ancestor_roots[i],budget)))throw fail();
  const count=publicInt(raw.matchingObservationCount),schools=publicInt(raw.matchingSourceSchoolCount);if(schools>count||count>publicInt(d.root.expected_effective_observation_count)||!Array.isArray(raw.rows)||raw.rows.length>q.limit+1||raw.rows.length>count)throw fail();
  const items:Row[]=[],keys:CurrentKey[]=[],seen=new Set<string>();let previous=after;const observationCipher=new EncryptedCurrentCursor(secret,'observation'),allRoots=[d.root,...d.ancestor_roots];
  for(const selected of raw.rows){
    if(!closed(selected,['model_row_hex','leaf_index','proof_hex'])||typeof selected.model_row_hex!=='string'||typeof selected.proof_hex!=='string')throw fail();
    const row=decodeRecord(MODEL_ROW,hexBytes(selected.model_row_hex),budget),display=row.display,filter=row.filters;
    if(row.operation!=='upsert'||row.tenant_key!==d.root.tenant_key||typeof row.canonical_result_id!=='string'||!obj(filter)||!obj(row.raw)||!obj(row.representative))throw fail();assertModelDisplay(display,budget);
    const year=publicInt(display.academic_year),key=validateCurrentKey([year,'CURRENT_REVIEW','CANONICAL_OBSERVATIONS','',row.canonical_result_id]);
    if(seen.has(row.canonical_result_id)||previous&&compareCurrentKeys(previous,key)>=0||filter.active_service!==true||publicInt(filter.academic_year)!==year||(q.academic_year!==null&&year!==q.academic_year)||!fold(display.university).includes(q.university_q)||!fold(display.department).includes(q.department_q)||
      !['track','group','metric_kind','cohort'].every(k=>!q[k as keyof CurrentReviewQuery]||fold(display[k==='group'?'recruit_group':k])===q[k as keyof CurrentReviewQuery]))throw fail();
    for(const k of ['university','department','track','recruit_group','metric_kind','cohort'])if(filter[k]!==display[k])throw fail();
    if(publicInt(row.representative.source_member_count)!==publicInt(display.source_member_count)||row.raw.json_type!==display.metric_value_json_type)throw fail();
    if(['present','actual_null'].includes(display.value_availability as string)&&(row.raw.literal!==display.metric_value_literal||row.raw.numeric_text!==display.metric_value_numeric_text))throw fail();
    const root=allRoots.find(r=>r.batch_id===row.batch_id);if(!root)throw fail();const index=publicInt(selected.leaf_index),rowHash=await digestRecord(MODEL_RECIPES.row,MODEL_ROW,row,budget);
    const leaf=await digestRecord('current_review_leaf_v2',LEAF,{tenant_key:row.tenant_key,batch_id:row.batch_id,leaf_index:index,canonical_result_id:row.canonical_result_id,model_row_digest:rowHash},budget);
    await verifyMerkleProof(leaf,index,publicInt(root.staged_change_count),expandProof(hexBytes(selected.proof_hex)),root.change_merkle_root as string,budget);
    if(row.display_digest!==await digestRecord('current_review_display17_v2',[['model_projection_sha256','H'],['display',recordOf(DISPLAY17)]],{model_projection_sha256:d.root.model_projection_sha256,display},budget))throw fail();
    const publicDisplay=structuredClone(display);publicDisplay.academic_year=year;publicDisplay.source_member_count=publicInt(display.source_member_count);
    for(const link of publicDisplay.link_scopes as Obj[])link.population_reference_year=publicInt(link.population_reference_year);
    items.push({observation_token:await observationCipher.seal({...binding,sourceStateSha256:rowHash},key),...publicDisplay} as Row);seen.add(row.canonical_result_id);previous=key;keys.push(key);
  }
  const next=items.length>q.limit?await new EncryptedCurrentCursor(secret).seal(binding,keys[q.limit-1]):null;
  return {format:'jungsi.current-admission-review-page/v1',status:'review',items:items.slice(0,q.limit),matching_observation_count:count,matching_source_school_count:schools,review_version:d.projection_version,as_of:utcText(raw.asOf),next_cursor:next,publication_status:'not_published'};
}
/** Explicit opt-in handler. Session verification and approved reviewer scope precede all data.
 * No default entrypoint calls this factory; the v1/C handler remains intact.
 */
export function createReadModelAdmissionReviewHandler(ports:ReadModelReviewPorts,t:ReadModelReviewTransport):(request:Request)=>Promise<Response> {
  if(typeof t.relayToken!=='string'||!/^[\x21-\x2b\x2d-\x7e]{32,512}$/.test(t.relayToken)||!/^\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/.test(t.pathPrefix)||!(t.cursorKey instanceof Uint8Array)||t.cursorKey.length!==32||!t.budget)throw fail('security_policy_unavailable');
  const cipher=new EncryptedCurrentCursor(t.cursorKey),clock=t.now??Date.now;
  const response=(value:Row,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
  return async(request)=>{
    const id=crypto.randomUUID().replaceAll('-','');try{
      const url=new URL(request.url);if(request.method!=='GET'||url.pathname!==t.pathPrefix+'/api/v1/review/current-admissions')throw new DisplayError('not_found',404);
      const relay=request.headers.get('x-jungsi-relay-token')??'';let diff=relay.length^t.relayToken.length;for(let i=0;i<Math.max(relay.length,t.relayToken.length);i++)diff|=(relay.charCodeAt(i)||0)^(t.relayToken.charCodeAt(i)||0);if(diff)throw new DisplayError('trusted_relay_required',403);
      const auth=request.headers.get('Authorization')??'',m=auth.match(/^Bearer ([^\s]+)$/);if(!m||!/^[^\s,]{1,16384}$/.test(m[1]))throw new DisplayError('authentication_required',401);
      const now=clock(),session=await ports.verifySession(m[1],now);if(!session||!uuid(session.subjectId)||!Number.isSafeInteger(session.expiresAt)||session.expiresAt<=now)throw new DisplayError('authentication_required',401);
      const d=await ports.loadDescriptor();await validateReadModelDescriptor(d,t.environment,now,t.budget);
      if(!d.approval.review_subjects.includes(session.subjectId))throw new DisplayError('review_subject_not_allowed',403);
      await ports.evidence.verifyBatch([{reference:d.activation_receipt,claim:await modelActivationClaim(d,t.budget),requiredRole:'approver',forbiddenIssuer:d.seal.producer_actor as string}],now);
      const q=parseCurrentReviewQuery(url),binding=await modelPageBinding(d,q,session.subjectId,session.expiresAt,t.budget),after=q.cursor===null?null:await cipher.open(q.cursor,binding,now);
      let raw:ReadModelRawPage;try{raw=await ports.readPage(d,q,after,session.subjectId);}catch(e){if(q.cursor&&e instanceof ReadModelError&&e.code==='current_review_model_state_unapproved')throw new DisplayError('cursor_version_mismatch',409);throw e;}
      const completed=clock();if(session.expiresAt<=completed)throw new DisplayError('authentication_required',401);await validateReadModelDescriptor(d,t.environment,completed,t.budget);
      await ports.evidence.verifyBatch([{reference:d.activation_receipt,claim:await modelActivationClaim(d,t.budget),requiredRole:'approver',forbiddenIssuer:d.seal.producer_actor as string}],completed);
      const grantStart=utcInstantMicros(raw.grantNotBefore),grantEnd=utcInstantMicros(raw.grantExpiresAt),grantNow=BigInt(completed)*1000n;if(grantStart!==utcInstantMicros(d.approval.issued_at)||grantEnd!==utcInstantMicros(d.approval.expires_at)||grantStart>grantNow||grantNow>=grantEnd||grantEnd<=grantStart||grantEnd-grantStart>86_400_000_000n)throw new DisplayError('review_grant_expired',403);
      const grantBinding={...binding,expiresAtMs:Math.min(binding.expiresAtMs,Number(grantEnd/1000n))};
      const page=await closeReadModelPage(raw,d,q,grantBinding,after,t.cursorKey,t.budget);
      const last=clock();if(last>=session.expiresAt)throw new DisplayError('authentication_required',401);
      await validateReadModelDescriptor(d,t.environment,last,t.budget);if(BigInt(last)*1000n>=grantEnd)throw new DisplayError('review_grant_expired',403);
      return response(page);
    }catch(e){const error=e instanceof DisplayError||e instanceof ReadModelError?e:new ReadModelError('backend_dependency_unavailable');return response({status:'error',error:{code:error.code},request_id:id},error.status);}
  };
}

