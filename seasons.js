/* Ricotta Orders -- holiday themes.
   Eleven special themes join the five colour themes. Each holiday theme turns
   on by itself during its dates (Settings > Appearance > "Holiday themes switch
   on by themselves"), and the person's own theme comes back after it. Match
   Night has no date: it is picked by hand on match days.
   A holiday theme brings:
     - its colours (html[data-theme] blocks in style.css),
     - a few quiet background decorations (#seasonDecor, behind everything),
     - a costume for Rico (his face and colours never change, only his clothes),
     - his "moment": once a day he pops up from the corner with a themed line,
     - theme surprises: sparkles when + is tapped, and now and then Rico jumps
       out (the Halloween ghost-sheet BOO), plus a celebration when every order
       is sent (both can be turned off in Settings),
     - themed tap and "orders sent" sounds (sounds.js asks themeSounds()).
   When it rains or snows in Erbil (the server keeps the weather), drops or
   flakes fall over the screen and Rico holds an umbrella.
   Depends on (runtime only): state, t, esc, lget, lset, currentTheme, soundTone,
   soundOn, ricoFace (unwrapped as ricoFaceBase). Load after assistant.js and
   before app.js. */

const COLOR_THEMES = ['ricotta','graphite','ocean','saffron','berry'];
const HOLIDAY_THEMES = ['halloween','winter','christmas','flagday','ramadan','eid','newroz','spring','autumn','summer','match'];
/* Dark card, accent and page colour of each holiday theme (the Settings swatch and the phone's bar). */
const HOLIDAY_LOOK = {
  halloween:{swatch:['#2B1B3D','#F28C28','#F0ECF2'], bar:'#F0ECF2'},
  winter:   {swatch:['#1D3A57','#6CB8EA','#EEF3F7'], bar:'#EEF3F7'},
  christmas:{swatch:['#6B1E22','#E0B04C','#F4EFEC'], bar:'#F4EFEC'},
  flagday:  {swatch:['#1B5E34','#FEBD11','#F5F3EC'], bar:'#F5F3EC'},
  ramadan:  {swatch:['#1B2447','#E2B04A','#F2F0EB'], bar:'#F2F0EB'},
  eid:      {swatch:['#134E4A','#E9B949','#F1F3EE'], bar:'#F1F3EE'},
  newroz:   {swatch:['#1E5A33','#FEBD11','#F4F2EA'], bar:'#F4F2EA'},
  spring:   {swatch:['#2D5A3D','#F28FB0','#F0F5EE'], bar:'#F0F5EE'},
  autumn:   {swatch:['#5A2E1E','#C8452F','#F5F0EA'], bar:'#F5F0EA'},
  summer:   {swatch:['#0F5257','#FF8A4C','#F4F3EC'], bar:'#F4F3EC'},
  match:    {swatch:['#14532D','#FACC15','#EEF3EE'], bar:'#EEF3EE'}
};

/* ---------- The holiday calendar (Baghdad dates) ----------
   Ramadan and the two Eids follow the moon, so their dates here are close
   estimates; a day either side is normal. */
const RAMADAN_DAYS = {2026:['02-18','03-19'], 2027:['02-08','03-09'], 2028:['01-28','02-25'], 2029:['01-16','02-13'], 2030:['01-05','02-03']};
const EID_DAYS = {
  2026:[['03-20','03-22'],['05-26','05-29']], 2027:[['03-10','03-12'],['05-16','05-19']], 2028:[['02-26','02-28'],['05-04','05-07']],
  2029:[['02-14','02-16'],['04-23','04-26']], 2030:[['02-04','02-06'],['04-13','04-16']]
};
/* Today in Baghdad as {y, md} (md = month*100+day). The Lab can pretend a date. */
/* One shared formatter: every render asks for today's date, and creating formatters is slow on phones. */
const BAGHDAD_DAY = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Baghdad', year:'numeric', month:'2-digit', day:'2-digit'});
function seasonToday(){
  const d = window.RICOTTA_TODAY ? new Date(window.RICOTTA_TODAY + 'T12:00:00Z') : new Date();
  const p = BAGHDAD_DAY.formatToParts(d);
  const g = k => +p.find(x=>x.type===k).value;
  return {y:g('year'), md:g('month')*100 + g('day')};
}
const mdOf = s => +s.slice(0,2)*100 + +s.slice(3);
const inSpan = (md, a, b) => a <= b ? md >= a && md <= b : md >= a || md <= b;
/* The holiday theme for today, or null. Earlier lines win when two overlap. */
function holidayTheme(){
  const {y, md} = seasonToday();
  if(md === 1217) return 'flagday';
  if(inSpan(md, 1220, 102)) return 'christmas';
  if((EID_DAYS[y] || []).some(([a, b])=>inSpan(md, mdOf(a), mdOf(b)))) return 'eid';
  const r = RAMADAN_DAYS[y];
  if(r && inSpan(md, mdOf(r[0]), mdOf(r[1]))) return 'ramadan';
  if(inSpan(md, 318, 324)) return 'newroz';
  if(inSpan(md, 1024, 1101)) return 'halloween';
  if(inSpan(md, 1102, 1130)) return 'autumn';
  if(inSpan(md, 401, 430)) return 'spring';
  if(inSpan(md, 1210, 220)) return 'winter';
  if(inSpan(md, 701, 831)) return 'summer';
  return null;
}
const isHolidayTheme = th => HOLIDAY_THEMES.includes(th);
/* Picking another theme while a holiday is on keeps that pick until the holiday ends (on this phone). */
const holidayKey = (account, h) => 'holidayOff:' + account + ':' + h + ':' + seasonToday().y;
function holidayDismissed(account, h){ return !!lget(holidayKey(account, h)); }
function setHolidayDismissed(account, h, on){ lset(holidayKey(account, h), on ? true : null); }

/* ---------- Rico's costumes ----------
   Pieces of SVG in Rico's own 100x106 drawing, put in four places: behind
   him (back), over his body (mid), on his head (head) and in his hands or
   around his neck, drawn last (hand). */
