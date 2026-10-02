const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../update-check.js'),'utf8');
function fixture(){
  let reloads=0,cartSaves=0,modal=false;
  const context=vm.createContext({APP_VERSION:'old',state:{cart:{},queue:null,pinBuffer:'',pinBusy:false},
    rcState:{supplierId:'',invoice:'',rate:'',deliveryAmt:'',lines:[]},trState:{itemId:'',qty:'',search:''},
    expensePending:false,financeHasPending:()=>context.expensePending,
    document:{activeElement:null,querySelector:()=>modal?{}:null,addEventListener(){}},
    location:{pathname:'/Ricotta/',reload(){reloads++}},persistCartDraft(){cartSaves++},
    t:key=>key,showConfirm:async()=>false,console,setInterval(){},setTimeout(){},
    fetch:async()=>({ok:true,text:async()=>"const APP_VERSION = 'new'"})});
  vm.runInContext(source,context);
  return {context,get reloads(){return reloads},get cartSaves(){return cartSaves},setModal:()=>{modal=true}};
}
test('automatic update respects unfocused receipt and transfer drafts',()=>{
  const f=fixture(); assert.equal(f.context.cartIsEmpty(),true);
  f.context.rcState.invoice='draft'; assert.equal(f.context.cartIsEmpty(),false);
  f.context.rcState.invoice=''; f.context.trState.itemId='item'; assert.equal(f.context.cartIsEmpty(),false);
  f.context.trState.itemId=''; f.context.expensePending=true; assert.equal(f.context.cartIsEmpty(),false,'unconfirmed financial operations count as unfinished work');
});
for(const newWork of ['receipt','transfer','cart','modal','expense']){
  test(`automatic reload cancels when ${newWork} starts during asset refresh`,async()=>{
    const f=fixture(); let complete;
    const gate=new Promise(resolve=>{complete=()=>resolve({ok:true})});
    f.context.fetch=()=>gate;
    const pending=f.context.hardReload({onlyIfIdle:true});
    if(newWork==='receipt')f.context.rcState.invoice='new invoice';
    else if(newWork==='transfer')f.context.trState.qty='3';
    else if(newWork==='cart')f.context.state.cart.item=2;
    else if(newWork==='expense')f.context.expensePending=true;
    else f.setModal();
    // Resolve every fetch with a shared gate so no request remains pending.
    complete();
    assert.equal(await pending,false); assert.equal(f.reloads,0);
  });
}
test('idle automatic and explicitly requested reloads still work',async()=>{
  const f=fixture(); assert.equal(await f.context.hardReload({onlyIfIdle:true}),true);
  f.context.rcState.invoice='draft'; assert.equal(await f.context.hardReload(),true);
  assert.equal(f.reloads,2); assert.equal(f.cartSaves,2);
});
