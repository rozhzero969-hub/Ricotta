// The app map (supabase/functions/_shared/app-map.js) that Rico's find_in_app searches: every entry is
// complete and points at something that exists (a screen, an Admin page, a Settings row, a row in Rico's
// settings, or something the app can do), each account finds only what it can use (Ahmad never finds
// ordering or Admin, Yunis never finds Admin), and the server's tools answer the same way.
// Run: node scripts/app-map-smoke.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import '../supabase/functions/_shared/search.js';
import '../supabase/functions/_shared/app-map.js';

const M = globalThis.RicottaAppMap;
const read = f => fs.readFileSync(f, 'utf8');
const app = read('app.js'), admin = read('admin.js'), assistant = read('assistant.js'), features = read('features.js'), receipts = read('receipts.js'), recipes = read('recipes.js');
const everything = [app, admin, assistant, features, receipts, recipes, read('spotlight.js')].join('\n');

// 1. Every entry is complete.
const ids = new Set();
for (const p of M.PLACES) {
  assert.ok(/^[a-zA-Z]+$/.test(p.id) && !ids.has(p.id), 'a unique id: ' + p.id); ids.add(p.id);
  assert.ok(['tab', 'page', 'setting', 'action'].includes(p.kind), p.id + ' has a kind');
  assert.equal(p.n.length, 3, p.id + ' is named in English, Kurdish and Arabic');
  p.n.forEach(n => assert.ok(typeof n === 'string' && n.trim() && !/[—–]/.test(n), p.id + ' has a plain name: ' + n));
  assert.ok(/[؀-ۿ]/.test(p.n[1]) || /Rico/.test(p.n[1]), p.id + ': the Kurdish name is in Kurdish');
  assert.ok(p.go && Object.keys(p.go).length, p.id + ' says how to open it');
  assert.ok(p.need && [].concat(p.need.v || []).length, p.id + ' says which screen it needs');
}
for (const p of M.PLACES) if (p.in) assert.ok(ids.has(p.in), p.id + ' is inside an entry that exists: ' + p.in);

