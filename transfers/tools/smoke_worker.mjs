// Read-only queue smoke check; never clicks the workplace page.
import { readFileSync } from 'node:fs';
const env=readFileSync(new URL('../worker/.env',import.meta.url),'utf8');
const token=env.match(/^WORKER_TOKEN=(.+)$/m)?.[1];
if(!token)throw new Error('Missing worker token');
const base='https://pxufdcyqjtmtklmrjodg.supabase.co/functions/v1/transfer-api';
const res=await fetch(base+'/worker/preview',{headers:{'x-worker-token':token}});
const body=await res.json();
if(!res.ok)throw new Error(`Queue check failed (${res.status}): ${body.error}`);
console.log('Authenticated queue preview succeeded; waiting request:',body.request?.id||'none');
