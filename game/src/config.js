// Every tuning number and colour for Solmar Heist in one place.
// The city is a grid: BLOCKS x BLOCKS blocks, each BLOCK metres wide with a ROAD between them.
export const STEP = 1 / 60;
export const SAVE_KEY = 'solmar-heist.save.v1';

export const CITY = {
  blocks: 8,          // blocks per side
  block: 44,          // block width (m)
  road: 14,           // road width (m)
  // pitch = block + road; city spans [-half, +half]
  get pitch() { return this.block + this.road; },
  get half() { return (this.blocks * this.pitch) / 2; },
};

export const PLAYER = {
  walkSpeed: 7,
  sprintSpeed: 11,
  radius: 0.55,
  height: 1.8,
  jumpSpeed: 7.5,
  health: 100,
};

export const CAR = {
  accel: 16,
  brake: 30,
  reverseAccel: 10,
  maxSpeed: 34,       // ~76 mph
  maxReverse: 10,
  steer: 0.55,        // rad/s at full lock, scaled by speed
  grip: 6,
  length: 4.4,
  width: 2.0,
};

// NOS boost (v2): hold Shift in a car to burn NOS. Top speed rises ~45% while the
// tank lasts; drifting (Space handbrake) refills a little of it. The tank refills
// slowly on its own and fully at the safehouse garage.
export const NOS = {
  max: 100,
  drainPerSec: 42,
  regenPerSec: 3.5,
  driftRefundPerSec: 9,
  boostMult: 1.45,
  refillPrice: 100,
};

// Police helicopter (v2): appears at 4-5 stars, hovers above the player with a
// spotlight, blocks wanted decay while overhead, and nudges ground units in.
export const HELI = {
  minWanted: 4,
  hoverHeight: 34,
  followSpeed: 26,
  spotRadius: 14,
  rotorHz: 11,
};

export const WEAPONS = {
  pistol: { name: 'PISTOL', damage: 34, cooldown: 0.3, price: 0 },
  smg: { name: 'SMG', damage: 18, cooldown: 0.09, price: 0 },
  shotgun: { name: 'SHOTGUN', damage: 16, pellets: 5, cooldown: 0.85, price: 600, ammo: 24 },
};

export const SHOP = {
  armorPrice: 200,
  smgAmmoPrice: 150,
  smgAmmoAmount: 60,
  nosPrice: 100,
  healthPrice: 120,
};

// Solmar Bay has 12 named districts (v2): the HUD names the one you are in, and the
// race / smuggle missions route through them. Grid is 8x8 blocks; districts are
// 2x2-block quarters plus the marina / old town corners.
export const DISTRICTS = [
  { name: 'Delia Row', x0: -232, z0: -232, x1: -58, z1: -58 },
  { name: 'Fishmarket', x0: -58, z0: -232, x1: 116, z1: -58 },
  { name: 'North Docks', x0: 116, z0: -232, x1: 232, z1: -58 },
  { name: 'Old Town', x0: -232, z0: -58, x1: -58, z1: 116 },
  { name: 'Civic Center', x0: -58, z0: -58, x1: 116, z1: 116 },
  { name: 'Bayfront', x0: 116, z0: -58, x1: 232, z1: 116 },
  { name: 'St. Anselm', x0: -232, z0: 116, x1: -58, z1: 232 },
  { name: 'Palm Court', x0: -58, z0: 116, x1: 116, z1: 232 },
  { name: 'Marina Bay', x0: 116, z0: 116, x1: 232, z1: 232 },
  { name: 'Sunset Strip', x0: -232, z0: -58, x1: -116, z1: 0 },
  { name: 'Harbor Lights', x0: 0, z0: -232, x1: 116, z1: -116 },
  { name: 'Cayo Verde', x0: 116, z0: 0, x1: 232, z1: 116 },
];

