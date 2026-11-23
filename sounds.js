/* Sounds, made by the app itself (nothing is downloaded).
     + and -           a soft tap (+ a touch higher than -)
     orders sent       a rising C-E-G-C chime
     Rico replies      two soft notes, up
     something wrong   two low notes, down (wrong PIN, a failed save)
     a milestone       a short fanfare (rare on purpose)
     undo              the order chime falling back down
   Each one can be turned on or off per device on the Settings. On
   iPhone they follow the silent switch like any app. Browsers only allow
   sound once the person has touched the page, so the audio is (re)started
   on every touch until it is running. */
const SOUND_KEYS = {qty:'soundQty', sent:'soundSent', rico:'soundRico', error:'soundError', milestone:'soundMilestone', undo:'soundUndo'};
let soundCtx = null, soundOut = null, lastTick = 0;

// They are account settings (features.js) and start on.
function soundOn(which){ return typeof featureOn === 'function' ? featureOn(SOUND_KEYS[which]) : true; }
function setSoundOn(which, on){ setFeature(SOUND_KEYS[which], on); }

function soundContext(){
  if(!soundCtx){
    const AC = window.AudioContext || window.webkitAudioContext;
    if(!AC) return null;
    // "ambient": quiet in silent mode, and never stops music that is playing.
    try{ if(navigator.audioSession) navigator.audioSession.type = 'ambient'; }catch(_){}
    soundCtx = new AC();
    soundOut = soundCtx.createGain();
    soundOut.gain.value = .6;
    soundOut.connect(soundCtx.destination);
  }
  if(soundCtx.state !== 'running') soundCtx.resume().catch(()=>{});
  return soundCtx;
}
// iPhone only lets audio start from a finished touch (touchend / click), not
// from the moment the finger lands, so every kind of touch gets a chance.
['pointerdown','touchend','click'].forEach(type=>document.addEventListener(type, ()=>{
  if(soundCtx?.state !== 'running' && Object.keys(SOUND_KEYS).some(soundOn)) soundContext();
}, {passive:true, capture:true}));

function soundTone(f, dur, gain, at = 0, type = 'sine'){
  const c = soundContext();
  if(!c) return;
  const t = c.currentTime + at + .005;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  g.gain.setValueAtTime(.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + .005);
  g.gain.exponentialRampToValueAtTime(.0001, t + dur);
  o.connect(g); g.connect(soundOut);
  o.start(t); o.stop(t + dur + .02);
}

/* Words for the iPhone app (RicottaViewController.swift). It accepts only these and sends nothing
   back; in a browser they go nowhere.
   - Haptics, used sparingly as Apple's apps do: a tick when an amount changes, a success tap when
     the orders are sent, an error buzz for a wrong PIN and a bump when the press-and-hold menu opens.
   - The page's look (the dark green loading screen, then dark or light), so the app paints the same colour
     behind the page and the status bar text stays readable.
   - The Mac app only (MainWindowController.swift): "Always see-through" switched in Settings, and a press
     or double-click on an empty part of the top bar or sidebar, which moves or zooms the window, and the
     Dock icon and colour theme chosen in Settings (icon:monogram, theme:pink). */
// The Dock icons: one for each theme first (in MAC_THEMES order), then the others. The first is the default.
const MAC_ICONS = ['ricotta','pumpkin','holly','moonlit','gemini','cupid','discord'];
const MAC_THEMES = ['ricotta','halloween','christmas','moonlit','google','pink','discord'];
/* Original Ricotta palettes inspired by the range of Discord's color themes.
   Each uses solid reading surfaces with color reserved for the surround and accents. */