const flowerSvg = (x, y, petal, mid) => `<g transform="translate(${x} ${y})"><circle r="4.3" fill="${petal}"/><circle r="2" fill="${mid}"/></g>`;
const COSTUMES = {
  halloween:{
    back:'<path class="lc lc-cape" d="M33 70 Q19 88 21 100 Q50 95 79 100 Q81 88 67 70Z" fill="#3A2552"/><path class="lc" d="M21 100 Q50 95 79 100" stroke="#F28C28" stroke-width="2" fill="none"/>',
    head:'<g class="lc"><path d="M19 15 Q50 3 81 15 Q50 23 19 15Z" fill="#2B1B3D"/><path d="M35 13 L47 -20 Q50 -27 58 -25 Q53 -20 54 -14 L65 12 Q50 17 35 13Z" fill="#3A2552"/><path d="M36.5 9 Q50 13 63.5 9 L62 5 Q50 9 38 5Z" fill="#F28C28"/><rect x="47" y="5.6" width="6" height="5" rx="1" fill="#FFD36B"/></g>'
  },
  winter:{
    head:'<g class="lc"><path d="M27 20 Q28 0 50 -1 Q72 0 73 20Z" fill="#2F6FB0"/><path d="M36 3v15M44 .5v17M56 .5v17M64 3v15" stroke="#255C93" stroke-width="2.2" opacity=".55"/><rect x="25" y="15" width="50" height="10" rx="5" fill="#E9F2FA"/><circle cx="50" cy="-3" r="6.5" fill="#E9F2FA"/></g><g class="lc lc-breath"><circle cx="64" cy="64" r="2.6"/><circle cx="70" cy="60" r="3.4"/><circle cx="77" cy="55" r="4.2"/></g>',
    hand:'<g class="lc"><rect x="29" y="67" width="42" height="9" rx="4.5" fill="#D9473F"/><path d="M34 67v9M42 67v9M50 67v9M58 67v9M66 67v9" stroke="#fff" stroke-width="2" opacity=".5"/><path d="M57 72h9v19h-9z" fill="#C23B34"/><path d="M58.5 91v3M61.5 91v3M64.5 91v3" stroke="#C23B34" stroke-width="1.6"/></g>'
  },
  christmas:{
    head:'<g class="lc"><path d="M24 20 Q30 -2 54 -4 Q72 -4 80 10 L88 22 Q76 16 74 20Z" fill="#C62828"/><rect x="22" y="15" width="56" height="10" rx="5" fill="#F5F5F5"/><circle cx="88" cy="22" r="5.5" fill="#F5F5F5"/></g>',
    hand:'<g class="lc"><rect x="72" y="80" width="15" height="13" rx="2" fill="#2E8B57"/><rect x="78.3" y="80" width="2.4" height="13" fill="#E0B04C"/><rect x="72" y="85.3" width="15" height="2.4" fill="#E0B04C"/><path d="M79.5 80c-3-4-7-2-4 0M79.5 80c3-4 7-2 4 0" stroke="#E0B04C" stroke-width="1.6" fill="none"/></g>'
  },
  flagday:{
    back:'<g class="lc lc-cape"><path d="M31 70 Q17 86 19 102 L81 102 Q83 86 69 70Z" fill="#278E43"/><path d="M31 70 Q22 78 21 86 L79 86 Q78 78 69 70Z" fill="#FFFFFF"/><path d="M31 70 Q26 74 24 78 L76 78 Q74 74 69 70Z" fill="#ED2024"/></g>',
    head:'<g class="lc"><rect x="20" y="26" width="60" height="4.5" rx="2.2" fill="#ED2024"/><rect x="20" y="30" width="60" height="3" fill="#FFFFFF"/><rect x="20" y="32.5" width="60" height="4.5" rx="2.2" fill="#278E43"/><circle cx="50" cy="31.5" r="3.4" fill="#FEBD11"/></g>'
  },
  ramadan:{
    head:'<g class="lc"><path d="M50 5.5V0" stroke="#8C6418" stroke-width="1.6"/><path d="M55 -13a8.5 8.5 0 1 0 0 14a6.6 6.6 0 1 1 0 -14z" fill="#E2B04A"/></g>',
    hand:'<g class="lc lc-lantern"><path d="M76 84v5" stroke="#8C6418" stroke-width="1.4"/><path d="M71 89h10l-1.6-2.4h-6.8z" fill="#C99A2E"/><rect x="71.5" y="89" width="9" height="12" rx="3" fill="#E2B04A"/><rect x="73.5" y="91" width="5" height="8" rx="2" fill="#FFE8A3" class="lc-glow"/><path d="M71 101h10l-2 3h-6z" fill="#C99A2E"/></g>'
  },
  eid:{
    mid:'<g class="lc"><path d="M33 72 Q31 90 36 97 L46 97 L44 72Z M67 72 Q69 90 64 97 L54 97 L56 72Z" fill="#7B3FA0"/><circle cx="45" cy="83" r="1.3" fill="#E9B949"/><circle cx="45" cy="89" r="1.3" fill="#E9B949"/></g>',
    hand:'<g class="lc"><path d="M41 69 L50 73 L41 77Z M59 69 L50 73 L59 77Z" fill="#7B3FA0"/><circle cx="50" cy="73" r="2.4" fill="#E9B949"/></g><g class="lc"><ellipse cx="81" cy="87" rx="10" ry="3" fill="#EFE7D6"/><circle cx="77" cy="84" r="3.4" fill="#C98B3E"/><circle cx="84" cy="84" r="3.4" fill="#D79D4E"/><circle cx="80.5" cy="81" r="3.2" fill="#C98B3E"/></g>'
  },
  newroz:{
    head:`<g class="lc"><ellipse cx="32" cy="17" rx="3.4" ry="1.8" fill="#4FA35B" transform="rotate(-40 32 17)"/><ellipse cx="68" cy="17" rx="3.4" ry="1.8" fill="#4FA35B" transform="rotate(40 68 17)"/>${flowerSvg(27,23,'#fff','#FEBD11')}${flowerSvg(36,12,'#fff','#FEBD11')}${flowerSvg(50,7,'#ED2024','#FEBD11')}${flowerSvg(64,12,'#fff','#FEBD11')}${flowerSvg(73,23,'#fff','#FEBD11')}</g>`,
    hand:'<g class="lc"><path d="M73 92 L80 44" stroke="#6B4A2B" stroke-width="2.4" stroke-linecap="round"/><g class="lc-flagcloth"><rect x="80" y="44" width="20" height="5" fill="#ED2024"/><rect x="80" y="49" width="20" height="5" fill="#fff"/><rect x="80" y="54" width="20" height="5" fill="#278E43"/><circle cx="90" cy="51.5" r="2.3" fill="#FEBD11"/></g></g>'
  },
  spring:{
    head:'<g class="lc"><ellipse cx="50" cy="15" rx="34" ry="6" fill="#E8C77E"/><path d="M33 15 Q34 0 50 -1 Q66 0 67 15Z" fill="#F0D28E"/><rect x="33" y="10" width="34" height="4" fill="#F28FB0"/><g transform="translate(64 9)"><circle r="4" fill="#F7B3C8"/><circle r="1.8" fill="#FFE08A"/></g></g>',
    hand:'<g class="lc"><path d="M72 84 Q79 72 86 84" stroke="#9C6B3B" stroke-width="2" fill="none"/><path d="M70 84 h18 l-2.5 10 h-13z" fill="#C79254"/><path d="M71 87h16M72 90.5h14" stroke="#9C6B3B" stroke-width="1"/><circle cx="76" cy="83" r="2.4" fill="#E0414F"/><circle cx="81" cy="82.5" r="2.4" fill="#F28FB0"/></g>'
  },
  autumn:{
    hand:'<g class="lc"><rect x="29" y="67" width="42" height="9" rx="4.5" fill="#D9792B"/><path d="M57 72h9v17h-9z" fill="#B8601E"/></g><g class="lc"><circle cx="20" cy="84" r="7" fill="#C8452F"/><path d="M17 77.5l1.5 2 1.5-2 1.5 2 1.5-2" stroke="#7A2418" stroke-width="1.4" fill="none"/><circle cx="18" cy="82" r="1.6" fill="#fff" opacity=".35"/></g>'
  },
  summer:{
    head:'<g class="lc"><rect x="27" y="45" width="21" height="13" rx="5.5" fill="#141414"/><rect x="52" y="45" width="21" height="13" rx="5.5" fill="#141414"/><path d="M48 49.5h4" stroke="#141414" stroke-width="2.6"/><path d="M31 48.5h7M56 48.5h7" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".45"/></g>',
    hand:'<g class="lc"><path d="M15 82 L21 98 L27 82Z" fill="#D9A15B"/><path d="M17 86l8-3M18 90l6-2" stroke="#B9813F" stroke-width="1"/><circle cx="21" cy="78" r="6" fill="#FF8FB1"/><circle cx="18" cy="74" r="4" fill="#FFF1D6"/></g>'
  },
  match:{
    mid:'<g class="lc"><path d="M30 70 h40 l6 8 -6 4 v15 h-28 v-15 l-6 -4z" fill="#15803D"/><path d="M42 70 q8 6 16 0" fill="none" stroke="#FACC15" stroke-width="2"/><text x="50" y="91" text-anchor="middle" font-size="12" font-weight="800" fill="#FACC15" font-family="Manrope,Sora,sans-serif">10</text></g>',
    hand:'<g class="lc lc-ball"><circle cx="80" cy="96" r="7" fill="#fff" stroke="#222" stroke-width="1"/><path d="M80 91.5l3.5 2.6-1.3 4.1h-4.4l-1.3-4.1z" fill="#222"/></g>'
  },
  rain:{
    hand:'<g class="lc lc-umbrella"><path d="M80 52 v38 q0 4 -4 4" stroke="#444" stroke-width="2" fill="none"/><path d="M58 54 Q80 30 102 54 Q97 50 91 54 Q85 50 80 54 Q75 50 69 54 Q63 50 58 54Z" fill="#3B82F6"/></g>'
  }
};
/* Dresses one of Rico's drawings (an HTML string from ricoFace) for a theme. */
function dressRico(svg, th){
  const c = COSTUMES[th];
  if(!c) return svg;
  let s = svg.replace('class="rico-bot ', `class="rico-bot season-c-${th} `);
  if(c.back) s = s.replace('<g class="rb-all">', '<g class="rb-all">' + c.back);
  if(c.mid) s = s.replace('<g class="rb-head">', c.mid + '<g class="rb-head">');
  return s.replace(/<\/g>(\s*)<\/g><\/svg>/, (all, ws) => (c.head || '') + '</g>' + ws + (c.hand || '') + '</g></svg>');
}
/* What Rico wears right now: the holiday's costume, or an umbrella in the rain. */
function ricoOutfit(){
  if(typeof state === 'undefined') return null;
  const th = currentTheme();
  if(isHolidayTheme(th)) return th;
  return weatherNow() === 'rain' && weatherFxOn() ? 'rain' : null;
}

