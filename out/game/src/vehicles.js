// Vehicles: the player's car, traffic and police.
// Arcade physics — no wheel simulation, just speed, heading and a steering angle, with
// building collision and car-car push-out. Traffic follows the road graph (straight along one
// road, random turn at each intersection). Police chase the player with a faster top speed and
// ram; on-foot cops are handled in peds.js.
import { CAR, CITY, NOS } from './config.js';
import { collideBuildings, nearestRoadPoint, randomRoadPoint } from './world.js';
import { pick, clamp } from './random.js';

export function makeCar(x, z, angle, color, opts = {}) {
  return {
    x, z, angle, speed: 0, steer: 0,
    color, police: !!opts.police, traffic: !!opts.traffic,
    parked: !!opts.parked, stolen: false, hp: 100,
    // v2: NOS tank (0-100) + drift state. NOS is spent by the driver, refilled
    // slowly, at the safehouse, or bought at the shop.
    nos: NOS.max, drifting: false, nosActive: false,
    // traffic AI
    axis: opts.axis || 'z', dir: opts.dir || 1, cruise: opts.cruise || 9,
    targetSpeed: opts.cruise || 9,
    // police AI
    ramCooldown: 0,
    mesh: null, wheelFL: null, wheelFR: null, wheelRL: null, wheelRR: null,
  };
}

// v2: the SBPD helicopter. No mesh here — just the numbers; render.js draws it.
// It hovers above the player, keeps pace, and its spotlight marks the player.
export function makeHeli(x, z) {
  return { x, z, y: 34, angle: 0, rotor: 0, spotX: x, spotZ: z, mesh: null, rotorMesh: null, spotMesh: null };
}

export function stepHeli(heli, targetX, targetZ, dt) {
  const dx = targetX - heli.x, dz = targetZ - heli.z;
  const dist = Math.hypot(dx, dz);
  const sp = Math.min(26, dist * 0.8 + 8);
  if (dist > 0.5) {
    heli.x += (dx / dist) * sp * dt;
    heli.z += (dz / dist) * sp * dt;
    heli.angle = Math.atan2(dx, dz);
  }
  heli.rotor += dt * 38;
  heli.spotX = targetX;
  heli.spotZ = targetZ;
  return heli;
}

function carForward(car) {
  return { x: Math.sin(car.angle), z: Math.cos(car.angle) };
}

// One physics step for a driven car. `drive` is -1..1 (throttle), `steerIn` -1..1,
// handbrake bool (Space: drift), `nos` bool (Shift: NOS boost, v2).
export function stepDrivenCar(car, drive, steerIn, handbrake, dt, city, nos = false) {
  const targetSteer = steerIn * CAR.steer;
  car.steer += (targetSteer - car.steer) * Math.min(1, dt * 8);
  const accel = drive > 0 ? CAR.accel * drive : drive < 0 ? -CAR.reverseAccel : 0;
  car.speed += accel * dt;
  if (drive === 0) car.speed -= car.speed * Math.min(1, dt * 1.2); // rolling drag
  // v2 drift: handbrake cuts grip — the car slides, turns sharper, and NOS refills.
  car.drifting = !!handbrake && Math.abs(car.speed) > 8;
  if (handbrake) {
    car.speed -= car.speed * Math.min(1, dt * 2.2);
    car.nos = clamp(car.nos + NOS.driftRefundPerSec * dt, 0, NOS.max);
  }
  // v2 NOS: hold Shift while moving forward. Burns the tank, lifts the top speed.
  car.nosActive = !!nos && car.nos > 0 && drive > 0 && car.speed > 4;
  if (car.nosActive) {
    car.nos = clamp(car.nos - NOS.drainPerSec * dt, 0, NOS.max);
    car.speed += CAR.accel * 0.9 * dt;
  } else {
    car.nos = clamp(car.nos + NOS.regenPerSec * dt, 0, NOS.max);
  }
  const maxF = car.nosActive ? CAR.maxSpeed * NOS.boostMult : CAR.maxSpeed;
  const maxR = -CAR.maxReverse;
  car.speed = Math.max(maxR, Math.min(maxF, car.speed));
  // Steering only bites while moving; sharper at low speed, sharper again in a drift.
  const driftMult = car.drifting ? 1.7 : 1;
  const turn = car.steer * (car.speed / CAR.maxSpeed) * 2.4 * driftMult * dt * (car.speed >= 0 ? 1 : -1);
  car.angle += turn;
  const f = carForward(car);
  car.x += f.x * car.speed * dt;
  car.z += f.z * car.speed * dt;
  const p = { x: car.x, z: car.z };
  if (collideBuildings(city, p, CAR.length / 2)) {
    car.x = p.x; car.z = p.z;
    // v2 (revision): a hard wall hit damages the car — this is what makes the
    // smuggle mission's damage rule real, and what the safehouse repairs.
    if (Math.abs(car.speed) > 12) car.hp = Math.max(0, car.hp - 6);
    car.speed *= -0.25; // bounce off the wall
  }
  return car;
}

