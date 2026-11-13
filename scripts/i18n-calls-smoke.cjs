/* Every t('key') in the app names a text that exists in English, Kurdish and Arabic, and is called like
   it is written: t('key')(…) only for texts that are functions, t('key') alone only for plain texts. A
   wrong one crashes a whole screen (Admin › Problems did, 2026-11-12). Keys built at run time
   (t('feat_' + id)) are not checked here.
   Run: node scripts/i18n-calls-smoke.cjs */
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const ctx = {}; vm.createContext(ctx); vm.runInContext(fs.readFileSync('i18n.js', 'utf8') + '\n' + fs.readFileSync('ordering-tools.js', 'utf8') + ';globalThis.T = T;', ctx);
const T = ctx.T, langs = ['en', 'ku', 'ar'];
const files = fs.readdirSync('.').filter(f => f.endsWith('.js') && !['i18n.js', 'sw.js', 'eslint.config.js'].includes(f));
const bad = [];
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/(?<![\w$.])t\(\s*'([A-Za-z0-9_]+)'\s*\)(\s*\()?/g)) {
    const [, key, called] = m, line = src.slice(0, m.index).split('\n').length;
    for (const l of langs) {
      const v = T[l]?.[key];
      if (v === undefined && l === 'en') bad.push(`${f}:${line} '${key}' is missing`);
      else if (v !== undefined && !!called !== (typeof v === 'function')) bad.push(`${f}:${line} '${key}' is ${typeof v} in ${l} but ${called ? 'called' : 'used as text'}`);
    }
  }
}
assert.deepEqual(bad, [], 'texts used the way they are written:\n' + bad.join('\n'));
console.log(`i18n calls PASS: every t('key') in ${files.length} files exists and is used as written, in English, Kurdish and Arabic`);