/* ---------- Drawings for the backgrounds and the theme cards ---------- */
const SVG_BITS = {
  ghost:'<svg viewBox="0 0 50 60"><path d="M5 25a20 20 0 0 1 40 0v30l-6.7-5-6.6 5-6.7-5-6.7 5-6.6-5L5 55z" fill="#fff"/><circle cx="18" cy="24" r="3.5" fill="#2B1B3D"/><circle cx="32" cy="24" r="3.5" fill="#2B1B3D"/><ellipse cx="25" cy="34" rx="4" ry="5" fill="#2B1B3D"/></svg>',
  bat:'<svg viewBox="0 0 60 26"><path d="M30 8c2-4 5-4 6 0 6-6 14-6 24 2-6 0-9 4-10 9-3-4-7-4-9 0-2-3-5-4-7-2-1-3-3-3-4-3s-3 0-4 3c-2-2-5-1-7 2-2-4-6-4-9 0-1-5-4-9-10-9 10-8 18-8 24-2 1-4 4-4 6 0z" fill="#2B1B3D"/></svg>',
  pumpkin:'<svg viewBox="0 0 64 58"><path d="M32 12c-1-6 2-10 7-10" stroke="#3B6B2A" stroke-width="4" fill="none" stroke-linecap="round"/><ellipse cx="20" cy="34" rx="16" ry="20" fill="#D9691A"/><ellipse cx="44" cy="34" rx="16" ry="20" fill="#D9691A"/><ellipse cx="32" cy="34" rx="14" ry="22" fill="#F28C28"/><g class="face" fill="#FFD36B"><path d="M19 27l7 6h-9z"/><path d="M45 27l-7 6h9z"/><path d="M18 41q14 10 28 0l-4 3-3-2-4 3-3-3-4 3-3-3-4 2z"/></g></svg>',
  web:'<svg viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M0 0L120 18M0 0L108 66M0 0L70 108M0 0L18 120"/><path d="M30 4.5Q24 12 27 16.5Q19 22 17 27Q10 28 4.5 30"/><path d="M60 9Q48 24 54 33Q38 44 35 54Q22 56 9 60"/><path d="M90 13.5Q72 36 81 49.5Q57 66 52 80Q33 84 13.5 90"/></svg>',
  moon:'<svg viewBox="0 0 84 84"><circle cx="42" cy="42" r="40" fill="#F6B25A"/><circle cx="30" cy="30" r="7" fill="#E89A3C" opacity=".6"/><circle cx="54" cy="50" r="10" fill="#E89A3C" opacity=".5"/><circle cx="50" cy="22" r="4" fill="#E89A3C" opacity=".6"/></svg>',
  daffodil:'<svg viewBox="0 0 40 72"><path d="M20 30V72" stroke="#3E8E4A" stroke-width="3"/><path d="M20 58q-14-6-16-20q12 6 16 20" fill="#4FA35B"/>' + [0,60,120,180,240,300].map(a=>`<ellipse cx="20" cy="13" rx="5" ry="9" fill="#fff" transform="rotate(${a} 20 22)"/>`).join('') + '<circle cx="20" cy="22" r="6" fill="#FEBD11"/><circle cx="20" cy="22" r="3" fill="#F28C28"/></svg>',
  lantern:'<svg viewBox="0 0 30 120"><path d="M15 0V48" stroke="#B8902F" stroke-width="1.2"/><path d="M9 48h12l3 6H6z" fill="#C99A2E"/><path d="M6 54h18l-2 30H8z" fill="#E2B04A"/><path d="M10 58h10l-1.5 22h-7z" fill="#FFE29A" class="glow"/><path d="M8 84h14l-4 8h-6z" fill="#C99A2E"/><circle cx="15" cy="96" r="2" fill="#C99A2E"/></svg>',
  crescent:'<svg viewBox="0 0 64 64"><path d="M42 6a28 28 0 1 0 16 46A24 24 0 1 1 42 6z" fill="#E2B04A"/><path d="M52 16l1.8 4.6 4.9.4-3.8 3.1 1.2 4.8-4.1-2.7-4.1 2.7 1.2-4.8-3.8-3.1 4.9-.4z" fill="#F2C96A"/></svg>',
  star:'<svg viewBox="0 0 12 12"><path d="M6 0l1.5 4.5L12 6 7.5 7.5 6 12 4.5 7.5 0 6l4.5-1.5z" fill="currentColor"/></svg>',
  cloud:'<svg viewBox="0 0 110 44"><path d="M20 40a14 14 0 0 1 4-27 20 20 0 0 1 37-5 16 16 0 0 1 26 10 12 12 0 0 1 3 22z" fill="#fff"/></svg>',
  mountains:'<svg viewBox="0 0 1200 200" preserveAspectRatio="xMidYMax slice"><path d="M0 200V120l120-60 90 50 140-90 120 80 90-40 160 90 110-70 140 60 120-50 110 40V200Z" fill="currentColor"/><path d="M0 200V160l160-30 140 25 180-40 160 40 200-30 180 30 180-20V200Z" fill="currentColor" opacity=".6"/></svg>',
  tree:'<svg viewBox="0 0 60 80"><path d="M30 4 L52 40 H40 L56 62 H4 L20 40 H8Z" fill="#2E7D4F"/><rect x="26" y="62" width="8" height="12" fill="#7A4B2A"/><path d="M30 0l2.4 5 5.4.6-4 3.6 1.1 5.3L30 12l-4.9 2.5 1.1-5.3-4-3.6 5.4-.6z" fill="#E0B04C"/><circle cx="24" cy="34" r="2.6" fill="#E04848"/><circle cx="36" cy="46" r="2.6" fill="#E0B04C"/><circle cx="20" cy="54" r="2.6" fill="#4FA3E0"/><circle cx="40" cy="56" r="2.6" fill="#E04848"/></svg>',
  pomegranate:'<svg viewBox="0 0 40 40"><circle cx="20" cy="22" r="16" fill="#C8452F"/><path d="M14 6l2 4 2-4 2 4 2-4 2 4 2-4" stroke="#7A2418" stroke-width="2.2" fill="none"/><circle cx="14" cy="18" r="3" fill="#fff" opacity=".3"/></svg>',
  leaf:'<svg viewBox="0 0 24 24"><path d="M12 2 C17 6 22 10 21 16 C16 15 14 19 12 22 C10 19 8 15 3 16 C2 10 7 6 12 2Z" fill="currentColor"/><path d="M12 4V22" stroke="rgba(0,0,0,.2)" stroke-width="1"/></svg>',
  petal:'<svg viewBox="0 0 12 16"><path d="M6 0 C10 4 12 9 6 16 C0 9 2 4 6 0Z" fill="currentColor"/></svg>',
  ball:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#fff" stroke="#222" stroke-width="1.2"/><path d="M12 7l4.2 3.1-1.6 5h-5.2l-1.6-5z" fill="#222"/></svg>',
  kleicha:'<svg viewBox="0 0 30 30"><circle cx="15" cy="15" r="13" fill="#D79D4E"/><circle cx="15" cy="15" r="13" fill="none" stroke="#B9772C" stroke-width="2" stroke-dasharray="3 3"/><path d="M15 6 Q20 15 15 24 Q10 15 15 6Z" fill="#B9772C" opacity=".55"/></svg>'
};
const plainSvg = svg => svg.replace(/<\/?svg[^>]*>/g, '');
/* The Kurdish sun: 21 rays. */
function kurdSun(r1, r2, color){
  let d = '';
  for(let i = 0; i < 21; i++){
    const a = i / 21 * Math.PI * 2, w = Math.PI / 21 * .55;
    const p = (ang, r) => `${(100 + Math.cos(ang) * r).toFixed(1)} ${(100 + Math.sin(ang) * r).toFixed(1)}`;
    d += `M${p(a - w, r1)}L${p(a, r2)}L${p(a + w, r1)}Z`;
  }
  return `<svg viewBox="0 0 200 200"><path d="${d}" fill="${color}"/><circle cx="100" cy="100" r="${r1}" fill="${color}"/></svg>`;
}
const flagSvg = () => `<svg viewBox="0 0 64 44"><rect x="0" y="0" width="2.5" height="44" fill="#6B4A2B"/><g class="cloth"><rect x="2.5" y="2" width="58" height="11" fill="#ED2024"/><rect x="2.5" y="13" width="58" height="11" fill="#fff"/><rect x="2.5" y="24" width="58" height="11" fill="#278E43"/><g transform="translate(23.5 10.5) scale(.08)">${plainSvg(kurdSun(40, 96, '#FEBD11'))}</g></g></svg>`;
/* Erbil Citadel on its mound, with the Kurdish flag over the gate. */
const CITADEL_TOP = 'M300 162V112h22v-8h40v12h30v-16h46v10h38v-14h52v8h32V60h16V40h44v20h16v44h34v-12h44v10h40v-16h46v14h34v-8h40v12h30v-6h24v58';
function citadelSvg(){
  const windows = [330,372,410,452,490,540,672,712,756,800,846,884].map((x,i)=>`M${x} ${i%2?126:132}h8v10h-8z`).join('');
  return `<svg viewBox="0 0 1200 240" preserveAspectRatio="xMidYMax slice">
    <path fill="currentColor" fill-rule="evenodd" d="M0 240V214C140 206 230 192 290 160H920C980 192 1060 206 1200 214V240Z ${CITADEL_TOP}Z M584 162V132a14 14 0 0 1 28 0V162Z ${windows}"/>
    <path d="${CITADEL_TOP}" fill="none" stroke="#fff" stroke-width="6" stroke-linejoin="round"/>
    <path d="M150 211C220 202 260 188 290 160H920C950 188 990 202 1060 211" fill="none" stroke="#fff" stroke-width="5"/>
    <rect x="597" y="2" width="3" height="40" fill="currentColor"/>
    <rect x="600" y="4" width="34" height="7" fill="#ED2024"/><rect x="600" y="11" width="34" height="7" fill="#fff"/><rect x="600" y="18" width="34" height="7" fill="#278E43"/><circle cx="617" cy="14.5" r="3.4" fill="#FEBD11"/>
  </svg>`;
}
/* The little picture on a theme's card in Settings (and behind a Devices card). */
function themeScene(id){
  const look = HOLIDAY_LOOK[id] || {swatch:(typeof THEME_LOOK !== 'undefined' && THEME_LOOK[id] ? THEME_LOOK[id].swatch : ['#14382C','#34C27A','#EEF1EF'])};
  const [deep, accent] = look.swatch;
  const sc = {
    ricotta:`<path d="M92 62c10-18 22-22 24-22-2 12-10 24-24 22z" fill="${accent}" opacity=".55"/><path d="M100 70c-4-14 0-26 2-28 6 8 6 22-2 28z" fill="${deep}" opacity=".25"/>`,
    graphite:`<path d="M96 52c-4-6 4-8 0-14M104 52c-4-6 4-8 0-14M112 52c-4-6 4-8 0-14" stroke="${deep}" stroke-width="2.2" fill="none" opacity=".35" stroke-linecap="round"/><rect x="88" y="54" width="32" height="10" rx="5" fill="${deep}" opacity=".4"/>`,
    ocean:`<path d="M0 66q10-6 20 0t20 0 20 0 20 0 20 0 20 0V80H0Z" fill="${accent}" opacity=".35"/><path d="M0 72q10-6 20 0t20 0 20 0 20 0 20 0 20 0V80H0Z" fill="${deep}" opacity=".25"/>`,
    saffron:`<path d="M104 40c0 0-8 10-8 15a8 8 0 0 0 16 0c0-5-8-15-8-15z" fill="${accent}" opacity=".7"/><path d="M92 58c0 0-5 6-5 9a5 5 0 0 0 10 0c0-3-5-9-5-9z" fill="${accent}" opacity=".5"/>`,
    berry:`<circle cx="104" cy="58" r="13" fill="${accent}" opacity=".7"/><path d="M100 45l4-5 4 5" stroke="${deep}" stroke-width="2" fill="none" opacity=".5"/><circle cx="100" cy="58" r="2" fill="#fff" opacity=".7"/><circle cx="107" cy="62" r="2" fill="#fff" opacity=".7"/>`,
    halloween:`<circle cx="100" cy="18" r="11" fill="#F6B25A" opacity=".8"/><g transform="translate(84 46) scale(.42)">${plainSvg(SVG_BITS.pumpkin)}</g><g transform="translate(8 8) scale(.36)" opacity=".7">${plainSvg(SVG_BITS.ghost)}</g>`,
    winter:`<g transform="translate(0 46) scale(.1 .14)" fill="${deep}" opacity=".45"><path d="M0 240V214C140 206 230 192 290 160H920C980 192 1060 206 1200 214V240Z ${CITADEL_TOP}Z"/></g>${[12,30,52,70,96,110].map((x,i)=>`<circle cx="${x}" cy="${8+i*7%30}" r="1.8" fill="#fff"/>`).join('')}`,
    christmas:`<path d="M0 6 Q30 16 60 6 T120 6" stroke="#3B3B3B" stroke-width="1" fill="none" opacity=".5"/>${[10,24,38,52,66,80,94,108].map((x,i)=>`<circle cx="${x}" cy="${8+Math.sin(i)*2}" r="2.6" fill="${['#E04848','#E0B04C','#4FA3E0','#3FBF6F'][i%4]}"/>`).join('')}<g transform="translate(92 40) scale(.5)">${plainSvg(SVG_BITS.tree)}</g>`,
    flagday:`<g transform="translate(70 4) scale(.75)">${plainSvg(flagSvg())}</g>`,
    ramadan:`<g transform="translate(92 6) scale(.36)">${plainSvg(SVG_BITS.crescent)}</g><g transform="translate(10 0) scale(.3)">${plainSvg(SVG_BITS.lantern)}</g>${[60,74,84].map((x,i)=>`<circle cx="${x}" cy="${10+i*6}" r="1.4" fill="#E2B04A"/>`).join('')}`,
    eid:`<g transform="translate(94 4) scale(.3)">${plainSvg(SVG_BITS.crescent)}</g><g transform="translate(86 50) scale(.7)">${plainSvg(SVG_BITS.kleicha)}</g>${[16,40,64].map((x,i)=>`<g transform="translate(${x} ${4+i*5}) scale(.9)" color="#E9B949">${plainSvg(SVG_BITS.star)}</g>`).join('')}`,
    newroz:`<g transform="translate(80 -8) scale(.24)" opacity=".85">${plainSvg(kurdSun(40,96,'#FEBD11'))}</g><rect x="0" y="0" width="120" height="3" fill="#ED2024"/><rect x="0" y="3" width="120" height="2" fill="#fff"/><rect x="0" y="5" width="120" height="3" fill="#278E43"/>`,
    spring:`${[12,30,58,80,104].map((x,i)=>`<g transform="translate(${x} ${6+i*9%40}) rotate(${i*40})" color="#F28FB0">${plainSvg(SVG_BITS.petal)}</g>`).join('')}<rect x="112" y="0" width="8" height="80" fill="#9FD3F0" opacity=".6"/>`,
    autumn:`${[14,40,70,96].map((x,i)=>`<g transform="translate(${x} ${8+i*11}) rotate(${i*55}) scale(.7)" color="${['#D9792B','#B8601E','#E0A030','#9C3324'][i]}">${plainSvg(SVG_BITS.leaf)}</g>`).join('')}<g transform="translate(92 50) scale(.6)">${plainSvg(SVG_BITS.pomegranate)}</g>`,
    summer:`<g transform="translate(86 -4) scale(.2)">${plainSvg(kurdSun(44,90,'#FFB547'))}</g><g transform="translate(0 52) scale(.1 .14)" fill="${deep}" opacity=".35"><path d="M0 200V120l120-60 90 50 140-90 120 80 90-40 160 90 110-70 140 60 120-50 110 40V200Z"/></g>`,
    match:`<rect x="2" y="2" width="116" height="76" rx="4" fill="none" stroke="#fff" stroke-width="1.6" opacity=".7"/><path d="M60 2V78" stroke="#fff" stroke-width="1.6" opacity=".7"/><circle cx="60" cy="40" r="12" fill="none" stroke="#fff" stroke-width="1.6" opacity=".7"/><g transform="translate(94 52) scale(.9)">${plainSvg(SVG_BITS.ball)}</g>`
  };
  return `<svg class="theme-scene" viewBox="0 0 120 80" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${sc[id] || ''}</svg>`;
}

