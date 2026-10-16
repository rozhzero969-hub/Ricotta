import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {turnstileConfig,verifyTurnstile} from '../supabase/functions/_shared/turnstile.ts';
const origin='https://rozhzero969-hub.github.io';
assert.equal(await verifyTurnstile(turnstileConfig(()=>'',origin),null,()=>{throw Error('unnecessary network');}),true);
const partial=turnstileConfig(k=>k==='TURNSTILE_SITE_KEY'?'public-key':'',origin);
assert.equal(await verifyTurnstile(partial,'token'),false,'partial configuration fails closed');
const config=turnstileConfig(k=>({TURNSTILE_SITE_KEY:'public-key',TURNSTILE_SECRET_KEY:'private-key'})[k],origin);
const reply=body=>async()=>new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
assert.equal(await verifyTurnstile(config,'token',reply({success:true,hostname:'rozhzero969-hub.github.io',action:'ricotta_auth'})),true);
assert.equal(await verifyTurnstile(config,'token',reply({success:true,hostname:'another-site.com',action:'ricotta_auth'})),false);
assert.equal(await verifyTurnstile(config,'token',reply({success:true,hostname:'rozhzero969-hub.github.io',action:'another_action'})),false);
assert.equal(await verifyTurnstile(config,'token',reply({success:false,'error-codes':['timeout-or-duplicate']})),false);
assert.equal(await verifyTurnstile(config,'token',async()=>{throw Error('offline');}),false);
assert.equal(await verifyTurnstile(config,'x'.repeat(2049),()=>{throw Error('oversized token must not call out');}),false);
const db=new PGlite({extensions:{pgcrypto}});
try{
 await db.exec('create role anon;create role authenticated;create role service_role;');
 await db.exec(fs.readFileSync('supabase/baseline.sql','utf8'));
 for(const file of fs.readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort())await db.exec(fs.readFileSync('supabase/migrations/'+file,'utf8'));
 const {rows}=await db.query("select to_regclass('public.app_passkeys') as keys,to_regclass('public.app_passkey_challenges') as challenges");
 assert.equal(rows[0].keys,null);assert.equal(rows[0].challenges,null);
 const columns=await db.query("select column_name from information_schema.columns where table_name='app_accounts' and column_name in ('tabs','theme','auto_theme')");
 assert.equal(columns.rows.length,0,'retired navigation and theme settings removed');
}finally{await db.close();}
console.log('Auth hardening PASS: Turnstile hostname/action/replay/error checks, optional configuration and retired passkeys/settings removed');
