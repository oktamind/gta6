// Sound, all synthesized with WebAudio — no audio files, nothing fetched.
// Engine hum (oscillator pitch follows speed), gunshots (noise burst), siren (two-tone loop
// while wanted), pickup blips and a mission-complete jingle. M toggles mute.
// v2 adds the car radio (three synth stations, Q cycles), a NOS whoosh, a helicopter
// rotor thump, a drift screech and a shop till blip — all synthesized live.
import { RADIO } from './config.js';

export function createSound() {
  let ctx = null;
  let muted = false;
  let engineOsc = null;
  let engineGain = null;
  let sirenOsc = null;
  let sirenGain = null;
  let sirenTimer = 0;
  // Radio state (v2): station index, on/off, next-note scheduler.
  let radioStation = 0;
  let radioOn = true;
  let radioStep = 0;
  let radioNextT = 0;
  let radioGain = null;
  let heliGain = null;
  let heliOsc = null;
  let heliTimer = 0;

  function ensure() {
    if (ctx) return ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      engineOsc = ctx.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 50;
      engineGain = ctx.createGain();
      engineGain.gain.value = 0;
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = 420;
      engineOsc.connect(filt).connect(engineGain).connect(ctx.destination);
      engineOsc.start();
      sirenOsc = ctx.createOscillator();
      sirenOsc.type = 'sine';
      sirenOsc.frequency.value = 700;
      sirenGain = ctx.createGain();
      sirenGain.gain.value = 0;
      sirenOsc.connect(sirenGain).connect(ctx.destination);
      sirenOsc.start();
      // Radio bus (v2) + heli rotor bus (v2): quiet gains, driven by stepRadio/stepHeli.
      radioGain = ctx.createGain();
      radioGain.gain.value = 0.05;
      radioGain.connect(ctx.destination);
      heliOsc = ctx.createOscillator();
      heliOsc.type = 'square';
      heliOsc.frequency.value = 22;
      heliGain = ctx.createGain();
      heliGain.gain.value = 0;
      const heliFilt = ctx.createBiquadFilter();
      heliFilt.type = 'lowpass';
      heliFilt.frequency.value = 220;
      heliOsc.connect(heliFilt).connect(heliGain).connect(ctx.destination);
      heliOsc.start();
    } catch { ctx = null; }
    return ctx;
  }

  // One radio note: a short triangle blip on the current station's scale.
  function radioNote() {
    if (!ctx || muted || !radioOn || !radioGain) return;
    const st = RADIO[radioStation % RADIO.length];
    const stepDur = 60 / st.tempo / 2;
    const degree = st.scale[radioStep % st.scale.length] + 12 * Math.floor(radioStep / st.scale.length) % 2;
    const freq = st.root * Math.pow(2, degree / 12);
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = radioStep % 4 === 0 ? 'square' : 'triangle';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.09, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + stepDur * 0.9);
    o.connect(g).connect(radioGain);
    o.start(t);
    o.stop(t + stepDur);
    radioStep += 1;
  }

  function blip(freq, dur, type, vol) {
    if (!ensure() || muted) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol || 0.15, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + dur);
  }

  function noise(dur, vol, lowpass) {
    if (!ensure() || muted) return;
    const t = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = vol;
    if (lowpass) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lowpass;
      src.connect(f).connect(g).connect(ctx.destination);
    } else {
      src.connect(g).connect(ctx.destination);
    }
    src.start(t);
  }

  return {
    unlock() { ensure(); if (ctx && ctx.state === 'suspended') ctx.resume(); },
    toggleMute() { muted = !muted; return muted; },
    get muted() { return muted; },
    shoot(isSmg) { noise(0.12, 0.35, isSmg ? 2600 : 1800); },
    punch() { noise(0.08, 0.25, 900); },
    pickup() { blip(880, 0.12, 'sine', 0.2); blip(1320, 0.18, 'sine', 0.15); },
    cash() { blip(660, 0.1, 'triangle', 0.2); setTimeout(() => blip(990, 0.16, 'triangle', 0.2), 90); },
    missionDone() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => blip(f, 0.22, 'triangle', 0.22), i * 110)); },
    busted() { [392, 330, 262].forEach((f, i) => setTimeout(() => blip(f, 0.3, 'sawtooth', 0.18), i * 160)); },
    honk() { blip(370, 0.25, 'square', 0.12); },
    engine(speed01, on) {
      if (!ensure() || muted) { if (engineGain) engineGain.gain.value = 0; return; }
      engineOsc.frequency.value = 45 + speed01 * 130;
      engineGain.gain.value = on ? 0.03 + speed01 * 0.05 : 0;
    },
    siren(wanted, dt) {
      if (!ensure() || muted || wanted === 0) { if (sirenGain) sirenGain.gain.value = 0; return; }
      sirenTimer += dt;
      const twoTone = Math.sin(sirenTimer * 2.4) > 0 ? 720 : 540;
      sirenOsc.frequency.value = twoTone;
      sirenGain.gain.value = 0.035;
    },
    // v2: radio scheduler — call every frame; notes fire on the station's tempo.
    stepRadio(dt, inCar) {
      if (!ensure() || muted || !radioOn || !inCar) return;
      radioNextT -= dt;
      if (radioNextT <= 0) {
        const st = RADIO[radioStation % RADIO.length];
        radioNextT = 60 / st.tempo / 2;
        radioNote();
      }
    },
    radioNext() {
      radioStation = (radioStation + 1) % RADIO.length;
      radioStep = 0;
      return RADIO[radioStation];
    },
    get radioStation() { return RADIO[radioStation % RADIO.length]; },
    radioToggle() { radioOn = !radioOn; return radioOn; },
    nos() { noise(0.45, 0.22, 3200); blip(1200, 0.3, 'sawtooth', 0.08); },
    drift() { noise(0.18, 0.12, 5200); },
    heli(active, dt) {
      if (!ensure() || muted) { if (heliGain) heliGain.gain.value = 0; return; }
      if (!active) { if (heliGain) heliGain.gain.value = 0; return; }
      heliTimer += dt;
      heliOsc.frequency.value = 20 + Math.sin(heliTimer * 9) * 4;
      heliGain.gain.value = 0.05;
    },
    till() { blip(1046, 0.1, 'triangle', 0.2); setTimeout(() => blip(1568, 0.18, 'triangle', 0.18), 90); },
  };
}
