/** Isolated display composition only. No default application transition. */
import {createOfficialHistoryDisplayHandler} from '../_shared/official_history_display.ts';
import {createOfficialHistoryInfrastructure} from '../_shared/official_history_postgres.ts';

const value=(name:string)=>Deno.env.get(name)??'';
try {
  const ports=createOfficialHistoryInfrastructure({
    databaseUrl:value('JUNGSI_DISPLAY_DATABASE_URL'),databaseCa:value('JUNGSI_DISPLAY_DATABASE_CA'),
    supabaseUrl:value('SUPABASE_URL'),publishableKey:value('JUNGSI_DISPLAY_PUBLISHABLE_KEY'),
    storageSecret:value('JUNGSI_DISPLAY_STORAGE_SECRET'),descriptorBucket:value('JUNGSI_DISPLAY_DESCRIPTOR_BUCKET'),
    descriptorPath:value('JUNGSI_DISPLAY_DESCRIPTOR_PATH'),descriptorSha256:value('JUNGSI_DISPLAY_DESCRIPTOR_SHA256'),
    descriptorBytes:Number(value('JUNGSI_DISPLAY_DESCRIPTOR_BYTES')),
  });
  Deno.serve(createOfficialHistoryDisplayHandler(ports,{relayToken:value('JUNGSI_RELAY_TOKEN'),
    environment:'isolated_cloud_review',pathPrefix:value('JUNGSI_DISPLAY_PATH_PREFIX')}));
} catch {
  Deno.serve(()=>new Response(JSON.stringify({status:'error',error:{code:'security_policy_unavailable'},request_id:crypto.randomUUID().replace(/-/g,'')}),
    {status:503,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}}));
}
