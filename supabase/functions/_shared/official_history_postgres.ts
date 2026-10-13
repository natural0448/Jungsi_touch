/** Concrete app-role SQL, verified Supabase Auth and private immutable Storage. */
import './node_compat_bootstrap.ts';
import postgres from 'npm:postgres@3.4.5';
import { DB_FIELDS, DisplayError, nowMicros, parseStrictJson, sameJson, utcInstantMicros, utcText, validateDisplayScope, VIEW } from './official_history_display.ts';
import type { DisplayDescriptor, OfficialHistoryPorts, Row } from './official_history_display.ts';

export interface OfficialHistoryInfrastructureSettings {
  databaseUrl: string; databaseCa: string; supabaseUrl: string; publishableKey: string;
  storageSecret: string; descriptorBucket: string; descriptorPath: string;
  descriptorSha256: string; descriptorBytes: number;
}
const fail = (code: string) => new DisplayError(code);
/** One subject-bound read includes native catalog, role and RLS evidence. */
export const JEONGSI_PASS_STATE_SQL=`SELECT c.oid IS NOT NULL AS relation_exists,
 current_user AS runtime_user,current_setting('row_security') AS row_security,
 current_setting('transaction_read_only') AS read_only,
 pg_has_role(current_user,'jungsi_backend_owner','MEMBER') AS owner_member,
 pg_has_role(current_user,'jungsi_backend_owner','USAGE') AS owner_usage,
 pg_has_role(current_user,'postgres','MEMBER') AS postgres_member,
 cols.native AS columns_native,cons.native AS constraints_native,
 jsonb_build_array(c.relrowsecurity,r.rolsuper,r.rolbypassrls,c.relowner=r.oid,
   has_table_privilege(current_user,c.oid,'SELECT'),
   has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
   has_any_column_privilege(current_user,c.oid,'INSERT,UPDATE,REFERENCES')) AS role_native,
 policies.native AS policies_native,
 to_char(paid.ends_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS expires_at
 FROM (SELECT to_regclass('public.jeongsi_passes') AS oid) target
 LEFT JOIN pg_catalog.pg_class c ON c.oid=target.oid
 LEFT JOIN pg_catalog.pg_roles r ON r.rolname=current_user AND r.rolname='jungsi_backend_app'
 LEFT JOIN LATERAL (
   SELECT jsonb_agg(jsonb_build_array(column_name,udt_name,is_nullable) ORDER BY ordinal_position) AS native
   FROM information_schema.columns WHERE table_schema='public' AND table_name='jeongsi_passes'
 ) cols ON true
 LEFT JOIN LATERAL (
   SELECT jsonb_agg(jsonb_build_array(conname,contype::text,convalidated,pg_get_constraintdef(oid)) ORDER BY conname) AS native
   FROM pg_catalog.pg_constraint WHERE conrelid=c.oid
 ) cons ON true
 LEFT JOIN LATERAL (
   SELECT jsonb_agg(jsonb_build_array(polname,polcmd::text,polpermissive,
     ARRAY(SELECT CASE WHEN role_id=0 THEN 'public' ELSE pg_get_userbyid(role_id) END FROM unnest(polroles) AS policy_role(role_id)),
     pg_get_expr(polqual,polrelid),pg_get_expr(polwithcheck,polrelid)) ORDER BY polname) AS native
   FROM pg_catalog.pg_policy WHERE polrelid=c.oid AND polcmd IN ('r','*')
 ) policies ON true
 LEFT JOIN LATERAL (
   SELECT max(ends_at) AS ends_at FROM public.jeongsi_passes
   WHERE user_id=$1::uuid AND revoked_at IS NULL AND starts_at<=$2::timestamptz AND ends_at>$2::timestamptz
 ) paid ON true`;
const PASS_COLUMNS:Record<string,[string,string]>={id:['int8','NO'],user_id:['uuid','NO'],
  starts_at:['timestamptz','NO'],ends_at:['timestamptz','NO'],note:['text','YES'],
  granted_by:['uuid','YES'],revoked_at:['timestamptz','YES'],revoked_by:['uuid','YES'],created_at:['timestamptz','NO']};
