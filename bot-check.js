/* Loaded locally; Cloudflare's script is requested only when protection is configured. */
let turnstileLoader,authConfigRequest,authConfigAt=0;
function resetAuthSecurityConfig(){authConfigRequest=null;authConfigAt=0;}
function authSecurityConfig(){
  if(!authConfigRequest || Date.now()-authConfigAt>60000){
    authConfigAt=Date.now();authConfigRequest=api('auth/security').then(r=>{if(!r.ok)resetAuthSecurityConfig();return r;});
  }
  return authConfigRequest;
}
document.addEventListener('DOMContentLoaded',()=>{if(!apiSession())authSecurityConfig();},{once:true});
function loadTurnstile(){
  if(window.turnstile)return Promise.resolve(window.turnstile);
  if(!turnstileLoader)turnstileLoader=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    const timer=setTimeout(()=>{script.remove();turnstileLoader=null;reject(new Error('timeout'));},10000);
    script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.onload=()=>{clearTimeout(timer);if(window.turnstile)resolve(window.turnstile);else{turnstileLoader=null;reject(new Error('unavailable'));}};
    script.onerror=()=>{clearTimeout(timer);script.remove();turnstileLoader=null;reject(new Error('unavailable'));};
    document.head.appendChild(script);
  });
  return turnstileLoader;
}
async function authBotProof(){
  const r=await authSecurityConfig();
  if(!r.ok || typeof r.data?.required!=='boolean')return {error:'network'};
  if(!r.data.required)return {token:null};
  if(!r.data.siteKey)return {error:'verification'};
  let client,widget;
  try{client=await loadTurnstile();}catch{return {error:'verification'};}
  const dialog=showChallenge(t('securityCheck'),t('securityCheckHint'));
  const box=dialog.box,status=box.querySelector('.modal-status'),again=box.querySelector('.modal-actions');
  const failed=()=>{status.textContent=t('securityCheckFailed');again.hidden=false;dialog.focus(box.querySelector('#challengeRetry'));};
  const start=()=>{
    status.textContent='';again.hidden=true;
    try{if(widget!==undefined)client.remove(widget);}catch(_){}
    try{widget=client.render(box.querySelector('#authChallenge'),{sitekey:r.data.siteKey,action:'ricotta_auth',theme:document.documentElement.classList.contains('dark')?'dark':'light',size:'compact',
      callback:value=>{if(value && box.isConnected)dialog.finish(value);},'expired-callback':failed,'timeout-callback':failed,'error-callback':failed});
    }catch(_){failed();}
  };
  box.querySelector('#challengeRetry').onclick=start;
  start();
  let token=null;
  try{token=await dialog.promise;}
  finally{if(widget!==undefined){try{client.remove(widget);}catch(_){}}}
  return token?{token}:{error:'cancelled'};
}
