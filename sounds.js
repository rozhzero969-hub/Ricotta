/* Two small sounds, made by the app itself (nothing is downloaded):
     a soft tap on the order + and - buttons (+ a touch higher than -),
     and a rising chime when today's orders have all been sent.
   They can be turned off per device in Settings, and on iPhone they follow
   the silent switch like any app. Browsers only allow sound after the first
   tap, so the audio is switched on then. */
const SOUND_PREF = 'sounds';   // stored per device; on unless turned off
let soundCtx = null, soundOut = null, lastTick = 0;

function soundsOn(){ return lget(SOUND_PREF) !== 'off'; }
function setSoundsOn(on){ lset(SOUND_PREF, on ? 'on' : 'off'); }

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
// Wake the audio on the first tap, so the first real sound is not lost.
document.addEventListener('pointerdown', ()=>{ if(soundsOn()) soundContext(); }, {once:true, passive:true});

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
  if(!soundsOn()) return;
  const now = performance.now();
  if(now - lastTick < 45) return;
  lastTick = now;
  soundTone(up ? 1150 : 900, .045, .22);
}

/* All orders sent: C, E, G, C rising, each with a quiet bell overtone. */
function playOrdersSent(){
  if(!soundsOn()) return;
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i)=>{
    soundTone(f, .6, .16, i * .085);
    soundTone(f * 2.01, .36, .04, i * .085);
  });
}
