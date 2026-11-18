// Sound, all synthesized with WebAudio — no audio files, nothing fetched.
// Engine hum (oscillator pitch follows speed), gunshots (noise burst), siren (two-tone loop
// while wanted), pickup blips and a mission-complete jingle. M toggles mute.
export function createSound() {
  let ctx = null;
  let muted = false;
  let engineOsc = null;
  let engineGain = null;
  let sirenOsc = null;
  let sirenGain = null;
  let sirenTimer = 0;

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
    } catch { ctx = null; }
    return ctx;
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
  };
}