// 2. Every target exists in the app.
const views = Object.keys(eval('(' + app.match(/const VIEW_LABEL_KEYS = (\{[^}]*\})/)[1] + ')'));
const adminPages = eval(admin.match(/const ADMIN_PAGES = (\[[^\]]*\])/)[1]);
const runs = assistant.slice(assistant.indexOf('const APP_PLACE_RUN = {'), assistant.indexOf('};', assistant.indexOf('const APP_PLACE_RUN = {')));
const ricoSheet = assistant.slice(assistant.indexOf('function openRicoSettings(){'), assistant.indexOf('/* A small date and time line'));
const selectorFound = (sel, src) => {
  const m = sel.match(/^#([\w-]+)$/) || sel.match(/^\.([\w-]+)$/) || sel.match(/^\[([\w-]+)(?:="([^"]+)")?\]$/);
  assert.ok(m, 'a simple selector: ' + sel);
  if (sel[0] === '#') return src.includes(`id="${m[1]}"`);
  if (sel[0] === '.') return new RegExp(`class="[^"]*\\b${m[1]}\\b`).test(src);
  if (m[1] === 'data-feature') return new RegExp(`\\{id:'${m[2]}'`).test(features) || src.includes(`data-feature="${m[2]}"`);
  return src.includes(m[1]);
};
for (const p of M.PLACES) {
  const g = p.go;
  if (g.view) assert.ok(views.includes(g.view), `${p.id}: the screen ${g.view} exists`);
  [].concat(p.need.v || [], p.need.ah || []).forEach(v => assert.ok(views.includes(v), `${p.id}: it needs a real screen (${v})`));
  if (g.admin) assert.ok(adminPages.includes(g.admin), `${p.id}: the Admin page ${g.admin} exists`);
  if (g.person) assert.ok(['rozha', 'yunis', 'ahmad'].includes(g.person), `${p.id}: a real person`);
  if (g.run) assert.ok(new RegExp(`\\b${g.run}:`).test(runs), `${p.id}: the app can do ${g.run} (APP_PLACE_RUN)`);
  if (g.sel) assert.ok(selectorFound(g.sel, everything), `${p.id}: the row ${g.sel} is on its screen`);
  if (g.rico) assert.ok(selectorFound(g.rico, ricoSheet), `${p.id}: the row ${g.rico} is in Rico's settings`);
}
// Every Admin page and every Settings switch can be found.
for (const page of adminPages.filter(x => x !== 'person')) assert.ok(M.PLACES.some(p => p.go.admin === page), 'Admin, ' + page + ' is on the map');
for (const id of [...features.matchAll(/\{id:'(\w+)', group:'(?!none)\w+'/g)].map(m => m[1]).filter(id => id !== 'ricoAutoStart'))
  assert.ok(M.PLACES.some(p => p.go.sel === `[data-feature="${id}"]` || (id === 'ricoSheet' && p.go.rico)), 'the setting ' + id + ' is on the map');

// 3. Each account finds only what it can use.
const rozha = { account: 'rozha', roles: [] };
const yunis = { account: 'yunis', roles: ['history', 'manage', 'catalog', 'record', 'assistant', 'send', 'exports', 'notify'] };
const ahmad = { account: 'ahmad', roles: ['assistant'] };
const mine = who => M.find('', who).map(p => p.id);
assert.deepEqual(M.PLACES.map(p => p.id).filter(id => !mine(rozha).includes(id)), ['minibar', 'setRecipeAlerts'], 'Rozh can use everything but Ahmad\'s own Stock tab and recipe alerts');
assert.ok(!mine(yunis).some(id => id.startsWith('admin')), 'Yunis never finds Admin');
assert.ok(!mine(yunis).includes('receipts') && !mine(yunis).includes('setRicoMac'), 'Yunis without Receipts never finds it');
for (const id of ['order', 'send', 'history', 'manage', 'suppliers', 'addItem', 'admin', 'adminSecurity', 'setSwipe', 'setSoundQty', 'tour', 'receipts', 'transfers', 'stock'])
  assert.ok(!mine(ahmad).includes(id), 'Ahmad never finds ' + id);
for (const id of ['recipes', 'recipeItems', 'minibar', 'setRecipeAlerts', 'setDark', 'rico', 'recipesTour'])
  assert.ok(mine(ahmad).includes(id), 'Ahmad finds ' + id);
assert.ok(!mine({ account: 'ahmad', roles: [] }).includes('rico'), 'Ahmad without Rico does not find Rico');
assert.ok(mine({ account: 'yunis', roles: ['receipts'] }).includes('receipts'), 'Yunis finds Receipts once Rozh gives it');
assert.ok(!mine({ account: 'yunis', roles: ['receipts'] }).includes('setRicoMac'), 'Rico on the Mac stays Rozh\'s');

// 4. Search: plain words, any language, best first.
const top = (q, who = rozha) => M.find(q, who, 3).map(p => p.id);
assert.equal(top('dark mode')[0], 'setDark');
assert.equal(top('where can I turn on dark mode?')[0], 'setDark', 'a whole question finds it');
assert.equal(top('تاریک')[0], 'setDark', 'Kurdish');
assert.equal(top('داكن')[0], 'setDark', 'Arabic');
assert.equal(top('change a pin')[0], 'adminPins');
assert.equal(top('notifications')[0], 'setNotif');
assert.equal(top('language')[0], 'setLanguage');
assert.equal(top('bring back something deleted')[0], 'adminRestore');
assert.equal(top('who can open what')[0], 'adminAccess');
assert.equal(top('recipes', ahmad)[0], 'recipes');
assert.deepEqual(top('send the order to suppliers', ahmad), [], 'Ahmad finds nothing about ordering');
assert.ok(!top('unlock sign in', yunis).some(id => id.startsWith('admin')), 'Yunis never gets an Admin page');
assert.equal(M.pathOf(M.byId('setDark'), 'en'), 'Settings, Light or Dark');
assert.equal(M.pathOf(M.byId('setDark'), 'ku'), 'ڕێکخستن، ڕووناک یان تاریک', 'Kurdish uses its own comma');

// 5. The server: find_in_app answers from the same map, open_screen shows a place only to someone who can use it.
const { _internals } = await import('../supabase/functions/api/assistant.ts');
const world = (account, roles) => ({ account, roles, full: account === 'rozha', catalog: account !== 'ahmad', can: { history: true, record: true, receipts: account === 'rozha', transfers: account === 'rozha', recipes: account !== 'yunis' } });
const run = async (w, name, a) => { const out = []; const r = await _internals.runTool({}, w, name, a, e => out.push(e), false); return { r, out }; };
let res = await run(world('ahmad', ['assistant']), 'find_in_app', { query: 'dark mode' });
assert.equal(res.r.found[0].id, 'setDark', 'Ahmad\'s Rico finds dark mode');
assert.equal(res.r.found[0].where_ku, M.pathOf(M.byId('setDark'), 'ku'));
res = await run(world('ahmad', ['assistant']), 'find_in_app', { query: 'sign-in safety wrong pins' });
assert.deepEqual(res.r.found, [], 'Ahmad\'s Rico finds no Admin page');
assert.ok(res.r.not_for_this_person?.length, 'and is told it exists but is not his');
res = await run(world('yunis', yunis.roles), 'open_screen', { place: 'adminSecurity' });
assert.equal(res.r.error, 'no_access', 'no button to Admin for Yunis');
assert.equal(res.out.length, 0);
res = await run(world('rozha', []), 'open_screen', { place: 'setDark' });
assert.equal(res.out[0].proposal.kind, 'open');
assert.equal(res.out[0].proposal.place, 'setDark');
assert.equal(res.out[0].proposal.screen, 'settings');
res = await run(world('yunis', yunis.roles), 'open_screen', { screen: 'history' });
assert.equal(res.out[0].proposal.screen, 'history', 'open_screen still opens a screen');
// A plain screen button is only for someone who has that screen: no Admin for Yunis, no Order for Ahmad.
res = await run(world('yunis', yunis.roles), 'open_screen', { screen: 'admin' });
assert.equal(res.r.error, 'no_access', 'no Admin button for Yunis'); assert.equal(res.out.length, 0);
res = await run(world('ahmad', ['assistant']), 'open_screen', { screen: 'order' });
assert.equal(res.r.error, 'no_access', 'no Order button for Ahmad'); assert.equal(res.out.length, 0);
res = await run(world('ahmad', ['assistant']), 'open_screen', { screen: 'recipes' });
assert.equal(res.out[0].proposal.screen, 'recipes', 'Ahmad gets his Recipes button');
res = await run(world('rozha', []), 'open_screen', { screen: 'send' });
assert.equal(res.out[0].proposal.screen, 'send', 'Rozh gets Send to suppliers');
assert.match(_internals.MANUAL, /find_in_app/, 'Rico\'s notes say he can show where things are');
assert.ok(_internals.TOOLS.some(t => t.name === 'find_in_app'));

console.log(`App map PASS: ${M.PLACES.length} places, each named in 3 languages and pointing at a real screen, Admin page, Settings row or action; Rozh, Yunis and Ahmad each find only what they can use; find_in_app and open_screen on the server agree`);
