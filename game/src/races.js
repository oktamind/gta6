// Street races (v3): repeatable time-trial circuits with two AI rivals.
// A race is a small state machine owned by this module: the player starts one by
// pressing E at a circuit's start flag (main.js), then drives its gates in order
// before the clock runs out. Two rival cars chase the same gates on their own
// steering — they are visual competition with a real effect: finish ahead of both
// and the prize pays 1.5x. The module owns no rendering; render.js draws the gates
// and main.js moves the rival cars and pays the prize.
import { RACE_EVENTS } from './config.js';
import { makeCar } from './vehicles.js';

export function createRaceState() {
  return {
    active: false,
    event: null,       // the RACE_EVENTS entry being run
    gateIndex: 0,
    timer: 0,
    rivals: [],        // rival cars (in G.raceRivals for the renderer)
    rivalsDone: 0,     // rivals that already finished
    best: {},          // event id -> best finish time in seconds
  };
}

export function raceEventAt(x, z) {
  for (const ev of RACE_EVENTS) {
    if (Math.hypot(x - ev.start.x, z - ev.start.z) < 10) return ev;
  }
  return null;
}

// Start a race. Returns the rival cars main.js should put in the world.
export function startRace(state, event, random) {
  state.active = true;
  state.event = event;
  state.gateIndex = 0;
  state.timer = event.time;
  state.rivalsDone = 0;
  state.rivals = [];
  const rivalColors = [0x7d3c98, 0x16a085];
  for (let i = 0; i < 2; i += 1) {
    const r = makeCar(
      event.start.x + (i === 0 ? -6 : 6),
      event.start.z - 6,
      0,
      rivalColors[i],
      { traffic: false },
    );
    r.speed = 0;
    r.cruise = 23 + random() * 3;   // rivals run a little slower than a NOS car
    r.gateIndex = 0;
    r.finished = false;
    r.finishT = 0;
    state.rivals.push(r);
  }
  return state.rivals;
}

// Steer one rival toward its next gate. Same arcade steering as the police chase
// (see vehicles.stepPolice) but aimed at a gate, not at the player. `helpers` is
// { collide(p, r), gatesLen, elapsed } so this module never reaches into city data
// it does not own.
export function stepRival(rival, gate, dt, helpers) {
  if (!gate || rival.finished) return;
  const dx = gate.x - rival.x, dz = gate.z - rival.z;
  const dist = Math.hypot(dx, dz);
  const want = Math.atan2(dx, dz);
  let diff = want - rival.angle;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  rival.angle += Math.max(-1.9 * dt, Math.min(1.9 * dt, diff));
  const wantSpeed = dist > 10 ? rival.cruise : rival.cruise * 0.7;
  rival.speed += (wantSpeed - rival.speed) * Math.min(1, dt * 1.4);
  rival.x += Math.sin(rival.angle) * rival.speed * dt;
  rival.z += Math.cos(rival.angle) * rival.speed * dt;
  const p = { x: rival.x, z: rival.z };
  if (helpers && helpers.collide) helpers.collide(p, 2.2);
  rival.x = p.x; rival.z = p.z;
  if (dist < 9) {
    rival.gateIndex += 1;
    if (rival.gateIndex >= (helpers ? helpers.gatesLen : 0)) {
      rival.finished = true;
      rival.finishT = helpers ? helpers.elapsed : 0;
    }
  }
}

// Advance the race by dt. `ctx` carries the live facts: player pos, whether the
// player is in a car. Returns events: { completed, failed, reason, pay, bonus }.
export function stepRace(state, dt, ctx) {
  const ev = {};
  if (!state.active || !state.event) return ev;
  state.timer -= dt;
  if (state.timer <= 0) {
    state.active = false;
    ev.failed = true;
    ev.reason = 'Out of time — the circuit went cold.';
    state.rivals = [];
    return ev;
  }
  const gates = state.event.gates;
  const gate = gates[state.gateIndex];
  if (gate && Math.hypot(ctx.x - gate.x, ctx.z - gate.z) < 9 && ctx.inCar) {
    state.gateIndex += 1;
    if (state.gateIndex >= gates.length) {
      state.active = false;
      const elapsed = state.event.time - state.timer;
      const prev = state.best[state.event.id];
      if (!prev || elapsed < prev) state.best[state.event.id] = elapsed;
      const beatRivals = state.rivals.every((r) => !r.finished);
      ev.completed = true;
      ev.pay = beatRivals ? Math.round(state.event.prize * 1.5) : state.event.prize;
      ev.bonus = beatRivals;
      ev.time = elapsed;
      state.rivals = [];
      return ev;
    }
    ev.message = `Gate ${state.gateIndex} cleared — ${gates.length - state.gateIndex} to go.`;
  }
  return ev;
}

export function raceObjectiveText(state) {
  if (!state.active || !state.event) return null;
  const gates = state.event.gates;
  return {
    title: `STREET RACE — ${state.event.name.toUpperCase()}`,
    text: `Gate ${state.gateIndex + 1} of ${gates.length} — $${state.event.prize}${state.rivals.every((r) => !r.finished) ? ' (1.5x if you beat both rivals)' : ''}.`,
    sub: `${Math.ceil(state.timer)}s left — Shift = NOS, Space = drift.`,
  };
}