export function createTraffic(random, city, count) {
  const cars = [];
  for (let i = 0; i < count; i += 1) {
    const pt = randomRoadPoint(random, city);
    const angle = pt.axis === 'z' ? (random() < 0.5 ? 0 : Math.PI) : (random() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
    const car = makeCar(pt.x, pt.z, angle,
      pick(random, [0xc0392b, 0x2471a3, 0xf1c40f, 0x7d3c98, 0x1abc9c, 0xe67e22, 0xecf0f1, 0x2c3e50]),
      { traffic: true, axis: pt.axis, cruise: 7 + random() * 5 });
    car.speed = car.cruise;
    cars.push(car);
  }
  return cars;
}

// Traffic: drive along the current road; at an intersection (both axes near a centreline)
// pick a new direction at random, sometimes turning. Keep speed, avoid piling into the car ahead.
// `random` is the seeded RNG so screenshot scenes stay deterministic.
export function stepTraffic(cars, dt, city, playerCar, random = Math.random) {
  const centres = city.centres;
  for (const car of cars) {
    // Slow down if another car is close ahead.
    let ahead = null;
    for (const other of cars) {
      if (other === car) continue;
      const dx = other.x - car.x, dz = other.z - car.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 9) {
        const f = carForward(car);
        if (dx * f.x + dz * f.z > 0) { ahead = other; break; }
      }
    }
    const want = ahead ? 0 : car.cruise;
    car.speed += (want - car.speed) * Math.min(1, dt * 2);
    const f = carForward(car);
    car.x += f.x * car.speed * dt;
    car.z += f.z * car.speed * dt;
    // At an intersection, maybe turn.
    const nearX = centres.find((c) => Math.abs(car.x - c) < 1.2);
    const nearZ = centres.find((c) => Math.abs(car.z - c) < 1.2);
    if (nearX !== undefined && nearZ !== undefined && random() < dt * 0.9) {
      const turn = random();
      if (turn < 0.3) {
        // Turn 90 degrees.
        const wasZ = Math.abs(Math.sin(car.angle)) < 0.7;
        car.angle = wasZ ? (random() < 0.5 ? Math.PI / 2 : -Math.PI / 2) : (random() < 0.5 ? 0 : Math.PI);
        car.x = nearX; car.z = nearZ;
      }
    }
    // Wrap around the city edge instead of driving into the sea.
    if (Math.abs(car.x) > CITY.half + 20 || Math.abs(car.z) > CITY.half + 20) {
      const pt = randomRoadPoint(random, city);
      car.x = pt.x; car.z = pt.z;
      car.angle = pt.axis === 'z' ? 0 : Math.PI / 2;
    }
    const p = { x: car.x, z: car.z };
    if (collideBuildings(city, p, 2)) { car.x = p.x; car.z = p.z; }
  }
  // Push the player's car out of traffic cars. A hard rear-end matches speeds (bump and
  // follow) instead of multiplying the player's speed down every step while the cars
  // touch — the old *= 0.85 glued the player behind the slowest traffic car.
  if (playerCar) {
    for (const car of cars) {
      const dx = playerCar.x - car.x, dz = playerCar.z - car.z;
      const d = Math.hypot(dx, dz);
      if (d < 4.4 && d > 0.01) {
        const push = (4.4 - d) / 2;
        playerCar.x += (dx / d) * push;
        playerCar.z += (dz / d) * push;
        car.x -= (dx / d) * push;
        car.z -= (dz / d) * push;
        if (playerCar.speed > car.speed + 3) {
          car.speed = playerCar.speed * 0.6;
          playerCar.speed *= 0.6;
        }
      }
    }
  }
}

export function createPoliceCar(random, city, nearX, nearZ) {
  // Spawn on a road a little way from the player, facing them.
  let pt = randomRoadPoint(random, city);
  let tries = 0;
  while (Math.hypot(pt.x - nearX, pt.z - nearZ) < 55 && tries < 12) { pt = randomRoadPoint(random, city); tries += 1; }
  const car = makeCar(pt.x, pt.z, Math.atan2(nearX - pt.x, nearZ - pt.z), 0x1e2a3a, { police: true });
  car.speed = 12;
  return car;
}

// Police chase: steer toward the player, faster than traffic, and ram. Returns damage dealt
// to the player (0 unless a ram connects) and whether the cop is close enough to bust on foot.
export function stepPolice(car, targetX, targetZ, inCar, dt, city) {
  const dx = targetX - car.x, dz = targetZ - car.z;
  const dist = Math.hypot(dx, dz);
  const wantAngle = Math.atan2(dx, dz);
  let diff = wantAngle - car.angle;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  car.angle += Math.max(-1.6 * dt, Math.min(1.6 * dt, diff));
  const wantSpeed = dist > 6 ? 30 : 12;
  car.speed += (wantSpeed - car.speed) * Math.min(1, dt * 1.5);
  const f = carForward(car);
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
  let best = null, bestD = maxDist;
  for (const car of parked) {
    const d = Math.hypot(car.x - x, car.z - z);
    if (d < bestD) { bestD = d; best = car; }
  }
  return best;
}
