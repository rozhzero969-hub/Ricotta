/* A browser-only, content-addressed artifact. Source stays readable in Git. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto'),{transformSync}=require('esbuild');
const root=path.resolve(__dirname,'..'),out=path.join(root,'dist');
// The app's scripts in the page's own order, read from index.html: a new <script defer src> is bundled
// without editing this file. config.js stays separate (the updater reads it); boot.js is built below.
const scripts=[...fs.readFileSync(path.join(root,'index.html'),'utf8').matchAll(/<script defer src="([^"]+\.js)"><\/script>/g)].map(m=>m[1]).filter(f=>f!=='config.js'&&f!=='boot.js');
assert.ok(scripts.length>5&&scripts.at(-1)==='update-check.js'&&scripts.includes('app.js'),'the app scripts are read from index.html');
const copied=['manifest.json','config.js','privacy.html','icon-192.png','icon-512.png','apple-touch-icon.png','install-icon.webp','vendor/SHEETJS-LICENSE',...['happy','excited','grateful','calm','thinking','worried','sad','angry'].map(m=>'rico-'+m+'.png'),...['Manrope','NotoKufiArabic'].map(m=>'fonts/'+m+'-OFL.txt')];
fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out);
function read(file){const source=path.join(root,file);assert.ok(fs.lstatSync(source).isFile(),file+' must be a real file');return fs.readFileSync(source);}
function write(file,bytes){const target=path.join(out,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);}
const emitted=[];
function asset(name,ext,bytes){const hash=createHash('sha256').update(bytes).digest('hex').slice(0,12),file=`assets/${name}.${hash}.${ext}`;write(file,bytes);emitted.push(file);return file;}
const minjs=s=>transformSync(s,{loader:'js',minify:true,target:'es2022',legalComments:'none'}).code;
const mincss=s=>transformSync(s,{loader:'css',minify:true,target:'es2022',legalComments:'none'}).code;
for(const file of copied)write(file,read(file));
// Load a matching version marker with this document; keep root config.js live for update probes.
const config=asset('config','js',minjs(read('config.js').toString()));
let fonts=read('fonts/fonts.css').toString();
for(const name of ['manrope-latin','noto-kufi-arabic']){
 const file=asset(name,'woff2',read('fonts/'+name+'.woff2'));
 fonts=fonts.replace(name+'.woff2',path.basename(file));
}
const fontCss=asset('fonts','css',mincss(fonts));
// Print windows use this stable alias; its own font URLs still carry hashes.
write('fonts/fonts.css',mincss(fonts.replaceAll('url(', 'url(../assets/')));
const css=asset('style','css',mincss(read('style.css').toString()));
const sheet=asset('spreadsheet','js',read('vendor/xlsx-0.20.3.min.js'));
const boot=asset('boot','js',minjs(read('boot.js').toString().replace("'style.css'",JSON.stringify(css)).replace("'fonts/fonts.css'",JSON.stringify(fontCss))));
let code=scripts.map(file=>read(file).toString()).join('\n;\n').replace('vendor/xlsx-0.20.3.min.js',sheet);
// The updater must refresh deployed files, not development source paths.
code=code.replace(/const APP_FILES = \[[^\]]*\];/,`const APP_FILES = ${JSON.stringify(['config.js','sw.js',css,fontCss,boot])};`);
const app=asset('app','js',minjs(code));
let html=read('index.html').toString();
html=html.replace('src="config.js"',`src="${config}"`);
html=html.replace('href="style.css"',`href="${css}"`).replace('href="style.css"',`href="${css}"`).replace('src="boot.js"',`src="${boot}"`);
html=html.replace(/<script defer src="([^\"]+)"><\/script>/g,(tag,file)=>scripts.includes(file)?(file==='app.js'?`<script defer src="${app}"></script>`:''):tag);
write('index.html',html);
const version=createHash('sha256').update(emitted.join('|')).digest('hex').slice(0,12);
let sw=read('sw.js').toString().replace("const STATIC_CACHE = 'ricotta-static-dev';",`const STATIC_CACHE = 'ricotta-static-${version}';`).replace('const STATIC_FILES = [];',`const STATIC_FILES = ${JSON.stringify(emitted)};`);
write('sw.js',minjs(sw));
// Validate every literal local reference, including CSS/JS and lazy loaders.
for(const match of html.matchAll(/(?:src|href)="([^"#?]+)"/g)){
 const file=match[1];if(!/^(https?:|data:)/.test(file))assert.ok(fs.existsSync(path.join(out,file)),'unpublished asset: '+file);
}
for(const file of [...copied,...emitted])assert.ok(!/(^|\/)(?:\.env|\.git|lab|scripts|node_modules)(?:\/|$)|\.(?:sql|ts|map)$/.test(file),'private/development file in site: '+file);
console.log('Site build PASS: minified hashed assets, local fonts, on-demand spreadsheets; backend/source/test files excluded');