const policyExpression=(value:unknown)=>typeof value==='string'?value.replace(/[\s()]/g,'').toLowerCase():null;
function verifyPassState(row:Row) {
  if(row.runtime_user!=='jungsi_backend_app'||row.row_security!=='on'||row.read_only!=='on'||
      row.owner_member!==false||row.owner_usage!==false||row.postgres_member!==false)throw fail('entitlement_unavailable');
  if(row.relation_exists!==true||!Array.isArray(row.columns_native)||row.columns_native.length!==9)throw fail('entitlement_unavailable');
  const names=new Set<string>();
  for(const column of row.columns_native) {
    if(!Array.isArray(column)||column.length!==3||!column.every(v=>typeof v==='string'))throw fail('entitlement_unavailable');
    const [name,kind,nullable]=column;
    if(names.has(name)||!Object.hasOwn(PASS_COLUMNS,name)||!sameJson([kind,nullable],PASS_COLUMNS[name]))throw fail('entitlement_unavailable');
    names.add(name);
  }
  const constraints=row.constraints_native;
  if(!Array.isArray(constraints)||!constraints.every(v=>Array.isArray(v)&&v.length===4))throw fail('entitlement_unavailable');
  const checkedConstraints=constraints as unknown[][];
  if(!checkedConstraints.some(v=>v[0]==='jeongsi_passes_period'&&v[1]==='c'&&v[2]===true&&policyExpression(v[3])==='checkends_at>starts_at')||
     !checkedConstraints.some(v=>v[1]==='p'&&v[2]===true&&policyExpression(v[3])==='primarykeyid')||
     !checkedConstraints.some(v=>v[1]==='f'&&v[2]===true&&policyExpression(v[3])==='foreignkeyuser_idreferencesauth.usersidondeletecascade'))throw fail('entitlement_unavailable');
  if(!sameJson(row.role_native,[true,false,false,false,true,false,false]))throw fail('entitlement_unavailable');
  const policies=row.policies_native;
  if(!Array.isArray(policies)||policies.length!==2||!policies.every(v=>Array.isArray(v)&&v.length===6&&
      typeof v[0]==='string'&&v[1]==='r'&&v[2]===true&&Array.isArray(v[3])&&v[3].every((r:unknown)=>typeof r==='string')&&v[5]===null))throw fail('entitlement_unavailable');
  const checkedPolicies=policies as [string,string,boolean,string[],unknown,null][];
  const own=checkedPolicies.find(v=>v[0]==='jeongsi_passes: select own or admin'),backend=checkedPolicies.find(v=>v[0]==='jeongsi_passes: jungsi backend read');
  if(!own||!backend||!sameJson(own[3],['public'])||!['auth.uid=user_idoris_admin','auth.uid=user_idorpublic.is_admin'].includes(policyExpression(own[4])??'')||
      backend[3].length!==2||!backend[3].includes('jungsi_backend_app')||!backend[3].includes('jungsi_backend_owner')||policyExpression(backend[4])!=='true')throw fail('entitlement_unavailable');
}
async function sha256(bytes: Uint8Array) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes).buffer))].map(v=>v.toString(16).padStart(2,'0')).join('');
}
async function bytes(response: Response, max: number): Promise<Uint8Array> {
  if (!response.body) throw fail('backend_dependency_unavailable');
  const declared=response.headers.get('content-length');
  if (declared && (!/^[0-9]+$/.test(declared) || Number(declared)>max)) throw fail('backend_dependency_unavailable');
  const reader=response.body.getReader(), chunks:Uint8Array[]=[]; let total=0;
  try { while(true) { const next=await reader.read();if(next.done)break;total+=next.value.byteLength;if(total>max)throw fail('backend_dependency_unavailable');chunks.push(next.value); } }
  finally { reader.releaseLock(); }
  const all=new Uint8Array(total);let offset=0;for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.byteLength;}return all;
}
function origin(settings: OfficialHistoryInfrastructureSettings): string {
  try {
    const u=new URL(settings.supabaseUrl);
    if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/'||u.port)throw new Error();
    return u.origin;
  } catch { throw fail('security_policy_unavailable'); }
}
function validate(settings: OfficialHistoryInfrastructureSettings) {
  origin(settings);
  if(!settings.databaseUrl||!settings.databaseCa.includes('-----BEGIN CERTIFICATE-----')||!settings.publishableKey||
    !settings.storageSecret||!settings.descriptorBucket||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/.test(settings.descriptorBucket)||
    !/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(settings.descriptorPath)||
    settings.descriptorPath.split('/').some(v=>v==='.'||v==='..')||!/[.]json$/.test(settings.descriptorPath)||
    !/^[0-9a-f]{64}$/.test(settings.descriptorSha256)||!Number.isSafeInteger(settings.descriptorBytes)||
    settings.descriptorBytes<1||settings.descriptorBytes>2_000_000)throw fail('security_policy_unavailable');
}
export async function loadPinnedDisplayDescriptor(settings: OfficialHistoryInfrastructureSettings, fetcher:typeof fetch=fetch): Promise<DisplayDescriptor> {
  validate(settings); const base=origin(settings), headers={apikey:settings.storageSecret};
  try {
    const bucketResponse=await fetcher(base+'/storage/v1/bucket/'+encodeURIComponent(settings.descriptorBucket),{headers,redirect:'error',signal:AbortSignal.timeout(5000)});
    if(!bucketResponse.ok)throw fail('official_history_scope_unverified');
    const bucket=parseStrictJson(new TextDecoder('utf-8',{fatal:true}).decode(await bytes(bucketResponse,32_768))) as Row;
    if(bucket.id!==settings.descriptorBucket||bucket.public!==false)throw fail('official_history_scope_unverified');
    const path=settings.descriptorPath.split('/').map(encodeURIComponent).join('/');
    const response=await fetcher(base+'/storage/v1/object/authenticated/'+encodeURIComponent(settings.descriptorBucket)+'/'+path,{headers,redirect:'error',signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw fail('official_history_scope_unverified');
    const body=await bytes(response,settings.descriptorBytes);
    if(body.length!==settings.descriptorBytes||await sha256(body)!==settings.descriptorSha256)throw fail('official_history_scope_unverified');
    const descriptor=parseStrictJson(new TextDecoder('utf-8',{fatal:true}).decode(body));
    if(descriptor===null||Array.isArray(descriptor)||typeof descriptor!=='object')throw fail('official_history_scope_unverified');
    return descriptor as DisplayDescriptor;
  } catch { throw fail('official_history_scope_unverified'); }
}
export function createOfficialHistoryInfrastructure(settings: OfficialHistoryInfrastructureSettings, options:{fetcher?:typeof fetch;sqlFactory?:(url:string,options:postgres.Options<{}>)=>postgres.Sql<{}>;environment?:'local_verification'|'isolated_cloud_review';now?:()=>number}={}): OfficialHistoryPorts {
  validate(settings); const fetcher=options.fetcher??fetch;
  // No built-in SUPABASE_DB_URL fallback: only the supplied app-role DSN.
  const sql=(options.sqlFactory??postgres)(settings.databaseUrl,{ssl:{rejectUnauthorized:true,ca:settings.databaseCa},prepare:false,max:1,
    connect_timeout:5,idle_timeout:5,max_lifetime:60,debug:false,fetch_types:false,backoff:()=>0.1,keep_alive:60,publications:'alltables',onnotice:()=>{},connection:{application_name:'jungsi-official-history-display'}});
  async function read<T>(work:(transaction:postgres.TransactionSql)=>Promise<T>,roleVerifiedInWork=false):Promise<{value:T}> {
    try {
      return await sql.begin('isolation level repeatable read read only', async transaction => {
        await transaction.unsafe("SET LOCAL TIME ZONE 'UTC'");
        await transaction.unsafe("SET LOCAL statement_timeout='5000ms'");
        if(!roleVerifiedInWork) {
          const role=await transaction.unsafe("SELECT current_user,r.rolsuper,r.rolbypassrls,current_setting('row_security') AS row_security,current_setting('transaction_read_only') AS read_only,pg_has_role(current_user,'jungsi_backend_owner','MEMBER') AS owner_member,pg_has_role(current_user,'jungsi_backend_owner','USAGE') AS owner_usage,pg_has_role(current_user,'postgres','MEMBER') AS postgres_member FROM pg_catalog.pg_roles r WHERE r.rolname=current_user");
          if(role.length!==1||role[0].current_user!=='jungsi_backend_app'||role[0].rolsuper!==false||role[0].rolbypassrls!==false||
            role[0].row_security!=='on'||role[0].read_only!=='on'||role[0].owner_member!==false||role[0].owner_usage!==false||role[0].postgres_member!==false)throw fail('official_history_runtime_role_unverified');
        }
        return {value:await work(transaction)};
      });
    } catch(e) { if(e instanceof DisplayError)throw e;throw fail('official_history_db_unavailable'); }
  }
  return {
    loadDescriptor:()=>loadPinnedDisplayDescriptor(settings,fetcher),
    async verifySession(token,now) {
      try {
        const response=await fetcher(origin(settings)+'/auth/v1/user',{headers:{apikey:settings.publishableKey,Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(5000)});
        if([400,401,403].includes(response.status))return null;
        if(!response.ok)throw fail('auth_unavailable');
        const user=parseStrictJson(new TextDecoder('utf-8',{fatal:true}).decode(await bytes(response,65_536))) as Row;
        const pieces=token.split('.');if(pieces.length!==3||typeof user.id!=='string')return null;
        // Decode sub/exp only after getUser validated this exact bearer token.
        const raw=atob(pieces[1].replace(/-/g,'+').replace(/_/g,'/'));
        const claims=parseStrictJson(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(raw,c=>c.charCodeAt(0)))) as Row;
        if(claims.sub!==user.id||typeof claims.exp!=='number'||!Number.isSafeInteger(claims.exp)||claims.exp*1000<=now)return null;
        if(claims.aal!==undefined&&claims.aal!==null&&claims.aal!=='aal1'&&claims.aal!=='aal2')return null;
        return {subjectId:user.id,expiresAt:claims.exp*1000};
      } catch(e) { if(e instanceof DisplayError)throw e;throw fail('auth_unavailable'); }
    },
    async paidUntil(subjectId,now) {
      return (await read(async tx=>{
        const rows=await tx.unsafe(JEONGSI_PASS_STATE_SQL,[subjectId,new Date(now).toISOString()]);
        if(rows.length!==1)throw fail('entitlement_unavailable');
        verifyPassState(rows[0]);
        const until=rows[0].expires_at;if(until===null)return null;
        if(typeof until!=='string'||utcInstantMicros(until)<=nowMicros(now))throw fail('entitlement_unavailable');
        return utcText(until);
      },true)).value;
    },
    async readRows(descriptor) {
      descriptor=validateDisplayScope(descriptor,options.environment??'isolated_cloud_review',(options.now??Date.now)());
      if((descriptor.read_strategy as Row|undefined)?.name!=='uncurated_pk_equivalent')throw fail('official_history_scope_unverified');
      return (await read(async tx=>{
        const role=await tx.unsafe("SELECT c.relowner=r.oid AS owner,has_table_privilege(current_user,c.oid,'SELECT') AS readable,has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS writable FROM pg_catalog.pg_class c JOIN pg_catalog.pg_roles r ON r.rolname=current_user WHERE c.oid=to_regclass($1)",[VIEW]);
        if(role.length!==1||role[0].owner!==false||role[0].readable!==true||role[0].writable!==false)throw fail('official_history_runtime_role_unverified');
        const expected=descriptor.bindings.map(b=>b.expected_db_row as Row);
        const strategy=descriptor.read_strategy as Row|undefined;
        if(strategy?.name==='uncurated_pk_equivalent') {
          const chain=strategy.active_view_chain as Row[],names=[...chain.map(v=>v.relation),'admission_results','curation_overlays','school_scope_overlays'];
          // With fetch_types:false, raw JS arrays have no text[] serializer. Bind JSON text
          // through OID25 first: a direct ::jsonb cast would serialize this string twice.
          const metadata=await tx.unsafe("WITH qualified AS (SELECT to_regclass(scoped.qualified_name) AS target_oid FROM unnest(ARRAY(SELECT value FROM jsonb_array_elements_text($1::text::jsonb) WITH ORDINALITY AS scoped_text(value,ordinality) ORDER BY ordinality)) AS scoped(qualified_name)) SELECT c.relname AS name,c.relkind AS kind,c.relrowsecurity AS rls,c.relforcerowsecurity AS force,to_jsonb(c.reloptions) AS options,c.relowner=r.oid AS owner,has_table_privilege(current_user,c.oid,'SELECT') AS readable,has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS writable,has_table_privilege('anon',c.oid,'SELECT') AS anon_read,has_table_privilege('authenticated',c.oid,'SELECT') AS authenticated_read,CASE WHEN c.relkind='v' THEN pg_get_viewdef(c.oid,true) ELSE NULL END AS definition FROM qualified q JOIN pg_catalog.pg_class c ON c.oid=q.target_oid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_roles r ON r.rolname=current_user WHERE n.nspname='jungsi_data_ingest' AND current_user='jungsi_backend_app' AND NOT r.rolsuper AND NOT r.rolbypassrls AND current_setting('row_security')='on' AND current_setting('transaction_read_only')='on' AND NOT pg_has_role(current_user,'jungsi_backend_owner','MEMBER') AND NOT pg_has_role(current_user,'jungsi_backend_owner','USAGE') AND NOT pg_has_role(current_user,'postgres','MEMBER')",[JSON.stringify(names.map(name=>'jungsi_data_ingest.'+name))]);
          if(metadata.length!==names.length)throw fail('official_history_runtime_role_unverified');
          for(const m of metadata) {
            if(m.owner!==false||m.readable!==true||m.writable!==false||m.anon_read!==false||m.authenticated_read!==false)throw fail('official_history_runtime_role_unverified');
            const view=chain.find(v=>v.relation===m.name);
            if(view) { if(m.kind!=='v'||!sameJson(m.options,view.reloptions)||typeof m.definition!=='string'||await sha256(new TextEncoder().encode(m.definition))!==view.view_definition_sha256)throw fail('official_history_scope_unverified'); }
            else if(m.kind!=='r'||m.rls!==true||m.force!==true)throw fail('official_history_runtime_role_unverified');
          }
          const projection=DB_FIELDS.map(k=>k.startsWith('curation_')?(k==='curation_release_id'?'NULL::text AS '+k:'NULL::jsonb AS '+k):'a.'+k+(k==='academic_year'?'::integer AS academic_year':k==='metric_value_numeric'?'::text AS metric_value_numeric':'')).join(',');
          const rows=await tx.unsafe('WITH selected AS (SELECT release_id,result_id FROM unnest(ARRAY(SELECT value FROM jsonb_array_elements_text($1::text::jsonb) WITH ORDINALITY AS scoped_text(value,ordinality) ORDER BY ordinality),ARRAY(SELECT value FROM jsonb_array_elements_text($2::text::jsonb) WITH ORDINALITY AS scoped_text(value,ordinality) ORDER BY ordinality)) AS scoped(release_id,result_id)) SELECT '+projection+',c.release_id AS guard_active_curation_release_id,p.source_school_id AS guard_school_source_school_id,p.after_row_fingerprint AS guard_school_after_row_fingerprint FROM selected s JOIN jungsi_data_ingest.admission_results a ON a.release_id=s.release_id AND a.result_id=s.result_id LEFT JOIN jungsi_data_ingest.curation_overlays c ON c.base_release_id=a.release_id AND c.result_id=a.result_id AND c.release_id=ANY(ARRAY(SELECT value FROM jsonb_array_elements_text($3::text::jsonb) WITH ORDINALITY AS scoped_text(value,ordinality) ORDER BY ordinality)) LEFT JOIN jungsi_data_ingest.school_scope_overlays p ON p.release_id=a.release_id AND p.result_id=a.result_id ORDER BY a.result_id LIMIT $4',
            [JSON.stringify(expected.map(r=>r.release_id)),JSON.stringify(expected.map(r=>r.result_id)),JSON.stringify(strategy.active_curation_release_ids),expected.length+1]);
          return rows.map(r=>({...r})) as Row[];
        }
        const projection=DB_FIELDS.map(k=>'v.'+k+(k==='metric_value_numeric'?'::text AS metric_value_numeric':'')).join(',');
        const rows=await tx.unsafe('SELECT '+projection+' FROM '+VIEW+' v JOIN unnest(ARRAY(SELECT value FROM jsonb_array_elements_text($1::text::jsonb) WITH ORDINALITY AS scoped_text(value,ordinality) ORDER BY ordinality),ARRAY(SELECT value FROM jsonb_array_elements_text($2::text::jsonb) WITH ORDINALITY AS scoped_text(value,ordinality) ORDER BY ordinality)) AS selected(release_id,result_id) ON v.release_id=selected.release_id AND v.result_id=selected.result_id LIMIT $3', [JSON.stringify(expected.map(r=>r.release_id)),JSON.stringify(expected.map(r=>r.result_id)),expected.length+1]);
        return rows.map(r=>({...r})) as Row[];
      })).value;
    },
  };
}