/* ---------- Background decorations (#seasonDecor, behind everything) ---------- */
const rnd = (a, b) => a + Math.random() * (b - a);
function decorHtml(th){
  let h = '';
  const fall = (n, cls, inner, dur=[9,19]) => {
    let out = '';
    for(let i = 0; i < n; i++){
      const s = rnd(.6, 1.3).toFixed(2);
      out += `<i class="sd-fall ${cls}" style="left:${rnd(0,100).toFixed(1)}%;--s:${s};--dx:${rnd(-50,50).toFixed(0)}px;--r:${rnd(-200,200).toFixed(0)}deg;animation-duration:${rnd(dur[0],dur[1]).toFixed(1)}s;animation-delay:-${rnd(0,dur[1]).toFixed(1)}s">${inner()}</i>`;
    }
    return out;
  };
  if(th === 'halloween'){
    h += `<div class="sd-web">${SVG_BITS.web}</div><div class="sd-moon">${SVG_BITS.moon}</div>`;
    h += `<div class="sd-ghost" style="top:22%;animation-duration:28s">${SVG_BITS.ghost}</div><div class="sd-ghost" style="top:58%;width:34px;animation-duration:36s;animation-delay:-17s">${SVG_BITS.ghost}</div>`;
    h += `<div class="sd-bat" style="top:30%">${SVG_BITS.bat}</div><div class="sd-bat" style="top:16%;width:24px;animation-duration:25s;animation-delay:-9s">${SVG_BITS.bat}</div>`;
    h += `<div class="sd-corner sd-left" style="width:58px">${SVG_BITS.pumpkin}</div><div class="sd-corner sd-right" style="width:44px">${SVG_BITS.pumpkin}</div>`;
  } else if(th === 'winter'){
    h += `<div class="sd-skyline sd-citadel">${citadelSvg()}</div>` + fall(26, 'sd-flake', ()=>'');
  } else if(th === 'christmas'){
    const bulbs = Array.from({length:14}, (_, i)=>`<circle class="sd-bulb" cx="${(i+.5)*(100/14)}%" cy="${14 + Math.sin(i*1.3)*6}" r="5" fill="${['#E04848','#E0B04C','#4FA3E0','#3FBF6F'][i%4]}" style="animation-delay:-${(i%4)*.4}s"/>`).join('');
    h += `<svg class="sd-lights" viewBox="0 0 100 30" preserveAspectRatio="none" width="100%" height="30"><path d="M0 8 Q12.5 22 25 8 T50 8 T75 8 T100 8" stroke="#3B3B3B" stroke-width=".6" fill="none" opacity=".45" vector-effect="non-scaling-stroke"/></svg><svg class="sd-lights" width="100%" height="34">${bulbs}</svg>`;
    h += `<div class="sd-corner sd-left" style="width:56px">${SVG_BITS.tree}</div>` + fall(12, 'sd-flake', ()=>'');
    const {md} = seasonToday();
    if(md === 1231 || md === 101) h += [18,52,80].map((x, i)=>`<div class="sd-firework" style="left:${x}%;top:${14+i*7}%;animation-delay:-${i*.9}s"></div>`).join('');
  } else if(th === 'flagday'){
    h += `<div class="sd-strip"></div><div class="sd-sun sd-sun-mid">${kurdSun(40, 96, '#FEBD11')}</div><div class="sd-flagbig">${flagSvg()}</div>`;
  } else if(th === 'ramadan'){
    h += `<div class="sd-crescent">${SVG_BITS.crescent}</div>`;
    for(let i = 0; i < 8; i++) h += `<div class="sd-star" style="top:${rnd(6,42).toFixed(0)}%;left:${rnd(4,96).toFixed(0)}%;width:${rnd(8,14).toFixed(0)}px;animation-delay:-${rnd(0,3).toFixed(1)}s;color:#E2B04A">${SVG_BITS.star}</div>`;
    h += `<div class="sd-lantern" style="left:7%">${SVG_BITS.lantern}</div><div class="sd-lantern" style="left:22%;width:22px;animation-delay:-1.6s">${SVG_BITS.lantern}</div><div class="sd-lantern" style="right:24%;width:26px;animation-delay:-3s">${SVG_BITS.lantern}</div>`;
  } else if(th === 'eid'){
    h += `<div class="sd-crescent">${SVG_BITS.crescent}</div>`;
    for(let i = 0; i < 9; i++) h += `<div class="sd-star" style="top:${rnd(4,40).toFixed(0)}%;left:${rnd(4,96).toFixed(0)}%;width:${rnd(9,15).toFixed(0)}px;animation-delay:-${rnd(0,3).toFixed(1)}s;color:#E9B949">${SVG_BITS.star}</div>`;
    h += `<div class="sd-corner sd-left" style="width:44px">${SVG_BITS.kleicha}</div><div class="sd-corner sd-right" style="width:36px;bottom:calc(122px + env(safe-area-inset-bottom,0px))">${SVG_BITS.kleicha}</div>`;
  } else if(th === 'newroz'){
    h += `<div class="sd-strip"></div><div class="sd-sun">${kurdSun(40, 96, '#FEBD11')}</div><div class="sd-flag">${flagSvg()}</div>`;
    h += `<div class="sd-flower sd-left">${SVG_BITS.daffodil}</div><div class="sd-flower" style="left:44px;width:30px;animation-delay:-1.3s">${SVG_BITS.daffodil}</div><div class="sd-flower sd-right" style="width:34px;animation-delay:-2.1s">${SVG_BITS.daffodil}</div>`;
  } else if(th === 'spring'){
    h += `<div class="sd-skyline sd-hills">${SVG_BITS.mountains}</div><div class="sd-waterfall"><i></i><i></i><i></i></div>` + fall(16, 'sd-petal', ()=>SVG_BITS.petal, [10,20]);
  } else if(th === 'autumn'){
    h += fall(14, 'sd-leaf', ()=>SVG_BITS.leaf, [11,21]) + `<div class="sd-corner sd-left" style="width:40px">${SVG_BITS.pomegranate}</div><div class="sd-corner sd-right" style="width:32px">${SVG_BITS.pomegranate}</div>`;
  } else if(th === 'summer'){
    h += `<div class="sd-bigsun">${kurdSun(44, 90, '#FFB547')}</div><div class="sd-skyline sd-hills">${SVG_BITS.mountains}</div>`;
    h += `<div class="sd-cloud" style="top:14%">${SVG_BITS.cloud}</div><div class="sd-cloud" style="top:30%;width:76px;animation-duration:95s;animation-delay:-40s">${SVG_BITS.cloud}</div>`;
  } else if(th === 'match'){
    h += `<div class="sd-pitch"><i class="sd-pitch-line"></i><i class="sd-pitch-circle"></i></div><div class="sd-rollball">${SVG_BITS.ball}</div>`;
  }
  return h;
}
function paintDecor(){
  const th = typeof state !== 'undefined' ? currentTheme() : null;
  const key = (isHolidayTheme(th) ? th : '') + '|' + (weatherFxOn() ? weatherNow() : '');
  let el = document.getElementById('seasonDecor');
  if(!el){
    el = document.createElement('div');
    el.id = 'seasonDecor'; el.setAttribute('aria-hidden', 'true');
    document.body.insertBefore(el, document.getElementById('app'));
  }
  if(el.dataset.key === key) return;
  el.dataset.key = key;
  let h = isHolidayTheme(th) ? decorHtml(th) : '';
  const w = weatherFxOn() ? weatherNow() : '';
  if(w === 'rain') for(let i = 0; i < 40; i++) h += `<i class="sd-drop" style="left:${rnd(0,100).toFixed(1)}%;animation-duration:${rnd(.7,1.2).toFixed(2)}s;animation-delay:-${rnd(0,1.2).toFixed(2)}s;opacity:${rnd(.25,.55).toFixed(2)}"></i>`;
  if(w === 'snow' && th !== 'winter') for(let i = 0; i < 24; i++) h += `<i class="sd-fall sd-flake" style="left:${rnd(0,100).toFixed(1)}%;--s:${rnd(.6,1.2).toFixed(2)};--dx:${rnd(-40,40).toFixed(0)}px;animation-duration:${rnd(9,18).toFixed(1)}s;animation-delay:-${rnd(0,18).toFixed(1)}s"></i>`;
  el.innerHTML = h;
}

