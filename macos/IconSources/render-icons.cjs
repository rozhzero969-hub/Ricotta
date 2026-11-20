/* Renders the Mac app's icon choices from this folder (see macos/README.md, "App icons").
     <name>.svg   the drawing, 1024 x 1024 on Apple's macOS icon grid
     <name>.png   optional: a finished 1024 x 1024 picture; used instead of the SVG when it is here
   Writes, for every name in ICONS:
     macos/Ricotta/Assets.xcassets/AppIcon-<name>.imageset/  512 and 1024 px (the Dock icon and View > App Icon)
     mac-icons/<name>.png                                    96 px (the website's Settings picker, Mac app only)
   and, from the first (default) icon, the app bundle's own icon (AppIcon.appiconset: Finder, Launchpad).
   Run from the repository root:  node macos/IconSources/render-icons.cjs  [--sheet out.png]
   The signed app bundle keeps its own icon. These images are used while the app runs. */
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path');
const ICONS=['ricotta','pumpkin','holly','moonlit','gemini','cupid','monogram','ticket','aurora','frost','copper','stamp'];
const repo=path.resolve(__dirname,'../..'),src=__dirname,assets=path.join(repo,'macos/Ricotta/Assets.xcassets');
const font=path.join(repo,'fonts/manrope-latin.woff2');
(async()=>{
  const browser=await chromium.launch();
  const page=await browser.newPage({deviceScaleFactor:1});
  const draw=async(name,size)=>{
    const png=path.join(src,name+'.png');
    const art=fs.existsSync(png)?`<img src="data:image/png;base64,${fs.readFileSync(png).toString('base64')}" width="${size}" height="${size}">`
      :fs.readFileSync(path.join(src,name+'.svg'),'utf8').replace('width="1024" height="1024"',`width="${size}" height="${size}"`);
    await page.setViewportSize({width:size,height:size});
    await page.setContent(`<style>@font-face{font-family:Manrope;font-weight:800;src:url(data:font/woff2;base64,${fs.readFileSync(font).toString('base64')})}html,body{margin:0;background:transparent}svg,img{display:block}</style>${art}`);
    await page.evaluate(()=>document.fonts.ready);
    return page.screenshot({omitBackground:true,clip:{x:0,y:0,width:size,height:size}});
  };
  fs.mkdirSync(path.join(repo,'mac-icons'),{recursive:true});
  for(const name of ICONS){
    const dir=path.join(assets,`AppIcon-${name}.imageset`);
    fs.mkdirSync(dir,{recursive:true});
    fs.writeFileSync(path.join(dir,`AppIcon-${name}.png`),await draw(name,512));
    fs.writeFileSync(path.join(dir,`AppIcon-${name}@2x.png`),await draw(name,1024));
    fs.writeFileSync(path.join(dir,'Contents.json'),JSON.stringify({images:[{idiom:'universal',scale:'1x',filename:`AppIcon-${name}.png`},{idiom:'universal',scale:'2x',filename:`AppIcon-${name}@2x.png`}],info:{author:'xcode',version:1}}));
    fs.writeFileSync(path.join(repo,'mac-icons',name+'.png'),await draw(name,96));
  }
  const bundle=path.join(assets,'AppIcon.appiconset');
  for(const pt of [16,32,128,256,512]){
    fs.writeFileSync(path.join(bundle,`icon_${pt}x${pt}.png`),await draw(ICONS[0],pt));
    fs.writeFileSync(path.join(bundle,`icon_${pt}x${pt}@2x.png`),await draw(ICONS[0],pt*2));
  }
  // --sheet: every icon at 16, 32, 128 and 512 pt, to check they read well at each size.
  const sheet=process.argv.indexOf('--sheet');
  if(sheet>0){
    const rows=ICONS.map(n=>`<div style="display:flex;align-items:end;gap:18px;margin:10px"><b style="width:90px;font:13px -apple-system">${n}</b>${[16,32,128,256].map(s=>`<img src="data:image/png;base64,${fs.readFileSync(path.join(assets,`AppIcon-${n}.imageset/AppIcon-${n}@2x.png`)).toString('base64')}" width="${s}" height="${s}">`).join('')}</div>`).join('');
    await page.setViewportSize({width:620,height:200});
    await page.setContent(`<body style="margin:0;background:#ECECEC">${rows}</body>`);
    await page.screenshot({path:process.argv[sheet+1],fullPage:true});
  }
  await browser.close();
  console.log('Rendered '+ICONS.length+' icons');
})().catch(e=>{console.error(e);process.exit(1);});
