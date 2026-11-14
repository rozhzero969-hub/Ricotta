/* Transfers show what is really left in a storage: the stock Rico read, less what other transfers are
   already taking (sent and waiting, being moved, or moved after the stock was read), and on a form, less
   the same item on the lines above (10 kg, 3 kg on item 1: item 2 shows 7 kg).
   Run: node scripts/transfer-left-smoke.cjs */
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const shared = fs.readFileSync('supabase/functions/_shared/transfers.js', 'utf8'), src = fs.readFileSync('transfers.js', 'utf8');
const code = src.slice(src.indexOf('const TF_TAKING'), src.indexOf('function tfAvailHtml('));
const read = Date.parse('2026-11-13T08:00:00Z');
const carrot = {name:'Carrot', base:'غرام', count:{name:'کیلۆ', factor:1000}, buy:null, stock:{'Main Storage':10000}};
const ctx = {tf:{data:{catalog:{at:read, titems:[carrot]}, transfers:[]}}, tfIsPractice:x=>x.mode === 'practice'};
vm.createContext(ctx); vm.runInContext(shared + ';globalThis.TF=()=>globalThis.RicottaTransfers;' + code + ';globalThis.tfLeft=tfLeft;globalThis.tfLeftForLine=tfLeftForLine;globalThis.tfCatalogLeft=tfCatalogLeft;globalThis.tfDrafted=tfDrafted;', ctx);
const kg = n=>n * 1000, line = qty=>({item:'Carrot', unit:'کیلۆ', qty});
const form = {id:'form', from:'Main Storage', lines:[line(3), line(null)]};
assert.equal(ctx.tfLeftForLine(carrot, form, 0), kg(10), 'item 1 sees all 10 kg');
assert.equal(ctx.tfLeftForLine(carrot, form, 1), kg(7), 'item 2 sees 7 kg after 3 kg on item 1');
const list = ctx.tf.data.transfers;
list.push({id:'a', from:'Main Storage', status:'queued', lines:[line(5)]});
assert.equal(ctx.tfLeft(carrot, 'Main Storage', 'form'), kg(5), 'a sent transfer waiting for Rico takes its 5 kg');
list.push({id:'b', from:'Main Storage', status:'moved', movedAt:'2026-11-13T07:00:00Z', lines:[line(2)]});
assert.equal(ctx.tfLeft(carrot, 'Main Storage', 'form'), kg(5), 'one moved before the stock was read is already in it');
list.push({id:'c', from:'Main Storage', status:'moved', movedAt:'2026-11-13T09:00:00Z', lines:[line(1)]});
assert.equal(ctx.tfLeft(carrot, 'Main Storage', 'form'), kg(4), 'one moved after the stock was read still counts');
list.push({id:'d', from:'Minibar', status:'queued', lines:[line(9)]}, {id:'e', from:'Main Storage', status:'cancelled', lines:[line(9)]}, {id:'f', from:'Main Storage', status:'queued', mode:'practice', lines:[line(9)]});
assert.equal(ctx.tfLeft(carrot, 'Main Storage', 'form'), kg(4), 'other storages, cancelled and practice runs do not count');
list.push({id:'form', from:'Main Storage', status:'draft', lines:[line(3)]});
assert.equal(ctx.tfLeft(carrot, 'Main Storage', 'form'), kg(4), 'the form itself is counted on its lines, not twice');
assert.equal(ctx.tfCatalogLeft(form).titems[0].stock['Main Storage'], kg(4), 'Send is checked against what is left');
assert.equal(ctx.tf.data.catalog.titems[0].stock['Main Storage'], kg(10), 'the stock read from Ricotta Restaurant is not changed');
// Rozh's example: 10 kg carrots, 5 kg in a draft (not sent) to Appetizers: another transfer sees 5 kg,
// and is told where the other 5 kg are. A draft from another storage, or one waiting to send, is not a draft here.
ctx.tf.data.transfers = [{id:'g', from:'Main Storage', to:'Appetizers', status:'draft', lines:[line(5)]}];
const form2 = {id:'form2', from:'Main Storage', lines:[line(null)]};
assert.equal(ctx.tfLeft(carrot, 'Main Storage', 'form2'), kg(5), 'a draft holds its 5 kg');
assert.deepEqual(JSON.parse(JSON.stringify(ctx.tfDrafted(carrot, 'Main Storage', 'form2'))), [{zone:'Appetizers', base:kg(5)}], 'and says where');
assert.equal(ctx.tfCatalogLeft(form2).titems[0].stock['Main Storage'], kg(5), 'Send allows 5 kg, not 10');
assert.equal(ctx.tfLeft(carrot, 'Main Storage', 'g'), kg(10), 'the draft itself still sees all 10 kg');
ctx.tf.data.transfers.push({id:'h', from:'Minibar', to:'Pizza', status:'draft', lines:[line(5)]});
assert.equal(ctx.tfLeft(carrot, 'Main Storage', 'form2'), kg(5), 'a draft from another storage does not count here');
console.log('Transfer stock left PASS: other transfers, this person\'s drafts and lines above are taken off, the read stock stays as read');
