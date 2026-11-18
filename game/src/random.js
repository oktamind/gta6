// A small seeded random number generator (mulberry32): the same seed gives the same city,
// which is what makes the screenshot scenes repeatable.
export function createRandom(seed) {
  let a = seed | 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick(random, array) {
  return array[Math.floor(random() * array.length)];
}

export function range(random, min, max) {
  return min + random() * (max - min);
}

// Seeded helpers, all through the same RNG so screenshots stay deterministic.
export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

export function shuffle(random, array) {
  const a = array.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

export function choice(random, array) {
  return array[Math.floor(random() * array.length)];
}

// Pick `n` distinct items from an array (Fisher-Yates prefix).
export function sample(random, array, n) {
  return shuffle(random, array).slice(0, Math.min(n, array.length));
}

// v3: linear interpolation and a seeded coin flip — small helpers the race rival
// spacing and the HUD smoothing use instead of inlining the same math twice.
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function chance(random, p) {
  return random() < p;
}
