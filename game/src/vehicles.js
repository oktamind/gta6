// Vehicles: the player's car, traffic and police.
// Arcade physics — no wheel simulation, just speed, heading and a steering
// angle, with building collision and car-car push-out. Traffic follows the
// road graph (straight along one road, a random turn at each intersection).
// Police chase the player with a faster top speed and ram; on-foot cops live
// in peds.js. Each driving system is split into small phases (steer, drive,
// NOS, limits, motion) so the update order is explicit and testable.
// v3: NOS builds HEAT on a long burn (overheat locks it out for a few
// seconds), and the helicopter ORBITS the player with a sweeping spotlight
// and calls in fresh ground units at 5 stars instead of hovering overhead.
import { CAR, CITY, NOS, HELI } from './config.js';
import { collideBuildings, nearestRoadPoint, randomRoadPoint } from './world.js';
import { pick, clamp } from './random.js';

function baseCar(x, z, angle, color) {
  return {
    x, z, angle, speed: 0, steer: 0,
    color, hp: 100, stolen: false,
    mesh: null, wheelFL: null, wheelFR: null, wheelRL: null, wheelRR: null,
  };
}

export function makeCar(x, z, angle, color, opts = {}) {
  const car = baseCar(x, z, angle, color);
  car.police = !!opts.police;
  car.traffic = !!opts.traffic;
  car.parked = !!opts.parked;
  // NOS tank (0-100) + drift state. NOS is spent by the driver, refilled
  // slowly, at the safehouse, or bought at the shop. nosHeat builds while
  // boosting and nosLockout counts down after an overheat — both start at 0.
  Object.assign(car, {
    nos: NOS.max, drifting: false, nosActive: false, nosHeat: 0, nosLockout: 0,
  });
  // Traffic AI: the axis it drives along, the direction, and its cruise speed.
  Object.assign(car, {
    axis: opts.axis || 'z', dir: opts.dir || 1,
    cruise: opts.cruise || 9, targetSpeed: opts.cruise || 9,
  });
  // Police AI.
  car.ramCooldown = 0;
  return car;
}

// The SBPD helicopter (v2, reworked in v3). No mesh here — just the numbers;
// render.js draws it. orbitA is the angle around the player, callT the
// countdown to the next reinforcement call at 5 stars, callReinforcements
// the flag main.js consumes (it spawns a fresh police car and clears it).
export function makeHeli(x, z) {
  return {
    x, z, y: HELI.hoverHeight, angle: 0, rotor: 0,
    spotX: x, spotZ: z, mesh: null, rotorMesh: null, spotMesh: null,
    orbitA: Math.atan2(z, x), callT: HELI.callSec, callReinforcements: false,
  };
}

function forwardOf(car) {
  return { x: Math.sin(car.angle), z: Math.cos(car.angle) };
}

function heliOrbit(heli, targetX, targetZ, dt) {
  heli.orbitA += HELI.orbitSpeed * dt;
  const wantX = targetX + Math.cos(heli.orbitA) * HELI.orbitRadius;
  const wantZ = targetZ + Math.sin(heli.orbitA) * HELI.orbitRadius;
  const dx = wantX - heli.x, dz = wantZ - heli.z;
  const dist = Math.hypot(dx, dz);
  const sp = Math.min(HELI.followSpeed, dist * 0.9 + 6);
  if (dist > 0.5) {
    heli.x += (dx / dist) * sp * dt;
    heli.z += (dz / dist) * sp * dt;
  }
  heli.angle = Math.atan2(targetX - heli.x, targetZ - heli.z);
  // Altitude breathes between 30 and 40 m as it circles.
  heli.y = HELI.hoverHeight + Math.sin(heli.orbitA * 2) * 5;
  heli.rotor += dt * 38;
}

function heliSpotlight(heli, targetX, targetZ, targetAngle) {
  // The spotlight sweeps a few metres ahead of the player's direction of
  // travel, not straight down.
  heli.spotX = targetX + Math.sin(targetAngle) * 10;
  heli.spotZ = targetZ + Math.cos(targetAngle) * 10;
}

function heliCall(heli, dt, wanted) {
  if (wanted < 5) {
    heli.callT = HELI.callSec;
    return;
  }
  heli.callT -= dt;
  if (heli.callT > 0) return;
  heli.callT = HELI.callSec;
  heli.callReinforcements = true;
}

// The helicopter orbits the player, sweeps its spotlight ahead of them, and
// at 5 stars flags a reinforcement call every HELI.callSec seconds.
export function stepHeli(heli, targetX, targetZ, dt, wanted = 4, targetAngle = 0) {
  heliOrbit(heli, targetX, targetZ, dt);
  heliSpotlight(heli, targetX, targetZ, targetAngle);
  heliCall(heli, dt, wanted);
  return heli;
}

function applySteering(car, steerIn, dt) {
  const targetSteer = steerIn * CAR.steer;
  car.steer += (targetSteer - car.steer) * Math.min(1, dt * 8);
}

