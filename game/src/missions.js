// The story: ten jobs from fixer Delia Voss (v3: +2 — Harbor Heist, a dockside
// crate run, and The Solmar Crown, the casino counting-room finale), plus a
// repeatable taxi side job. A mission is a small state machine: each step has a
// target point, a radius, and text.
// The module owns no rendering — it reports the current marker, timer and objective
// text, and main.js moves the player-facing state (cash, wanted) when a mission
// completes. Markers use landmark APPROACH points (see world.landmarkApproach): the
// landmark buildings are 26 m wide, so a marker at the building centre is
// unreachable behind the walls.
import { MISSIONS } from './config.js';
import { landmarkApproach } from './world.js';

export function createMissionState() {
  return {
    index: 0,            // mission currently offered (0..9); 10 = story done
    done: [false, false, false, false, false, false, false, false, false, false],
    active: false,       // a mission is currently being run
    step: 0,
    timer: 0,            // countdown for timed steps, 0 = no timer
    holdT: 0,            // vault hold progress
    kills: 0,            // gulls dealt with (mission 3)
    checkpoints: [],     // courier checkpoints (mission 2) / race gates (mission 7)
    checkpointIndex: 0,
    packageT: 0,         // survival timer (mission 4 / finale / crown)
    marker: null,        // { x, z, color, label }
    taxi: null,          // active taxi fare { from, to, fare, timer }
    taxiCooldown: 0,
    smuggleCar: null,    // mission 6: the marked car to deliver intact
    carDamage: 0,        // mission 6: damage taken (over 60 voids the pay)
  };
}

export function missionName(state) {
  return state.index < 10 ? MISSIONS[state.index].name : 'Story complete';
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
  if (m.id === 'smuggle') {
    // The hot car waits at the North Docks; the marina is the drop.
    const dock = { x: 190, z: -190 };
    state.marker = { x: dock.x, z: dock.z, color: 0xe67e22, label: 'Hot car — North Docks' };
    state.carDamage = 0;
    return { smuggleAt: dock };
  }
  if (m.id === 'race') {
    // Six gates across the districts, in order, 110 seconds. Gates sit on road
    // intersections (the road centrelines) so a car can always reach them — a gate
    // inside a block can end up inside a building and be unreachable.
    const gates = [
      { x: -167, z: -167 }, { x: 65, z: -167 }, { x: 181, z: -51 },
      { x: 123, z: 181 }, { x: -51, z: 181 }, { x: -167, z: 51 },
    ];
    state.checkpoints = gates;
    state.checkpointIndex = 0;
    state.timer = 110;
    state.marker = { x: gates[0].x, z: gates[0].z, color: 0x4fa8e8, label: 'Gate 1 of 6 — Bayfront Grand Prix' };
    return {};
  }
  if (m.id === 'finale') {
    const pd = at('police');
    state.marker = { x: pd.x, z: pd.z, color: 0xe5484d, label: 'SBPD Central — evidence vault' };
    return {};
  }
  if (m.id === 'harbor') {
    // v3 job 9: the crates wait on the North Docks; load them, then haul them home.
    const dock = { x: 190, z: -190 };
    state.marker = { x: dock.x, z: dock.z, color: 0xe67e22, label: 'Crates — North Docks' };
    return {};
  }
  if (m.id === 'crown') {
    // v3 job 10: the Crown Casino counting room — the biggest score in Solmar Bay.
    const cz = at('casino');
    state.marker = { x: cz.x, z: cz.z, color: 0xffd23e, label: 'The Solmar Crown Casino' };
    return {};
  }
  return {};
}

