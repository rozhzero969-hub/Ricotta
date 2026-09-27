/* Sounds and haptics, both made by the app itself (nothing is downloaded).
     + and -        a soft tap (+ a touch higher than -)
     orders sent    a rising C-E-G-C chime
     swiping        a quiet, airy chord when swiping between the 3 main tabs
                    (a little higher going forward, lower going back)
   Each sound and the haptics can be turned on or off per device on the
   Sounds & haptics screen. On iPhone the sounds follow the silent switch like
   any app. Browsers only allow sound after the first tap, so the audio is
   switched on then. */
const SOUND_KEYS = {qty:'sound.qty', sent:'sound.sent', swipe:'sound.swipe'};
let soundCtx = null, soundOut = null, lastTick = 0, hapticSwitch = null;

// Everything starts on until it is turned off on this device.
const prefOn = key=>lget(key) !== 'off';
function soundOn(which){ return prefOn(SOUND_KEYS[which]); }
function setSoundOn(which, on){ lset(SOUND_KEYS[which], on ? 'on' : 'off'); }
function hapticsOn(){ return prefOn('haptics'); }
function setHapticsOn(on){ lset('haptics', on ? 'on' : 'off'); }

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
document.addEventListener('pointerdown', ()=>{ if(Object.keys(SOUND_KEYS).some(soundOn)) soundContext(); }, {once:true, passive:true});

function soundTone(f, dur, gain, at = 0, attack = .005){
  const c = soundContext();
  if(!c) return;
  const t = c.currentTime + at + .005;
  const o = c.createOscillator(), g = c.createGain();
  o.frequency.setValueAtTime(f, t);
  g.gain.setValueAtTime(.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
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
  haptic(20);
  if(!soundOn('sent')) return;
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i)=>{
    soundTone(f, .6, .16, i * .085);
    soundTone(f * 2.01, .36, .04, i * .085);
  });
}

/* Swiping between the 3 main tabs: a quiet chord (a note and its fifth) that
   swells in and fades, C going back and D going forward. */
function playSwipe(forward){
  if(!soundOn('swipe')) return;
  const f = forward ? 293.7 : 261.6;
  soundTone(f, .42, .055, 0, .12);
  soundTone(f * 1.5, .42, .033, 0, .12);
}

/* A light haptic tap. Android phones vibrate; iPhone (iOS 18 and newer) has
   no vibration for websites, but gives a real haptic tick when a switch
   control is toggled, so a hidden switch is toggled instead. Works best
   straight from a tap or the end of a swipe. */
function haptic(ms = 8){
  if(!hapticsOn()) return;
  try{
    if(navigator.vibrate){ navigator.vibrate(ms); return; }
    if(!hapticSwitch){
      hapticSwitch = document.createElement('label');
      hapticSwitch.setAttribute('aria-hidden', 'true');
      hapticSwitch.style.cssText = 'position:fixed;left:-60px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
      const input = document.createElement('input');
      input.type = 'checkbox'; input.tabIndex = -1; input.setAttribute('switch', '');
      hapticSwitch.appendChild(input);
      document.body.appendChild(hapticSwitch);
    }
    const had = document.activeElement;
    hapticSwitch.click();
    if(had && document.activeElement !== had) had.focus?.({preventScroll:true});
  }catch(_){}
}
