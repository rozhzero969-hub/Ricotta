/* Ricotta for Mac: the themes' living artwork (style.css, "Mac themes").
   Only inside the Mac app (html.mac-shell) with a theme other than Ricotta's own; browsers, phones and the
   iPhone app never get html.mac-shell, so this file does nothing there.
   - A quiet layer of drawings sits behind the whole page (#macDecor, z-index -1, pointer-events none): it
     shows in the page's empty space and through the see-through window, never over text or controls.
   - Moving parts use transform and opacity only. Rare moments (bats, a shooting star) come every minute or
     so, never constantly. Everything stops while the window is hidden, and Reduce Motion keeps the drawings
     still (style.css) and skips the moments here.
   - Two small celebrations: when every order is sent (window.macThemeFx('sent'), from maybeFinishQueue) and
     when + is pressed on an item (Cupid's hearts, Google's ripple).
   Depends on nothing else in the app. */
(function(){
  const root = document.documentElement;
  const THEMES = ['halloween','christmas','moonlit','google','pink'];
  const theme = ()=> root.classList.contains('mac-shell') ? THEMES.find(n=>root.classList.contains('theme-' + n)) || '' : '';
  const still = ()=> !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const rand = (a, b)=> a + Math.random() * (b - a);
  const svg = (box, body, fit = '')=> `<svg viewBox="${box}"${fit ? ` preserveAspectRatio="${fit === true ? 'none' : fit}"` : ''} aria-hidden="true">${body}</svg>`;

  /* ---------- The drawings ---------- */
  const STAR4 = 'M12 0c.9 7.3 4.7 11.1 12 12-7.3.9-11.1 4.7-12 12-.9-7.3-4.7-11.1-12-12 7.3-.9 11.1-4.7 12-12Z';
  const HEART = 'M12 21.3C10.3 20 2 14.3 2 8.6A5.2 5.2 0 0 1 12 6.4a5.2 5.2 0 0 1 10 2.2c0 5.7-8.3 11.4-10 12.7Z';
  const BAT = 'M30 12c-1.6-2.4-1-5 .4-6.4.4 1.4 1.3 2.1 2.6 2.2 1.3-.1 2.2-.8 2.6-2.2 1.4 1.4 2 4 .4 6.4 3.4-3.6 9.8-5.8 17-4.6-3.6 1.1-5.6 3.6-5.6 6.9-2.8-1.5-5.8-1.3-7.5.9-1.9-1.4-4.2-1.3-5.3.6-1.1-.9-1.9-1.4-2.6-1.4s-1.5.5-2.6 1.4c-1.1-1.9-3.4-2-5.3-.6-1.7-2.2-4.7-2.4-7.5-.9 0-3.3-2-5.8-5.6-6.9 7.2-1.2 13.6 1 17 4.6Z';
  // A seeded scatter, so the stars sit in the same places each time the theme opens.
  function scatter(n, seed){
    let s = seed; const next = ()=> (s = (s * 9301 + 49297) % 233280) / 233280;
    return Array.from({length:n}, ()=>({x:next(), y:next(), r:next(), d:next()}));
  }
  const stars = (n, seed, maxY)=> scatter(n, seed).map(p=>`<i class="fx-star" style="left:${(p.x * 100).toFixed(2)}%;top:${(p.y * maxY).toFixed(2)}%;--s:${(.5 + p.r * .9).toFixed(2)};--d:${(5 + p.d * 7).toFixed(1)}s;--w:${(-p.d * 9).toFixed(1)}s">${svg('0 0 24 24', `<path d="${STAR4}"/>`)}</i>`).join('');
  const moon = (cls, full)=> `<div class="fx-moon ${cls}">${svg('0 0 200 200', `
      <defs><radialGradient id="fxMoonFace" cx=".38" cy=".34" r=".75"><stop offset="0" stop-color="var(--moon-hi)"/><stop offset="1" stop-color="var(--moon-lo)"/></radialGradient>
      <radialGradient id="fxMoonHalo"><stop offset=".45" stop-color="var(--moon-glow)" stop-opacity=".5"/><stop offset="1" stop-color="var(--moon-glow)" stop-opacity="0"/></radialGradient>
      <mask id="fxMoonCut"><rect width="200" height="200" fill="#fff"/>${full ? '' : '<circle cx="128" cy="84" r="52" fill="#000"/>'}</mask></defs>
      <circle cx="100" cy="100" r="98" fill="url(#fxMoonHalo)"/>
      <g mask="url(#fxMoonCut)"><circle cx="100" cy="100" r="54" fill="url(#fxMoonFace)"/>
      <g fill="var(--moon-lo)" opacity=".55"><circle cx="82" cy="88" r="9"/><circle cx="110" cy="122" r="12"/><circle cx="76" cy="122" r="5"/><circle cx="118" cy="80" r="5"/></g></g>`)}</div>`;

  const SCENES = {
    halloween:()=> `<div class="fx-sky"></div>
      ${moon('fx-hw-moon', true)}
      <div class="fx-clouds"></div>
      <div class="fx-hills">${svg('0 0 1200 220', '<path d="M0 220V158c90-30 180-44 270-32 80-30 170-46 250-30 90-26 190-30 290-8 70-24 160-32 230-18 70 2 120 12 160 24V220Z"/><path d="M140 132l-3-34m3 18 12-10m-12 2-10-9M930 110l-2-30m2 14 10-8m-10 1-8-7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>', 'xMidYMax slice')}</div>
      <div class="fx-fog fx-fog-a"></div><div class="fx-fog fx-fog-b"></div>`,
    christmas:()=> `<div class="fx-sky"></div>
      <div class="fx-snow fx-snow-far"></div><div class="fx-snow fx-snow-mid"></div><div class="fx-snow fx-snow-near"></div>
      <div class="fx-drift">${svg('0 0 1200 120', '<path d="M0 120V70c120-30 260-34 400-10 140-28 300-34 440-6 120-22 250-20 360 2v64Z"/>', true)}</div>
      <div class="fx-lights">${lights()}</div>`,
    moonlit:()=> `<div class="fx-sky"></div>
      <div class="fx-stars">${stars(26, 7, 62)}</div>
      ${moon('fx-mo-moon', false)}
      <div class="fx-shoot"><i></i></div>
      <div class="fx-hills">${svg('0 0 1200 160', '<path d="M0 160V112c140-44 300-60 460-30 160-40 320-46 470-12 110-14 200-6 270 10v80Z"/>', true)}</div>`,
    google:()=> '',
    pink:()=> `<div class="fx-sky"></div>
      <div class="fx-hearts">${scatter(9, 3).map((p, i)=>`<i class="fx-heart" style="left:${(4 + p.x * 92).toFixed(1)}%;--s:${(.55 + p.r * .8).toFixed(2)};--d:${(34 + p.d * 26).toFixed(1)}s;--w:${(-p.y * 50).toFixed(1)}s;--x:${(p.r * 40 - 20).toFixed(0)}px;--o:${i % 3 ? .55 : .8}">${svg('0 0 24 24', `<path d="${HEART}"/>`)}</i>`).join('')}</div>
      <div class="fx-petals">${svg('0 0 1200 140', '<path d="M0 140V96c160-30 330-40 520-16 180-26 360-30 520-4 70 10 120 18 160 24v40Z"/>', true)}</div>`
  };
  // Christmas: a strand of warm lights hanging in soft loops along the top of the page.
  function lights(){
    const n = 28, w = 1600, colors = ['#FFD36B','#FF6B6B','#7FD1A8','#FFD36B','#8EC5FF'];
    let wire = 'M0 6';
    const bulbs = Array.from({length:n}, (_, i)=>{
      const x0 = i * w / n, x1 = (i + 1) * w / n, mid = (x0 + x1) / 2, c = i % colors.length;
      wire += ` Q${mid} 30 ${x1} 6`;
      return `<g class="fx-bulb" style="--d:${(3.6 + (i * 7 % 5) * .55).toFixed(2)}s;--w:${(-(i * 1.7) % 4).toFixed(2)}s" transform="translate(${mid} 18)"><circle class="fx-glow" cy="3" r="13" fill="url(#fxGlow${c})"/><path d="M-2.6 -4h5.2v3h-5.2z" fill="#4d5a52"/><ellipse cy="4" rx="3.6" ry="5.2" fill="${colors[c]}"/><ellipse cx="-1.2" cy="2" rx="1" ry="1.8" fill="#fff" opacity=".6"/></g>`;
    });
    const glows = colors.map((c, i)=>`<radialGradient id="fxGlow${i}"><stop offset="0" stop-color="${c}" stop-opacity=".85"/><stop offset=".45" stop-color="${c}" stop-opacity=".3"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient>`).join('');
    return svg(`0 0 ${w} 40`, `<defs>${glows}</defs><path d="${wire}" fill="none" stroke="#3f5249" stroke-width="1.6" opacity=".8"/>${bulbs.join('')}`);
  }

  /* ---------- Building and pausing ---------- */
  let layer = null, shown = '', timer = 0;
  function build(){
    const th = theme();
    if(th === shown && (!th || layer?.isConnected)) return;
    shown = th; clearTimeout(timer); layer?.remove(); layer = null;
    if(!th || !SCENES[th] || !document.body) return;
    const html = SCENES[th]();
    if(html){
      layer = document.createElement('div');
      layer.id = 'macDecor'; layer.className = 'fx-' + th; layer.setAttribute('aria-hidden', 'true');
      layer.innerHTML = html;
      document.body.prepend(layer);
    }
    schedule(true);
  }
  // Pause every drawing while the window is hidden or minimised (WebKit reports it as a hidden page).
  function paused(){ root.classList.toggle('fx-paused', document.hidden); if(!document.hidden) schedule(false); }
  // The rare moments: bats on Halloween, a shooting star on Moonlit. First one soon, then every minute or so.
  function schedule(first){
    clearTimeout(timer);
    const th = theme();
    if(th !== 'halloween' && th !== 'moonlit') return;
    timer = setTimeout(()=>{ if(!document.hidden && !still() && theme() === th) (th === 'halloween' ? bats : shootingStar)(); schedule(false); },
      first ? rand(6000, 12000) : rand(45000, 90000));
  }
  function bats(){
    if(!layer) return;
    const flock = document.createElement('div');
    flock.className = 'fx-flock';
    const rtl = Math.random() < .5;
    flock.innerHTML = [0, 1, 2].slice(0, 2 + (Math.random() < .5)).map(i=>`<i class="fx-bat" style="--y:${(i * 18 + rand(-6, 6)).toFixed(0)}px;--x:${(i * 46).toFixed(0)}px;--f:${(.16 + i * .025).toFixed(3)}s;--sc:${(1 - i * .18).toFixed(2)}">${svg('0 0 66 24', `<path d="${BAT}"/>`)}</i>`).join('');
    flock.style.top = rand(10, 34).toFixed(0) + 'px';
    if(rtl) flock.classList.add('fx-rtl');
    layer.appendChild(flock);
    flock.addEventListener('animationend', e=>{ if(e.target === flock) flock.remove(); });
    setTimeout(()=>flock.remove(), 9000);
  }
  function shootingStar(){
    const s = layer?.querySelector('.fx-shoot');
    if(!s) return;
    s.style.setProperty('--sx', rand(30, 70).toFixed(0) + '%');
    s.style.setProperty('--sy', rand(4, 18).toFixed(0) + '%');
    s.classList.remove('go'); void s.offsetWidth; s.classList.add('go');
  }

  /* ---------- Celebrations ---------- */
  function burstLayer(){
    const box = document.createElement('div');
    box.className = 'fx-burst'; box.setAttribute('aria-hidden', 'true');
    document.body.appendChild(box);
    setTimeout(()=>box.remove(), 2600);
    return box;
  }
  const anchor = ()=> (document.querySelector('.queue-done, .order-hero') || document.body).getBoundingClientRect();
  // Celebrations start in the card's empty side (the end away from its text), never over the numbers.
  const side = (r, f = .28)=> root.classList.contains('rtl') ? r.left + r.width * f : r.right - r.width * f;
  function piece(box, cls, html, x, y, keyframes, ms, delay = 0){
    const el = document.createElement('i');
    el.className = cls; el.innerHTML = html;
    el.style.left = x + 'px'; el.style.top = y + 'px';
    box.appendChild(el);
    el.animate(keyframes, {duration:ms, delay, easing:'cubic-bezier(.23,1,.32,1)', fill:'both'});
    return el;
  }
  // Christmas: snow and a little gold and red confetti rise from the card and drift down.
  function snowBurst(){
    const box = burstLayer(), r = anchor(), cx = side(r), cy = r.top + Math.min(r.height, 140) / 2;
    const colors = ['#ffffff','#ffffff','#F4D58D','#E5484D','#ffffff','#BFE3CF'];
    for(let i = 0; i < 30; i++){
      const a = rand(-Math.PI * .9, -Math.PI * .1), d = rand(70, 200), c = colors[i % colors.length], flake = i % 3 === 0;
      const html = flake ? svg('0 0 24 24', `<path d="M12 1v22M2.5 6.5l19 11M2.5 17.5l19-11" stroke="${c}" stroke-width="2.4" stroke-linecap="round" fill="none"/>`) : `<b style="background:${c};border-radius:${i % 2 ? '50%' : '1.5px'}"></b>`;
      const dx = Math.cos(a) * d, dy = Math.sin(a) * d;
      piece(box, 'fx-bit' + (flake ? ' fx-flake' : ''), html, cx, cy, [
        {transform:'translate(-50%,-50%) scale(.4) rotate(0deg)', opacity:0},
        {transform:`translate(calc(-50% + ${dx * .7}px),calc(-50% + ${dy * .7}px)) scale(1) rotate(${rand(-90, 90)}deg)`, opacity:1, offset:.35},
        {transform:`translate(calc(-50% + ${dx}px),calc(-50% + ${dy + rand(160, 260)}px)) scale(.9) rotate(${rand(-240, 240)}deg)`, opacity:0}], rand(1500, 2100), rand(0, 120));
    }
  }
  // Cupid: a bow draws at the card's edge and lets an arrow fly; a heart opens where it lands.
  function cupidShot(){
    const box = burstLayer(), r = anchor(), y = r.top + Math.min(r.height, 160) / 2;
    const rtl = root.classList.contains('rtl'), x0 = side(r, .52), x1 = side(r, .2);
    const flip = rtl ? ' scale(-1,1)' : '';
    piece(box, 'fx-cupid-bow', svg('0 0 40 80', '<path d="M8 4c26 10 26 62 0 72" fill="none" stroke="#B8862E" stroke-width="5" stroke-linecap="round"/><path d="M8 4v72" stroke="#F7D9E4" stroke-width="1.5"/>'), x0, y,
      [{transform:`translate(-50%,-50%)${flip} scale(.8)`, opacity:0}, {transform:`translate(-50%,-50%)${flip}`, opacity:1, offset:.2}, {transform:`translate(-50%,-50%)${flip}`, opacity:1, offset:.7}, {transform:`translate(-50%,-50%)${flip} scale(.9)`, opacity:0}], 1300);
    piece(box, 'fx-cupid-arrow', svg('0 0 120 24', `<path d="M6 12h96" stroke="#B8862E" stroke-width="3.4" stroke-linecap="round"/><path d="M2 6l10 6-10 6M10 6l10 6-10 6" fill="none" stroke="#E58BAE" stroke-width="2.4" stroke-linejoin="round"/><path transform="translate(96 1) scale(.9)" d="${HEART}" fill="#E0457B"/>`), x0, y,
      [{transform:`translate(-20%,-50%)${flip}`, opacity:0}, {transform:`translate(-20%,-50%)${flip}`, opacity:1, offset:.18}, {transform:`translate(calc(-20% + ${x1 - x0}px),-50%)${flip}`, opacity:1, offset:.62}, {transform:`translate(calc(-20% + ${x1 - x0}px),-50%)${flip}`, opacity:0}], 1250, 120);
    for(let i = 0; i < 12; i++){
      const a = i / 12 * Math.PI * 2, d = rand(40, 90);
      piece(box, 'fx-bit fx-heartbit', svg('0 0 24 24', `<path d="${HEART}" fill="${['#E0457B','#F49AB8','#FFD1E1'][i % 3]}"/>`), x1, y, [
        {transform:'translate(-50%,-50%) scale(.3)', opacity:0},
        {transform:`translate(calc(-50% + ${Math.cos(a) * d * .6}px),calc(-50% + ${Math.sin(a) * d * .6}px)) scale(1)`, opacity:1, offset:.4},
        {transform:`translate(calc(-50% + ${Math.cos(a) * d}px),calc(-50% + ${Math.sin(a) * d + 30}px)) scale(.7)`, opacity:0}], 1100, 760);
    }
  }
  // Halloween and Moonlit: a short, soft rise of sparks (embers, or stars) from the card.
  function sparks(colors, path){
    const box = burstLayer(), r = anchor(), cx = side(r), cy = r.top + Math.min(r.height, 140) / 2;
    for(let i = 0; i < 18; i++){
      const dx = rand(-r.width * .18, r.width * .18), dy = rand(-160, -60);
      piece(box, 'fx-bit fx-spark', svg('0 0 24 24', `<path d="${path}" fill="${colors[i % colors.length]}"/>`), cx + rand(-40, 40), cy, [
        {transform:'translate(-50%,-50%) scale(.3)', opacity:0},
        {transform:`translate(calc(-50% + ${dx * .5}px),calc(-50% + ${dy * .5}px)) scale(1)`, opacity:1, offset:.3},
        {transform:`translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px)) scale(.5)`, opacity:0}], rand(1200, 1700), rand(0, 200));
    }
  }
  // Google: four coloured dots hop once, like Google's own loader.
  function googleDots(){
    const box = burstLayer(), r = anchor(), cx = side(r), cy = r.top + Math.min(r.height, 140) / 2;
    ['#4285F4','#EA4335','#FBBC05','#34A853'].forEach((c, i)=>{
      piece(box, 'fx-bit fx-gdot', `<b style="background:${c}"></b>`, cx + (i - 1.5) * 26, cy, [
        {transform:'translate(-50%,-50%) scale(.6)', opacity:0}, {transform:'translate(-50%,-50%)', opacity:1, offset:.15},
        {transform:'translate(-50%,calc(-50% - 22px))', opacity:1, offset:.35}, {transform:'translate(-50%,-50%)', opacity:1, offset:.55},
        {transform:'translate(-50%,calc(-50% - 10px))', opacity:1, offset:.7}, {transform:'translate(-50%,-50%) scale(.9)', opacity:0}], 1500, i * 90);
    });
  }
  function fx(kind, from){
    const th = theme();
    if(!th || still() || document.hidden) return;
    try{
      if(kind === 'sent'){
        if(th === 'christmas') snowBurst();
        else if(th === 'pink') cupidShot();
        else if(th === 'halloween') sparks(['#FFB347','#FF8A2B','#FFD36B'], 'M12 2c3 5 6 7 6 12a6 6 0 0 1-12 0c0-5 3-7 6-12Z');
        else if(th === 'moonlit') sparks(['#E8EEFF','#C9D6F2','#FFF3C4'], STAR4);
        else if(th === 'google') googleDots();
      } else if(kind === 'add' && from && th === 'pink') addHearts(from);
    }catch(_){ /* artwork never gets in the way of ordering */ }
  }
  // Cupid: three tiny hearts lift off the + button.
  function addHearts(btn){
    const box = burstLayer(), r = btn.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    for(let i = 0; i < 3; i++){
      const dx = (i - 1) * 14 + rand(-3, 3);
      piece(box, 'fx-bit fx-addheart', svg('0 0 24 24', `<path d="${HEART}" fill="${['#F49AB8','#E0457B','#FFC2D6'][i]}"/>`), cx, cy - 6, [
        {transform:'translate(-50%,-50%) scale(.4)', opacity:0}, {transform:`translate(calc(-50% + ${dx * .5}px),calc(-50% - 14px)) scale(1)`, opacity:1, offset:.35},
        {transform:`translate(calc(-50% + ${dx}px),calc(-50% - 34px)) scale(.8)`, opacity:0}], 560, i * 40);
    }
  }
  // Google: a Material ripple from where the pointer pressed, inside the button's own shape.
  function ripple(e){
    if(theme() !== 'google' || still() || e.button !== 0) return;
    const btn = e.target.closest?.('button,.btn,[role=radio],[role=tab],.navbtn,a');
    if(!btn || btn.disabled || btn.closest('#macDecor')) return;
    const r = btn.getBoundingClientRect();
    if(r.width < 8 || r.width > 900 || r.height > 200) return;
    const wrap = document.createElement('span');
    wrap.className = 'fx-ripple'; wrap.setAttribute('aria-hidden', 'true');
    Object.assign(wrap.style, {left:r.left + 'px', top:r.top + 'px', width:r.width + 'px', height:r.height + 'px', borderRadius:getComputedStyle(btn).borderRadius});
    const dot = document.createElement('i'), size = Math.hypot(r.width, r.height) * 2;
    Object.assign(dot.style, {width:size + 'px', height:size + 'px', left:(e.clientX - r.left - size / 2) + 'px', top:(e.clientY - r.top - size / 2) + 'px'});
    wrap.appendChild(dot); document.body.appendChild(wrap);
    dot.animate([{transform:'scale(.05)', opacity:.28}, {transform:'scale(1)', opacity:.16}], {duration:420, easing:'cubic-bezier(.23,1,.32,1)', fill:'forwards'});
    const end = ()=>{ wrap.animate([{opacity:1}, {opacity:0}], {duration:260, easing:'ease-out', fill:'forwards'}).onfinish = ()=>wrap.remove(); window.removeEventListener('pointerup', end, true); };
    window.addEventListener('pointerup', end, true);
    setTimeout(end, 1200);
  }

  window.macThemeFx = fx;
  if(window.RICOTTA_MAC_SHELL !== true) return;
  new MutationObserver(build).observe(root, {attributes:true, attributeFilter:['class']});
  document.addEventListener('visibilitychange', paused);
  document.addEventListener('pointerdown', ripple, true);
  document.addEventListener('click', e=>{ const b = e.target.closest?.('[data-inc]'); if(b && e.detail > 0) fx('add', b); }, true);
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
  paused();
})();