function applyDrive(car, drive, handbrake, dt) {
  const accel = drive > 0 ? CAR.accel * drive : drive < 0 ? -CAR.reverseAccel : 0;
  car.speed += accel * dt;
  if (drive === 0) car.speed -= car.speed * Math.min(1, dt * 1.2); // rolling drag
  // Drift: the handbrake cuts grip — the car slides, turns sharper, and NOS refills.
  car.drifting = !!handbrake && Math.abs(car.speed) > 8;
  if (handbrake) {
    car.speed -= car.speed * Math.min(1, dt * 2.2);
    car.nos = clamp(car.nos + NOS.driftRefundPerSec * dt, 0, NOS.max);
  }
}

// NOS with heat: hold Shift while moving forward. It burns the tank and lifts
// the top speed — but a continuous burn builds heat, and past the overheat
// point the kit locks out until it cools. Heat bleeds off fast when idle.
function applyNos(car, drive, nos, dt) {
  if (car.nosLockout > 0) car.nosLockout = Math.max(0, car.nosLockout - dt);
  const wantNos = !!nos && car.nos > 0 && drive > 0 && car.speed > 4 && car.nosLockout <= 0;
  car.nosActive = wantNos;
  if (!car.nosActive) {
    car.nos = clamp(car.nos + NOS.regenPerSec * dt, 0, NOS.max);
    car.nosHeat = Math.max(0, car.nosHeat - dt * 2);
    return;
  }
  car.nos = clamp(car.nos - NOS.drainPerSec * dt, 0, NOS.max);
  car.nosHeat += dt;
  car.speed += CAR.accel * 0.9 * dt;
  if (car.nosHeat < NOS.overheatAfterSec) return;
  car.nosActive = false;
  car.nosLockout = NOS.lockoutSec;
  car.nosHeat = 0;
}

function applyMotion(car, dt, city) {
  const maxF = car.nosActive ? CAR.maxSpeed * NOS.boostMult : CAR.maxSpeed;
  car.speed = Math.max(-CAR.maxReverse, Math.min(maxF, car.speed));
  // Steering only bites while moving; sharper at low speed, sharper again in a drift.
  const driftMult = car.drifting ? 1.7 : 1;
  const turn = car.steer * (car.speed / CAR.maxSpeed) * 2.4 * driftMult * dt * (car.speed >= 0 ? 1 : -1);
  car.angle += turn;
  const f = forwardOf(car);
  car.x += f.x * car.speed * dt;
  car.z += f.z * car.speed * dt;
  const p = { x: car.x, z: car.z };
  if (!collideBuildings(city, p, CAR.length / 2)) return;
  car.x = p.x; car.z = p.z;
  // A hard wall hit damages the car — this is what makes the smuggle
  // mission's damage rule real, and what the safehouse repairs.
  if (Math.abs(car.speed) > 12) car.hp = Math.max(0, car.hp - 6);
  car.speed *= -0.25; // bounce off the wall
}

// One physics step for a driven car. `drive` is -1..1 (throttle), `steerIn`
// -1..1, handbrake bool (Space: drift), `nos` bool (Shift: NOS boost).
export function stepDrivenCar(car, drive, steerIn, handbrake, dt, city, nos = false) {
  applySteering(car, steerIn, dt);
  applyDrive(car, drive, handbrake, dt);
  applyNos(car, drive, nos, dt);
  applyMotion(car, dt, city);
  return car;
}

const TRAFFIC_COLORS = [0xc0392b, 0x2471a3, 0xf1c40f, 0x7d3c98, 0x1abc9c, 0xe67e22, 0xecf0f1, 0x2c3e50];

