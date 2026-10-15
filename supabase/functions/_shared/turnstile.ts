// Optional bot protection. Partial configuration fails closed; no secret reaches the browser.
export function turnstileConfig(env: (key:string)=>string|undefined, origin:string) {
  const secret=env('TURNSTILE_SECRET_KEY')||'',siteKey=env('TURNSTILE_SITE_KEY')||'';
  const hostname=(env('TURNSTILE_HOSTNAME')||new URL(origin).hostname).toLowerCase();
  return {required:!!(secret||siteKey),ready:!!(secret&&siteKey&&hostname),secret,siteKey,hostname};
}
export async function verifyTurnstile(config:ReturnType<typeof turnstileConfig>, token:unknown, fetcher:typeof fetch=fetch):Promise<boolean> {
  if(!config.required)return true;
  if(!config.ready || typeof token!=='string' || !token || token.length>2048)return false;
  try{
    const r=await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify',{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),headers:{'Content-Type':'application/json'},
      body:JSON.stringify({secret:config.secret,response:token}),
    });
    if(!r.ok)return false;
    const result=await r.json();
    return result.success===true && result.hostname===config.hostname && result.action==='ricotta_auth';
  }catch{return false;}
}