const COLOR_PALETTES = [
  ['discord','Discord','#252633','#24252A','#AEB6FF'],
  ['berry','Blackberry','#3C223E','#241928','#F2A7D8'],
  ['iris','Iris Hour','#302952','#211B35','#C5B5FF'],
  ['lagoon','Blue Lagoon','#15404B','#142935','#83E0EA'],
  ['linen','Linen','#493A2B','#2C241D','#F7CF9A'],
  ['evening','Evening Peach','#4B293C','#35222B','#FFC1A0'],
  ['matcha','Iced Matcha','#2E4233','#1E2B24','#C2E495'],
  ['sea','Deep Sea','#20365C','#122033','#90C3FF'],
  ['embers','Embers','#4C2A20','#2D1C1A','#FFA983'],
  ['noir','Noir','#31313A','#131319','#D8D9EA'],
  ['plum','Plum Fizz','#482D5A','#2E213B','#E7B2FF'],
  ['mintwave','Mint Wave','#1D4347','#152933','#99E9CC'],
  ['cocoa','Cocoa','#49312C','#2C211F','#EBC3AF'],
  ['tiramisu','Tiramisu','#463543','#2A202F','#EAC2D6'],
  ['opal','Opal','#2B3857','#1F2539','#D0DFFD'],
  ['papaya','Papaya','#4C3626','#312522','#FFCA77'],
  ['moss','Moss Garden','#374331','#242D24','#C7DEA5'],
  ['slate','Blue Slate','#303E48','#202932','#B3D8E9'],
  ['cobalt','Cobalt','#25346B','#1D2141','#A6C1FF'],
  ['orchid','Orchid Night','#472D55','#282039','#E5B9FF'],
  ['pom','Pomegranate','#4C253A','#321E29','#FFAACD'],
  ['dawn','Soft Dawn','#453349','#2B2B40','#F6BEE8'],
  ['jade','Jade','#1F443F','#152D2A','#9BE6C1'],
  ['marine','Aquamarine','#1C3D53','#172C36','#92E2F3'],
  ['caramel','Caramel','#4A3A22','#302618','#FFDF92'],
  ['lavender','Lavender Milk','#373151','#242231','#D8CBFF'],
  ['brick','Rosy Brick','#493033','#2E2329','#FFB8B8'],
  ['polar','Polar Haze','#283846','#182530','#A7E0FF'],
  ['cosmic','Cosmic Sorbet','#3D2B62','#262341','#FFB7EA'],
];
const NATIVE_WORDS = ['selection','light','medium','success','warning','error','page-splash','page-dark','page-light','see-through-on','see-through-off','window-drag','window-zoom',
  ...MAC_ICONS.map(n=>'icon:' + n), ...MAC_THEMES.map(n=>'theme:' + n)];
function tellApp(word){
  try{ if(NATIVE_WORDS.includes(word)) window.webkit?.messageHandlers?.ricotta?.postMessage(word); }catch(_){ /* never interrupt the app */ }
}
const haptic = kind=>tellApp(kind);

/* + and -: a soft, round tap. Holding a button repeats quickly, so ticks
   closer than 45 ms apart are skipped to keep it gentle. */
function playQtyTick(up){
  if(!soundOn('qty')) return;
  const now = performance.now();
  if(now - lastTick < 45) return;
  lastTick = now;
  soundTone(up ? 1150 : 900, .045, .22);
}

/* All orders sent: C, E, G, C rising, each with a quiet bell overtone. */
function playOrdersSent(){
  if(!soundOn('sent')) return;
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i)=>{
    soundTone(f, .6, .16, i * .085);
    soundTone(f * 2.01, .36, .04, i * .085);
  });
}

/* Rico's answer arrived: E then A, soft. */
function playRicoReply(){
  if(!soundOn('rico')) return;
  soundTone(1318.5, .35, .14); soundTone(1760, .5, .12, .12);
}
/* Something went wrong: two low notes, never loud. */
function playError(){
  if(!soundOn('error')) return;
  soundTone(220, .12, .2, 0, 'triangle'); soundTone(196, .16, .2, .13, 'triangle');
}
/* A kitchen milestone or a streak goal: C E G C E. */
function playMilestone(){
  if(!soundOn('milestone')) return;
  [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i)=>{ soundTone(f, .7, .13, i * .09); soundTone(f * 2.01, .42, .03, i * .09); });
}
/* Undo: the order chime going back down. */
function playUndo(){
  if(!soundOn('undo')) return;
  [1046.5, 783.99, 659.25].forEach((f, i)=>{ soundTone(f, .4, .12, i * .07); soundTone(f * 2.01, .24, .03, i * .07); });
}
