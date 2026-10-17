/* Transfers (transfers.js): reading a list, finding the workplace items, the rows, the workplace item
   list upload and the styled Excel file, read back with the spreadsheet library and checked byte by byte. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),zlib=require('node:zlib');

const app=fs.readFileSync('app.js','utf8');
const fold=app.match(/const FOLD_TEXT = [\s\S]*?\nfunction foldText[^\n]*\n/)[0];
const stored=new Map();
const state={lang:'en',account:'rozha',view:'transfers',units:[{id:'kg',en:'kg',ku:'کیلۆ'}]};
const ctx={T:{en:{},ku:{},ar:{}},state,console,TextEncoder,TextDecoder,Intl,
 lget:k=>stored.get(k)??null,lset:(k,v)=>{stored.set(k,v);return true;},esc:v=>String(v),
 formatIraqDateTime:(value,options={})=>new Intl.DateTimeFormat('en-US-u-nu-latn',{timeZone:'Asia/Baghdad',hour12:true,...options}).format(new Date(value)),
 t:k=>ctx.T[state.lang][k]??k};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('supabase/functions/_shared/search.js','utf8')+'\n'+fold,ctx);
const source=fs.readFileSync('transfers.js','utf8');
vm.runInContext(source,ctx);
const run=code=>vm.runInContext(code,ctx), plain=v=>JSON.parse(JSON.stringify(v));

// Every language has every text, and the texts write numbers 1 2 3.
for(const lang of ['ku','ar']) assert.deepEqual(Object.keys(ctx.T[lang]).sort(),Object.keys(ctx.T.en).sort(),lang+' has every Transfers text');
assert.ok(!/[٠-٩۰-۹]/.test(source.slice(source.indexOf('const TRANSFER_TEXT'),source.indexOf('for (const lang'))),'texts write numbers 1 2 3 (the reader itself understands Arabic digits)');

// Units: کیلۆ, kg and كيلو are one unit; an item with one unit uses it when none was written.
const S=ctx.RicottaSearch;
assert.equal(S.unit(['کیلۆ','سندوق'],'kg'),'کیلۆ');
assert.equal(S.unit(['کیلۆ','سندوق'],'صندوق'),'سندوق');
assert.equal(S.unit(['کیلۆ'],''),'کیلۆ');
assert.equal(S.unit(['کیلۆ','دانە'],''),null,'two units and none written: the person picks');
assert.equal(S.unit(['کیلۆ'],'carton'),null,'a unit the item does not have is not accepted');
assert.ok(S.isUnit('kilos') && S.isUnit('فەردە') && !S.isUnit('tomatoes'));

// The workplace item list.
const list=[
 {id:'flour',name:'Al Hadbaa Flour - ئاردی حەدبا',units:['فەردە','کیلۆ'],aliases:[]},
 {id:'tom',name:'Tomatoes - تەماتە',units:['کیلۆ','سندوق'],aliases:['tamata']},
 {id:'milk',name:'Al Mudhish Milk - شیری مودهش',units:['دانە','کارتۆن'],aliases:[]},
 {id:'bbq',name:'Barbecue Sauce - سۆسی باربیکیو',units:['دانە'],aliases:[]},
 {id:'chick',name:'Chicken Breast - سنگی مریشک',units:['کیلۆ'],aliases:[]},
 {id:'chickw',name:'Chicken Wings - باڵی مریشک',units:['کیلۆ'],aliases:[]},
];
ctx.setStockItems(list);

// Reading typed lines: amount, unit and the item as written. A comma before a digit is a decimal.
assert.deepEqual(plain(ctx.parseTransferText('tomatoes 2 kg, onions 1 sack\nflour 1,5\n٢ کیلۆ تەماتە\n- bbq sauce x3')),[
 {said:'tomatoes',amount:2,unit:'kg'},{said:'onions',amount:1,unit:'sack'},{said:'flour',amount:1.5,unit:null},
 {said:'تەماتە',amount:2,unit:'کیلۆ'},{said:'bbq sauce',amount:3,unit:null},
]);

// Finding items on the phone: sure only for an exact name, half or remembered spelling, never a guess.
const match=said=>plain(ctx.matchStockLocally(said));
assert.deepEqual([match('tomatoes').itemId,match('tomatoes').sure],['tom',true],'the English half');
assert.deepEqual([match('ئاردی حەدبا').itemId,match('ئاردی حەدبا').sure],['flour',true],'the Kurdish half');
assert.equal(match('TAMATA').sure,true,'a remembered spelling');
assert.deepEqual([match('tomatos').itemId,match('tomatos').sure],['tom',false],'a misspelling is offered, not chosen');
assert.equal(match('chicken').sure,false,'two items could fit: the person picks');
assert.deepEqual(match('chicken').suggestions.slice(0,2).sort(),['chick','chickw']);
assert.deepEqual(match('bbq sauce').suggestions,['bbq'],'any one word finds suggestions when no item has every word');
assert.equal(match('something else').itemId,null);

// Rows: what is wrong with each, and the same item and unit twice become one row.
run("transferState(); transfer.rows=[];");
ctx.addTransferRows([
 {said:'flour',amount:2,unit:'sack',itemId:'flour',sure:true},
 {said:'Al Hadbaa Flour',amount:1.5,unit:'فەردە',itemId:'flour',sure:true},
 {said:'tomatos',amount:1,unit:'kg',itemId:'tom',sure:false,suggestions:['tom']},
 {said:'milk',amount:6,unit:null,itemId:'milk',sure:true},
 {said:'bbq',amount:0,unit:null,itemId:'bbq',sure:true},
 {said:'something else',amount:1,unit:null,itemId:null,sure:false},
 {said:'flour',amount:1,unit:'کارتۆن',itemId:'flour',sure:true},
]);
const rows=run('transfer.rows');
assert.deepEqual(plain(rows.map(r=>[r.itemId,r.amount,r.unit])),[['flour',3.5,'فەردە'],['tom',1,'کیلۆ'],['milk',6,null],['bbq',null,'دانە'],[null,1,null],['flour',1,null]]);
assert.deepEqual(plain(rows.map(ctx.rowIssue)),['','check','unit','amount','item','unit'],'every problem is named');
assert.equal(run("issueText(transfer.rows[5],'unit')"),ctx.T.en.trUnitMissing,'a unit the item lacks is dropped, so the person chooses one');
rows[5].unit='کارتۆن';assert.equal(ctx.rowIssue(rows[5]),'unit');assert.equal(run("issueText(transfer.rows[5],'unit')"),ctx.T.en.trUnitWrong);
assert.ok(stored.get('transfer:rozha').rows.length===6,'the list is kept on this phone');
for(const bad of [0,-1,100000,1.0001,NaN]) assert.equal(run(`validAmount(${bad})`),false,'amount '+bad);
assert.ok(run('validAmount(0.125) && validAmount(99999)'));

// The Excel file: a zip of stored parts with correct checksums, the stock system's sheets, and a styled first sheet.
const sheetLib={};vm.createContext(sheetLib);vm.runInContext(fs.readFileSync('vendor/xlsx-0.20.3.min.js','utf8'),sheetLib);
const XLSX=sheetLib.XLSX;
const at=new Date('2026-10-18T06:05:00Z');
const items=[...list.map(i=>i.name),'=HYPERLINK("http://x")','Ice & "Snow" <cold>\u0001'];
const xrows=[{name:'Al Hadbaa Flour - ئاردی حەدبا',amount:3.5,unit:'فەردە'},{name:'=HYPERLINK("http://x")',amount:1,unit:'دانە'},{name:'Ice & "Snow" <cold>\u0001',amount:0.125,unit:'کیلۆ'}];
const data=ctx.transferWorkbook(xrows,{items,units:['فەردە','کیلۆ','دانە','کارتۆن'],at});
assert.deepEqual(Buffer.from(ctx.transferWorkbook(xrows,{items,units:['فەردە','کیلۆ','دانە','کارتۆن'],at})),Buffer.from(data),'the same list gives the same file');
const parts=new Map();
for(let o=0;o+30<=data.length&&Buffer.from(data.subarray(o,o+4)).readUInt32LE(0)===0x04034b50;){
 const b=Buffer.from(data.subarray(o)),size=b.readUInt32LE(18),nameLen=b.readUInt16LE(26),extra=b.readUInt16LE(28);
 assert.equal(b.readUInt16LE(8),0,'stored, not compressed');assert.equal(b.readUInt32LE(22),size);
 const name=b.subarray(30,30+nameLen).toString(),body=b.subarray(30+nameLen+extra,30+nameLen+extra+size);
 assert.equal(b.readUInt32LE(14),zlib.crc32(body),'checksum of '+name);
 parts.set(name,body.toString());o+=30+nameLen+extra+size;
}
assert.deepEqual([...parts.keys()],['[Content_Types].xml','_rels/.rels','docProps/core.xml','xl/workbook.xml','xl/_rels/workbook.xml.rels','xl/styles.xml','xl/worksheets/sheet1.xml','xl/worksheets/sheet2.xml','xl/worksheets/sheet3.xml','xl/worksheets/sheet4.xml']);
const end=Buffer.from(data.subarray(data.length-22));assert.equal(end.readUInt32LE(0),0x06054b50);assert.equal(end.readUInt16LE(10),parts.size);
// The library runs in its own sandbox: hand it bytes made there.
const book=XLSX.read(vm.runInContext('Uint8Array',sheetLib).from(data),{type:'array',cellStyles:true});
assert.deepEqual(plain(book.SheetNames),['Transfer','Item list','Units','How to fill'],'the sheets of the stock system template');
const sheet=book.Sheets.Transfer;
assert.deepEqual(plain(XLSX.utils.sheet_to_json(sheet,{header:1})),[['Item name','Amount','Unit'],['Al Hadbaa Flour - ئاردی حەدبا',3.5,'فەردە'],['=HYPERLINK("http://x")',1,'دانە'],['Ice & "Snow" <cold>',0.125,'کیلۆ']],'row 1 is exactly Item name, Amount, Unit');
assert.equal(sheet.B2.t,'n','amounts are numbers');
assert.ok(sheet.A3.t==='s' && !sheet.A3.f,'a name that looks like a formula stays text');
assert.deepEqual(plain(XLSX.utils.sheet_to_json(book.Sheets['Item list'],{header:1})).slice(1).map(r=>r[0]),items.map(n=>n.replace('\u0001','')),'every workplace item for the dropdown');
assert.deepEqual(plain(XLSX.utils.sheet_to_json(book.Sheets.Units,{header:1})),[['Unit'],['فەردە'],['کیلۆ'],['دانە'],['کارتۆن']]);
const s1=parts.get('xl/worksheets/sheet1.xml');
assert.match(s1,/<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"\/>/,'the heading row stays in view');
assert.match(s1,/<dataValidation type="list"[^>]*sqref="A2:A200"><formula1>'Item list'!\$A\$2:\$A\$9<\/formula1>/,'item dropdown');
assert.match(s1,/<dataValidation type="list"[^>]*sqref="C2:C200"><formula1>Units!\$A\$2:\$A\$5<\/formula1>/,'unit dropdown');
assert.match(s1,/<c r="A1" s="1" t="inlineStr">/,'the heading uses the green heading style');
assert.match(s1,/<c r="A3" s="3"/,'every second row is banded');
assert.match(parts.get('xl/styles.xml'),/<fgColor rgb="FF1F5C3F"\/>[\s\S]*<fgColor rgb="FFEEF6F0"\/>/);
assert.match(parts.get('docProps/core.xml'),/<dcterms:created xsi:type="dcterms:W3CDTF">2026-10-18T06:05:00Z</);
assert.equal(run(`FILE_TIME.format(new Date('${at.toISOString()}'))`).replace(/\D/g,''),'0905','the file name uses Erbil time');

// Uploading the workplace item list: the "Item list" sheet and its "Units" sheet, or any sheet with a name column.
ctx.loadSpreadsheetReader=async()=>XLSX;
const file=(bytes,name)=>({name,size:bytes.length,type:'',arrayBuffer:async()=>bytes});
const template=XLSX.utils.book_new();
XLSX.utils.book_append_sheet(template,XLSX.utils.aoa_to_sheet([['Item name','Amount','Unit']]),'Transfer');
XLSX.utils.book_append_sheet(template,XLSX.utils.aoa_to_sheet([['Item name'],['Almonds - بادەم'],['Beans - فاسۆلیا'],['almonds - بادەم'],['']]),'Item list');
XLSX.utils.book_append_sheet(template,XLSX.utils.aoa_to_sheet([['Unit'],['کیلۆ'],['فەردە']]),'Units');
(async()=>{
 let read=plain(await ctx.readStockListFile(file(XLSX.write(template,{type:'array',bookType:'xlsx'}),'template.xlsx')));
 assert.deepEqual(read,{items:[{name:'Almonds - بادەم',units:[]},{name:'Beans - فاسۆلیا',units:[]}],units:['کیلۆ','فەردە']},'the stock system template, without repeats');
 const own=XLSX.utils.book_new();
 XLSX.utils.book_append_sheet(own,XLSX.utils.aoa_to_sheet([['Workplace items'],[],['Code','Item name','Units'],['A1','Sugar - شەکر','فەردە, کیلۆ'],['A2','Tea - چای','پاکەت|کارتۆن|پاکەت']]),'Sheet1');
 read=plain(await ctx.readStockListFile(file(XLSX.write(own,{type:'array',bookType:'xlsx'}),'items.xlsx')));
 assert.deepEqual(read.items,[{name:'Sugar - شەکر',units:['فەردە','کیلۆ']},{name:'Tea - چای',units:['پاکەت','کارتۆن']}],'the heading row is found and units are split');
 read=plain(await ctx.readStockListFile(file(new TextEncoder().encode('﻿Item name,Unit\nپیاز - Onions,کیلۆ\n"Oil, sunflower",تەنەکە\n'),'list.csv')));
 assert.deepEqual(read.items,[{name:'پیاز - Onions',units:['کیلۆ']},{name:'Oil, sunflower',units:['تەنەکە']}],'a UTF-8 CSV keeps Kurdish');
 console.log('Transfers: PASS (translations, units, reading lines, matching without guessing, row checks, merged repeats, styled Excel parts/checksums/sheets/dropdowns/formula-safe text, item list upload from xlsx and csv)');
})().catch(e=>{console.error(e);process.exitCode=1;});
