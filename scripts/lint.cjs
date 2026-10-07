const fs=require('fs');const cp=require('child_process');
fs.writeFileSync('.lint-all.js',['config.js','icons.js','i18n.js','storage.js','sounds.js','modals.js','push.js','assistant.js','app.js','update-check.js'].map(p=>fs.readFileSync(p,'utf8')).join('\n'));
cp.execFileSync(process.execPath,['node_modules/eslint/bin/eslint.js','--config','scripts/eslint.undef.config.cjs','.lint-all.js'],{stdio:'inherit'});
