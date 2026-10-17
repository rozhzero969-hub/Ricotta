/* Publish an explicit browser-only artifact; never copy the repository root. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'dist');
const files=['index.html','manifest.json','boot.js','config.js','icons.js','i18n.js','storage.js','sounds.js','modals.js','bot-check.js','push.js','assistant.js','kitchen.js','supabase/functions/_shared/search.js','ordering-tools.js','app.js','update-check.js','sw.js','style.css','vendor/xlsx-0.20.3.min.js','vendor/SHEETJS-LICENSE','icon-192.png','icon-512.png','apple-touch-icon.png',...['happy','excited','grateful','calm','thinking','worried','sad','angry'].map(m=>'rico-'+m+'.png')];
// A symlink, a path escape or an unreviewed dependency must fail the build.
fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out);
for(const file of files){
 const source=path.join(root,file);assert.ok(fs.lstatSync(source).isFile(),file+' must be a real file');
 const target=path.join(out,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(source,target);
}
const html=fs.readFileSync(path.join(out,'index.html'),'utf8');
for(const match of html.matchAll(/(?:src|href)="([^"#?]+)"/g)){
 const file=match[1];if(!/^(https?:|data:)/.test(file))assert.ok(files.includes(file),'unpublished asset: '+file);
}
for(const file of files)assert.ok(!/(^|\/)(?:\.env|\.git|lab|scripts|node_modules)(?:\/|$)|\.(?:sql|ts|map)$/.test(file),'private/development file in site: '+file);
console.log('Site build PASS: '+files.length+' browser assets; backend, migrations, tests and local files excluded');
