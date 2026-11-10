/* Number boxes on the Receipts and Transfers forms keep what was typed while the form is redrawn.
   A redraw (a new line appearing, Rico's status, the line's question, coming back online) rebuilds each
   box; built from the number alone, "12." came back as "12" and the dot vanished.
   Run: node scripts/number-box-smoke.cjs */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync('receipts.js','utf8');
const code=src.slice(src.indexOf('function rrOnlyNum('),src.indexOf('const RR_MOD'));
const queue=[],flush=()=>queue.splice(0).forEach(f=>f());
const ctx={document:{activeElement:null},setTimeout:f=>queue.push(f)};
vm.createContext(ctx);vm.runInContext(code,ctx);
const {rrOnlyNum,rrBoxText,rrKeepTyped,rrTidyTyped}=ctx;
// A box the person types into: value, cursor, and whether it is still on the page.
const box=value=>({value,selectionStart:value.length,isConnected:true,setSelectionRange(){}});
const type=(line,key,text,commas)=>{const el=box(text);line[key]=rrOnlyNum(el,true,commas);rrKeepTyped(line,key,el);return el;};

// Qty: the dot stays through a redraw, and so do the decimals being typed.
const l={item:'Tomato',qty:null,cost:null};
for(const [typed,shown] of [['12','12'],['12.','12.'],['12.5','12.5'],['12.50','12.50'],['0.','0.'],['0.0','0.0'],['12.5','12.5']]){
  type(l,'qty',typed,false);
  assert.equal(rrBoxText(l,'qty'),shown,'qty box after typing '+typed);
}
assert.equal(l.qty,12.5,'the number kept is the one typed');
// Unit cost (with commas): the same.
for(const [typed,shown] of [['1250','1,250'],['1250.','1,250.'],['1,250.5','1,250.5']]){
  const el=type(l,'cost',typed,true);
  assert.equal(el.value,shown,'cost box shows commas while typing '+typed);
  assert.equal(rrBoxText(l,'cost',true),shown,'cost box after a redraw, typed '+typed);
}
assert.equal(l.cost,1250.5);
// Arabic and Kurdish digits and the Arabic decimal sign still read as a number with its dot.
type(l,'qty','٣٫',false);
assert.equal(l.qty,3);assert.equal(rrBoxText(l,'qty'),'3.');
// Something else changed the number (Rico read a photo, another device): the new number shows.
type(l,'cost','90.',true);l.cost=300;
assert.equal(rrBoxText(l,'cost',true),'300');
// A box that can't be read keeps its text (in red), never "NaN".
type(l,'qty','.',false);
assert.ok(Number.isNaN(l.qty));assert.equal(rrBoxText(l,'qty'),'.');
rrTidyTyped(l,'qty',box('.'));flush();assert.equal(rrBoxText(l,'qty'),'.','a box that cannot be read stays as typed after leaving it');
assert.equal(rrBoxText({qty:Number.NaN},'qty'),'','no text kept: an empty box, not NaN');
// Leaving the box tidies it; a box taken away by a redraw has not been left.
const el=type(l,'qty','7.',false);
el.isConnected=false;rrTidyTyped(l,'qty',el);flush();
assert.equal(rrBoxText(l,'qty'),'7.','a redraw is not leaving the box');
// The redraw's blur arrives while the old box is still attached, and the box is gone a moment later.
el.isConnected=true;rrTidyTyped(l,'qty',el);el.isConnected=false;flush();
assert.equal(rrBoxText(l,'qty'),'7.','a box removed right after its blur has not been left');
ctx.document.activeElement=el;el.isConnected=true;rrTidyTyped(l,'qty',el);flush();
assert.equal(rrBoxText(l,'qty'),'7.','a box that has the focus again has not been left');
ctx.document.activeElement=null;rrTidyTyped(l,'qty',el);flush();
assert.equal(rrBoxText(l,'qty'),'7','leaving the box drops a dot left at the end');
type(l,'qty','2.100',false);rrTidyTyped(l,'qty',box('2.100'));flush();
assert.equal(rrBoxText(l,'qty'),'2.100','leaving the box keeps 2.100 as typed');
type(l,'qty','.010',false);rrTidyTyped(l,'qty',box('.010'));flush();
assert.equal(rrBoxText(l,'qty'),'.010','leaving the box keeps .010 as typed');
// Empty and new boxes.
assert.equal(rrBoxText({qty:null},'qty'),'');
assert.equal(rrBoxText({cost:38578.5},'cost',true),'38,578.5');
type(l,'qty','',false);assert.equal(l.qty,null);assert.equal(rrBoxText(l,'qty'),'');
// The text is never sent: drafts are saved with the numbers only.
assert.match(src,/lines:r\.lines\.filter\(l=>l\.item\)\.map\(l=>\(\{item:l\.item, unit:l\.unit, qty:[^}]*cost:[^}]*\}\)\)/,'receipt drafts send numbers only');
// Every number box on both forms is drawn from what was typed.
const tf=fs.readFileSync('transfers.js','utf8');
for(const [file,text,needles] of [['receipts.js',src,["rrBoxText(l, 'qty')","rrBoxText(l, 'cost', true)","rrBoxText(r, 'rate')","rrBoxText(r, 'delivery', true)"]],['transfers.js',tf,["rrBoxText(l, 'qty', true)"]]])
  for(const n of needles) assert.ok(text.includes(n),file+' draws its box with '+n);
console.log('number boxes ok');
