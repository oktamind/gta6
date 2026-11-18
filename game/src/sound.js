// Sound, all synthesized with WebAudio — no audio files, nothing fetched.
// Engine hum (oscillator pitch follows speed), gunshots (noise burst), siren
// (two-tone loop while wanted), pickup blips and a mission-complete jingle.
// M toggles mute. The radio is four synth stations (Q cycles), plus a NOS
// whoosh, a helicopter rotor thump, a drift screech and a shop till blip —
// all synthesized live. The rifle cracks deeper and longer than the pistol;
// races get countdown beeps and a win stinger.
// Feel: every tone is pitch-varied by a deterministic wobble so identical
// repeats never sound like a machine gun — the variation rides on a counter,
// never Math.random, so the game stays deterministic under test.
import { RADIO } from './config.js';

export function createSound() {
  let ctx = null;
  let muted = false;
  // Live buses, built once by ensure().
  let engineOsc = null, engineGain = null;
  let sirenOsc = null, sirenGain = null, sirenTimer = 0;
  let radioGain = null, radioStation = 0, radioOn = true;
  let radioStep = 0, radioNextT = 0;
  let heliOsc = null, heliGain = null, heliTimer = 0;
  // Deterministic pitch wobble: each tone advances the counter and detunes
  // by up to ±6% on a fixed sine, so repeats stay alive but reproducible.
  let voice = 0;
  const detune = () => 1 + Math.sin((voice += 1) * 2.4) * 0.06;

  function makeBus(type, freq, filterFreq) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    if (filterFreq) {
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = filterFreq;
      osc.connect(filt).connect(gain);
    } else {
      osc.connect(gain);
    }
    gain.connect(ctx.destination);
    osc.start();
    return { osc, gain };
  }

  function ensure() {
    if (ctx) return ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      const eng = makeBus('sawtooth', 50, 420);
      engineOsc = eng.osc; engineGain = eng.gain;
      const sir = makeBus('sine', 700, 0);
      sirenOsc = sir.osc; sirenGain = sir.gain;
      radioGain = ctx.createGain();
      radioGain.gain.value = 0.05;
      radioGain.connect(ctx.destination);
      const hel = makeBus('square', 22, 220);
      heliOsc = hel.osc; heliGain = hel.gain;
    } catch { ctx = null; }
    return ctx;
  }

  // One short oscillator tone. `when` delays it (for jingles); every tone
  // gets the deterministic pitch wobble.
  function note(freq, dur, type, vol, when = 0) {
    if (!ensure() || muted) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.value = freq * detune();
    g.gain.setValueAtTime(vol || 0.15, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + dur);
  }

  // A noise burst, optionally low-passed. The buffer is white noise by
  // nature; its randomness never touches game state or screenshots.
  function burst(dur, vol, lowpass) {
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

  // A rising line of notes, `stepMs` apart — the jingle shape for mission
  // wins, busts and race wins.
  function arpeggio(freqs, stepMs, dur, type, vol) {
    freqs.forEach((f, i) => note(f, dur, type, vol, (i * stepMs) / 1000));
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

  const SHOTS = {
    smg: () => burst(0.12, 0.35, 2600),
    shotgun: () => burst(0.22, 0.45, 1200),
    rifle: () => { burst(0.28, 0.5, 900); note(180, 0.18, 'sawtooth', 0.2); },
    pistol: () => burst(0.12, 0.35, 1800),
  };

  return {
    unlock() { ensure(); if (ctx && ctx.state === 'suspended') ctx.resume(); },
    toggleMute() { muted = !muted; return muted; },
    get muted() { return muted; },
    // shoot takes the weapon kind — the rifle cracks deeper and longer than
    // the pistol, the SMG stays a fast bark, the shotgun a wide thump.
    shoot(kind) { (SHOTS[kind] || SHOTS.pistol)(); },
    punch() { burst(0.08, 0.25, 900); },
    pickup() { note(880, 0.12, 'sine', 0.2); note(1320, 0.18, 'sine', 0.15, 0); },
    cash() { note(660, 0.1, 'triangle', 0.2); note(990, 0.16, 'triangle', 0.2, 0.09); },
    missionDone() { arpeggio([523, 659, 784, 1046], 110, 0.22, 'triangle', 0.22); },
    busted() { arpeggio([392, 330, 262], 160, 0.3, 'sawtooth', 0.18); },
    honk() { note(370, 0.25, 'square', 0.12); },
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
    // Radio scheduler — call every frame; notes fire on the station's tempo.
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
    nos() { burst(0.45, 0.22, 3200); note(1200, 0.3, 'sawtooth', 0.08); },
    // The overheat clunk — a short low thud when the NOS kit locks out.
    nosOverheat() { note(140, 0.25, 'square', 0.2); burst(0.15, 0.15, 600); },
    drift() { burst(0.18, 0.12, 5200); },
    heli(active, dt) {
      if (!ensure() || muted) { if (heliGain) heliGain.gain.value = 0; return; }
      if (!active) { if (heliGain) heliGain.gain.value = 0; return; }
      heliTimer += dt;
      heliOsc.frequency.value = 20 + Math.sin(heliTimer * 9) * 4;
      heliGain.gain.value = 0.05;
    },
    till() { note(1046, 0.1, 'triangle', 0.2); note(1568, 0.18, 'triangle', 0.18, 0.09); },
    // Street-race stingers — three countdown beeps and a rising win arpeggio.
    raceBeep() { note(660, 0.12, 'square', 0.18); },
    raceWin() { arpeggio([523, 659, 784, 1046, 1318], 100, 0.2, 'triangle', 0.22); },
  };
}
