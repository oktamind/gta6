// The story: ten jobs from fixer Delia Voss — the last two are v3 (Harbor
// Heist, a dockside crate run, and The Solmar Crown, the casino counting-room
// finale) — plus a repeatable taxi side job. Each job is a small state
// machine driven by one table of steppers; the shared patterns (hold E to
// crack, survive the heat, clear checkpoints in order) live in helpers so no
// job re-implements them. The module owns no rendering: it reports the marker,
// the timer and the objective text, and main.js moves the player-facing state
// (cash, wanted) when a job completes. Markers sit on landmark APPROACH
// points (world.landmarkApproach): the landmark blocks are 26 m wide, so a
// marker at a building centre would be unreachable behind the walls.
import { MISSIONS } from './config.js';
import { landmarkApproach } from './world.js';

export function createMissionState() {
  return {
    index: 0, // job currently offered (0..9); 10 = story done
    done: Array(10).fill(false),
    active: false,
    step: 0,
    timer: 0, // countdown for timed steps, 0 = no timer
    holdT: 0, // vault hold progress
    kills: 0, // gulls dealt with (job 3)
    checkpoints: [], // courier drops (job 2) / race gates (job 7)
    checkpointIndex: 0,
    packageT: 0, // survival timer (job 4 / finale / crown)
    marker: null, // { x, z, color, label }
    taxi: null, // active taxi fare { to, fare, timer }
    taxiCooldown: 0,
    smuggleCar: null, // job 6: the marked car to deliver intact
    carDamage: 0, // job 6: damage taken (over 60 voids the pay)
  };
}

export function missionName(state) {
  return state.index < 10 ? MISSIONS[state.index].name : 'Story complete';
}

function putMarker(state, x, z, color, label) {
  state.marker = { x, z, color, label };
}

function randomDrop(random, city) {
  const row = city.centres[Math.floor(random() * city.centres.length)];
  const pick = (axis) => (random() < 0.5 ? axis : (random() - 0.5) * 2 * 180);
  // One axis lands on a road centreline, the other lands anywhere — the
  // ternary call order is the seeded sequence, so keep it exactly here.
  return { x: pick(row), z: random() < 0.5 ? (random() - 0.5) * 2 * 180 : row };
}

// One starter per job id: lay out the marker (and anything main.js must
// spawn) and hand back the spawn instructions.
const STARTERS = {
  wheels(state, city) {
    const g = landmarkApproach(city, 'garage');
    putMarker(state, g.x, g.z, 0xffd23e, "Delia's Garage");
    return { needCar: true };
  },
  courier(state, city, random) {
    state.checkpoints = Array.from({ length: 5 }, () => randomDrop(random, city));
    state.timer = 100;
    const first = state.checkpoints[0];
    putMarker(state, first.x, first.z, 0x58c96b, 'Drop 1 of 5');
    return {};
  },
  shakedown(state, city) {
    const mk = landmarkApproach(city, 'market');
    putMarker(state, mk.x, mk.z, 0xe5484d, 'Gull turf — Fishmarket Square');
    return { spawnGullsAt: { x: mk.x, z: mk.z, count: 3 } };
  },
  hot(state, city) {
    const mk = landmarkApproach(city, 'market');
    putMarker(state, mk.x, mk.z, 0xffd23e, 'Pick up the package');
    return {};
  },
  vault(state, city) {
    const bk = landmarkApproach(city, 'bank');
    putMarker(state, bk.x, bk.z, 0xffd23e, 'Solmar Trust Bank');
    return {};
  },
  smuggle(state) {
    // The hot car waits at the North Docks; the marina is the drop.
    const dock = { x: 190, z: -190 };
    putMarker(state, dock.x, dock.z, 0xe67e22, 'Hot car — North Docks');
    state.carDamage = 0;
    return { smuggleAt: dock };
  },
  race(state) {
    // Six gates across the districts, in order, 110 seconds. Gates sit on
    // road intersections (the road centrelines) so a car can always reach
    // them — a gate inside a block can end up inside a building.
    const gates = [
      { x: -167, z: -167 }, { x: 65, z: -167 }, { x: 181, z: -51 },
      { x: 123, z: 181 }, { x: -51, z: 181 }, { x: -167, z: 51 },
    ];
    state.checkpoints = gates;
    state.checkpointIndex = 0;
    state.timer = 110;
    putMarker(state, gates[0].x, gates[0].z, 0x4fa8e8, 'Gate 1 of 6 — Bayfront Grand Prix');
    return {};
  },
  finale(state, city) {
    const pd = landmarkApproach(city, 'police');
    putMarker(state, pd.x, pd.z, 0xe5484d, 'SBPD Central — evidence vault');
    return {};
  },
  harbor(state) {
    // Job 9: the crates wait on the North Docks; load them, haul them home.
    const dock = { x: 190, z: -190 };
    putMarker(state, dock.x, dock.z, 0xe67e22, 'Crates — North Docks');
    return {};
  },
  crown(state, city) {
    // Job 10: the Crown Casino counting room — the biggest score in Solmar Bay.
    const cz = landmarkApproach(city, 'casino');
    putMarker(state, cz.x, cz.z, 0xffd23e, 'The Solmar Crown Casino');
    return {};
  },
};

