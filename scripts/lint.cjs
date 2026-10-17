const fs=require('fs');const cp=require('child_process');
// Every script the page loads, in its own order (read from index.html, so a new file is never skipped).
const files=[...fs.readFileSync('index.html','utf8').matchAll(/<script defer src="([^"]+\.js)"><\/script>/g)].map(m=>m[1]);
fs.writeFileSync('.lint-all.js',files.map(p=>fs.readFileSync(p,'utf8')).join('\n'));
cp.execFileSync(process.execPath,['node_modules/eslint/bin/eslint.js','--config','scripts/eslint.undef.config.cjs','.lint-all.js'],{stdio:'inherit'});
