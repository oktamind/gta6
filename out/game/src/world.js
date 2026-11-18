// Solmar Bay itself: a seeded grid city. No drawing here — just data the renderer and the
// gameplay both read: road centrelines, building footprints (AABBs for collision), sidewalks,
// named landmarks, parking spots and the road graph traffic and police drive on.
import { CITY, PALETTE, DISTRICTS } from './config.js';
import { pick, range } from './random.js';

export const LANDMARKS = [
  { id: 'garage', name: "Delia's Garage", kind: 'garage' },
  { id: 'bank', name: 'Solmar Trust Bank', kind: 'bank' },
  { id: 'marina', name: 'Marina Dock', kind: 'marina' },
  { id: 'hospital', name: 'St. Anselm Hospital', kind: 'hospital' },
  { id: 'police', name: 'SBPD Central', kind: 'police' },
  { id: 'market', name: 'Fishmarket Square', kind: 'market' },
  // v2: a safehouse garage (save + repair + full NOS refill) and a shop
  // (armor, SMG ammo, NOS, health, shotgun) — the top-10 pattern's missing half.
  { id: 'safehouse', name: 'Rae’s Safehouse', kind: 'safehouse' },
  { id: 'shop', name: 'Solmar Arms & Ammo', kind: 'shop' },
];

// Named district at (x,z) — v2 HUD readout. Falls back to the nearest quarter.
export function districtAt(x, z) {
  for (const d of DISTRICTS) {
    if (x >= d.x0 && x < d.x1 && z >= d.z0 && z < d.z1) return d.name;
  }
  return 'Solmar Bay';
}

// Road centrelines: roads run at x = k*pitch - half + road/2 offsets... simpler: grid lines at
// multiples of pitch, centred on the city. Road i centre = -half + i*pitch + road/2 for i in 0..blocks.
export function roadCentres() {
  const centres = [];
  for (let i = 0; i <= CITY.blocks; i += 1) centres.push(-CITY.half + i * CITY.pitch + CITY.road / 2);
  return centres;
}

export function createCity(random) {
  const centres = roadCentres();
  const buildings = [];
  const landmarks = {};
  const parkSpots = [];
  const pickups = [];

  // One building (or a small cluster) per block, inset from the roads.
  for (let bx = 0; bx < CITY.blocks; bx += 1) {
    for (let bz = 0; bz < CITY.blocks; bz += 1) {
      const x0 = -CITY.half + bx * CITY.pitch + CITY.road;
      const z0 = -CITY.half + bz * CITY.pitch + CITY.road;
      const count = random() < 0.35 ? 2 : 1;
      for (let k = 0; k < count; k += 1) {
        const w = range(random, 14, CITY.block - 6) / (count === 2 ? 1.6 : 1);
        const d = range(random, 14, CITY.block - 6) / (count === 2 ? 1.6 : 1);
        const xRaw = x0 + (count === 2 ? (k * CITY.block) / 2.4 : CITY.block / 2) + range(random, -3, 3);
        const zRaw = z0 + CITY.block / 2 + range(random, -3, 3);
        // Clamp the footprint inside the block: an unclamped wide building at a block edge
        // spills onto the road and blocks it entirely (seed 1: a building at x 1.9..20.6 sat
        // across the x=7 road and wedged every car that drove up it).
        const x = Math.max(x0 + w / 2 + 1, Math.min(x0 + CITY.block - w / 2 - 1, xRaw));
        const z = Math.max(z0 + d / 2 + 1, Math.min(z0 + CITY.block - d / 2 - 1, zRaw));
        const h = range(random, 7, random() < 0.18 ? 46 : 22);
        buildings.push({ x, z, w, d, h, color: pick(random, PALETTE.building), id: `b${bx}-${bz}-${k}` });
      }
      // A parked car on a random block edge, on the road.
      if (random() < 0.55) {
        const along = centres[bx];
        parkSpots.push({ x: along + (random() < 0.5 ? -3.4 : 3.4), z: -CITY.half + bz * CITY.pitch + CITY.road + range(random, 6, CITY.block - 6), angle: Math.PI / 2 });
      }
    }
  }

  // Landmarks sit on fixed blocks so missions always know where they are.
  const landmarkBlocks = { garage: [1, 1], bank: [6, 3], marina: [7, 7], hospital: [1, 6], police: [4, 4], market: [3, 6], safehouse: [2, 7], shop: [5, 1] };
  for (const lm of LANDMARKS) {
    const [bx, bz] = landmarkBlocks[lm.id];
    const x = -CITY.half + bx * CITY.pitch + CITY.road + CITY.block / 2;
    const z = -CITY.half + bz * CITY.pitch + CITY.road + CITY.block / 2;
    landmarks[lm.id] = { ...lm, x, z };
    // Flatten the landmark's own building into a taller, distinct one.
    const lmH = lm.kind === 'bank' ? 30 : lm.kind === 'police' ? 24 : lm.kind === 'safehouse' ? 12 : lm.kind === 'shop' ? 14 : 16;
    const lmColor = lm.kind === 'bank' ? 0xd8c98a : lm.kind === 'police' ? 0x3a5a7a : lm.kind === 'safehouse' ? 0x58c96b : lm.kind === 'shop' ? 0xffb02e : 0x8a6f5c;
    buildings.push({ x, z, w: 26, d: 26, h: lmH, color: lmColor, id: `lm-${lm.id}`, landmark: lm.id });
  }

  // Health + weapon pickups scattered on sidewalks.
  for (let i = 0; i < 10; i += 1) {
    const c = centres[Math.floor(random() * centres.length)];
    pickups.push({ x: c + (random() < 0.5 ? -5.5 : 5.5), z: range(random, -CITY.half + 20, CITY.half - 20), kind: i % 3 === 2 ? 'smg' : 'health', taken: false });
  }

  return { centres, buildings, landmarks, parkSpots, pickups };
}