// Start the current job. Returns the spawn instructions main.js needs
// (e.g. gulls to spawn, checkpoints to lay out).
export function startMission(state, city, random) {
  const m = MISSIONS[state.index];
  state.active = true;
  state.step = 0;
  state.timer = 0;
  state.holdT = 0;
  state.kills = 0;
  state.checkpointIndex = 0;
  const start = STARTERS[m.id];
  return start ? start(state, city, random) : {};
}

// ---- Shared step patterns ----

// Hold E at the marker for `seconds`; progress drains twice as fast when the
// player lets go or steps away. Returns true the moment the crack finishes.
function crackStep(state, dt, near, holding, seconds, onCracked) {
  if (!(near && holding)) {
    state.holdT = Math.max(0, state.holdT - dt * 2);
    return false;
  }
  state.holdT += dt;
  if (state.holdT < seconds) return false;
  onCracked();
  return true;
}

// Count a survival timer down; returns true when it hits zero.
function surviveStep(state, dt, onSurvived) {
  state.packageT -= dt;
  if (state.packageT > 0) return false;
  onSurvived();
  return true;
}

// Advance through checkpoints in order. Returns 'done' when the last one is
// cleared, 'next' when the marker moves on, null when nowhere near.
function checkpointStep(state, near, mkLabel, doneMessage, ev, m) {
  if (!near) return null;
  state.checkpointIndex += 1;
  if (state.checkpointIndex >= state.checkpoints.length) {
    finishJob(state, ev, m, doneMessage);
    return 'done';
  }
  const cp = state.checkpoints[state.checkpointIndex];
  putMarker(state, cp.x, cp.z, state.marker.color, mkLabel(state.checkpointIndex + 1));
  return 'next';
}

function finishJob(state, ev, m, message) {
  state.active = false;
  state.done[state.index] = true;
  state.index += 1;
  state.marker = null;
  ev.completed = true;
  ev.pay = m.pay;
  ev.message = message;
  return ev;
}

function failJob(state, ev, reason) {
  state.active = false;
  ev.failed = true;
  ev.reason = reason;
  return ev;
}