/* ---------- Weather from the server (state.weather), shown when it rains or snows ---------- */
function weatherNow(){
  const w = typeof state !== 'undefined' ? state.weather : null;
  if(!w || !w.updatedAt || Date.now() - Date.parse(w.updatedAt) > 3 * 3600_000) return '';
  return w.snow ? 'snow' : w.rain ? 'rain' : '';
}
const weatherFxOn = () => lget('weatherFx') !== false;
const surprisesOn = () => lget('themeSurprises') !== false;

/* ---------- Words for Rico's moments ---------- */
const W3 = (en, ku, ar) => ({en, ku, ar});
const SEASON_WORDS = {
  halloween:{mood:'excited', peek:W3('BOOO!','بوووو!','بووووو!'), sub:W3('Haha, got you! It’s only me, Rico. 🎃','هاها، ترساندمت! تەنها منم، ریکۆ. 🎃','هاها، أمسكتك! إنه أنا فقط، ريكو. 🎃'),
    pop:W3('BOO! 👻','بوو! 👻','بوو! 👻'), popSub:W3('Did that tomato scare you?','ئەو تەماتەیە ترساندتی؟','هل أخافتك هذه الطماطم؟'),
    sent:W3('All sent! No tricks today, only treats. 🎃','هەمووی نێردرا! ئەمڕۆ فێڵ نییە، تەنها شیرینی. 🎃','أُرسل الكل! لا خدع اليوم، حلوى فقط. 🎃')},
  winter:{mood:'worried', peek:W3('Brrr… so cold! 🥶','بڕڕڕ… زۆر ساردە! 🥶','بررر… الجو بارد جدًا! 🥶'), sub:W3('My fingers are frozen. Order something warm, please?','پەنجەکانم بەستوون. شتێکی گەرم داوا بکە تکایە؟','أصابعي متجمدة. اطلب شيئًا دافئًا من فضلك؟'),
    pop:W3('Achoo! 🤧','ئاپچی! 🤧','أتشو! 🤧'), popSub:W3('Sorry, it’s cold. Shall we order soup?','ببورە، ساردە. شۆربا داوا بکەین؟','آسف، الجو بارد. هل نطلب شوربة؟'),
    sent:W3('All sent! Now let’s warm up with tea. ☕','هەمووی نێردرا! ئێستا با بە چا گەرم ببینەوە. ☕','أُرسل الكل! الآن لنتدفأ بالشاي. ☕')},
  christmas:{mood:'excited', peek:W3('Merry Christmas from Ankawa! 🎄','کریسمس پیرۆز لە عەنکاوەوە! 🎄','ميلاد مجيد من عنكاوا! 🎄'), sub:W3('Order early, the bakery is busy this week.','زوو داوا بکە، نانەواخانەکە ئەم هەفتەیە قەرەباڵغە.','اطلب مبكرًا، المخبز مزدحم هذا الأسبوع.'),
    pop:W3('Ho ho ho! 🎄','هۆ هۆ هۆ! 🎄','هو هو هو! 🎄'), popSub:W3('Santa Rico checked the list twice.','ریکۆی بابە نۆئێل لیستەکەی دوو جار پشکنی.','بابا ريكو راجع القائمة مرتين.'),
    sent:W3('All sent! Merry Christmas! 🎄','هەمووی نێردرا! کریسمس پیرۆز! 🎄','أُرسل الكل! ميلاد مجيد! 🎄')},
  flagday:{mood:'excited', peek:W3('Happy Flag Day! ☀️','ڕۆژی ئاڵا پیرۆز بێت! ☀️','يوم العلم سعيد! ☀️'), sub:W3('I’m wearing the flag with pride today.','ئەمڕۆ ئاڵاکە بە شانازییەوە دەپۆشم.','أرتدي العلم بفخر اليوم.'),
    pop:W3('Long live Kurdistan! ☀️','بژی کوردستان! ☀️','عاشت كوردستان! ☀️'), popSub:W3('The flag is flying over the kitchen today.','ئەمڕۆ ئاڵاکە بەسەر چێشتخانەکەوە دەشەکێتەوە.','العلم يرفرف فوق المطبخ اليوم.'),
    sent:W3('All sent! Long live Kurdistan! ☀️','هەمووی نێردرا! بژی کوردستان! ☀️','أُرسل الكل! عاشت كوردستان! ☀️')},
  ramadan:{mood:'calm', peek:W3('Ramadan Kareem 🌙','ڕەمەزان پیرۆز 🌙','رمضان كريم 🌙'), sub:W3('I lit a lantern for the kitchen. Are the dates for iftar on the list?','چرایەکم بۆ چێشتخانە داگیرساند. خورما بۆ بەربانگ لە لیستەکەدایە؟','أشعلت فانوسًا للمطبخ. هل التمر للإفطار في القائمة؟'),
    pop:W3('Psst… 🌙','هێی… 🌙','همسة… 🌙'), popSub:W3('Don’t forget the dates for iftar.','خورما بۆ بەربانگ لەبیر مەکە.','لا تنسَ التمر للإفطار.'),
    sent:W3('All sent before iftar. Ramadan Kareem 🌙','هەمووی پێش بەربانگ نێردرا. ڕەمەزان پیرۆز 🌙','أُرسل الكل قبل الإفطار. رمضان كريم 🌙')},
  eid:{mood:'happy', peek:W3('Eid Mubarak! 🌙','جەژنتان پیرۆز بێت! 🌙','عيد مبارك! 🌙'), sub:W3('I brought kleicha for the whole kitchen.','کلێچەم بۆ هەموو چێشتخانەکە هێناوە.','أحضرت الكليچة للمطبخ كله.'),
    pop:W3('Eid Mubarak! 🎉','جەژنت پیرۆز بێت! 🎉','عيد مبارك! 🎉'), popSub:W3('Have a kleicha, you earned it.','کلێچەیەک بخۆ، شایەنیت.','خذ كليچة، تستحقها.'),
    sent:W3('All sent! Eid Mubarak to the whole kitchen. 🎉','هەمووی نێردرا! جەژنی هەموو چێشتخانەکە پیرۆز بێت. 🎉','أُرسل الكل! عيد مبارك للمطبخ كله. 🎉')},
  newroz:{mood:'excited', peek:W3('Newroz pîroz be! 🔥','نەورۆز پیرۆز بێت! 🔥','نوروز مبارك! 🔥'), sub:W3('I’m dancing the govend! Join me after the orders are out.','گۆڤەند دەگێڕم! دوای ناردنی داواکارییەکان وەرە.','أرقص الدبكة! انضم إليّ بعد إرسال الطلبات.'),
    pop:W3('Halparke time! 💃','کاتی هەڵپەڕکێیە! 💃','وقت الدبكة! 💃'), popSub:W3('One more item and I’ll dance again.','کاڵایەکی تر و دیسان سەما دەکەم.','صنف آخر وسأرقص مجددًا.'),
    sent:W3('All sent! Newroz pîroz be! 🔥','هەمووی نێردرا! نەورۆز پیرۆز بێت! 🔥','أُرسل الكل! نوروز مبارك! 🔥')},
  spring:{mood:'happy', peek:W3('Spring at Gali Ali Beg! 🌸','بەهاری گەلی عەلی بەگ! 🌸','ربيع كلي علي بك! 🌸'), sub:W3('Picnic season: fresh salads go fast.','وەرزی سەیرانە: زەڵاتەی تازە زوو تەواو دەبێت.','موسم النزهات: السلطات الطازجة تنفد بسرعة.'),
    pop:W3('Achoo… flowers! 🌸','ئاپچی… گوڵ! 🌸','أتشو… زهور! 🌸'), popSub:W3('Spring is here. Fresh herbs taste best now.','بەهار هات. سەوزەی تازە ئێستا خۆشترینە.','جاء الربيع. الأعشاب الطازجة ألذ الآن.'),
    sent:W3('All sent! Time for a picnic. 🌸','هەمووی نێردرا! کاتی سەیرانە. 🌸','أُرسل الكل! حان وقت النزهة. 🌸')},
  autumn:{mood:'calm', peek:W3('Pomegranate season! 🍂','وەرزی هەنار! 🍂','موسم الرمان! 🍂'), sub:W3('Halabja’s pomegranates are the sweetest right now.','هەنارەکانی هەڵەبجە ئێستا شیرینترینن.','رمان حلبجة الأحلى الآن.'),
    pop:W3('Crunch! 🍂','خڕش! 🍂','قرمشة! 🍂'), popSub:W3('A pomegranate from Halabja for you.','هەنارێکی هەڵەبجە بۆ تۆ.','رمانة من حلبجة لك.'),
    sent:W3('All sent! Sweet as a Halabja pomegranate. 🍂','هەمووی نێردرا! شیرین وەک هەناری هەڵەبجە. 🍂','أُرسل الكل! حلو كرمان حلبجة. 🍂')},
  summer:{mood:'happy', peek:W3('Phew, it’s hot! 😎','ئۆف، گەرمە! 😎','أوف، الجو حار! 😎'), sub:W3('I’m melting like the mozzarella. Is the fridge order in?','وەک مۆزارێلا دەتوێمەوە. داواکاریی سەلاجەکە نێردرا؟','أذوب مثل الموزاريلا. هل أُرسل طلب الثلاجة؟'),
    pop:W3('Splash! 💦','شڵپ! 💦','طرطشة! 💦'), popSub:W3('Keep the mozzarella cold today.','ئەمڕۆ مۆزارێلاکە سارد ڕابگرە.','أبقِ الموزاريلا باردة اليوم.'),
    sent:W3('All sent! Time for a cold lemonade. 🍋','هەمووی نێردرا! کاتی لیمۆناتەیەکی ساردە. 🍋','أُرسل الكل! حان وقت عصير ليمون بارد. 🍋')},
  match:{mood:'excited', peek:W3('Match night! ⚽','شەوی یارییە! ⚽','ليلة المباراة! ⚽'), sub:W3('Big crowd tonight: order extra bread and drinks.','ئەمشەو قەرەباڵغە: نان و خواردنەوەی زیاتر داوا بکە.','حشد كبير الليلة: اطلب خبزًا ومشروبات إضافية.'),
    pop:W3('GOOOAL! ⚽','گۆڵڵڵ! ⚽','هدددف! ⚽'), popSub:W3('One more item and we win the match.','کاڵایەکی تر و یارییەکە دەبەینەوە.','صنف آخر ونفوز بالمباراة.'),
    sent:W3('All sent! That’s a goal for the kitchen! ⚽','هەمووی نێردرا! ئەوە گۆڵێکە بۆ چێشتخانە! ⚽','أُرسل الكل! هدف للمطبخ! ⚽')}
};
const wordsIn = w => (w && (w[state.lang] || w.en)) || '';

