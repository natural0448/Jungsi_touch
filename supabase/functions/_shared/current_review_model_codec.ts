/** Generic RM v2 byte codec. No source fetch, authorization, publication or default-provider switch. */
export class ReadModelError extends Error {
  constructor(public readonly code='current_review_model_not_ready',public readonly status=503){super(code);this.name='ReadModelError';}
}
export interface CodecBudget { maxBytes:number;maxElements:number;maxDepth:number }
export type ScalarType='T'|'I'|'U'|'Z'|'H'|'B';
export type Shape=ScalarType|{nullable:Shape}|{array:Shape}|{record:RecordShape};
export type RecordShape=readonly (readonly [string,Shape])[];
export interface TlvNode { tag:number;value:null|boolean|string|TlvNode[]|(readonly [string,TlvNode])[] }
export const TAG={M:0,N:1,F:2,B:3,I:4,T:5,U:6,Z:7,H:8,A:9,R:10} as const;
const enc=new TextEncoder(),dec=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const error=()=>new ReadModelError('current_review_model_codec_invalid');
export const nullable=(shape:Shape):Shape=>({nullable:shape});
export const arrayOf=(shape:Shape):Shape=>({array:shape});
export const recordOf=(shape:RecordShape):Shape=>({record:shape});
export function isClosedRecord(value:unknown,shape:RecordShape):value is Record<string,unknown> {
  return value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===shape.length&&shape.every(([k])=>Object.hasOwn(value,k));
}
function budget(b:CodecBudget){if(!b||![b.maxBytes,b.maxElements,b.maxDepth].every(x=>Number.isSafeInteger(x)&&x>0)||b.maxBytes>0xffffffff)throw error();}
function text(v:unknown):string {
  if(typeof v!=='string')throw error();
  for(let i=0;i<v.length;i++){const c=v.charCodeAt(i);if(c>=0xd800&&c<=0xdbff){const n=v.charCodeAt(++i);if(!(n>=0xdc00&&n<=0xdfff))throw error();}else if(c>=0xdc00&&c<=0xdfff)throw error();}
  return v;
}
function integer(v:unknown):string {
  const s=typeof v==='bigint'?v.toString():typeof v==='number'&&Number.isSafeInteger(v)&&!Object.is(v,-0)?String(v):v;
  if(typeof s!=='string'||! /^-?(?:0|[1-9][0-9]*)$/.test(s)||s==='-0')throw error();return s;
}
function utc(v:unknown):string {
  const s=text(v),m=s.match(/^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})\.([0-9]{6})Z$/);if(!m)throw error();
  const d=new Date(0);d.setUTCFullYear(+m[1],+m[2]-1,+m[3]);d.setUTCHours(+m[4],+m[5],+m[6],0);
  if(!Number.isFinite(d.getTime())||d.getUTCFullYear()!==+m[1]||d.getUTCMonth()+1!==+m[2]||d.getUTCDate()!==+m[3]||d.getUTCHours()!==+m[4]||d.getUTCMinutes()!==+m[5]||d.getUTCSeconds()!==+m[6])throw error();
  return s;
}
export function hexBytes(value:string,length?:number):Uint8Array {
  if(!/^(?:[0-9a-f]{2})*$/.test(value)||length!==undefined&&value.length!==length*2)throw error();
  return Uint8Array.from(value.match(/../g)??[],v=>parseInt(v,16));
}
export function bytesHex(value:Uint8Array):string{return [...value].map(x=>x.toString(16).padStart(2,'0')).join('');}
export function compareBytes(a:Uint8Array,b:Uint8Array):number {
  for(let i=0;i<Math.min(a.length,b.length);i++)if(a[i]!==b[i])return a[i]<b[i]?-1:1;return Math.sign(a.length-b.length);
}
export const compareUtf8=(a:string,b:string)=>compareBytes(enc.encode(text(a)),enc.encode(text(b)));
export function typedNode(shape:Shape,value:unknown):TlvNode {
  if(typeof shape!=='string'){
    if('nullable'in shape)return value===null?{tag:TAG.N,value:null}:typedNode(shape.nullable,value);
    if('array'in shape){if(!Array.isArray(value))throw error();return {tag:TAG.A,value:value.map(x=>typedNode(shape.array,x))};}
    if(!isClosedRecord(value,shape.record))throw error();
    return {tag:TAG.R,value:shape.record.map(([k,s])=>[k,typedNode(s,value[k])] as const)};
  }
  switch(shape){
    case'T':return {tag:TAG.T,value:text(value)};
    case'I':return {tag:TAG.I,value:integer(value)};
    case'B':if(typeof value!=='boolean')throw error();return {tag:value?TAG.B:TAG.F,value};
    case'U':{const s=text(value);if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(s))throw error();return {tag:TAG.U,value:s};}
    case'H':{const s=text(value);hexBytes(s,32);return {tag:TAG.H,value:s};}
    case'Z':return {tag:TAG.Z,value:utc(value)};
  }
}
const u32=(n:number)=>{if(!Number.isSafeInteger(n)||n<0||n>0xffffffff)throw error();const b=new Uint8Array(4);new DataView(b.buffer).setUint32(0,n);return b;};
const join=(parts:Uint8Array[],b:CodecBudget)=>{const size=parts.reduce((n,p)=>n+p.length,0);if(size>b.maxBytes)throw error();const out=new Uint8Array(size);let p=0;for(const part of parts){out.set(part,p);p+=part.length;}return out;};
export function encodeNode(node:TlvNode,b:CodecBudget):Uint8Array {
  budget(b);let elements=0;
  function walk(n:TlvNode,depth:number):Uint8Array {
    if(depth>b.maxDepth||++elements>b.maxElements)throw error();let payload:Uint8Array;
    switch(n.tag){
      case TAG.M:case TAG.N:if(n.value!==null)throw error();payload=new Uint8Array();break;
      case TAG.F:case TAG.B:if(n.value!==(n.tag===TAG.B))throw error();payload=new Uint8Array();break;
      case TAG.I:payload=enc.encode(integer(n.value));break;
      case TAG.T:payload=enc.encode(text(n.value));break;
      case TAG.Z:payload=enc.encode(utc(n.value));break;
      case TAG.H:payload=hexBytes(text(n.value),32);break;
      case TAG.U:{const s=text(n.value);typedNode('U',s);payload=hexBytes(s.replaceAll('-',''),16);break;}
      case TAG.A:{if(!Array.isArray(n.value))throw error();const values=n.value as TlvNode[];payload=join([u32(values.length),...values.map(v=>walk(v,depth+1))],b);break;}
      case TAG.R:{if(!Array.isArray(n.value))throw error();const pairs=n.value as (readonly[string,TlvNode])[],seen=new Set<string>(),parts:Uint8Array[]=[u32(pairs.length)];
        for(const p of pairs){if(!Array.isArray(p)||p.length!==2||seen.has(p[0]))throw error();seen.add(p[0]);parts.push(walk(typedNode('T',p[0]),depth+1),walk(p[1],depth+1));}payload=join(parts,b);break;}
      default:throw error();
    }
    return join([Uint8Array.of(n.tag),u32(payload.length),payload],b);
  }return walk(node,0);
}
export const encodeRecord=(shape:RecordShape,value:unknown,b:CodecBudget)=>encodeNode(typedNode(recordOf(shape),value),b);
export function decodeNode(bytes:Uint8Array,b:CodecBudget):TlvNode {
  budget(b);if(!(bytes instanceof Uint8Array)||bytes.length>b.maxBytes)throw error();let elements=0;
  function walk(offset:number,end:number,depth:number):[TlvNode,number] {
    if(depth>b.maxDepth||++elements>b.maxElements||offset+5>end)throw error();
    const tag=bytes[offset],length=new DataView(bytes.buffer,bytes.byteOffset+offset+1,4).getUint32(0);let p=offset+5;const stop=p+length;if(stop>end)throw error();
    let value:TlvNode['value'];
    if([TAG.M,TAG.N,TAG.F,TAG.B].includes(tag as 0)){if(length!==0)throw error();value=tag===TAG.F?false:tag===TAG.B?true:null;}
    else if(tag===TAG.T||tag===TAG.I||tag===TAG.Z){const s=dec.decode(bytes.subarray(p,stop));value=tag===TAG.I?integer(s):tag===TAG.Z?utc(s):text(s);}
    else if(tag===TAG.H){if(length!==32)throw error();value=bytesHex(bytes.subarray(p,stop));}
    else if(tag===TAG.U){if(length!==16)throw error();const s=bytesHex(bytes.subarray(p,stop));value=s.slice(0,8)+'-'+s.slice(8,12)+'-'+s.slice(12,16)+'-'+s.slice(16,20)+'-'+s.slice(20);}
    else if(tag===TAG.A||tag===TAG.R){
      if(length<4)throw error();const count=new DataView(bytes.buffer,bytes.byteOffset+p,4).getUint32(0);p+=4;if(count>b.maxElements)throw error();
      const list:TlvNode[]=[],pairs:(readonly[string,TlvNode])[]=[],seen=new Set<string>();
      for(let i=0;i<count;i++){
        if(tag===TAG.R){const [k,next]=walk(p,stop,depth+1);p=next;if(k.tag!==TAG.T||typeof k.value!=='string'||seen.has(k.value))throw error();seen.add(k.value);const[v,last]=walk(p,stop,depth+1);p=last;pairs.push([k.value,v]);}
        else{const[v,last]=walk(p,stop,depth+1);p=last;list.push(v);}
      }if(p!==stop)throw error();value=tag===TAG.A?list:pairs;
    }else throw error();
    return [{tag,value},stop];
  }
  try{const[n,end]=walk(0,bytes.length,0);if(end!==bytes.length||compareBytes(encodeNode(n,b),bytes)!==0)throw error();return n;}catch{throw error();}
}
function untype(shape:Shape,node:TlvNode):unknown {
  if(typeof shape!=='string'){
    if('nullable'in shape)return node.tag===TAG.N?null:untype(shape.nullable,node);
    if('array'in shape){if(node.tag!==TAG.A)throw error();return (node.value as TlvNode[]).map(n=>untype(shape.array,n));}
    if(node.tag!==TAG.R)throw error();const pairs=node.value as (readonly[string,TlvNode])[];
    if(pairs.length!==shape.record.length||pairs.some((p,i)=>p[0]!==shape.record[i][0]))throw error();
    return Object.fromEntries(pairs.map((p,i)=>[p[0],untype(shape.record[i][1],p[1])]));
  }
  const expected=shape==='B'?[TAG.F,TAG.B]:[TAG[shape]];if(!expected.includes(node.tag as never))throw error();return node.value;
}
export const decodeRecord=(shape:RecordShape,bytes:Uint8Array,b:CodecBudget)=>untype(recordOf(shape),decodeNode(bytes,b)) as Record<string,unknown>;
export async function sha256Bytes(bytes:Uint8Array):Promise<string>{return bytesHex(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes).buffer)));}
export async function digestRecord(domain:string,shape:RecordShape,value:unknown,b:CodecBudget):Promise<string> {
  return sha256Bytes(join([hexBytes('4a542d524d0001'),encodeNode(typedNode('T',domain),b),encodeRecord(shape,value,b)],b));
}
const N=(s:Shape)=>nullable(s),A=(s:Shape)=>arrayOf(s),R=(s:RecordShape)=>recordOf(s);
const named=(names:string,type:Shape):RecordShape=>names.split(',').map(n=>[n,type] as const);
const Iwire=new Set(['academic_year','population_reference_year','source_member_count']);
const Bwire=new Set(['active_service','is_representative','individual_offering_metric_inference_allowed']);
const wireShape=(fields:string[]):RecordShape=>fields.map(k=>[k,Bwire.has(k)?'B':Iwire.has(k)?N('I'):N('T')] as const);
export const BASE29_FIELDS='release_id,result_id,academic_year,school_id,university_code,university,recruit_group,recruit_group_raw,department,track,offering_pk,anchor_2027_pks,metric_kind,metric_value_literal,metric_value_numeric,metric_value_json_type,cohort,statistic_label,active_service,source_path,source_sha256,source_location,source_review_status,original_record_locator,field_presence_types,row_fingerprint,curation_release_id,curation_fields,curation_evidence'.split(',');
export const CURRENT35=wireShape([...BASE29_FIELDS,...'source_result_id,canonical_result_id,source_member_count,management_status,overlap_review_key,source_row_fingerprint'.split(',')]);
export const MEMBER32=wireShape([...BASE29_FIELDS,...'canonical_result_id,source_all29_sha256,is_representative'.split(',')]);
export const POP7=wireShape('result_id,academic_year,population_reference_year,reference_offering_pk,link_kind,active_service,individual_offering_metric_inference_allowed'.split(','));
export const OFFICIAL6=named('metric_definition,unit,original_scale,source_url,source_as_of,publication_status',N('T'));
export const LINK_SCOPE:RecordShape=[['population_reference_year','I'],['link_kind','T'],['individual_offering_metric_inference_allowed','B']];
export const DISPLAY17:RecordShape=[['academic_year','I'],...named('university,department,track,recruit_group,metric_kind,metric_value_literal,metric_value_json_type,metric_value_numeric_text,cohort,statistic_label',N('T')),['source_member_count','I'],['link_scopes',A(R(LINK_SCOPE))],['official_metadata',R(OFFICIAL6)],['review_status','T'],['value_availability','T'],['hold_reasons',A('T')]];
export const FILTER:RecordShape=[['academic_year',N('I')],...named('school_id,university_code',N('T')),['active_service',N('B')],...named('university,department,track,recruit_group,metric_kind,cohort',N('T'))];
export const RAW=named('literal,json_type,numeric_text',N('T'));
export const REPRESENTATIVE:RecordShape=[...named('release_id,result_id,source_row_fingerprint,effective_row_fingerprint',N('T')),['source_member_count',N('I')]];
export const MODEL_ROW:RecordShape=[['tenant_key','T'],['batch_id','U'],['canonical_result_id','T'],['operation','T'],['filters',N(R(FILTER))],['raw',N(R(RAW))],['representative',N(R(REPRESENTATIVE))],...named('content_digest,member_digest,population_digest',N('H')),['display',N(R(DISPLAY17))],...named('display_digest,before_content_digest',N('H')),...named('impact_entry_sha256,qualification_receipt_sha256','H')];
export const LEAF:RecordShape=[['tenant_key','T'],['batch_id','U'],['leaf_index','I'],['canonical_result_id','T'],['model_row_digest','H']];
export const ANCESTRY_ENTRY:RecordShape=[['depth','I'],['batch_id','U'],['batch_kind','T'],['manifest_sha256',N('H')],['parent_batch_id',N('U')],['parent_manifest_sha256',N('H')]];
export const ANCESTRY:RecordShape=[['head_batch_id','U'],['entries',A(R(ANCESTRY_ENTRY))]];
export const SOURCE_STATE:RecordShape=[['command_id','T'],...named('payload_sha256,definition_sha256,source_projection_sha256','H'),['completeness_state_id','T'],...named('completeness_state_sha256,coverage_receipt_sha256','H'),...named('source_dependency_closure_sha256,content_recipe_sha256,model_row_recipe_sha256,binding_recipe_sha256,codec_spec_sha256','H')];
export const ROOT:RecordShape=[['tenant_key','T'],['batch_id','U'],['batch_kind','T'],['parent_batch_id',N('U')],['parent_manifest_sha256',N('H')],...named('source_state_digest,model_projection_sha256,selection_scope_sha256,tenant_mapping_sha256','H'),...named('content_recipe,model_row_recipe,binding_recipe','T'),...named('transition_manifest_sha256,ancestry_digest','H'),...named('staged_change_count,upsert_count,retract_count,expected_effective_observation_count,expected_effective_school_tuple_count','I'),...named('change_merkle_root,verification_plan_sha256','H'),['producer_actor','U'],['created_at','Z']];
export const BINDING:RecordShape=[['tenant_key','T'],['tenant_mapping_sha256','H'],['source_state',R(SOURCE_STATE)],...named('model_projection_sha256,selection_scope_sha256','H'),['head_batch_id','U'],...named('head_manifest_sha256,ancestry_digest,transition_manifest_sha256','H'),...named('content_recipe,model_row_recipe,binding_recipe','T')];
export const SEAL:RecordShape=[['tenant_key','T'],['batch_id','U'],...named('batch_manifest_sha256,binding_sha256,ancestry_digest,source_state_digest,transition_manifest_sha256,tenant_mapping_sha256','H'),['producer_actor','U'],['verifier_actor','U'],...named('verification_receipt_sha256,approval_receipt_sha256','H'),['sealed_at','Z']];
export const REF:RecordShape=[...named('evidence_id,evidence_kind,immutable_version','T'),['bytes','I'],['sha256','H'],['issuer_actor','U'],['recorded_at','Z']];
export const DEPENDENCY_STATE:RecordShape=[['command_id','T'],...named('payload_sha256,definition_sha256,source_projection_sha256','H'),...named('content_recipe,model_row_recipe,binding_recipe','T'),['completeness_state_id','T'],['completeness_state_sha256','H'],['coverage_receipt',R(REF)],...named('source_dependency_closure_sha256,content_recipe_sha256,model_row_recipe_sha256,binding_recipe_sha256,codec_spec_sha256','H')];
export const SCOPE:RecordShape=[['allowed_years',A('I')],...named('selection_scope_sha256,model_projection_sha256,qualification_rules_sha256','H'),['canonical_universe_receipt',R(REF)],['dependency_rules_sha256','H']];
export const DOMAIN:RecordShape=[['classification','T'],['effect_rules_sha256','H'],...['event_inventory_receipt','before_root_receipt','after_root_receipt','coverage_proof_receipt'].map(k=>[k,R(REF)] as const)];
export const FENCE:RecordShape=[['lease_id','T'],['lease_receipt',R(REF)],['writer_scope_sha256','H'],...named('begin_at,end_at','Z'),...named('begin_state_sha256,end_state_sha256','H'),['allowed_writers_receipt',R(REF)],['out_of_protocol_write_check',R(REF)]];
export const REGISTRATION:RecordShape=[['mechanism_id','T'],['mechanism_definition_sha256','H'],...['parent_registration_receipt','target_registration_receipt','latest_snapshot_binding_receipt'].map(k=>[k,R(REF)] as const)];
export const COVERAGE:RecordShape=[['coverage_version','T'],...['source_change','correction','curation','school_scope','member','population','flag','out_of_command'].map(k=>[k,R(DOMAIN)] as const),['writer_fence',R(FENCE)],['state_registration',R(REGISTRATION)]];
export const IMPACT_REP:RecordShape=[...named('release_id,result_id','T'),...named('source_row_fingerprint,effective_row_fingerprint',N('T'))];
export const MULTISET:RecordShape=[['element_count','I'],['recipe','T'],['exact_digest','H'],['qualification_receipt',R(REF)]];
export const OBS:RecordShape=[['in_approved_scope','B'],['academic_year','I'],...named('school_id,university_code',N('T')),['active_service','B'],['content_digest','H'],['current_wire_receipt',R(REF)],['representative',R(IMPACT_REP)],['member_multiset',R(MULTISET)],['population_multiset',R(MULTISET)],...named('corrected_filter_digest,display17_digest','H'),['original_source29_validation_receipt',N(R(REF))],['native_canonical32_validation_receipt',N(R(REF))],['component_validation_policy_sha256','H']];
export const IMPACT_ENTRY:RecordShape=[['canonical_result_id','T'],['before',N(R(OBS))],['after',N(R(OBS))],['operation','T'],['reason_codes',A('T')],['origin_event_ids',A('T')],['dependency_evidence',R(REF)],['qualification_receipt',R(REF)]];
export const EVENT:RecordShape=[...named('event_id,command_id','T'),['command_payload_sha256','H'],['change_type','T'],['ordinal','I'],...named('before_state_sha256,after_state_sha256','H'),['before_evidence',R(REF)],['after_evidence',R(REF)],['before_canonical_ids',A('T')],['after_canonical_ids',A('T')],['dependency_edge_receipt',R(REF)],['reason_codes',A('T')]];
export const CLOSURE:RecordShape=[['rules_sha256','H'],['event_root_ids',A('T')],['edge_inventory_receipt',R(REF)],['fixed_point_receipt',R(REF)],['before_canonical_ids',A('T')],['after_canonical_ids',A('T')],['affected_union_ids',A('T')],['affected_union_sha256','H'],['unknown_edges',A('T')]];
export const OUTSIDE:RecordShape=[['parent_universe_receipt',R(REF)],['excluded_affected_ids_sha256','H'],...['parent_outside_commitment','target_outside_commitment','dependency_domains_complete_receipt','writer_fence_receipt','equivalence_proof_receipt'].map(k=>[k,R(REF)] as const),['exceptions',A('T')]];
export const SCHOOL_TUPLE:RecordShape=[...named('school_id,university_code',N('T')),...named('parent_multiplicity,removed_multiplicity,added_multiplicity,target_multiplicity','I'),['frequency_evidence',R(REF)]];
export const COUNTS:RecordShape=[...named('parent_observation_count,parent_school_tuple_count,upsert_new_count,retract_old_count,replaced_count,target_observation_count','I'),['touched_school_tuples',A(R(SCHOOL_TUPLE))],['target_school_tuple_count','I'],...['parent_count_receipt','target_count_receipt','count_equivalence_receipt'].map(k=>[k,R(REF)] as const)];
export const CHECKPOINT:RecordShape=[['chunk_id','T'],...named('approved_ids_sha256,source_before_state_sha256,source_after_state_sha256,definition_sha256','H'),['qualification_receipt',R(REF)],...named('bytes_read,bytes_written,elapsed_micros','I'),['lease_receipt',R(REF)]];
export const IMPACT:RecordShape=[...named('manifest_version,tenant_key','T'),['tenant_mapping_sha256','H'],['parent_batch_id','U'],['parent_batch_manifest_sha256','H'],['parent_state',R(DEPENDENCY_STATE)],['target_state',R(DEPENDENCY_STATE)],['scope',R(SCOPE)],['coverage',R(COVERAGE)],['command_events',A(R(EVENT))],['dependency_closure',R(CLOSURE)],['impacts',A(R(IMPACT_ENTRY))],['outside_unchanged',R(OUTSIDE)],['counts',R(COUNTS)],['checkpoints',A(R(CHECKPOINT))],['producer_actor','U'],['verifier_actor','U'],['verification_receipt',R(REF)],['approval_receipt',R(REF)]];
export async function sortedWire(shape:RecordShape,rows:Record<string,unknown>[],b:CodecBudget):Promise<Record<string,unknown>[]> {
  const items=rows.map(row=>({row,bytes:encodeRecord(shape,row,b)}));
  if(shape===MEMBER32){const seen=new Set<string>();for(const {row}of items){if(typeof row.release_id!=='string'||typeof row.result_id!=='string')throw error();const k=bytesHex(encodeNode(typedNode(A('T'),[row.release_id,row.result_id]),b));if(seen.has(k))throw error();seen.add(k);}
    items.sort((a,c)=>compareUtf8(a.row.release_id as string,c.row.release_id as string)||compareUtf8(a.row.result_id as string,c.row.result_id as string)||compareBytes(a.bytes,c.bytes));}
  else items.sort((a,c)=>compareBytes(a.bytes,c.bytes));return items.map(x=>x.row);
}
export async function wireContentDigests(projection:string,current:Record<string,unknown>,members:Record<string,unknown>[],population:Record<string,unknown>[],b:CodecBudget) {
  const ms=await sortedWire(MEMBER32,members,b),ps=await sortedWire(POP7,population,b);
  return {content:await digestRecord('current_review_content_wire_v2',[['source_wire_projection_sha256','H'],['current',R(CURRENT35)],['members',A(R(MEMBER32))],['population',A(R(POP7))]],{source_wire_projection_sha256:projection,current,members:ms,population:ps},b),
    members:await digestRecord('current_review_member_multiset_v2',[['source_wire_projection_sha256','H'],['members',A(R(MEMBER32))]],{source_wire_projection_sha256:projection,members:ms},b),
    population:await digestRecord('current_review_population_multiset_v2',[['source_wire_projection_sha256','H'],['population',A(R(POP7))]],{source_wire_projection_sha256:projection,population:ps},b)};
}
export async function merkleTree(leaves:string[],tenant:string,batch:string,b:CodecBudget):Promise<{root:string;proofs:string[][]}> {
  if(leaves.length>b.maxElements)throw error();for(const h of leaves)hexBytes(h,32);
  if(!leaves.length)return {root:await digestRecord('current_review_merkle_empty_v2',[['tenant_key','T'],['batch_id','U']],{tenant_key:tenant,batch_id:batch},b),proofs:[]};
  const levels=[leaves.slice()];while(levels.at(-1)!.length>1){const previous=levels.at(-1)!,next:string[]=[];for(let i=0;i<previous.length;i+=2)next.push(await digestRecord('current_review_merkle_node_v2',[['left','H'],['right','H']],{left:previous[i],right:previous[i+1]??previous[i]},b));levels.push(next);}
  const proofs=leaves.map((_,i)=>{const p:string[]=[];for(let level=0;level<levels.length-1;level++){p.push(levels[level][i^1]??levels[level][i]);i=Math.floor(i/2);}return p;});return {root:levels.at(-1)![0],proofs};
}
export async function verifyMerkleProof(leaf:string,index:number,count:number,proof:string[],root:string,b:CodecBudget):Promise<void> {
  if(!Number.isSafeInteger(index)||!Number.isSafeInteger(count)||count<1||index<0||index>=count||proof.length>b.maxDepth)throw error();
  let h=leaf,i=index,n=count,p=0;hexBytes(h,32);hexBytes(root,32);
  while(n>1){const sibling=proof[p++];if(sibling===undefined)throw error();hexBytes(sibling,32);if(n%2===1&&i===n-1&&sibling!==h)throw error();
    h=await digestRecord('current_review_merkle_node_v2',[['left','H'],['right','H']],{left:i%2?sibling:h,right:i%2?h:sibling},b);i=Math.floor(i/2);n=Math.ceil(n/2);}
  if(p!==proof.length||h!==root)throw error();
}
export function compactProof(proof:string[]):Uint8Array {const out=new Uint8Array(proof.length*32);proof.forEach((h,i)=>out.set(hexBytes(h,32),i*32));return out;}
export function expandProof(bytes:Uint8Array):string[]{if(bytes.length%32)throw error();const out:string[]=[];for(let i=0;i<bytes.length;i+=32)out.push(bytesHex(bytes.subarray(i,i+32)));return out;}