// A landmark's street-front approach point: 18 m east of its building centre. The landmark
// buildings are 26 m wide (half 13), so a marker or a spawn AT the centre is unreachable —
// the player collides with the walls 13 m out. Approach points sit on the plaza just clear
// of the walls, where the player can actually stand.
export function landmarkApproach(city, id) {
  const lm = city.landmarks[id];
  return { x: lm.x + 18, z: lm.z };
}
export function onRoad(city, x, z) {
  const r = CITY.road / 2 + 0.5;
  for (const c of city.centres) {
    if (Math.abs(x - c) < r || Math.abs(z - c) < r) return true;
  }
  return false;
}

// Push a circle (x,z,r) out of every building AABB it overlaps. Returns true if it hit anything.
export function collideBuildings(city, p, r) {
  let hit = false;
  for (const b of city.buildings) {
    const hw = b.w / 2, hd = b.d / 2;
    const cx = Math.max(b.x - hw, Math.min(p.x, b.x + hw));
    const cz = Math.max(b.z - hd, Math.min(p.z, b.z + hd));
    const dx = p.x - cx, dz = p.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      hit = true;
      if (d2 > 0.0001) {
        const d = Math.sqrt(d2);
        p.x = cx + (dx / d) * r;
        p.z = cz + (dz / d) * r;
      } else {
        // Centre inside the box: push out along the smallest penetration axis.
        const px = b.w / 2 + r - Math.abs(p.x - b.x);
        const pz = b.d / 2 + r - Math.abs(p.z - b.z);
        if (px < pz) p.x += p.x > b.x ? px : -px;
        else p.z += p.z > b.z ? pz : -pz;
      }
    }
  }
  // City bounds.
  const lim = CITY.half + 30;
  p.x = Math.max(-lim, Math.min(lim, p.x));
  p.z = Math.max(-lim, Math.min(lim, p.z));
  return hit;
}

// Nearest road centreline point to (x,z): traffic and police snap to it.
export function nearestRoadPoint(city, x, z) {
  let best = null, bestD = Infinity;
  for (const c of city.centres) {
    const d1 = Math.abs(x - c);
    if (d1 < bestD) { bestD = d1; best = { x: c, z, axis: 'z' }; }
    const d2 = Math.abs(z - c);
    if (d2 < bestD) { bestD = d2; best = { x, z: c, axis: 'x' }; }
  }
  return best;
}

// Random point on a road, for spawning traffic / police / pedestrians.
export function randomRoadPoint(random, city) {
  const c = city.centres[Math.floor(random() * city.centres.length)];
  if (random() < 0.5) return { x: c + (random() < 0.5 ? -3 : 3), z: range(random, -CITY.half, CITY.half), axis: 'z' };
  return { x: range(random, -CITY.half, CITY.half), z: c + (random() < 0.5 ? -3 : 3), axis: 'x' };
}