/* ---------- Sounds for each holiday theme (sounds.js asks for them) ---------- */
const SEASON_SOUNDS = {
  halloween:{type:'triangle', up:330, down:262, sent:[[392,0,.5],[370,.22,.5],[349,.44,.5],[294,.66,.9]]},
  winter:{type:'sine', up:2093, down:1760, sent:[[1568,0,.35],[1760,.1,.35],[2093,.2,.5],[2637,.32,.7]]},
  christmas:{type:'sine', up:1318, down:1175, sent:[[659,0,.18],[659,.18,.18],[659,.36,.36],[659,.72,.18],[659,.9,.18],[659,1.08,.36],[659,1.44,.18],[784,1.62,.18],[523,1.8,.27],[587,2.07,.09],[659,2.16,.6]]},
  flagday:{type:'sine', up:784, down:659, sent:[[523,0,.4],[659,.2,.4],[784,.4,.4],[1046,.6,.8]]},
  ramadan:{type:'sine', up:1046, down:880, sent:[[523,0,.9],[659,.32,.9],[784,.64,1.2]]},
  eid:{type:'sine', up:988, down:784, sent:[[784,0,.3],[988,.12,.3],[1175,.24,.3],[1568,.36,.7]]},
  newroz:{type:'triangle', up:196, down:147, sent:[[587,0,.22],[659,.14,.22],[784,.28,.22],[659,.42,.22],[880,.56,.5]]},
  spring:{type:'sine', up:2637, down:2349, sent:[[2349,0,.08],[2637,.08,.08],[2349,.2,.08],[2794,.28,.2]]},
  autumn:{type:'triangle', up:660, down:520, sent:[[523,0,.4],[494,.18,.4],[440,.36,.4],[523,.54,.7]]},
  summer:{type:'sine', up:1318, down:1046, sent:[[784,0,.3],[988,.12,.3],[1175,.24,.5]]},
  match:{type:'square', up:2093, down:1760, sent:[[2093,0,.08],[2349,.09,.08],[2093,.18,.08],[2349,.27,.08],[2093,.36,.3]], gain:.05}
};
/* The holiday theme's sounds, or null for the app's usual ones. */
function themeSounds(){
  if(typeof state === 'undefined' || !state.account) return null;
  return SEASON_SOUNDS[currentTheme()] || null;
}
function playSeasonTones(list, gain = .12, type = 'sine'){
  try{ list.forEach(([f, at, dur])=>soundTone(f, dur, gain, at, type)); }catch(_){ /* a sound never stops anything */ }
}

