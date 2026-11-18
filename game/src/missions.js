// The story: five jobs from fixer Delia Voss, plus a repeatable taxi side job.
// A mission is a small state machine: each step has a target point, a radius, and text.
// The module owns no rendering — it reports the current marker, timer and objective text,
// and main.js moves the player-facing state (cash, wanted) when a mission completes.
// Markers use landmark APPROACH points (see world.landmarkApproach): the landmark buildings
// are 26 m wide, so a marker at the building centre is unreachable behind the walls.
import { MISSIONS } from './config.js';
import { landmarkApproach } from './world.js';

export function createMissionState() {
  return {
    index: 0,            // mission currently offered (0..4); 5 = story done
    done: [false, false, false, false, false],
    active: false,       // a mission is currently being run
    step: 0,
    timer: 0,            // countdown for timed steps, 0 = no timer
    holdT: 0,            // vault hold progress
    kills: 0,            // gulls dealt with (mission 3)
    checkpoints: [],     // courier checkpoints (mission 2)
    checkpointIndex: 0,
    packageT: 0,         // survival timer (mission 4)
    marker: null,        // { x, z, color, label }
    taxi: null,          // active taxi fare { from, to, fare, timer }
    taxiCooldown: 0,
  };
}

export function missionName(state) {
  return state.index < 5 ? MISSIONS[state.index].name : 'Story complete';
}

// Start the current mission. Returns the spawn instructions main.js needs
// (e.g. gulls to spawn, checkpoints to lay out).
export function startMission(state, city, random) {
  const m = MISSIONS[state.index];
  state.active = true;
  state.step = 0;
  state.timer = 0;
  state.holdT = 0;
  state.kills = 0;
  state.checkpointIndex = 0;
  const L = city.landmarks;
  const at = (id) => landmarkApproach(city, id);
  if (m.id === 'wheels') {
    const g = at('garage');
    state.marker = { x: g.x, z: g.z, color: 0xffd23e, label: "Delia's Garage" };
    return { needCar: true };
  }
  if (m.id === 'courier') {
    state.checkpoints = [];
    for (let i = 0; i < 5; i += 1) {
      const c = city.centres[Math.floor(random() * city.centres.length)];
      state.checkpoints.push({ x: random() < 0.5 ? c : (random() - 0.5) * 2 * 180, z: random() < 0.5 ? (random() - 0.5) * 2 * 180 : c });
    }
    state.timer = 100;
    state.marker = { x: state.checkpoints[0].x, z: state.checkpoints[0].z, color: 0x58c96b, label: 'Drop 1 of 5' };
    return {};
  }
  if (m.id === 'shakedown') {
    const mk = at('market');
    state.marker = { x: mk.x, z: mk.z, color: 0xe5484d, label: 'Gull turf — Fishmarket Square' };
    return { spawnGullsAt: { x: mk.x, z: mk.z, count: 3 } };
  }
  if (m.id === 'hot') {
    const mk = at('market');
    state.marker = { x: mk.x, z: mk.z, color: 0xffd23e, label: 'Pick up the package' };
    return {};
  }
  if (m.id === 'vault') {
    const bk = at('bank');
    state.marker = { x: bk.x, z: bk.z, color: 0xffd23e, label: 'Solmar Trust Bank' };
    return {};
  }
  return {};
}

