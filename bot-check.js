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
  let token='',confirmed=false,widget,client;
  try{client=await loadTurnstile();}catch{return {error:'verification'};}
  try{
    await showFormModal({title:esc(t('securityCheck')),bodyHtml:`<p>${esc(t('securityCheckHint'))}</p><div id="authChallenge"></div>`,okLabel:t('securityContinue'),
      onOpen:(box,{submit})=>{
        const ok=box.querySelector('#modalFormOk');ok.hidden=true;ok.disabled=true;
        const reset=()=>{token='';ok.disabled=true;};
        try{widget=client.render(box.querySelector('#authChallenge'),{sitekey:r.data.siteKey,action:'ricotta_auth',theme:document.documentElement.classList.contains('dark')?'dark':'light',size:'compact',
          callback:value=>{if(!box.isConnected || confirmed || !value)return;token=value;ok.disabled=false;submit();},'expired-callback':reset,'error-callback':()=>{reset();box.querySelector('#modalFormStatus').textContent=t('securityCheckFailed');}});
        }catch{box.querySelector('#modalFormStatus').textContent=t('securityCheckFailed');}
      },
      onSubmit:async()=>{if(!token)return {error:t('securityCheckFailed')};confirmed=true;return {};},
    });
  }catch{return {error:'verification'};}
  finally{if(widget!==undefined){try{client.remove(widget);}catch(_){}}}
  return confirmed?{token}:{error:'cancelled'};
}