/* ---------- Rico pops up from the corner ---------- */
let seasonPeekTimer = 0;
function seasonMoment(th, {title, sub, scare, mood, short} = {}){
  th = th || currentTheme();
  const w = SEASON_WORDS[th];
  if(!w) return;
  document.querySelector('.season-peek')?.remove();
  clearTimeout(seasonPeekTimer);
  const head = title ? wordsIn(title) : wordsIn(w.peek);
  const line = sub === null ? '' : sub ? wordsIn(sub) : wordsIn(w.sub);
  scare = scare ?? (th === 'halloween');
  const el = document.createElement('div');
  el.className = 'season-peek' + (scare ? ' scare' : '') + (short ? ' short' : '') + (state.account ? '' : ' at-top');
  el.setAttribute('role', 'status');
  const firstMood = mood || (scare ? 'angry' : w.mood);
  el.innerHTML = `<div class="season-peek-rico">${ricoFace(firstMood, '')}${scare ? `<div class="season-sheet">${SVG_BITS.ghost}</div>` : ''}</div><div class="season-bubble" dir="auto">${esc(head)}${scare || !line ? '' : `<small>${esc(line)}</small>`}</div>`;
  // Sit above the send bar or the tab bar, so nothing important is covered.
  const bar = [...document.querySelectorAll('.bottom-bar.show, .bottomnav')].map(x=>x.getBoundingClientRect()).filter(r=>r.height && r.top > innerHeight * .5).sort((a, b)=>a.top - b.top)[0];
  if(bar && state.account) el.style.bottom = Math.round(innerHeight - bar.top + 10) + 'px';
  document.body.appendChild(el);
  const snd = SEASON_SOUNDS[th];
  if(snd && soundOn('sent')) playSeasonTones(snd.sent, snd.gain || .12, snd.type);
  if(scare){
    if(!matchMedia('(prefers-reduced-motion: reduce)').matches){
      document.getElementById('app')?.classList.add('season-shake');
      setTimeout(()=>document.getElementById('app')?.classList.remove('season-shake'), 450);
    }
    setTimeout(()=>{
      if(!el.isConnected) return;
      const bot = el.querySelector('.rico-bot');
      if(bot) bot.outerHTML = ricoFace('excited', '');
      el.querySelector('.season-bubble').innerHTML = `${esc(head)}${line ? `<small>${esc(line)}</small>` : ''}`;
    }, 1900);
  }
  const close = ()=>{ el.classList.add('out'); setTimeout(()=>el.remove(), 360); };
  el.addEventListener('click', close);
  seasonPeekTimer = setTimeout(close, short ? (scare ? 4200 : 3200) : (scare ? 7500 : 6500));
}