// One stepper per job id: (state, dt, ctx, near, ev, m) — returns the event
// object (possibly with completed/failed/message/setWanted filled in).
const STEPPERS = {
  wheels(state, dt, ctx, near, ev, m) {
    if (near && ctx.inCar) finishJob(state, ev, m, 'Wheels delivered. Delia owes you one.');
  },
  courier(state, dt, ctx, near, ev, m) {
    const res = checkpointStep(state, near, (n) => `Drop ${n} of 5`, 'All five drops made. Clean run.', ev, m);
    if (res === 'next') ev.message = `Drop ${state.checkpointIndex} done — next one marked.`;
  },
  shakedown(state, dt, ctx, near, ev, m) {
    if (ctx.gullKills >= 3) {
      finishJob(state, ev, m, 'The Gulls got the message.');
      return;
    }
    state.marker.label = `Gulls dealt with: ${ctx.gullKills} / 3`;
  },
  hot(state, dt, ctx, near, ev, m) {
    if (state.step === 0) {
      if (!near) return;
      state.step = 1;
      state.packageT = 60;
      state.marker = null;
      ev.message = 'Package grabbed — now survive 60 seconds with the heat on!';
      ev.setWanted = 3;
      return;
    }
    if (surviveStep(state, dt, () => {})) finishJob(state, ev, m, 'Sixty seconds of heat, and you are still free.');
  },
  smuggle(state, dt, ctx, near, ev, m) {
    // Step 0: reach the hot car and get in (main.js reports ctx.inSmuggleCar).
    // Step 1: drive it to the marina. Damage is tracked by main.js.
    if (state.step === 0) {
      if (!ctx.inSmuggleCar) return;
      state.step = 1;
      const mz = ctx.marina;
      putMarker(state, mz.x, mz.z, 0x58c96b, 'Marina Dock — deliver the car');
      ev.message = 'Cargo loaded — deliver it to the marina. Keep it clean!';
      return;
    }
    if (state.carDamage >= 60) {
      failJob(state, ev, 'The cargo car is wrecked — Delia is not paying for scrap.');
      return;
    }
    if (near && ctx.inCar) finishJob(state, ev, m, 'Harbor Lights delivered clean. Delia pays in full.');
  },
  race(state, dt, ctx, near, ev, m) {
    const res = checkpointStep(state, near, (n) => `Gate ${n} of 6`, 'Six gates, one winner. The Bayfront is yours.', ev, m);
    if (res === 'next') ev.message = `Gate ${state.checkpointIndex} cleared — next one marked. NOS helps.`;
  },
  vault(state, dt, ctx, near, ev, m) {
    if (state.step === 0) {
      if (!near) return;
      state.step = 1;
      ev.message = 'At the vault — hold E to crack it (3 seconds).';
      return;
    }
    if (state.step === 1) {
      crackStep(state, dt, near, ctx.holdingE, 3, () => {
        state.step = 2;
        putMarker(state, ctx.marina.x, ctx.marina.z, 0x58c96b, 'Marina Dock — the boat');
        ev.message = 'Vault cracked! Get to the marina boat — 4 stars and counting.';
        ev.setWanted = 4;
      });
      return;
    }
    if (near) finishJob(state, ev, m, 'The Vault Run is done. Solmar Bay is yours, Rae.');
  },
  finale(state, dt, ctx, near, ev, m) {
    if (state.step === 0) {
      if (!near) return;
      state.step = 1;
      ev.message = 'At the evidence vault — hold E to crack it (4 seconds).';
      return;
    }
    if (state.step === 1) {
      crackStep(state, dt, near, ctx.holdingE, 4, () => {
        state.step = 2;
        state.packageT = 75;
        state.marker = null;
        ev.message = 'Evidence grabbed! Survive 75 seconds at 5 stars — the helicopter is coming.';
        ev.setWanted = 5;
      });
      return;
    }
    if (state.step === 2) {
      surviveStep(state, dt, () => {
        state.step = 3;
        const sh = ctx.safehouse;
        putMarker(state, sh.x, sh.z, 0x58c96b, 'Safehouse — disappear');
        ev.message = 'You outlasted them — now vanish into the safehouse.';
      });
      return;
    }
    if (near) finishJob(state, ev, m, 'The Delia Gambit is done. Solmar Bay is yours, Rae.');
  },
  harbor(state, dt, ctx, near, ev, m) {
    // Job 9: step 0 reach the crates, step 1 hold E 3s to load, step 2 haul
    // them back to Delia's garage.
    if (state.step === 0) {
      if (!near) return;
      state.step = 1;
      ev.message = 'At the crates — hold E to load them (3 seconds).';
      return;
    }
    if (state.step === 1) {
      crackStep(state, dt, near, ctx.holdingE, 3, () => {
        state.step = 2;
        const g = ctx.garage;
        putMarker(state, g.x, g.z, 0x58c96b, "Delia's Garage — unload");
        ev.message = 'Crates loaded! Haul them back to Delia’s garage.';
      });
      return;
    }
    if (near) finishJob(state, ev, m, 'Harbor Heist done — the crates are Delia’s now.');
  },
  crown(state, dt, ctx, near, ev, m) {
    // Job 10: step 0 reach the casino, step 1 hold E 5s on the counting room,
    // step 2 survive 90 seconds at 5 stars, step 3 vanish into the safehouse.
    if (state.step === 0) {
      if (!near) return;
      state.step = 1;
      ev.message = 'At the counting room — hold E to crack it (5 seconds).';
      return;
    }
    if (state.step === 1) {
      crackStep(state, dt, near, ctx.holdingE, 5, () => {
        state.step = 2;
        state.packageT = 90;
        state.marker = null;
        ev.message = 'Counting room cracked! Survive 90 seconds at 5 stars — the helicopter is calling in backup.';
        ev.setWanted = 5;
      });
      return;
    }
    if (state.step === 2) {
      surviveStep(state, dt, () => {
        state.step = 3;
        const sh = ctx.safehouse;
        putMarker(state, sh.x, sh.z, 0x58c96b, 'Safehouse — disappear');
        ev.message = 'You outlasted the whole city — now vanish into the safehouse.';
      });
      return;
    }
    if (near) finishJob(state, ev, m, 'The Solmar Crown is yours. Ten jobs, one legend, zero witnesses.');
  },
};