// Advance the mission by dt. `ctx` carries the live facts: player pos, inCar, near
// marker, gull kills, wanted. Returns events: { completed, failed, reason, pay, message }.
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
  if (m.id === 'smuggle') {
    // Step 0: reach the hot car and get in (main.js hands it over via ctx.inSmuggleCar).
    // Step 1: drive it to the marina. Damage is tracked by main.js in state.carDamage.
    if (state.step === 0 && ctx.inSmuggleCar) {
      state.step = 1;
      const mz = ctx.marina;
      state.marker = { x: mz.x, z: mz.z, color: 0x58c96b, label: 'Marina Dock — deliver the car' };
      ev.message = 'Cargo loaded — deliver it to the marina. Keep it clean!';
    } else if (state.step === 1) {
      if (state.carDamage >= 60) {
        state.active = false;
        ev.failed = true;
        ev.reason = 'The cargo car is wrecked — Delia is not paying for scrap.';
        return ev;
      }
      if (nearMarker && ctx.inCar) return complete(state, ev, m, 'Harbor Lights delivered clean. Delia pays in full.');
    }
  }
  if (m.id === 'race') {
    if (nearMarker) {
      state.checkpointIndex += 1;
      if (state.checkpointIndex >= state.checkpoints.length) {
        return complete(state, ev, m, 'Six gates, one winner. The Bayfront is yours.');
      }
      const cp = state.checkpoints[state.checkpointIndex];
      state.marker = { x: cp.x, z: cp.z, color: 0x4fa8e8, label: `Gate ${state.checkpointIndex + 1} of 6` };
      ev.message = `Gate ${state.checkpointIndex} cleared — next one marked. NOS helps.`;
    }
  }
  if (m.id === 'finale') {
    if (state.step === 0 && nearMarker) {
      state.step = 1;
      ev.message = 'At the evidence vault — hold E to crack it (4 seconds).';
    } else if (state.step === 1) {
      if (nearMarker && ctx.holdingE) {
        state.holdT += dt;
        if (state.holdT >= 4) {
          state.step = 2;
          state.packageT = 75;
          state.marker = null;
          ev.message = 'Evidence grabbed! Survive 75 seconds at 5 stars — the helicopter is coming.';
          ev.setWanted = 5;
        }
      } else {
        state.holdT = Math.max(0, state.holdT - dt * 2);
      }
    } else if (state.step === 2) {
      state.packageT -= dt;
      if (state.packageT <= 0) {
        state.step = 3;
        const sh = ctx.safehouse;
        state.marker = { x: sh.x, z: sh.z, color: 0x58c96b, label: 'Safehouse — disappear' };
        ev.message = 'You outlasted them — now vanish into the safehouse.';
      }
    } else if (state.step === 3 && nearMarker) {
      return complete(state, ev, m, 'The Delia Gambit is done. Solmar Bay is yours, Rae.');
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
  if (m.id === 'harbor') {
    // v3 job 9: step 0 reach the crates, step 1 hold E 3s to load, step 2 haul
    // them back to Delia's garage.
    if (state.step === 0 && nearMarker) {
      state.step = 1;
      ev.message = 'At the crates — hold E to load them (3 seconds).';
    } else if (state.step === 1) {
      if (nearMarker && ctx.holdingE) {
        state.holdT += dt;
        if (state.holdT >= 3) {
          state.step = 2;
          const g = ctx.garage;
          state.marker = { x: g.x, z: g.z, color: 0x58c96b, label: "Delia's Garage — unload" };
          ev.message = 'Crates loaded! Haul them back to Delia’s garage.';
        }
      } else {
        state.holdT = Math.max(0, state.holdT - dt * 2);
      }
    } else if (state.step === 2 && nearMarker) {
      return complete(state, ev, m, 'Harbor Heist done — the crates are Delia’s now.');
    }
  }
  if (m.id === 'crown') {
    // v3 job 10: step 0 reach the casino, step 1 hold E 5s on the counting room,
    // step 2 survive 90 seconds at 5 stars, step 3 vanish into the safehouse.
    if (state.step === 0 && nearMarker) {
      state.step = 1;
      ev.message = 'At the counting room — hold E to crack it (5 seconds).';
    } else if (state.step === 1) {
      if (nearMarker && ctx.holdingE) {
        state.holdT += dt;
        if (state.holdT >= 5) {
          state.step = 2;
          state.packageT = 90;
          state.marker = null;
          ev.message = 'Counting room cracked! Survive 90 seconds at 5 stars — the helicopter is calling in backup.';
          ev.setWanted = 5;
        }
      } else {
        state.holdT = Math.max(0, state.holdT - dt * 2);
      }
    } else if (state.step === 2) {
      state.packageT -= dt;
      if (state.packageT <= 0) {
        state.step = 3;
        const sh = ctx.safehouse;
        state.marker = { x: sh.x, z: sh.z, color: 0x58c96b, label: 'Safehouse — disappear' };
        ev.message = 'You outlasted the whole city — now vanish into the safehouse.';
      }
    } else if (state.step === 3 && nearMarker) {
      return complete(state, ev, m, 'The Solmar Crown is yours. Ten jobs, one legend, zero witnesses.');
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
    if (state.index >= 10) return { title: 'STORY COMPLETE', text: 'All ten jobs done. Solmar Bay is yours — free roam, taxi fares, street races, chaos.', sub: 'Press E near a race flag for a street race, or near a taxi passenger (yellow ped) for a fare. Safehouse repairs and saves.' };
    const m = MISSIONS[state.index];
    return { title: 'NEXT JOB — ' + m.name, text: m.brief, sub: 'Drive to Delia, or press E near the garage marker to start. ' + m.detail };
  }
  const m = MISSIONS[state.index];
  let sub = m.detail;
  if (m.id === 'courier' && state.timer > 0) sub = `${Math.ceil(state.timer)}s left — ${state.checkpointIndex}/5 drops.`;
  if (m.id === 'hot' && state.step === 1) sub = `${Math.ceil(state.packageT)}s of heat left.`;
  if (m.id === 'vault' && state.step === 1) sub = `Cracking… ${Math.round((state.holdT / 3) * 100)}% — hold E at the marker.`;
  if (m.id === 'smuggle') sub = state.step === 0 ? 'Steal the orange car at the North Docks.' : `Deliver it intact — damage ${Math.round(state.carDamage)}% (60% voids the pay).`;
  if (m.id === 'race' && state.timer > 0) sub = `${Math.ceil(state.timer)}s left — gate ${state.checkpointIndex + 1}/6. Shift = NOS, Space = drift.`;
  if (m.id === 'finale' && state.step === 1) sub = `Cracking… ${Math.round((state.holdT / 4) * 100)}% — hold E at the marker.`;
  if (m.id === 'finale' && state.step === 2) sub = `${Math.ceil(state.packageT)}s of 5-star heat left — the helicopter is on you.`;
  if (m.id === 'harbor' && state.step === 1) sub = `Loading… ${Math.round((state.holdT / 3) * 100)}% — hold E at the crates.`;
  if (m.id === 'crown' && state.step === 1) sub = `Cracking… ${Math.round((state.holdT / 5) * 100)}% — hold E at the counting room.`;
  if (m.id === 'crown' && state.step === 2) sub = `${Math.ceil(state.packageT)}s of 5-star heat left — the helicopter is calling in backup.`;
  return { title: m.name, text: m.brief, sub };
}
