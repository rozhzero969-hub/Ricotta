/* Ricotta Lab: special themes for the real app.
   Adds five seasonal themes to Settings > Appearance (next to the app's own
   five), draws each theme's quiet background decorations, dresses Rico for
   the occasion (his face and colours never change, only his clothes and how
   he acts), and adds the Lab panel for rating themes and ideas.
   Runs right after app.js, so THEMES, THEME_LOOK, T, state, render,
   setTheme, currentTheme and ricoFace already exist. */
(function(){
  const SPECIAL = window.LAB_SPECIAL;
  const RICO = window.LAB_RICO;
  const lsGet = (k, d) => { try{ const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; }catch(_){ return d; } };
  const lsSet = (k, v) => { try{ localStorage.setItem(k, JSON.stringify(v)); }catch(_){} };
  const L = () => (typeof state !== 'undefined' && ['en','ku','ar'].includes(state.lang)) ? state.lang : 'en';
  const escH = s => String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  /* ---------- 1. The themes join the app's own list ---------- */
  const LOOK = {
    halloween:{swatch:['#2B1B3D','#F28C28','#F0ECF2'], bar:'#F0ECF2', names:{en:'Halloween', ku:'هالۆوین', ar:'الهالوين'}},
    winter:{swatch:['#1D3A57','#6CB8EA','#EEF3F7'], bar:'#EEF3F7', names:{en:'Winter Citadel', ku:'زستانی قەڵا', ar:'شتاء القلعة'}},
    newroz:{swatch:['#1E5A33','#FEBD11','#F4F2EA'], bar:'#F4F2EA', names:{en:'Newroz', ku:'نەورۆز', ar:'نوروز'}},
    ramadan:{swatch:['#1B2447','#E2B04A','#F2F0EB'], bar:'#F2F0EB', names:{en:'Ramadan Nights', ku:'شەوانی ڕەمەزان', ar:'ليالي رمضان'}},
    summer:{swatch:['#0F5257','#FF8A4C','#F4F3EC'], bar:'#F4F3EC', names:{en:'Shaqlawa Summer', ku:'هاوینی شەقڵاوە', ar:'صيف شقلاوة'}}
  };
  for(const id of SPECIAL){
    if(!THEMES.includes(id)) THEMES.push(id);
    THEME_LOOK[id] = {swatch:LOOK[id].swatch, bar:LOOK[id].bar};
    for(const lg of ['en','ku','ar']) if(T[lg] && T[lg].themeNames) T[lg].themeNames[id] = LOOK[id].names[lg];
  }
  const isSpecial = th => SPECIAL.includes(th);

  /* ---------- 2. Rico's costumes ---------- */
  const flower = (x, y, petal, mid) => `<g transform="translate(${x} ${y})"><circle r="4.3" fill="${petal}"/><circle r="2" fill="${mid}"/></g>`;
  const COSTUME = {
    halloween:{
      back:'<path class="lc lc-cape" d="M33 70 Q19 88 21 100 Q50 95 79 100 Q81 88 67 70Z" fill="#3A2552"/><path class="lc" d="M21 100 Q50 95 79 100" stroke="#F28C28" stroke-width="2" fill="none"/>',
      head:'<g class="lc"><path d="M19 15 Q50 3 81 15 Q50 23 19 15Z" fill="#2B1B3D"/><path d="M35 13 L47 -20 Q50 -27 58 -25 Q53 -20 54 -14 L65 12 Q50 17 35 13Z" fill="#3A2552"/><path d="M36.5 9 Q50 13 63.5 9 L62 5 Q50 9 38 5Z" fill="#F28C28"/><rect x="47" y="5.6" width="6" height="5" rx="1" fill="#FFD36B"/></g>'
    },
    winter:{
      head:'<g class="lc"><path d="M27 20 Q28 0 50 -1 Q72 0 73 20Z" fill="#2F6FB0"/><path d="M36 3v15M44 .5v17M56 .5v17M64 3v15" stroke="#255C93" stroke-width="2.2" opacity=".55"/><rect x="25" y="15" width="50" height="10" rx="5" fill="#E9F2FA"/><circle cx="50" cy="-3" r="6.5" fill="#E9F2FA"/></g><g class="lc lc-breath"><circle cx="64" cy="64" r="2.6"/><circle cx="70" cy="60" r="3.4"/><circle cx="77" cy="55" r="4.2"/></g>',
      hand:'<g class="lc"><rect x="29" y="67" width="42" height="9" rx="4.5" fill="#D9473F"/><path d="M34 67v9M42 67v9M50 67v9M58 67v9M66 67v9" stroke="#fff" stroke-width="2" opacity=".5"/><path d="M57 72h9v19h-9z" fill="#C23B34"/><path d="M58.5 91v3M61.5 91v3M64.5 91v3" stroke="#C23B34" stroke-width="1.6"/></g>'
    },
    newroz:{
      head:`<g class="lc"><ellipse cx="32" cy="17" rx="3.4" ry="1.8" fill="#4FA35B" transform="rotate(-40 32 17)"/><ellipse cx="68" cy="17" rx="3.4" ry="1.8" fill="#4FA35B" transform="rotate(40 68 17)"/><ellipse cx="43" cy="8.5" rx="3" ry="1.6" fill="#4FA35B" transform="rotate(-15 43 8.5)"/>${flower(27,23,'#fff','#FEBD11')}${flower(36,12,'#fff','#FEBD11')}${flower(50,7,'#ED2024','#FEBD11')}${flower(64,12,'#fff','#FEBD11')}${flower(73,23,'#fff','#FEBD11')}</g>`,
      hand:'<g class="lc"><path d="M73 92 L80 44" stroke="#6B4A2B" stroke-width="2.4" stroke-linecap="round"/><g class="lc-flagcloth"><rect x="80" y="44" width="20" height="5" fill="#ED2024"/><rect x="80" y="49" width="20" height="5" fill="#fff"/><rect x="80" y="54" width="20" height="5" fill="#278E43"/><circle cx="90" cy="51.5" r="2.3" fill="#FEBD11"/></g></g>'
    },
    ramadan:{
      head:'<g class="lc"><path d="M50 5.5V0" stroke="#8C6418" stroke-width="1.6"/><path d="M55 -13a8.5 8.5 0 1 0 0 14a6.6 6.6 0 1 1 0 -14z" fill="#E2B04A"/></g>',
      hand:'<g class="lc lc-lantern"><path d="M76 84v5" stroke="#8C6418" stroke-width="1.4"/><path d="M71 89h10l-1.6-2.4h-6.8z" fill="#C99A2E"/><rect x="71.5" y="89" width="9" height="12" rx="3" fill="#E2B04A"/><rect x="73.5" y="91" width="5" height="8" rx="2" fill="#FFE8A3" class="lc-glow"/><path d="M71 101h10l-2 3h-6z" fill="#C99A2E"/></g>'
    },
    summer:{
      head:'<g class="lc"><rect x="27" y="45" width="21" height="13" rx="5.5" fill="#141414"/><rect x="52" y="45" width="21" height="13" rx="5.5" fill="#141414"/><path d="M48 49.5h4" stroke="#141414" stroke-width="2.6"/><path d="M31 48.5h7M56 48.5h7" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".45"/></g>',
      hand:'<g class="lc"><path d="M15 82 L21 98 L27 82Z" fill="#D9A15B"/><path d="M17 86l8-3M18 90l6-2" stroke="#B9813F" stroke-width="1"/><circle cx="21" cy="78" r="6" fill="#FF8FB1"/><circle cx="18" cy="74" r="4" fill="#FFF1D6"/></g>'
    }
  };
  const plainRicoFace = ricoFace;
  function dress(svg, th){
    const c = COSTUME[th];
    if(!c) return svg;
    let s = svg.replace('class="rico-bot ', `class="rico-bot lab-c-${th} `);
    if(c.back) s = s.replace('<g class="rb-all">', '<g class="rb-all">' + c.back);
    s = s.replace(/<\/g>(\s*)<\/g><\/svg>/, (all, ws) => (c.head || '') + '</g>' + ws + (c.hand || '') + '</g></svg>');
    return s;
  }
  window.ricoFace = function(mood, cls){
    const th = (typeof state !== 'undefined' && state.account) ? currentTheme() : null;
    return dress(plainRicoFace(mood, cls), th);
  };

  /* ---------- 3. Background decorations ---------- */
  const rnd = (a, b) => a + Math.random() * (b - a);
  const SVG = {
    ghost:'<svg viewBox="0 0 50 60"><path d="M5 25a20 20 0 0 1 40 0v30l-6.7-5-6.6 5-6.7-5-6.7 5-6.6-5L5 55z" fill="#fff"/><circle cx="18" cy="24" r="3.5" fill="#2B1B3D"/><circle cx="32" cy="24" r="3.5" fill="#2B1B3D"/><ellipse cx="25" cy="34" rx="4" ry="5" fill="#2B1B3D"/></svg>',
    bat:'<svg viewBox="0 0 60 26"><path d="M30 8c2-4 5-4 6 0 6-6 14-6 24 2-6 0-9 4-10 9-3-4-7-4-9 0-2-3-5-4-7-2-1-3-3-3-4-3s-3 0-4 3c-2-2-5-1-7 2-2-4-6-4-9 0-1-5-4-9-10-9 10-8 18-8 24-2 1-4 4-4 6 0z" fill="#2B1B3D"/></svg>',
    pumpkin:'<svg viewBox="0 0 64 58"><path d="M32 12c-1-6 2-10 7-10" stroke="#3B6B2A" stroke-width="4" fill="none" stroke-linecap="round"/><ellipse cx="20" cy="34" rx="16" ry="20" fill="#D9691A"/><ellipse cx="44" cy="34" rx="16" ry="20" fill="#D9691A"/><ellipse cx="32" cy="34" rx="14" ry="22" fill="#F28C28"/><g class="face" fill="#FFD36B"><path d="M19 27l7 6h-9z"/><path d="M45 27l-7 6h9z"/><path d="M18 41q14 10 28 0l-4 3-3-2-4 3-3-3-4 3-3-3-4 2z"/></g></svg>',
    web:'<svg viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M0 0L120 18M0 0L108 66M0 0L70 108M0 0L18 120"/><path d="M30 4.5Q24 12 27 16.5Q19 22 17 27Q10 28 4.5 30"/><path d="M60 9Q48 24 54 33Q38 44 35 54Q22 56 9 60"/><path d="M90 13.5Q72 36 81 49.5Q57 66 52 80Q33 84 13.5 90"/></svg>',
    moon:'<svg viewBox="0 0 84 84"><circle cx="42" cy="42" r="40" fill="#F6B25A"/><circle cx="30" cy="30" r="7" fill="#E89A3C" opacity=".6"/><circle cx="54" cy="50" r="10" fill="#E89A3C" opacity=".5"/><circle cx="50" cy="22" r="4" fill="#E89A3C" opacity=".6"/></svg>',
    flower:'<svg viewBox="0 0 40 72"><path d="M20 30V72" stroke="#3E8E4A" stroke-width="3"/><path d="M20 58q-14-6-16-20q12 6 16 20" fill="#4FA35B"/>' + [0,60,120,180,240,300].map(a=>`<ellipse cx="20" cy="13" rx="5" ry="9" fill="#fff" transform="rotate(${a} 20 22)"/>`).join('') + '<circle cx="20" cy="22" r="6" fill="#FEBD11"/><circle cx="20" cy="22" r="3" fill="#F28C28"/></svg>',
    lantern:'<svg viewBox="0 0 30 120"><path d="M15 0V48" stroke="#B8902F" stroke-width="1.2"/><path d="M9 48h12l3 6H6z" fill="#C99A2E"/><path d="M6 54h18l-2 30H8z" fill="#E2B04A"/><path d="M10 58h10l-1.5 22h-7z" fill="#FFE29A" class="glow"/><path d="M8 84h14l-4 8h-6z" fill="#C99A2E"/><circle cx="15" cy="96" r="2" fill="#C99A2E"/></svg>',
    crescent:'<svg viewBox="0 0 64 64"><path d="M42 6a28 28 0 1 0 16 46A24 24 0 1 1 42 6z" fill="#E2B04A"/><path d="M52 16l1.8 4.6 4.9.4-3.8 3.1 1.2 4.8-4.1-2.7-4.1 2.7 1.2-4.8-3.8-3.1 4.9-.4z" fill="#F2C96A"/></svg>',
    star:'<svg viewBox="0 0 12 12"><path d="M6 0l1.5 4.5L12 6 7.5 7.5 6 12 4.5 7.5 0 6l4.5-1.5z" fill="#E2B04A"/></svg>',
    cloud:'<svg viewBox="0 0 110 44"><path d="M20 40a14 14 0 0 1 4-27 20 20 0 0 1 37-5 16 16 0 0 1 26 10 12 12 0 0 1 3 22z" fill="#fff"/></svg>',
    mountains:'<svg viewBox="0 0 1200 200" preserveAspectRatio="xMidYMax slice"><path d="M0 200V120l120-60 90 50 140-90 120 80 90-40 160 90 110-70 140 60 120-50 110 40V200Z" fill="currentColor"/><path d="M0 200V160l160-30 140 25 180-40 160 40 200-30 180 30 180-20V200Z" fill="currentColor" opacity=".6"/></svg>'
  };
  function kurdSun(r1, r2, color){
    let d = '';
    for(let i = 0; i < 21; i++){
      const a = i / 21 * Math.PI * 2, w = Math.PI / 21 * .55;
      const p = (ang, r) => `${(100 + Math.cos(ang) * r).toFixed(1)} ${(100 + Math.sin(ang) * r).toFixed(1)}`;
      d += `M${p(a - w, r1)}L${p(a, r2)}L${p(a + w, r1)}Z`;
    }
    return `<svg viewBox="0 0 200 200"><path d="${d}" fill="${color}"/><circle cx="100" cy="100" r="${r1}" fill="${color}"/></svg>`;
  }
  function citadel(){
    const top = 'M300 162V112h22v-8h40v12h30v-16h46v10h38v-14h52v8h32V60h16V40h44v20h16v44h34v-12h44v10h40v-16h46v14h34v-8h40v12h30v-6h24v58';
    const windows = [330,372,410,452,490,540,672,712,756,800,846,884].map((x,i)=>`M${x} ${i%2?126:132}h8v10h-8z`).join('');
    return `<svg viewBox="0 0 1200 240" preserveAspectRatio="xMidYMax slice">
      <path fill="currentColor" fill-rule="evenodd" d="M0 240V214C140 206 230 192 290 160H920C980 192 1060 206 1200 214V240Z ${top}Z M584 162V132a14 14 0 0 1 28 0V162Z ${windows}"/>
      <path d="${top}" fill="none" stroke="#fff" stroke-width="6" stroke-linejoin="round"/>
      <path d="M150 211C220 202 260 188 290 160H920C950 188 990 202 1060 211" fill="none" stroke="#fff" stroke-width="5"/>
      <rect x="597" y="2" width="3" height="40" fill="currentColor"/>
      <rect x="600" y="4" width="34" height="7" fill="#ED2024"/><rect x="600" y="11" width="34" height="7" fill="#fff"/><rect x="600" y="18" width="34" height="7" fill="#278E43"/><circle cx="617" cy="14.5" r="3.4" fill="#FEBD11"/>
    </svg>`;
  }
  function buildDeco(th){
    let el = document.getElementById('labDeco');
    if(!el){ el = document.createElement('div'); el.id = 'labDeco'; el.setAttribute('aria-hidden','true'); document.body.insertBefore(el, document.getElementById('app')); }
    el.dataset.theme = th || '';
    let h = '';
    if(th === 'halloween'){
      h += `<div class="ld-web">${SVG.web}</div><div class="ld-moon">${SVG.moon}</div>`;
      h += `<div class="ld-ghost" style="top:22%;animation-duration:28s">${SVG.ghost}</div><div class="ld-ghost" style="top:58%;width:34px;animation-duration:36s;animation-delay:-17s">${SVG.ghost}</div>`;
      h += `<div class="ld-bat" style="top:30%">${SVG.bat}</div><div class="ld-bat" style="top:16%;width:24px;animation-duration:25s;animation-delay:-9s">${SVG.bat}</div>`;
      h += `<div class="ld-pumpkin" style="left:10px">${SVG.pumpkin}</div><div class="ld-pumpkin" style="right:12px;width:44px">${SVG.pumpkin}</div>`;
    } else if(th === 'winter'){
      h += `<div class="ld-citadel">${citadel()}</div>`;
      for(let i = 0; i < 28; i++){
        const s = rnd(3, 8).toFixed(1);
        h += `<i class="ld-flake" style="left:${rnd(0,100).toFixed(1)}%;width:${s}px;height:${s}px;opacity:${rnd(.45,.95).toFixed(2)};--dx:${rnd(-40,40).toFixed(0)}px;animation-duration:${rnd(9,19).toFixed(1)}s;animation-delay:-${rnd(0,19).toFixed(1)}s"></i>`;
      }
    } else if(th === 'newroz'){
      h += `<div class="ld-strip"></div><div class="ld-sun">${kurdSun(40, 96, '#FEBD11')}</div>`;
      h += `<div class="ld-flag"><svg viewBox="0 0 64 44"><rect x="0" y="0" width="2.5" height="44" fill="#6B4A2B"/><g class="cloth"><rect x="2.5" y="2" width="58" height="11" fill="#ED2024"/><rect x="2.5" y="13" width="58" height="11" fill="#fff"/><rect x="2.5" y="24" width="58" height="11" fill="#278E43"/><g transform="translate(23.5 10.5) scale(.08)">${kurdSun(40, 96, '#FEBD11').replace(/<\/?svg[^>]*>/g,'')}</g></g></svg></div>`;
      h += `<div class="ld-flower" style="left:10px">${SVG.flower}</div><div class="ld-flower" style="left:44px;width:30px;animation-delay:-1.3s">${SVG.flower}</div><div class="ld-flower" style="right:16px;width:34px;animation-delay:-2.1s">${SVG.flower}</div>`;
    } else if(th === 'ramadan'){
      h += `<div class="ld-crescent">${SVG.crescent}</div>`;
      for(let i = 0; i < 8; i++) h += `<div class="ld-star" style="top:${rnd(6,42).toFixed(0)}%;left:${rnd(4,96).toFixed(0)}%;width:${rnd(8,14).toFixed(0)}px;animation-delay:-${rnd(0,3).toFixed(1)}s">${SVG.star}</div>`;
      h += `<div class="ld-lantern" style="left:7%">${SVG.lantern}</div><div class="ld-lantern" style="left:22%;width:22px;animation-delay:-1.6s">${SVG.lantern}</div><div class="ld-lantern" style="right:24%;width:26px;animation-delay:-3s">${SVG.lantern}</div>`;
    } else if(th === 'summer'){
      h += `<div class="ld-bigsun">${kurdSun(44, 90, '#FFB547').replace('<circle cx="100" cy="100" r="44" fill="#FFB547"/>','<circle cx="100" cy="100" r="46" fill="#FFC562"/>')}</div><div class="ld-mountains">${SVG.mountains}</div>`;
      h += `<div class="ld-cloud" style="top:14%">${SVG.cloud}</div><div class="ld-cloud" style="top:30%;width:76px;animation-duration:95s;animation-delay:-40s">${SVG.cloud}</div>`;
    }
    el.innerHTML = h;
  }
  const decoOn = () => lsGet('ricottaLab:deco', true) !== false;
  const applyDecoPref = () => document.documentElement.classList.toggle('lab-deco-off', !decoOn());

  /* ---------- 4. Rico's moment: he pops up from the corner ---------- */
  const JINGLE = {
    halloween:[[392,0,.5],[370,.22,.5],[349,.44,.5],[294,.66,.9]],
    winter:[[1568,0,.35],[1760,.1,.35],[2093,.2,.5],[1760,.32,.6]],
    newroz:[[587,0,.22],[659,.14,.22],[784,.28,.22],[659,.42,.22],[880,.56,.5]],
    ramadan:[[523,0,.9],[659,.32,.9],[784,.64,1.2]],
    summer:[[784,0,.3],[988,.12,.3],[1175,.24,.5]]
  };
  function jingle(th){
    try{
      if(typeof soundTone !== 'function') return;
      if(typeof soundOn === 'function' && !soundOn('sent') && !soundOn('qty')) return;
      for(const [f, at, dur] of (JINGLE[th] || [])) soundTone(f, dur, .14, at);
    }catch(_){}
  }
  let peekTimer = null;
  function ricoMoment(th){
    th = th || currentTheme();
    const words = RICO[th];
    if(!words || !state.account) return;
    document.querySelector('.lab-peek')?.remove();
    clearTimeout(peekTimer);
    const lg = L();
    const el = document.createElement('div');
    el.className = 'lab-peek' + (th === 'halloween' ? ' scare' : '');
    el.setAttribute('role', 'status');
    const sheet = th === 'halloween' ? `<div class="sheet">${SVG.ghost}</div>` : '';
    const firstMood = th === 'halloween' ? 'angry' : th === 'winter' ? 'worried' : th === 'ramadan' ? 'calm' : 'excited';
    el.innerHTML = `<div class="lab-ghost">${ricoFace(firstMood, '')}${sheet}</div><div class="lab-peek-bubble" dir="${lg === 'en' ? 'ltr' : 'rtl'}">${escH(words.peek[lg])}${th === 'halloween' ? '' : `<small>${escH(words.peek2[lg])}</small>`}</div>`;
    document.body.appendChild(el);
    jingle(th);
    if(th === 'halloween'){
      setTimeout(()=>{
        if(!el.isConnected) return;
        const bot = el.querySelector('.rico-bot');
        if(bot) bot.outerHTML = ricoFace('excited', '');
        el.querySelector('.lab-peek-bubble').innerHTML = `${escH(words.peek[lg])}<small>${escH(words.peek2[lg])}</small>`;
      }, 2000);
    }
    const close = ()=>{ el.classList.add('out'); setTimeout(()=>el.remove(), 360); };
    el.addEventListener('click', close);
    peekTimer = setTimeout(close, th === 'halloween' ? 8000 : 6500);
  }
  setInterval(()=>{
    if(document.visibilityState === 'visible' && state.account && isSpecial(currentTheme()) && !document.querySelector('.lab-panel') && decoOn()) ricoMoment();
  }, 4 * 60 * 1000);

  /* ---------- 5. Follow every theme change the app makes ---------- */
  let lastTheme = null;
  function onTheme(){
    const th = state.account ? currentTheme() : null;
    if(th === lastTheme) return;
    const first = lastTheme === null;
    lastTheme = th;
    buildDeco(isSpecial(th) ? th : null);
    if(isSpecial(th)){
      setTimeout(()=>{ if(typeof ricoRefreshInbox === 'function') ricoRefreshInbox(); }, 900);
      setTimeout(()=>{ if(currentTheme() === th && decoOn()) ricoMoment(th); }, first ? 3200 : 900);
    }
    if(!first) setTimeout(()=>render(), 0);
    paintPanel();
  }
  const plainApplyTheme = applyTheme;
  window.applyTheme = function(){ plainApplyTheme(); onTheme(); };
  const plainRender = render;
  window.render = function(){ const r = plainRender.apply(this, arguments); onTheme(); return r; };
  /* ---------- 6. WhatsApp: show the message instead of leaving the Lab ---------- */
  let toastTimer = null;
  function labToast(text){
    document.querySelector('.lab-toast')?.remove();
    const el = document.createElement('div');
    el.className = 'lab-toast'; el.setAttribute('role', 'status'); el.textContent = text;
    document.body.appendChild(el);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(()=>el.remove(), 4800);
    el.addEventListener('click', ()=>el.remove());
  }
  document.addEventListener('click', e=>{
    const a = e.target.closest && e.target.closest('a[href^="https://wa.me/"]');
    if(!a) return;
    e.preventDefault();
    let msg = '';
    try{ msg = new URL(a.href).searchParams.get('text') || ''; }catch(_){}
    labToast('In the real app WhatsApp opens here with:\n\n' + msg);
  }, true);

  /* ---------- 7. The Lab panel ---------- */
  const INFO = {
    halloween:{t:'Halloween', d:'Ghosts drift by, bats fly past and pumpkins glow. Rico wears a witch hat and cape and tries to scare you.'},
    winter:{t:'Winter Citadel', d:'Snow falls over Erbil Citadel. Rico wears a hat and scarf, shivers, and you can see his breath.'},
    newroz:{t:'Newroz', d:'Kurdish flag colours and the 21-ray sun. Rico wears a flower crown, waves the flag and dances the govend.'},
    ramadan:{t:'Ramadan Nights', d:'A crescent moon, stars and swinging lanterns. Rico carries a lantern and reminds you about iftar.'},
    summer:{t:'Shaqlawa Summer', d:'Sun over the mountains. Rico wears sunglasses, holds an ice cream and sweats in the heat.'}
  };
  const IDEAS = [
    ['usual','Fill my usual order','One tap fills each item with its normal amount, learned from past orders.'],
    ['export','Save the month before it is deleted','History is wiped at the start of every month. Rico reminds you and makes a PDF or Excel file first.'],
    ['undo','Undo after sending','A few seconds to take back an order sent by mistake.'],
    ['delivery','Delivery check','Tick each item when it arrives and mark anything short or missing.'],
    ['spend','Prices and monthly spend','See what today’s order costs and what each supplier got this month.'],
    ['approval','Approval before sending','Yunis prepares the order, Rozha approves it with one tap.'],
    ['dark','Dark mode','Easier on the eyes at night. Can follow the phone’s setting.'],
    ['kitchen','Kitchen mode','Bigger buttons and text for wet hands or gloves.'],
    ['favorites','Pinned items','Items you order every day sit at the top.'],
    ['search','Search every item','Type in English, Kurdish or Arabic, across all suppliers.'],
    ['notes','Notes on items','A short note in the WhatsApp message, like “ripe, not soft”.'],
    ['holidays','Supplier days off and holidays','Reminders skip closed days, including Eid.'],
    ['voice','Order by voice','Say the order to Rico and it fills itself.'],
    ['closing','Rico’s closing summary','At closing time: what was ordered, what’s missing, what’s due tomorrow.'],
    ['autotheme','Themes switch on by themselves','Halloween in late October, Newroz on 21 March, Ramadan and winter on their dates, then back to your normal theme.'],
    ['weekday','Weekday templates','A different usual order for each day of the week.'],
    ['invoice','Invoice photo','Keep a photo of the supplier’s invoice with the order.'],
    ['backup','Weekly backup','Copy orders and the catalog somewhere safe every week.']
  ];
  let picks = Object.assign({ideas:{}, themes:{}, notes:''}, lsGet('ricottaLab:picks', {}));
  let db = null, panelOpen = false, saveTimer = null, status = {text:'', ok:false};

  const fab = document.createElement('button');
  fab.className = 'lab-fab'; fab.type = 'button'; fab.innerHTML = '<i></i>LAB';
  fab.setAttribute('aria-label', 'Open Ricotta Lab');
  document.body.appendChild(fab);
  fab.addEventListener('click', ()=>{ panelOpen = true; paintPanel(); });

  const ratedNames = (map, v, names) => Object.entries(map).filter(([,x])=>x===v).map(([k])=>names(k)).filter(Boolean);
  const themeName = k => INFO[k]?.t;
  const ideaName = k => (IDEAS.find(i=>i[0]===k) || [])[1];
  function summary(){
    const list = (label, arr) => label + ':\n' + (arr.length ? arr.map(x=>'- '+x).join('\n') : '- none') + '\n';
    let s = 'Ricotta Lab picks\n\n';
    s += list('Special themes I love', ratedNames(picks.themes, 'love', themeName));
    s += list('Special themes to skip', ratedNames(picks.themes, 'skip', themeName));
    s += '\n' + list('Ideas I love', ratedNames(picks.ideas, 'love', ideaName));
    s += list('Maybe later', ratedNames(picks.ideas, 'maybe', ideaName));
    if(picks.notes.trim()) s += '\nMy notes:\n' + picks.notes.trim() + '\n';
    return s;
  }
  function changed(){
    lsSet('ricottaLab:picks', picks);
    status = {text: db ? 'Unsaved changes' : 'Kept on this device', ok:false};
    clearTimeout(saveTimer);
    if(db) saveTimer = setTimeout(()=>save(false), 2500);
  }
  async function save(manual){
    clearTimeout(saveTimer);
    if(!db){ status = {text: manual ? 'Saving for Claude isn’t available here. Use Copy as text.' : 'Kept on this device', ok:false}; paintStatus(); return; }
    try{
      status = {text:'Saving…', ok:false}; paintStatus();
      await db.doc('picks/latest').set({
        summary: summary(),
        themesLoved: ratedNames(picks.themes,'love',themeName), themesSkipped: ratedNames(picks.themes,'skip',themeName),
        loved: ratedNames(picks.ideas,'love',ideaName), maybe: ratedNames(picks.ideas,'maybe',ideaName), skipped: ratedNames(picks.ideas,'skip',ideaName),
        notes: picks.notes, state: JSON.parse(JSON.stringify(picks)), updatedAt: new Date().toISOString()
      });
      status = {text:'Saved for Claude at ' + new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}), ok:true};
    }catch(err){ status = {text:'Could not save. Try again in a moment.', ok:false}; }
    paintStatus();
  }
  function paintStatus(){ const el = document.getElementById('labStatus'); if(el){ el.textContent = status.text; el.classList.toggle('ok', status.ok); } }
  const rateBtns = (kind, id, opts) => opts.map(([v, label])=>`<button type="button" class="lab-btn" data-v="${v}" data-rate="${kind}:${id}" aria-pressed="${(kind==='t' ? picks.themes : picks.ideas)[id] === v}">${label}</button>`).join('');
  const iconFor = th => ({halloween:SVG.pumpkin, winter:'<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M12 2v20M3.3 7l17.4 10M20.7 7L3.3 17M9 4l3 3 3-3M9 20l3-3 3 3"/></svg>', newroz:kurdSun(40, 96, '#FEBD11'), ramadan:SVG.crescent, summer:kurdSun(44, 90, '#FFB547')})[th];

  function paintPanel(){
    document.querySelector('.lab-scrim')?.remove();
    document.querySelector('.lab-panel')?.remove();
    fab.hidden = panelOpen;
    if(!panelOpen) return;
    const cur = state.account ? currentTheme() : null;
    const who = state.account === 'yunis' ? 'Yunis' : 'Rozha';
    const scrim = document.createElement('div'); scrim.className = 'lab-scrim';
    const p = document.createElement('aside'); p.className = 'lab-panel'; p.setAttribute('aria-label', 'Ricotta Lab');
    p.innerHTML = `<div class="lab-head"><b>Ricotta<i></i><span>Lab</span></b><button type="button" class="lab-x" data-lab="close" aria-label="Close">×</button></div>
    <div class="lab-body">
      <div class="lab-sec"><p>This is your real app, the same code as the repository, running on sample data. Nothing here touches the real kitchen. ${state.account ? `You are signed in as <b>${who}</b>.` : 'Type any 6 digits to sign in as Rozha, or 222222 for Yunis.'}</p>
        <div class="lab-acts">${state.account ? `<button type="button" class="lab-btn" data-lab="switch">Switch to ${who === 'Rozha' ? 'Yunis' : 'Rozha'}</button>` : ''}<button type="button" class="lab-btn" data-lab="reset">Reset sample data</button></div></div>
      <div class="lab-sec"><h3>Special themes</h3><p>Each one changes the colours, adds a few quiet decorations and dresses Rico up. They are also in Settings › Appearance, next to your five themes.</p>
        ${SPECIAL.map(th=>`<div class="lab-th ${cur===th?'cur':''}"><div class="lab-sw" style="background:linear-gradient(150deg,${LOOK[th].swatch[0]},${LOOK[th].swatch[0]} 50%,${LOOK[th].swatch[1]} 160%)"><span style="width:30px;height:30px;display:block">${iconFor(th)}</span></div>
          <div class="lab-th-t"><b>${escH(INFO[th].t)}</b><span>${escH(INFO[th].d)}</span>
          <div class="lab-acts">${cur===th ? `<button type="button" class="lab-btn pri" data-lab="moment">Rico’s moment</button>` : `<button type="button" class="lab-btn pri" data-use="${th}">Try it</button>`}${rateBtns('t', th, [['love','Love it'],['skip','Skip']])}</div></div></div>`).join('')}
        <div class="lab-acts"><button type="button" class="lab-btn" data-use="ricotta">Back to Ricotta green</button></div>
        <label class="lab-row"><span>Background decorations</span><input type="checkbox" id="labDecoOn" ${decoOn()?'checked':''}></label></div>
      <div class="lab-sec"><h3>New feature ideas</h3><p>Not built yet. Rate them and I’ll build the ones you love into the real app.</p>
        ${IDEAS.map(([id, t, d])=>`<div class="lab-idea"><b>${escH(t)}</b><span>${escH(d)}</span><div class="lab-acts">${rateBtns('i', id, [['love','Love it'],['maybe','Maybe'],['skip','Skip']])}</div></div>`).join('')}</div>
      <div class="lab-sec"><h3>Notes for Claude</h3><textarea class="lab-notes" id="labNotes" placeholder="For example: Halloween but fewer bats. Winter snow only on the Order screen.">${escH(picks.notes)}</textarea>
        <div class="lab-acts"><button type="button" class="lab-btn pri" data-lab="save">Save my picks</button><button type="button" class="lab-btn" data-lab="copy">Copy as text</button></div>
        <span class="lab-status" id="labStatus"></span>
        <p>After saving, tell Claude “read my Ricotta Lab picks”.</p></div>
    </div>`;
    document.body.append(scrim, p);
    paintStatus();
    scrim.addEventListener('click', ()=>{ panelOpen = false; paintPanel(); });
    p.addEventListener('click', e=>{
      const b = e.target.closest('button'); if(!b) return;
      if(b.dataset.lab === 'close'){ panelOpen = false; paintPanel(); fab.focus(); return; }
      if(b.dataset.lab === 'moment'){ panelOpen = false; paintPanel(); ricoMoment(); return; }
      if(b.dataset.lab === 'save'){ save(true); return; }
      if(b.dataset.lab === 'copy'){
        const text = summary();
        const fallback = ()=>{ const ta = document.createElement('textarea'); ta.className = 'lab-copy'; ta.value = text; ta.readOnly = true; b.closest('.lab-sec').appendChild(ta); ta.focus(); ta.select(); status = {text:'Selected. Press Cmd+C to copy.', ok:false}; paintStatus(); };
        try{ navigator.clipboard.writeText(text).then(()=>{ status = {text:'Copied', ok:true}; paintStatus(); }, fallback); }catch(_){ fallback(); }
        return;
      }
      if(b.dataset.lab === 'reset'){ window.labResetData(); location.reload(); return; }
      if(b.dataset.lab === 'switch'){
        const next = state.account === 'yunis' ? 'rozha' : 'yunis';
        try{ localStorage.setItem('ricottaOrders:apiSession', JSON.stringify({token:'lab-'+next, account:next, name:next==='yunis'?'Yunis':'Rozha', tabs:['order','assistant','history'], expiresAt:new Date(Date.now()+18*3600000).toISOString()})); }catch(_){}
        location.reload(); return;
      }
      if(b.dataset.use){
        if(!state.account){ labToast('Sign in first: type any 6 digits.'); return; }
        panelOpen = false;
        setTheme(b.dataset.use); render(); paintPanel();
        return;
      }
      if(b.dataset.rate){
        const [kind, id] = b.dataset.rate.split(':'), v = b.dataset.v, map = kind === 't' ? picks.themes : picks.ideas;
        if(map[id] === v) delete map[id]; else map[id] = v;
        b.parentElement.querySelectorAll('[data-rate]').forEach(x=>x.setAttribute('aria-pressed', map[id] === x.dataset.v));
        changed(); paintStatus();
      }
    });
    p.querySelector('#labNotes').addEventListener('input', e=>{ picks.notes = e.target.value; changed(); paintStatus(); });
    p.querySelector('#labDecoOn').addEventListener('change', e=>{ lsSet('ricottaLab:deco', e.target.checked); applyDecoPref(); });
  }
  document.addEventListener('keydown', e=>{ if(e.key === 'Escape' && panelOpen){ panelOpen = false; paintPanel(); } });

  /* Saved picks live in the artifact's database, so Claude can read them. */
  (async ()=>{
    try{
      db = await window.claude?.use?.('db') || null;
      if(!db) return;
      const snap = await db.doc('picks/latest').get();
      const d = snap.exists ? snap.data() : null;
      if(d && d.state){
        picks = {ideas:{...(d.state.ideas || {})}, themes:{...(d.state.themes || {})}, notes:String(d.state.notes || d.notes || '')};
        lsSet('ricottaLab:picks', picks);
        status = {text:'Your saved picks are loaded', ok:true};
      } else status = {text:'Ready to save', ok:true};
      if(panelOpen) paintPanel();
    }catch(_){ db = null; }
  })();

  applyDecoPref();
  render();
})();