// Advance the job by dt. `ctx` carries the live facts: player pos, inCar,
// gull kills, holding E, landmark approaches. Returns events:
// { completed, failed, reason, pay, message, setWanted }.
export function stepMission(state, dt, ctx) {
  const ev = {};
  if (!state.active) return ev;
  const m = MISSIONS[state.index];
  if (state.timer > 0) {
    state.timer -= dt;
    if (state.timer <= 0) {
      return failJob(state, ev, m.id === 'courier' ? 'Out of time — the drops went cold.' : 'Too slow.');
    }
  }
  const marker = state.marker;
  const near = marker ? Math.hypot(ctx.x - marker.x, ctx.z - marker.z) < 9 : false;
  const run = STEPPERS[m.id];
  if (run) run(state, dt, ctx, near, ev, m);
  return ev;
}

// One sub-line builder per job id for the active-job objective panel.
const SUBS = {
  courier: (s) => (s.timer > 0 ? `${Math.ceil(s.timer)}s left — ${s.checkpointIndex}/5 drops.` : ''),
  hot: (s) => (s.step === 1 ? `${Math.ceil(s.packageT)}s of heat left.` : ''),
  vault: (s) => (s.step === 1 ? `Cracking… ${Math.round((s.holdT / 3) * 100)}% — hold E at the marker.` : ''),
  smuggle: (s) => (s.step === 0 ? 'Steal the orange car at the North Docks.' : `Deliver it intact — damage ${Math.round(s.carDamage)}% (60% voids the pay).`),
  race: (s) => (s.timer > 0 ? `${Math.ceil(s.timer)}s left — gate ${s.checkpointIndex + 1}/6. Shift = NOS, Space = drift.` : ''),
  finale: (s) => (s.step === 1
    ? `Cracking… ${Math.round((s.holdT / 4) * 100)}% — hold E at the marker.`
    : s.step === 2 ? `${Math.ceil(s.packageT)}s of 5-star heat left — the helicopter is on you.` : ''),
  harbor: (s) => (s.step === 1 ? `Loading… ${Math.round((s.holdT / 3) * 100)}% — hold E at the crates.` : ''),
  crown: (s) => (s.step === 1
    ? `Cracking… ${Math.round((s.holdT / 5) * 100)}% — hold E at the counting room.`
    : s.step === 2 ? `${Math.ceil(s.packageT)}s of 5-star heat left — the helicopter is calling in backup.` : ''),
};

export function objectiveText(state) {
  if (state.taxi) {
    return {
      title: 'TAXI FARE',
      text: `Drive your passenger to the marker — $${state.taxi.fare}.`,
      sub: state.taxi.timer > 0 ? `${Math.ceil(state.taxi.timer)}s left` : '',
    };
  }
  if (!state.active) {
    if (state.index >= 10) {
      return {
        title: 'STORY COMPLETE',
        text: 'All ten jobs done. Solmar Bay is yours — free roam, taxi fares, street races, chaos.',
        sub: 'Press E near a race flag for a street race, or near a taxi passenger (yellow ped) for a fare. Safehouse repairs and saves.',
      };
    }
    const m = MISSIONS[state.index];
    return {
      title: 'NEXT JOB — ' + m.name,
      text: m.brief,
      sub: 'Drive to Delia, or press E near the garage marker to start. ' + m.detail,
    };
  }
  const m = MISSIONS[state.index];
  const subFor = SUBS[m.id];
  const sub = subFor ? subFor(state) : '';
  return { title: m.name, text: m.brief, sub: sub === '' ? m.detail : sub };
}
