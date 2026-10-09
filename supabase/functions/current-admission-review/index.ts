/** Explicit isolated reviewer connector; never a default application or publication transition. */
import { createCurrentAdmissionReviewHandler } from '../_shared/current_admission_review.ts';
import { createCurrentReviewInfrastructure } from '../_shared/current_admission_review_postgres.ts';

const value=(name:string)=>Deno.env.get(name)??'';
try {
  const secret=value('JUNGSI_CURRENT_REVIEW_CURSOR_KEY_HEX');
  if(!/^[0-9a-fA-F]{64}$/.test(secret))throw new Error('private current key unavailable');
  const cursorKey=Uint8Array.from(secret.match(/../g)!,part=>Number.parseInt(part,16));
  const ports=createCurrentReviewInfrastructure({
    databaseUrl:value('JUNGSI_DISPLAY_DATABASE_URL'),databaseCa:value('JUNGSI_DISPLAY_DATABASE_CA'),
    supabaseUrl:value('SUPABASE_URL'),publishableKey:value('JUNGSI_DISPLAY_PUBLISHABLE_KEY'),
    storageSecret:value('JUNGSI_DISPLAY_STORAGE_SECRET'),descriptorBucket:value('JUNGSI_DISPLAY_DESCRIPTOR_BUCKET'),
    descriptorPath:value('JUNGSI_CURRENT_REVIEW_DESCRIPTOR_PATH'),descriptorSha256:value('JUNGSI_CURRENT_REVIEW_DESCRIPTOR_SHA256'),
    descriptorBytes:Number(value('JUNGSI_CURRENT_REVIEW_DESCRIPTOR_BYTES')),
  });
  Deno.serve(createCurrentAdmissionReviewHandler(ports,{relayToken:value('JUNGSI_RELAY_TOKEN'),cursorKey,
    environment:'isolated_cloud_review',pathPrefix:'/functions/v1/current-admission-review'}));
} catch {
  Deno.serve(()=>new Response(JSON.stringify({status:'error',error:{code:'security_policy_unavailable'},request_id:crypto.randomUUID().replace(/-/g,'')}),
    {status:503,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}}));
}