export function createTraffic(random, city, count) {
  return Array.from({ length: count }, () => {
    const pt = randomRoadPoint(random, city);
    const angle = pt.axis === 'z'
      ? (random() < 0.5 ? 0 : Math.PI)
      : (random() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
    const car = makeCar(pt.x, pt.z, angle, pick(random, TRAFFIC_COLORS),
      { traffic: true, axis: pt.axis, cruise: 7 + random() * 5 });
    car.speed = car.cruise;
    return car;
  });
}

function carAhead(cars, car) {
  const f = forwardOf(car);
  for (const other of cars) {
    if (other === car) continue;
    const dx = other.x - car.x, dz = other.z - car.z;
    if (Math.hypot(dx, dz) >= 9) continue;
    if (dx * f.x + dz * f.z > 0) return other;
  }
  return null;
}

function maybeTurn(car, nearX, nearZ, dt, random) {
  if (nearX === undefined || nearZ === undefined) return;
  if (random() >= dt * 0.9) return;
  const turn = random();
  if (turn >= 0.3) return;
  // Turn 90 degrees.
  const wasZ = Math.abs(Math.sin(car.angle)) < 0.7;
  car.angle = wasZ
    ? (random() < 0.5 ? Math.PI / 2 : -Math.PI / 2)
    : (random() < 0.5 ? 0 : Math.PI);
  car.x = nearX; car.z = nearZ;
}

function wrapAtEdge(car, random, city) {
  if (Math.abs(car.x) <= CITY.half + 20 && Math.abs(car.z) <= CITY.half + 20) return;
  // Wrap around the city edge instead of driving into the sea.
  const pt = randomRoadPoint(random, city);
  car.x = pt.x; car.z = pt.z;
  car.angle = pt.axis === 'z' ? 0 : Math.PI / 2;
}

// Traffic: drive along the current road; at an intersection (both axes near
// a centreline) pick a new direction at random, sometimes turning. Keep
// speed, avoid piling into the car ahead. `random` is the seeded RNG so
// screenshot scenes stay deterministic.
export function stepTraffic(cars, dt, city, playerCar, random = Math.random) {
  const centres = city.centres;
  for (const car of cars) {
    // Slow down if another car is close ahead.
    const ahead = carAhead(cars, car);
    const want = ahead ? 0 : car.cruise;
    car.speed += (want - car.speed) * Math.min(1, dt * 2);
    const f = forwardOf(car);
    car.x += f.x * car.speed * dt;
    car.z += f.z * car.speed * dt;
    // At an intersection, maybe turn.
    const nearX = centres.find((c) => Math.abs(car.x - c) < 1.2);
    const nearZ = centres.find((c) => Math.abs(car.z - c) < 1.2);
    maybeTurn(car, nearX, nearZ, dt, random);
    wrapAtEdge(car, random, city);
    const p = { x: car.x, z: car.z };
    if (collideBuildings(city, p, 2)) { car.x = p.x; car.z = p.z; }
  }
  pushPlayerOut(cars, playerCar);
}

// Push the player's car out of traffic cars. A hard rear-end matches speeds
// (bump and follow) instead of multiplying the player's speed down every
// step while the cars touch — the old *= 0.85 glued the player behind the
// slowest traffic car.
function pushPlayerOut(cars, playerCar) {
  if (!playerCar) return;
  for (const car of cars) {
    const dx = playerCar.x - car.x, dz = playerCar.z - car.z;
    const d = Math.hypot(dx, dz);
    if (d >= 4.4 || d <= 0.01) continue;
    const push = (4.4 - d) / 2;
    playerCar.x += (dx / d) * push;
    playerCar.z += (dz / d) * push;
    car.x -= (dx / d) * push;
    car.z -= (dz / d) * push;
    if (playerCar.speed <= car.speed + 3) continue;
    car.speed = playerCar.speed * 0.6;
    playerCar.speed *= 0.6;
  }
}

export function createPoliceCar(random, city, nearX, nearZ) {
  // Spawn on a road a little way from the player, facing them.
  let pt = randomRoadPoint(random, city);
  for (let tries = 0; tries < 12 && Math.hypot(pt.x - nearX, pt.z - nearZ) < 55; tries += 1) {
    pt = randomRoadPoint(random, city);
  }
  const car = makeCar(pt.x, pt.z, Math.atan2(nearX - pt.x, nearZ - pt.z), 0x1e2a3a, { police: true });
  car.speed = 12;
  return car;
}

// Smallest signed angle from `from` to `to`, in (-PI, PI].
function angleDiff(from, to) {
  let diff = to - from;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

// Police chase: steer toward the player, faster than traffic, and ram.
// Returns damage dealt to the player (0 unless a ram connects).
export function stepPolice(car, targetX, targetZ, inCar, dt, city) {
  const dx = targetX - car.x, dz = targetZ - car.z;
  const dist = Math.hypot(dx, dz);
  const wantAngle = Math.atan2(dx, dz);
  const diff = angleDiff(car.angle, wantAngle);
  car.angle += Math.max(-1.6 * dt, Math.min(1.6 * dt, diff));
  const wantSpeed = dist > 6 ? 30 : 12;
  car.speed += (wantSpeed - car.speed) * Math.min(1, dt * 1.5);
  const f = forwardOf(car);
  car.x += f.x * car.speed * dt;
  car.z += f.z * car.speed * dt;
  const p = { x: car.x, z: car.z };
  if (collideBuildings(city, p, CAR.length / 2)) { car.x = p.x; car.z = p.z; car.speed *= 0.4; }
  let damage = 0;
  car.ramCooldown = Math.max(0, car.ramCooldown - dt);
  if (dist < 4.6 && car.ramCooldown <= 0) {
    damage = inCar ? 6 : 14;
    car.ramCooldown = 1.2;
    car.speed *= 0.3;
  }
  return { damage, dist };
}

export function nearestParkedCar(parked, x, z, maxDist) {
  return parked.reduce((best, car) => {
    const d = Math.hypot(car.x - x, car.z - z);
    return d < best.d ? { car, d } : best;
  }, { car: null, d: maxDist }).car;
}
