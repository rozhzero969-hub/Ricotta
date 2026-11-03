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
     behind the page and the status bar text stays readable. */
const NATIVE_WORDS = ['selection','light','medium','success','warning','error','page-splash','page-dark','page-light'];
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
