/* Sounds, made by the app itself (nothing is downloaded).
     + and -        a soft tap (+ a touch higher than -)
     orders sent    a rising C-E-G-C chime
   Each one can be turned on or off per device on the Sounds screen. On
   iPhone they follow the silent switch like any app. Browsers only allow
   sound once the person has touched the page, so the audio is (re)started
   on every touch until it is running. */
const SOUND_KEYS = {qty:'sound.qty', sent:'sound.sent'};
let soundCtx = null, soundOut = null, lastTick = 0;

// Everything starts on until it is turned off on this device.
function soundOn(which){ return lget(SOUND_KEYS[which]) !== 'off'; }
function setSoundOn(which, on){ lset(SOUND_KEYS[which], on ? 'on' : 'off'); }

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

function soundTone(f, dur, gain, at = 0){
  const c = soundContext();
  if(!c) return;
  const t = c.currentTime + at + .005;
  const o = c.createOscillator(), g = c.createGain();
  o.frequency.setValueAtTime(f, t);
  g.gain.setValueAtTime(.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + .005);
  g.gain.exponentialRampToValueAtTime(.0001, t + dur);
  o.connect(g); g.connect(soundOut);
  o.start(t); o.stop(t + dur + .02);
}

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
