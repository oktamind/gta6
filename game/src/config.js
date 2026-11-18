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
