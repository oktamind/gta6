// Pedestrians and on-foot enemies.
// Peds stroll the sidewalks, cross roads at intersections, and flee from gunfire. Gull
// enforcers (mission 3) and on-foot cops stand their ground, chase the player and punch/shoot.
// v2: a shopkeeper stands at Solmar Arms & Ammo and a mechanic at the safehouse —
// both stay put, never flee, and never count as targets for missions.
// v3: a croupier stands at the Crown Casino (job 10's set dressing — same stationary
// keeper behaviour, gold jacket) and gulls now also guard the dock crates in job 9.
import { CITY } from './config.js';
import { collideBuildings, nearestRoadPoint, randomRoadPoint } from './world.js';
import { pick, range } from './random.js';

export function makePed(random, city, opts = {}) {
  const pt = randomRoadPoint(random, city);
  // Nudge onto the sidewalk beside the road.
  const x = pt.axis === 'z' ? pt.x + (random() < 0.5 ? -5.6 : 5.6) : pt.x;
  const z = pt.axis === 'x' ? pt.z + (random() < 0.5 ? -5.6 : 5.6) : pt.z;
  return {
    x, z, angle: random() * Math.PI * 2,
    speed: range(random, 1.2, 2.2), hp: 100,
    kind: opts.kind || 'ped', // ped | gull | cop
    color: opts.color || pick(random, [0xe74c3c, 0x3498db, 0x2ecc71, 0xf39c12, 0x9b59b6, 0x1abc9c, 0xe67e22, 0x95a5a6]),
    state: 'walk', stateT: 0, targetX: x, targetZ: z,
    fleeX: 0, fleeZ: 0, attackCooldown: 0, shootCooldown: 0,
    mesh: null, alive: true, paid: false,
  };
}

export function createPeds(random, city, count) {
  const peds = [];
  for (let i = 0; i < count; i += 1) peds.push(makePed(random, city));
  return peds;
}

function pickStrollTarget(ped, random, city) {
  const pt = randomRoadPoint(random, city);
  ped.targetX = pt.x;
  ped.targetZ = pt.z;
}

// One step. Returns events: { shot: ped } when a cop/gull shoots the player, { hit: ped }
// when one lands a melee hit. Gunfire position (gx, gz) makes nearby peds flee.
export function stepPeds(peds, dt, city, player, gunfire, random) {
  const events = { damage: 0, shotBy: null, killed: [] };
  for (const ped of peds) {
    if (!ped.alive) continue;
    ped.attackCooldown = Math.max(0, ped.attackCooldown - dt);
    ped.shootCooldown = Math.max(0, ped.shootCooldown - dt);
    const dx = player.x - ped.x, dz = player.z - ped.z;
    const dist = Math.hypot(dx, dz);

    // Keepers never move, never flee, never fight — they run the shop/safehouse/casino.
    if (ped.kind === 'shopkeeper' || ped.kind === 'mechanic' || ped.kind === 'croupier') {
      ped.angle = Math.PI;
      continue;
    }
    if (ped.kind === 'ped') {
      if (gunfire && Math.hypot(ped.x - gunfire.x, ped.z - gunfire.z) < 26) {
        ped.state = 'flee';
        ped.fleeX = ped.x - gunfire.x; ped.fleeZ = ped.z - gunfire.z;
        ped.stateT = 2.5;
      }
      if (ped.state === 'flee') {
        ped.stateT -= dt;
        const len = Math.hypot(ped.fleeX, ped.fleeZ) || 1;
        ped.x += (ped.fleeX / len) * 5 * dt;
        ped.z += (ped.fleeZ / len) * 5 * dt;
        ped.angle = Math.atan2(ped.fleeX, ped.fleeZ);
        if (ped.stateT <= 0) ped.state = 'walk';
      } else {
        const tx = ped.targetX - ped.x, tz = ped.targetZ - ped.z;
        const td = Math.hypot(tx, tz);
        if (td < 1.5) pickStrollTarget(ped, random, city);
        else {
          ped.x += (tx / td) * ped.speed * dt;
          ped.z += (tz / td) * ped.speed * dt;
          ped.angle = Math.atan2(tx, tz);
        }
      }
    } else {
      // Gull enforcer or on-foot cop: chase the player and attack.
      if (dist > 2.2) {
        const sp = ped.kind === 'cop' ? 5.2 : 4.4;
        ped.x += (dx / dist) * sp * dt;
        ped.z += (dz / dist) * sp * dt;
        ped.angle = Math.atan2(dx, dz);
      } else if (ped.attackCooldown <= 0) {
        events.damage += ped.kind === 'cop' ? 9 : 7;
        ped.attackCooldown = 1.0;
      }
      // Cops shoot from mid-range when the player is wanted.
      if (ped.kind === 'cop' && dist > 8 && dist < 30 && ped.shootCooldown <= 0) {
        ped.shootCooldown = 1.6;
        events.damage += 5;
        events.shotBy = ped;
      }
    }
    const p = { x: ped.x, z: ped.z };
    if (collideBuildings(city, p, 0.6)) { ped.x = p.x; ped.z = p.z; }
    if (Math.abs(ped.x) > CITY.half + 28 || Math.abs(ped.z) > CITY.half + 28) {
      // Wandered out: respawn on a road near the player.
      const pt = randomRoadPoint(random, city);
      ped.x = pt.x; ped.z = pt.z;
    }
  }
  return events;
}

// Damage a ped at (x,z) within `radius` of the shot point, nearest first. Returns the ped hit or null.
export function damagePedsAt(peds, x, z, radius, damage) {
  let best = null, bestD = radius;
  for (const ped of peds) {
    if (!ped.alive) continue;
    const d = Math.hypot(ped.x - x, ped.z - z);
    if (d < bestD) { bestD = d; best = ped; }
  }
  if (!best) return null;
  best.hp -= damage;
  if (best.hp <= 0) { best.alive = false; }
  return best;
}

// Spawn N gull enforcers around a point.
export function spawnGulls(random, x, z, count) {
  const gulls = [];
  for (let i = 0; i < count; i += 1) {
    const g = makePed(random, { centres: [x], half: 999 }, { kind: 'gull', color: 0x8e2f32 });
    g.x = x + (random() - 0.5) * 16;
    g.z = z + (random() - 0.5) * 16;
    g.hp = 60;
    gulls.push(g);
  }
  return gulls;
}

// Stationary shopkeeper / mechanic / croupier peds. They stand at their landmark's
// approach point, face the street, and never walk off.
export function spawnKeeper(kind, x, z) {
  const colors = { shopkeeper: 0xffb02e, mechanic: 0x58c96b, croupier: 0xc9a227 };
  return {
    x, z, angle: Math.PI, speed: 0, hp: 100,
    kind, // 'shopkeeper' | 'mechanic' | 'croupier'
    color: colors[kind] || 0xffb02e,
    state: 'stand', stateT: 0, targetX: x, targetZ: z,
    fleeX: 0, fleeZ: 0, attackCooldown: 0, shootCooldown: 0,
    mesh: null, alive: true, paid: false, taxi: false,
  };
}

// Spawn an on-foot cop near the player.
export function spawnCop(random, city, player) {
  const pt = randomRoadPoint(random, city);
  const cop = makePed(random, city, { kind: 'cop', color: 0x1e2a3a });
  cop.x = pt.x; cop.z = pt.z;
  cop.hp = 80;
  return cop;
}