// Advance the mission by dt. `ctx` carries the live facts: player pos, inCar, near marker,
// gull kills, wanted. Returns events: { completed, failed, reason, pay, message }.
export function stepMission(state, dt, ctx) {
  const ev = {};
  if (!state.active) return ev;
  const m = MISSIONS[state.index];
  if (state.timer > 0) {
    state.timer -= dt;
    if (state.timer <= 0) {
      state.active = false;
      ev.failed = true;
      ev.reason = m.id === 'courier' ? 'Out of time — the drops went cold.' : 'Too slow.';
      return ev;
    }
  }
  const marker = state.marker;
  const nearMarker = marker ? Math.hypot(ctx.x - marker.x, ctx.z - marker.z) < 9 : false;

  if (m.id === 'wheels') {
    if (nearMarker && ctx.inCar) return complete(state, ev, m, 'Wheels delivered. Delia owes you one.');
  }
  if (m.id === 'courier') {
    if (nearMarker) {
      state.checkpointIndex += 1;
      if (state.checkpointIndex >= state.checkpoints.length) {
        return complete(state, ev, m, 'All five drops made. Clean run.');
      }
      const cp = state.checkpoints[state.checkpointIndex];
      state.marker = { x: cp.x, z: cp.z, color: 0x58c96b, label: `Drop ${state.checkpointIndex + 1} of 5` };
      ev.message = `Drop ${state.checkpointIndex} done — next one marked.`;
    }
  }
  if (m.id === 'shakedown') {
    if (ctx.gullKills >= 3) return complete(state, ev, m, 'The Gulls got the message.');
    state.marker.label = `Gulls dealt with: ${ctx.gullKills} / 3`;
  }
  if (m.id === 'hot') {
    if (state.step === 0 && nearMarker) {
      state.step = 1;
      state.packageT = 60;
      state.marker = null;
      ev.message = 'Package grabbed — now survive 60 seconds with the heat on!';
      ev.setWanted = 3;
    } else if (state.step === 1) {
      state.packageT -= dt;
      if (state.packageT <= 0) return complete(state, ev, m, 'Sixty seconds of heat, and you are still free.');
    }
  }
  if (m.id === 'vault') {
    if (state.step === 0 && nearMarker) {
      state.step = 1;
      ev.message = 'At the vault — hold E to crack it (3 seconds).';
    } else if (state.step === 1) {
      if (nearMarker && ctx.holdingE) {
        state.holdT += dt;
        if (state.holdT >= 3) {
          state.step = 2;
          state.marker = { x: ctx.marina.x, z: ctx.marina.z, color: 0x58c96b, label: 'Marina Dock — the boat' };
          ev.message = 'Vault cracked! Get to the marina boat — 4 stars and counting.';
          ev.setWanted = 4;
        }
      } else {
        state.holdT = Math.max(0, state.holdT - dt * 2);
      }
    } else if (state.step === 2 && nearMarker) {
      return complete(state, ev, m, 'The Vault Run is done. Solmar Bay is yours, Rae.');
    }
  }
  return ev;
}

function complete(state, ev, m, message) {
  state.active = false;
  state.done[state.index] = true;
  state.index += 1;
  state.marker = null;
  ev.completed = true;
  ev.pay = m.pay;
  ev.message = message;
  return ev;
}

export function objectiveText(state) {
  if (state.taxi) return { title: 'TAXI FARE', text: `Drive your passenger to the marker — $${state.taxi.fare}.`, sub: state.taxi.timer > 0 ? `${Math.ceil(state.taxi.timer)}s left` : '' };
  if (!state.active) {
    if (state.index >= 5) return { title: 'STORY COMPLETE', text: 'All five jobs done. Solmar Bay is yours — free roam, taxi fares, chaos.', sub: 'Press E near a taxi passenger (yellow ped) for a fare.' };
    const m = MISSIONS[state.index];
    return { title: 'NEXT JOB — ' + m.name, text: m.brief, sub: 'Drive to Delia, or press E near the garage marker to start. ' + m.detail };
  }
  const m = MISSIONS[state.index];
  let sub = m.detail;
  if (m.id === 'courier' && state.timer > 0) sub = `${Math.ceil(state.timer)}s left — ${state.checkpointIndex}/5 drops.`;
  if (m.id === 'hot' && state.step === 1) sub = `${Math.ceil(state.packageT)}s of heat left.`;
  if (m.id === 'vault' && state.step === 1) sub = `Cracking… ${Math.round((state.holdT / 3) * 100)}% — hold E at the marker.`;
  return { title: m.name, text: m.brief, sub };
}