// Car radio (v2): three switchable synth stations, Q cycles. No audio files — the
// sound module synthesises each station's loop live.
export const RADIO = [
  { name: 'SOLMAR FM 88.5', tag: 'sunset pop', tempo: 112, scale: [0, 2, 4, 7, 9], root: 220 },
  { name: 'BAY 101 BASS', tag: 'night drive', tempo: 96, scale: [0, 3, 5, 7, 10], root: 110 },
  { name: 'PALM AM 1420', tag: 'old gold', tempo: 132, scale: [0, 4, 5, 7, 11], root: 262 },
];

export const WANTED = {
  max: 5,
  decayDelay: 18,     // seconds without a crime before stars start falling
  decayInterval: 8,   // seconds per star lost while hidden
  bustRange: 3.0,     // cop must be this close on foot to bust you
  bustTime: 1.4,      // seconds inside bust range to get busted
};

export const MISSIONS = [
  { id: 'wheels', name: '1 · Wheels', pay: 300,
    brief: 'Delia needs wheels. Steal any car and bring it to her garage.',
    detail: 'Press E next to a parked or traffic car to steal it, then drive to the yellow marker.' },
  { id: 'courier', name: '2 · Courier Run', pay: 500,
    brief: 'Five drops across the bay, 100 seconds. Do not be late.',
    detail: 'Drive through every glowing checkpoint before the timer runs out.' },
  { id: 'shakedown', name: '3 · Shakedown', pay: 700,
    brief: 'The Gulls crew moved in on Delia’s turf. Send three of them packing.',
    detail: 'Go to the red marker and deal with 3 Gull enforcers — fists work, bullets work faster.' },
  { id: 'hot', name: '4 · Hot Pursuit', pay: 900,
    brief: 'A package, a 3-star tail, and sixty seconds of bad decisions.',
    detail: 'Grab the package, then survive 60 seconds with the heat on. Lose them or outlast them.' },
  { id: 'vault', name: '5 · The Vault Run', pay: 2000,
    brief: 'The Solmar Trust vault. In, out, gone — then the boat at the marina.',
    detail: 'Reach the bank, hold E at the vault for 3 seconds, then escape to the marina with 4 stars.' },
  { id: 'smuggle', name: '6 · Harbor Lights', pay: 1200,
    brief: 'A hot car full of Delia’s cargo. Deliver it to the marina — quietly.',
    detail: 'Steal the marked car at the docks, then drive it to the marina without wrecking it. Damage over 60% voids the pay.' },
  { id: 'race', name: '7 · Bayfront Grand Prix', pay: 1500,
    brief: 'An illegal street race across all twelve districts. NOS is legal here.',
    detail: 'Hit all 6 race gates in order before the 110-second clock runs out. Shift for NOS, Space to drift the corners.' },
  { id: 'finale', name: '8 · The Delia Gambit', pay: 3000,
    brief: 'One last job: rob the SBPD evidence vault, then lose the helicopter.',
    detail: 'Reach SBPD Central, hold E for 4 seconds, then survive 75 seconds at 5 stars with the helicopter on you — then reach the safehouse.' },
];

export const PALETTE = {
  skyTop: 0x2a4a6b, skyBottom: 0xf2a65a, fog: 0xd98a4e,
  asphalt: 0x2e3138, sidewalk: 0x8d929c, ground: 0x3d4a35,
  building: [0x9a7b5f, 0x7d8aa0, 0xb08d6a, 0x6b7f8e, 0xa88a7a, 0x5f7086, 0xc2a878, 0x8a6f5c],
  glass: 0x2b3a4a, player: 0xffb02e, playerDark: 0x1c2733,
  police: 0x1e2a3a, policeLight: 0x2f7fe0,
  carColors: [0xc0392b, 0x2471a3, 0xf1c40f, 0x7d3c98, 0x1abc9c, 0xe67e22, 0xecf0f1, 0x2c3e50, 0x16a085, 0xd35400],
  pedColors: [0xe74c3c, 0x3498db, 0x2ecc71, 0xf39c12, 0x9b59b6, 0x1abc9c, 0xe67e22, 0x95a5a6],
  marker: 0xffd23e, enemy: 0x8e2f32, pickup: 0x58c96b,
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
