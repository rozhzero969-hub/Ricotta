/* Regression checks for account changes and order-save recovery. No network. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const commands = source.slice(source.indexOf('async function runCommand('), source.indexOf('async function refreshDevices('));
const queueCode = source.slice(source.indexOf('let finishingQueue ='), source.indexOf('/* ============ History ============'));
const logoutCode = source.slice(source.indexOf('function signOut('), source.indexOf('async function doLogout('));
const draftCode = source.slice(source.indexOf('function persistCartDraft('), source.indexOf('function restoreCartDraft('));
function fixture(overrides = {}) {
  const sandbox = {
    state: {account:'rozha', view:'queue', suppliers:[], history:[], cart:{i1:2}, queue:[{supplierId:'s1', sent:true, items:[{itemId:'i1', name:'Item', qty:2, unit:'box'}]}]},
    session: {token:'old', account:'rozha'}, ricoSuggestion:{at:1}, forcedRefreshOpen:false,
    writes:[], notices:[], chimes:0, logouts:0, reloads:0, renders:0,
    outboxJobId:()=> 'stable-id', t:key=>key, lset:()=>true, persistQueue:()=>sandbox.persists++, persists:0, console:{error:()=>{}},
    render:()=>sandbox.renders++, persistCartDraft:()=>{}, playOrdersSent:()=>sandbox.chimes++,
    toast:(message)=>sandbox.notices.push(message), goView:view=>{sandbox.state.view=view;},
    apiSession:()=>sandbox.session, apiSessionMatches:s=>s?.token===sandbox.session?.token,
    signOut:()=>{sandbox.logouts++;sandbox.session=null;}, hardReload:async()=>sandbox.reloads++,
    matchMedia:()=>({matches:true}), setTimeout:callback=>{callback();return 0;},
    api:async()=>({ok:true}), showForcedRefresh:async()=>true,
    sendOrQueue:async(_path,_method,record)=>{sandbox.writes.push(record);return 'saved';},
    ...overrides,
  };
  vm.createContext(sandbox);
  vm.runInContext(commands + queueCode, sandbox);
  return sandbox;
}
const json = value=>JSON.parse(JSON.stringify(value));
(async()=>{
  const recovery = fixture();
  let attempt = 0;
  recovery.sendOrQueue = async(_path,_method,record)=>{recovery.writes.push(record);return ++attempt===1?'failed':'saved';};
  const originalQueue = recovery.state.queue;
  await vm.runInContext('maybeFinishQueue()', recovery);
  assert.deepEqual(json(recovery.state.cart),{i1:2},'failed saves preserve the draft');
  assert.equal(recovery.state.queue,originalQueue,'failed saves preserve the sent queue');
  assert.equal(recovery.state.queue.saveState,'failed');
  assert.equal(recovery.state.history.length,0,'failed saves do not claim History was saved');
  await vm.runInContext('maybeFinishQueue()', recovery);
  assert.equal(recovery.writes[0],recovery.writes[1],'retry saves the same record and id');
  assert.equal(recovery.chimes,1,'retry does not repeat supplier-send feedback');
  assert.equal(recovery.state.history.length,1);
  assert.equal(recovery.state.queue,null);
  assert.deepEqual(json(recovery.state.cart),{});

  // A sound that throws (an iPhone audio quirk) never stops the order from saving.
  const noSound = fixture({playOrdersSent:()=>{ throw new Error('audio unavailable'); }});
  await vm.runInContext('maybeFinishQueue()', noSound);
  assert.equal(noSound.writes.length,1,'the order is saved even when the chime fails');
  assert.equal(noSound.state.queue,null);
  assert.ok(noSound.persists>0,'the queue state is kept on the phone while saving');

  // An unexpected error while saving shows Retry instead of leaving the order stuck on "saving".
  const broken = fixture({sendOrQueue:async()=>{ throw new Error('boom'); }});
  const brokenQueue = broken.state.queue;
  await vm.runInContext('maybeFinishQueue()', broken);
  assert.equal(broken.state.queue,brokenQueue);
  assert.equal(brokenQueue.saveState,'failed','a broken save offers Retry');
  assert.equal(vm.runInContext('finishingQueue', broken),null,'a broken save never blocks the next try');
  broken.sendOrQueue = async(_path,_method,record)=>{broken.writes.push(record);return 'saved';};
  await vm.runInContext('maybeFinishQueue()', broken);
  assert.equal(broken.writes.length,1,'Retry saves the order');
  assert.equal(broken.state.queue,null);

  let finishSave;
  const staleSave = fixture({sendOrQueue:()=>new Promise(resolve=>{finishSave=resolve;})});
  const saving = vm.runInContext('maybeFinishQueue()',staleSave);
  const nextQueue = [{sent:false,items:[]}];
  staleSave.session={token:'new',account:'yunis'};
  staleSave.state.queue=nextQueue; staleSave.state.cart={i2:3};
  finishSave('saved'); await saving;
  assert.equal(staleSave.state.queue,nextQueue,'old save completion cannot erase a newer queue');
  assert.deepEqual(json(staleSave.state.cart),{i2:3});
  assert.equal(staleSave.state.history.length,0);

  let finishAck;
  const logout = fixture({api:()=>new Promise(resolve=>{finishAck=resolve;})});
  const loggingOut = vm.runInContext("runCommand({id:'command',type:'logout'})",logout);
  logout.session={token:'new',account:'yunis'}; finishAck({ok:false,stale:true}); await loggingOut;
  assert.equal(logout.logouts,0,'old logout acknowledgement cannot end a new session');

  let finishPrompt;
  const refresh = fixture({showForcedRefresh:()=>new Promise(resolve=>{finishPrompt=resolve;})});
  const refreshing = vm.runInContext("runCommand({id:'command',type:'refresh'})",refresh);
  refresh.session=null; finishPrompt(undefined); await refreshing;
  assert.equal(refresh.reloads,0,'a dismissed refresh after logout cannot reload');

  const crossTab = fixture();
  Object.assign(crossTab, {
    LS_PREFIX:'ricottaOrders:', DEFAULT_TABS:['order','assistant','history'],
    rowPress:null, toastTimer:null, reminderDraft:{time:'09:00'},
    drafts:{}, listeners:{}, modalResets:0, streamResets:0, sessionClears:0,
    document:{getElementById:()=>null}, clearTimeout:()=>{},
    ricoReset:()=>crossTab.streamResets++,
    stopStepHold:()=>{}, dismissAllModals:()=>crossTab.modalResets++,
    closeSelSheet:()=>{}, closeContextMenu:()=>{}, closeLangMenu:()=>{},
    window:{addEventListener:(name,handler)=>{crossTab.listeners[name]=handler;}},
    lset:(key,value)=>{crossTab.drafts[key]=json(value);return true;},
    clearApiSession:()=>{crossTab.sessionClears++;crossTab.session=null;},
  });
  crossTab.state.items=[{id:'private'}]; crossTab.state.history=[{id:'private-order'}];
  vm.runInContext(draftCode + logoutCode, crossTab);
  const originalSession = crossTab.session;
  crossTab.listeners.storage({key:'ricottaOrders:lang',oldValue:'en',newValue:'ar'});
  assert.equal(crossTab.state.account,'rozha','unrelated storage keys leave the account mounted');
  crossTab.listeners.storage({key:'ricottaOrders:apiSession',oldValue:JSON.stringify(originalSession),newValue:JSON.stringify({...originalSession,name:'Updated name'})});
  assert.equal(crossTab.state.account,'rozha','same-token metadata changes leave the account mounted');
  const nextSession = {token:'new',account:'yunis'};
  crossTab.session=nextSession;
  crossTab.listeners.storage({key:'ricottaOrders:apiSession',oldValue:JSON.stringify(originalSession),newValue:JSON.stringify(nextSession)});
  assert.equal(crossTab.session,nextSession,'the other tab’s new session remains stored');
  assert.equal(crossTab.sessionClears,0,'a local cross-tab reset never removes the shared token');
  assert.equal(crossTab.apiSessionMatches(originalSession),false,'old requests remain stale after a cross-tab account change');
  assert.deepEqual(crossTab.drafts['pendingCart:rozha'],{i1:2},'the departing account’s draft is preserved under its own key');
  assert.equal(crossTab.state.account,null);
  assert.deepEqual(json(crossTab.state.items),[]);
  assert.deepEqual(json(crossTab.state.history),[]);
  assert.deepEqual(json(crossTab.state.cart),{});
  assert.equal(crossTab.state.queue,null);
  assert.equal(crossTab.state.pinError,'session');
  assert.equal(crossTab.modalResets,1); assert.equal(crossTab.streamResets,1);
  crossTab.state.account='yunis'; crossTab.state.cart={i2:3}; crossTab.session=null;
  crossTab.listeners.storage({key:'ricottaOrders:apiSession',oldValue:JSON.stringify(nextSession),newValue:null});
  assert.equal(crossTab.state.account,null,'logout in another tab clears this workspace');
  assert.deepEqual(crossTab.drafts['pendingCart:yunis'],{i2:3});

  // WhatsApp links: Iraqi numbers in every usual form, and numbers that are already international.
  const wa = vm.createContext({});
  vm.runInContext(source.slice(source.indexOf('function waLink('), source.indexOf('const ICON_CHAT')), wa);
  for(const [phone, number] of [['0750 123 4567','9647501234567'],['750 123 4567','9647501234567'],['+964 750 123 4567','9647501234567'],['00964 750 123 4567','9647501234567'],['+90 555 123 4567','905551234567']]){
    assert.equal(vm.runInContext(`waLink(${JSON.stringify(phone)}, 'Hi')`, wa), `https://wa.me/${number}?text=Hi`, phone);
  }

  // Tapping a notification opens the screen it is about.
  const pushSource = fs.readFileSync(path.join(__dirname, '..', 'push.js'), 'utf8');
  const intentCode = pushSource.slice(pushSource.indexOf('function handlePushIntent('), pushSource.indexOf("if('serviceWorker' in navigator)"));
  const tapped = (kind, view, account = 'yunis')=>{
    const opened = [];
    const c = vm.createContext({state:{account, view:'order', suppliers:[]}, goView:v=>opened.push(v), openNotesSheet:()=>opened.push('notes'),
      refreshData:()=>{}, ricoRefreshInbox:()=>{}, canOpen:()=>true, render:()=>{}, openUpdatePopup:()=>opened.push('update')});
    vm.runInContext(intentCode, c);
    vm.runInContext(`handlePushIntent(${JSON.stringify(kind)}, '', '', ${JSON.stringify(view)})`, c);
    return opened;
  };
  assert.deepEqual(tapped('assistant','history'),['history'],"Rico's end-of-month message opens History");
  assert.deepEqual(tapped('assistant','notes'),['notes'],"Rico's reminder about an unread note opens the notes");
  assert.deepEqual(tapped('assistant',''),['assistant']);
  assert.deepEqual(tapped('note',''),['notes']);
  assert.deepEqual(tapped('update','',null),['update'],'an update message opens even when signed out');
  assert.deepEqual(tapped('assistant','history',null),[],'nothing else opens while signed out');
  console.log(JSON.stringify({result:'PASS',checks:'recoverable failed order save, stable retry, a failing chime or save never sticks, stale completion and commands, cross-tab reset preserving session and account draft, WhatsApp numbers, notification taps'}));
})().catch(error=>{console.error(error);process.exitCode=1;});