/* Sparkles where the finger tapped. */
const SEASON_BITS = {
  halloween:()=>Math.random() < .5 ? SVG_BITS.bat : SVG_BITS.ghost,
  winter:()=>'<svg viewBox="0 0 24 24"><path d="M12 2v20M3.3 7l17.4 10M20.7 7L3.3 17" stroke="#8CC8EE" stroke-width="2.6" stroke-linecap="round"/></svg>',
  christmas:()=>`<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4.5" fill="${['#E04848','#E0B04C','#4FA3E0','#3FBF6F'][Math.floor(Math.random()*4)]}"/></svg>`,
  flagday:()=>`<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4.5" fill="${['#ED2024','#FFFFFF','#278E43','#FEBD11'][Math.floor(Math.random()*4)]}" stroke="rgba(0,0,0,.12)"/></svg>`,
  newroz:()=>`<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4.5" fill="${['#ED2024','#FFFFFF','#278E43','#FEBD11'][Math.floor(Math.random()*4)]}" stroke="rgba(0,0,0,.12)"/></svg>`,
  ramadan:()=>`<span style="color:#E2B04A">${SVG_BITS.star}</span>`,
  eid:()=>Math.random() < .4 ? SVG_BITS.kleicha : `<span style="color:#E9B949">${SVG_BITS.star}</span>`,
  spring:()=>`<span style="color:${Math.random() < .5 ? '#F28FB0' : '#F7C6D6'}">${SVG_BITS.petal}</span>`,
  autumn:()=>`<span style="color:${['#D9792B','#B8601E','#E0A030','#9C3324'][Math.floor(Math.random()*4)]}">${SVG_BITS.leaf}</span>`,
  summer:()=>Math.random() < .5 ? '<svg viewBox="0 0 10 14"><path d="M5 0C5 0 0 6 0 9a5 5 0 0 0 10 0C10 6 5 0 5 0z" fill="#5BC0EB"/></svg>' : '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="5" fill="#FFB547"/></svg>',
  match:()=>SVG_BITS.ball
};
function seasonSparkle(th, x, y, count = 6, spread = 70){
  if(!SEASON_BITS[th] || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for(let i = 0; i < count; i++){
    const p = document.createElement('span');
    p.className = 'season-bit';
    const a = rnd(0, Math.PI * 2), r = rnd(spread * .4, spread);
    p.style.cssText = `left:${x}px;top:${y}px;--dx:${(Math.cos(a)*r).toFixed(0)}px;--dy:${(Math.sin(a)*r - spread*.5).toFixed(0)}px;--s:${rnd(.7,1.3).toFixed(2)};--r:${rnd(-120,120).toFixed(0)}deg;width:${th==='halloween'||th==='match'?18:12}px`;
    p.innerHTML = SEASON_BITS[th]();
    document.body.appendChild(p);
    setTimeout(()=>p.remove(), 1000);
  }
}
/* Tapping + in a holiday theme: sparkles, and every so often Rico jumps out. */
let seasonTaps = 0, seasonNext = 4, seasonLast = 0;
document.addEventListener('pointerdown', e=>{
  const b = e.target.closest && e.target.closest('[data-inc]');
  if(!b || typeof state === 'undefined' || !state.account) return;
  const th = currentTheme();
  if(!isHolidayTheme(th) || !surprisesOn()) return;
  seasonSparkle(th, e.clientX, e.clientY);
  seasonTaps++;
  if(seasonTaps >= seasonNext && Date.now() - seasonLast > 60000){
    seasonLast = Date.now();
    seasonNext = seasonTaps + Math.round(rnd(8, 14));
    const w = SEASON_WORDS[th];
    setTimeout(()=>seasonMoment(th, {title:w.pop, sub:w.popSub, short:true}), 120);
  }
}, true);
/* Every order sent: a themed celebration (called by app.js). */
function seasonCelebrate(){
  const th = currentTheme();
  if(!isHolidayTheme(th) || !surprisesOn()) return false;
  for(let i = 0; i < 4; i++) setTimeout(()=>seasonSparkle(th, rnd(innerWidth*.2, innerWidth*.8), rnd(innerHeight*.35, innerHeight*.6), 9, 140), i * 160);
  setTimeout(()=>seasonMoment(th, {title:SEASON_WORDS[th].sent, sub:null, scare:false, mood:'excited'}), 300);
  return true;
}
/* Once a day per holiday theme, a little after the app opens, Rico says hello in costume.
   One saved value ("theme|Baghdad day") remembers the last hello, so nothing piles up on the phone. */
function seasonGreeting(){
  const th = currentTheme();
  if(!isHolidayTheme(th) || !state.account) return;
  const {y, md} = seasonToday(), seen = th + '|' + y + '-' + md;
  if(lget('seasonHello') === seen) return;
  lset('seasonHello', seen);
  setTimeout(()=>{ if(currentTheme() === th && !document.querySelector('.modal-overlay')) seasonMoment(th); }, 2600);
}
