// Solmar Heist v3 — boot, the fixed-step loop, and every screen.
// The game lives on four screens (title / play / paused / end) and advances in
// 1/60 s slices while the renderer paints the result. ?seed=N pins the city
// layout; ?shot=start|drive|chase|heist&seed=N stages one frozen scene for a
// screenshot and raises window.__shotReady once it has been painted twice.
// v3 content: ten story jobs, three rival street races, a rifle, a fourth radio
// station, fourteen districts, and a police helicopter that orbits and radios
// for ground backup.
import { STEP, SAVE_KEY, PLAYER, CAR, WANTED, MISSIONS, CITY, RADIO, SHOP, HELI, WEAPONS, RACE_EVENTS } from './config.js';
import { createRandom } from './random.js';
import { createInput, ACTION_ENTER, ACTION_PAUSE, ACTION_SHOOT, ACTION_JUMP, ACTION_HONK, ACTION_RELOAD, ACTION_INTERACT, ACTION_RADIO, ACTION_SHOP1, ACTION_SHOP2, ACTION_SHOP3, ACTION_SHOP4, ACTION_SHOP5 } from './input.js';
import { createCity, collideBuildings, nearestRoadPoint, landmarkApproach, districtAt } from './world.js';
import { makeCar, stepDrivenCar, createTraffic, stepTraffic, createPoliceCar, stepPolice, nearestParkedCar, makeHeli, stepHeli } from './vehicles.js';
import { createPeds, stepPeds, damagePedsAt, spawnGulls, spawnCop, spawnKeeper } from './peds.js';
import { createMissionState, startMission, stepMission, objectiveText } from './missions.js';
import { createRaceState, startRace, stepRace, raceEventAt, stepRival, raceObjectiveText } from './races.js';
import { createSound } from './sound.js';
import { createHud } from './hud.js';
import { createRenderer } from './render.js';
import { stageShot } from './shots.js';

const MAX_FRAME = 0.25;
const query = new URLSearchParams(window.location.search);
const shotName = query.get('shot');
const seedRaw = Number.parseInt(query.get('seed') ?? '', 10);
const seed = Number.isInteger(seedRaw) ? seedRaw : 1337;

const canvas = document.getElementById('game');
const statusEl = document.getElementById('status');
const random = createRandom(seed);
const city = createCity(random);
const sound = createSound();
const hud = createHud();
const renderer = createRenderer(canvas, city, random);
const input = createInput(canvas);

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

const G = {
  seed, city, random,
  player: {
    // Spawn on the plaza before Delia's garage (its approach point), never at the
    // landmark centre — the garage block is 26 m across and would eat the spawn.
    x: city.landmarks.garage.x + 18, z: city.landmarks.garage.z, y: 0, vy: 0,
    angle: 0, camYaw: Math.PI * 0.75, camPitch: 0.32,
    health: PLAYER.health, cash: 150, weapon: 'pistol', smgAmmo: 0,
    armor: 0, shotgunAmmo: 0, rifleAmmo: 0,
    inCar: false, car: null, moving: false,
  },
  parked: [], traffic: [], police: [], peds: [],
  mission: createMissionState(),
  race: createRaceState(),
  raceRivals: [],
  raceStarts: RACE_EVENTS,
  objective: { title: 'FREE ROAM', text: 'Explore Solmar Bay.', sub: '' },
  wanted: 0, lastCrimeT: -999, decayT: 0, bustT: 0,
  day: 1, clockMin: 8 * 60, time: 0,
  screen: 'title', freeRoam: false, storyDone: false,
  fireCooldown: 0, taxiPed: null, taxiCooldown: 8, gunfire: null, hitstopT: 0,
  gullKills: 0, holdingE: false, shotCam: null,
  heli: null, radioStation: 0, district: 'Solmar Bay', nos: 100,
  smuggleCar: null, driftT: 0,
  stats: { carsStolen: 0, shotsFired: 0, pedsDown: 0, missionsDone: 0, fares: 0, earned: 0, racesWon: 0 },
};

// Fill the city's parking spots with parked cars (eight paint jobs, cycling).
const PAINTS = [0xc0392b, 0x2471a3, 0xf1c40f, 0x7d3c98, 0x1abc9c, 0xe67e22, 0xecf0f1, 0x2c3e50];
for (const spot of city.parkSpots) {
  G.parked.push(makeCar(spot.x, spot.z, spot.angle, PAINTS[G.parked.length % PAINTS.length], { parked: true }));
}
G.traffic = createTraffic(random, city, 14);
G.peds = createPeds(random, city, 26);
// Keepers stand at their counters — shopkeeper, safehouse mechanic, and the
// casino croupier. They join after createPeds, which replaces G.peds wholesale.
for (const [kind, landmark] of [['shopkeeper', 'shop'], ['mechanic', 'safehouse'], ['croupier', 'casino']]) {
  const at = landmarkApproach(city, landmark);
  G.peds.push(spawnKeeper(kind, at.x, at.z));
}

function announce(msg) { statusEl.textContent = msg; }

function addWanted(n, reason) {
  if (n > 0 && G.wanted >= 5) return;
  G.wanted = clamp(G.wanted + n, 0, 5);
  G.lastCrimeT = G.time;
  G.decayT = 0;
  if (n > 0) hud.toast(`WANTED ${'★'.repeat(G.wanted)} — ${reason || 'somebody saw that'}`);
}

const SAVE_VERSION = 3;

function saveGame(silent) {
  try {
    const p = G.player;
    const data = {
      version: SAVE_VERSION, savedAt: Date.now(),
      cash: p.cash, health: p.health, x: p.x, z: p.z, angle: p.angle,
      weapon: p.weapon, smgAmmo: p.smgAmmo,
      armor: p.armor, shotgunAmmo: p.shotgunAmmo, rifleAmmo: p.rifleAmmo,
      radioStation: G.radioStation, raceBest: G.race.best,
      missionIndex: G.mission.index, missionDone: G.mission.done,
      day: G.day, clockMin: G.clockMin,
    };
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    if (!silent) document.getElementById('save-note').textContent = 'Saved — cash, jobs and position stored in this browser.';
    return true;
  } catch { return false; }
}

function loadSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function numOr(v, fallback) { return typeof v === 'number' ? v : fallback; }

function applySave(data) {
  const p = G.player;
  p.cash = numOr(data.cash, 150);
  p.health = numOr(data.health, PLAYER.health);
  p.x = numOr(data.x, p.x);
  p.z = numOr(data.z, p.z);
  p.angle = numOr(data.angle, 0);
  p.weapon = data.weapon || 'pistol';
  p.smgAmmo = numOr(data.smgAmmo, 0);
  p.armor = numOr(data.armor, 0);
  p.shotgunAmmo = numOr(data.shotgunAmmo, 0);
  p.rifleAmmo = numOr(data.rifleAmmo, 0);
  G.radioStation = numOr(data.radioStation, 0);
  G.race.best = data.raceBest || {};
  G.mission.index = numOr(data.missionIndex, 0);
  // Older saves carry fewer done-flags (v1: 5, v2: 8) — pad to ten jobs.
  const done = Array.isArray(data.missionDone) ? data.missionDone.slice() : [];
  while (done.length < 10) done.push(false);
  G.mission.done = done.slice(0, 10);
  G.day = numOr(data.day, 1);
  G.clockMin = numOr(data.clockMin, 480);
}

function showScreen(name) {
  G.screen = name;
  for (const [id, when] of [['screen-title', 'title'], ['screen-pause', 'paused'], ['screen-end', 'end']]) {
    document.getElementById(id).classList.toggle('hidden', name !== when);
  }
}

function refreshTitle() {
  document.getElementById('btn-continue').style.display = loadSave() ? '' : 'none';
  const rows = [];
  MISSIONS.forEach((m, i) => {
    const cls = G.mission.done[i] ? 'done' : (i === G.mission.index ? 'now' : '');
    rows.push(`<li class="${cls}">${m.name} — $${m.pay}</li>`);
  });
  document.getElementById('mission-list').innerHTML = rows.join('');
}

function resetPlayerForNewGame() {
  const p = G.player;
  p.health = PLAYER.health;
  p.inCar = false; p.car = null;
  p.weapon = 'pistol'; p.smgAmmo = 0;
  p.armor = 0; p.shotgunAmmo = 0; p.rifleAmmo = 0;
}

function newGame(freeRoam, fromSave) {
  const p = G.player;
  resetPlayerForNewGame();
  G.wanted = 0; G.bustT = 0; G.gullKills = 0;
  G.heli = null; G.smuggleCar = null;
  G.mission = createMissionState();
  G.race = createRaceState();
  G.raceRivals = [];
  G.freeRoam = freeRoam;
  if (freeRoam) {
    G.mission.index = 10;
    G.mission.done = Array(10).fill(true);
  }
  if (fromSave) applySave(fromSave);
  else if (!freeRoam) {
    p.cash = 150;
    const g = landmarkApproach(city, 'garage');
    p.x = g.x; p.z = g.z;
  }
  showScreen('play');
  sound.unlock();
  announce(freeRoam ? 'Free roam. Solmar Bay is yours.' : 'Story started. Delia is waiting at the garage.');
  if (!freeRoam && !fromSave) hud.toast('Job 1: Wheels — press E at the garage to start', 4200);
}

// ---- Cars: get in, get out ----
function enterCar() {
  const p = G.player;
  const car = nearestParkedCar([...G.parked, ...G.traffic], p.x, p.z, 4.5);
  if (!car) return false;
  const lot = G.traffic.includes(car) ? G.traffic : G.parked;
  lot.splice(lot.indexOf(car), 1);
  if (!car.stolen) {
    car.stolen = true;
    G.stats.carsStolen += 1;
    addWanted(1, 'car stolen');
  }
  p.inCar = true;
  p.car = car;
  // The camera yaw is the view direction, so face it along the car's nose.
  p.camYaw = car.angle;
  sound.unlock();
  hud.toast(car.police ? 'You stole a police car. Bold.' : 'Car stolen — drive like you mean it.');
  return true;
}

function exitCar() {
  const p = G.player;
  if (!p.car) return;
  const car = p.car;
  car.speed = 0;
  car.parked = true;
  G.parked.push(car);
  // Step out on the driver's side, clear of the door.
  p.x = car.x - Math.cos(car.angle) * 2.2;
  p.z = car.z + Math.sin(car.angle) * 2.2;
  p.y = 0;
  p.inCar = false;
  p.car = null;
}

// ---- Combat: the vest eats hits first, then health ----
function damagePlayer(amount) {
  const p = G.player;
  const soaked = Math.min(p.armor, amount);
  p.armor -= soaked;
  p.health -= (amount - soaked);
  // Getting hit shakes the camera (trauma 0.35) so damage reads as impact,
  // not bookkeeping.
  renderer.addTrauma(0.35);
}

function aimDir() { return { x: Math.sin(G.player.camYaw), z: Math.cos(G.player.camYaw) }; }

function findConeTarget(range, minDot) {
  const p = G.player;
  const dir = aimDir();
  let best = null, bestD = range;
  for (const ped of G.peds) {
    if (!ped.alive) continue;
    const dx = ped.x - p.x, dz = ped.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d > bestD || d < 0.5) continue;
    if ((dx * dir.x + dz * dir.z) / d > minDot) { bestD = d; best = ped; }
  }
  return best;
}

function shotgunBlast(dir) {
  const p = G.player;
  // Five pellets: everything alive in a wide cone out to 20 m takes a hit.
  for (const ped of G.peds) {
    if (!ped.alive) continue;
    const dx = ped.x - p.x, dz = ped.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d > 20 || d < 0.5) continue;
    if ((dx * dir.x + dz * dir.z) / d > 0.92) {
      ped.hp -= 16;
      if (ped.hp <= 0) { ped.alive = false; onPedDown(ped, false); }
    }
  }
}

function shoot() {
  const p = G.player;
  if (G.fireCooldown > 0 || p.inCar) return;
  const w = WEAPONS[p.weapon] || WEAPONS.pistol;
  const ammoKey = { smg: 'smgAmmo', shotgun: 'shotgunAmmo', rifle: 'rifleAmmo' }[p.weapon];
  if (ammoKey && p[ammoKey] <= 0) {
    const dryName = { smg: 'SMG', shotgun: 'Shotgun', rifle: 'Rifle' }[p.weapon];
    p.weapon = 'pistol';
    hud.toast(`${dryName} dry — back to the pistol.`);
    return;
  }
  G.fireCooldown = w.cooldown;
  if (ammoKey) p[ammoKey] -= 1;
  G.stats.shotsFired += 1;
  sound.shoot(p.weapon);
  const dir = aimDir();
  const from = { x: p.x, y: 1.5, z: p.z };
  // A swing first: anyone right in front of you eats a punch instead of a bullet.
  const close = damagePedsAt(G.peds, p.x + dir.x * 1.6, p.z + dir.z * 1.6, 1.4, 20);
  if (close) {
    sound.punch();
    onPedDown(close, true);
    return;
  }
  // Hitscan down a narrow cone. The rifle reaches 80 m; everything else 46 m.
  const range = p.weapon === 'rifle' ? 80 : 46;
  const best = findConeTarget(range, 0.985);
  const to = best
    ? { x: best.x, y: 1.2, z: best.z }
    : { x: p.x + dir.x * range, y: 1.5, z: p.z + dir.z * range };
  renderer.showTracer(from, to, G.time + 0.08);
  G.gunfire = { x: p.x, z: p.z };
  if (!best) return;
  if (p.weapon === 'shotgun') shotgunBlast(dir);
  else {
    best.hp -= w.damage;
    if (best.hp <= 0) { best.alive = false; onPedDown(best, false); }
  }
}

function onPedDown(ped, melee) {
  G.stats.pedsDown += 1;
  if (ped.kind === 'gull') {
    G.gullKills += 1;
    hud.toast(`Gull down — ${G.gullKills}/3`);
  } else if (ped.kind === 'cop') {
    addWanted(2, 'officer down');
  } else {
    addWanted(1, melee ? 'assault in broad daylight' : 'civilian shot');
  }
}

// ---- Story jobs ----
function nearLandmark(name, radius) {
  const at = landmarkApproach(city, name);
  return Math.hypot(G.player.x - at.x, G.player.z - at.z) < radius;
}

function tryStartMission() {
  if (G.mission.active || G.mission.index >= 10 || G.freeRoam) return false;
  if (!nearLandmark('garage', 12)) return false;
  const res = startMission(G.mission, city, random);
  if (res.spawnGullsAt) {
    G.peds.push(...spawnGulls(random, res.spawnGullsAt.x, res.spawnGullsAt.z, res.spawnGullsAt.count));
  }
  if (res.smuggleAt) {
    // Job 6: the hot car waits at the docks — orange, engine running, full NOS.
    const hot = makeCar(res.smuggleAt.x, res.smuggleAt.z, Math.PI / 2, 0xe67e22, { parked: true });
    hot.nos = 100;
    G.parked.push(hot);
    G.smuggleCar = hot;
    G.mission.smuggleCar = hot;
  }
  const m = MISSIONS[G.mission.index];
  hud.toast(`${m.name}: ${m.brief}`, 4200);
  announce(`Mission started: ${m.name}. ${m.brief}`);
  sound.pickup();
  return true;
}

function finishMission(ev) {
  const p = G.player;
  p.cash += ev.pay;
  G.stats.earned += ev.pay;
  G.stats.missionsDone += 1;
  hud.toast(`JOB DONE — +$${ev.pay}. ${ev.message}`, 4500);
  sound.missionDone();
  sound.cash();
  renderer.addTrauma(0.3);
  announce(`Mission complete. Earned $${ev.pay}. ${ev.message}`);
  saveGame(true);
  if (G.mission.index >= 10 && !G.storyDone) {
    G.storyDone = true;
    endScreen('story', 'Solmar Bay is yours', 'All ten jobs done. Delia paid in full, the boat is waiting, and the city finally knows your name. Free roam continues — fares, races, chaos, whatever you like.');
  }
}

// ---- Street races (v3) ----
function tryStartRace() {
  const p = G.player;
  if (G.mission.active || G.race.active || !p.inCar) return false;
  const ev = raceEventAt(p.x, p.z);
  if (!ev) return false;
  G.raceRivals = startRace(G.race, ev, random);
  hud.toast(`${ev.name} — ${ev.gates.length} gates, ${ev.time}s. Beat both rivals for 1.5x ($${Math.round(ev.prize * 1.5)}).`, 4200);
  announce(`Street race started: ${ev.name}.`);
  sound.raceBeep();
  return true;
}

function clearRivals() {
  // Rival meshes are pooled in the renderer — pull them out of the scene before
  // dropping the list, or the rivals freeze in place at their last position.
  for (const rival of G.raceRivals) renderer.removeCar(rival);
  G.raceRivals = [];
}

function finishRace(ev) {
  const p = G.player;
  p.cash += ev.pay;
  G.stats.earned += ev.pay;
  G.stats.racesWon += 1;
  clearRivals();
  hud.toast(`RACE WON — +$${ev.pay}${ev.bonus ? ' (beat both rivals, 1.5x!)' : ''} in ${Math.round(ev.time)}s.`, 4500);
  sound.raceWin();
  sound.cash();
  renderer.punchFov(4);
  announce(`Race won. Earned $${ev.pay}.`);
  saveGame(true);
}

// ---- End screens ----
function endScreen(kind, title, text) {
  const p = G.player;
  document.getElementById('end-title').textContent = title;
  document.getElementById('end-text').textContent = text;
  const lines = [
    `Cash $${p.cash.toLocaleString('en-US')} · Jobs done ${G.stats.missionsDone}/10 · Races won ${G.stats.racesWon} · Cars stolen ${G.stats.carsStolen}`,
    `Fares ${G.stats.fares} · Earned $${G.stats.earned.toLocaleString('en-US')} · Day ${G.day}`,
  ];
  document.getElementById('end-stats').innerHTML = lines.join('<br>');
  showScreen('end');
  sound.busted();
  announce(`${title}. ${text}`);
  G.endKind = kind;
}

function respawn() {
  const p = G.player;
  if (p.inCar) exitCar();
  const h = landmarkApproach(city, 'hospital');
  p.x = h.x; p.z = h.z; p.y = 0; p.vy = 0;
  p.health = PLAYER.health;
  G.wanted = 0;
  G.heli = null;
  for (const car of G.police) renderer.removeCar(car);
  G.police = [];
  for (const ped of G.peds) if (ped.kind === 'cop') ped.alive = false;
  showScreen('play');
}

// ---- Taxi side job ----
function taxiPedNear() {
  return G.taxiPed && Math.hypot(G.player.x - G.taxiPed.x, G.player.z - G.taxiPed.z) < 6;
}

function maybeSpawnTaxi() {
  if (G.mission.active || G.taxiPed || G.taxiCooldown > 0 || !G.player.inCar) return;
  const p = G.player;
  const aheadX = p.x + Math.sin(p.car.angle) * 26;
  const aheadZ = p.z + Math.cos(p.car.angle) * 26;
  const road = nearestRoadPoint(city, aheadX, aheadZ);
  const ped = {
    x: road.x + 5.6, z: road.z, angle: 0, speed: 0, hp: 100, kind: 'ped',
    color: 0xffd23e, state: 'wait', stateT: 0, targetX: road.x, targetZ: road.z,
    fleeX: 0, fleeZ: 0, attackCooldown: 0, shootCooldown: 0, mesh: null, alive: true, taxi: true,
  };
  G.peds.push(ped);
  G.taxiPed = ped;
  hud.toast('Taxi passenger waiting ahead (yellow). Drive close and press E.');
}

function startTaxi() {
  const p = G.player;
  G.taxiPed.alive = false;
  G.taxiPed = null;
  const destRow = city.centres[Math.floor(random() * city.centres.length)];
  const to = { x: (random() - 0.5) * 2 * 160, z: destRow };
  const fare = 60 + Math.round(Math.hypot(to.x - p.x, to.z - p.z) / 4);
  G.mission.taxi = { to, fare, timer: 55 };
  G.mission.marker = { x: to.x, z: to.z, color: 0x58c96b, label: 'Taxi drop-off' };
  hud.toast(`Fare accepted — $${fare}. Get them there in 55 seconds.`);
}

// ---- Shop & safehouse: slot 5 is the v3 rifle ----
function nearShop() { return nearLandmark('shop', 12); }
function nearSafehouse() { return nearLandmark('safehouse', 12); }

function notEnough(what) { hud.toast(`Not enough cash for ${what}.`); }

// One entry per shop slot: what it costs, what it does, what it says.
const SHOP_OFFERS = [
  {
    slot: 1, label: 'armor ($200)',
    buy(p) {
      if (p.cash < SHOP.armorPrice) return notEnough('armor ($200)');
      p.cash -= SHOP.armorPrice;
      p.armor = Math.min(100, p.armor + 50);
      hud.toast('Armor +50 — the vest takes hits first.');
      sound.till();
    },
  },
  {
    slot: 2, label: 'SMG ammo ($150)',
    buy(p) {
      if (p.cash < SHOP.smgAmmoPrice) return notEnough('SMG ammo ($150)');
      p.cash -= SHOP.smgAmmoPrice;
      p.smgAmmo += SHOP.smgAmmoAmount;
      p.weapon = 'smg';
      hud.toast(`SMG ammo +${SHOP.smgAmmoAmount}.`);
      sound.till();
    },
  },
  {
    slot: 3, label: 'NOS refill ($100)',
    buy(p) {
      if (p.cash < SHOP.nosPrice) return notEnough('a NOS refill ($100)');
      p.cash -= SHOP.nosPrice;
      if (p.car) p.car.nos = 100;
      G.nos = 100;
      hud.toast('NOS tank refilled.');
      sound.till();
    },
  },
  {
    slot: 4, label: 'shotgun',
    buy(p) {
      if (p.weapon === 'shotgun') {
        if (p.cash < SHOP.shotgunShellPrice) return notEnough(`shotgun shells (${SHOP.shotgunShellAmount}) at $${SHOP.shotgunShellPrice}`);
        p.cash -= SHOP.shotgunShellPrice;
        p.shotgunAmmo += SHOP.shotgunShellAmount;
        hud.toast(`Shotgun shells +${SHOP.shotgunShellAmount}.`);
        sound.till();
        return;
      }
      if (p.cash < WEAPONS.shotgun.price) return notEnough('the shotgun ($600)');
      p.cash -= WEAPONS.shotgun.price;
      p.weapon = 'shotgun';
      p.shotgunAmmo = WEAPONS.shotgun.ammo;
      hud.toast('Shotgun bought — 24 shells, wide spread.');
      sound.till();
    },
  },
  {
    slot: 5, label: 'rifle',
    buy(p) {
      if (p.weapon === 'rifle') {
        if (p.cash < SHOP.rifleAmmoPrice) return notEnough(`rifle rounds (${SHOP.rifleAmmoAmount}) at $${SHOP.rifleAmmoPrice}`);
        p.cash -= SHOP.rifleAmmoPrice;
        p.rifleAmmo += SHOP.rifleAmmoAmount;
        hud.toast(`Rifle rounds +${SHOP.rifleAmmoAmount}.`);
        sound.till();
        return;
      }
      if (p.cash < WEAPONS.rifle.price) return notEnough('the rifle ($900)');
      p.cash -= WEAPONS.rifle.price;
      p.weapon = 'rifle';
      p.rifleAmmo = WEAPONS.rifle.ammo;
      hud.toast('Rifle bought — 20 rounds, 80 m reach, heavy hits.');
      sound.till();
    },
  },
];

function buyFromShop(slot) {
  const p = G.player;
  if (!nearShop() || p.inCar) return;
  const offer = SHOP_OFFERS.find((o) => o.slot === slot);
  if (offer) offer.buy(p);
}

function useSafehouse() {
  const p = G.player;
  if (!nearSafehouse()) return false;
  p.health = PLAYER.health;
  if (p.car) { p.car.hp = 100; p.car.nos = 100; }
  G.nos = 100;
  saveGame(false);
  hud.toast('Safehouse: healed, car repaired, NOS refilled, game saved.', 4000);
  sound.pickup();
  return true;
}

// ---- One fixed step, split into phases so each reads top to bottom ----
function tickClock(dt) {
  G.time += dt;
  G.clockMin += dt * 0.5;
  if (G.clockMin >= 1440) { G.clockMin -= 1440; G.day += 1; }
  G.fireCooldown = Math.max(0, G.fireCooldown - dt);
  G.taxiCooldown = Math.max(0, G.taxiCooldown - dt);
}

function tickLook() {
  const p = G.player;
  const look = input.takeLook();
  p.camYaw -= look.dx * 0.0032;
  p.camPitch = clamp(p.camPitch + look.dy * 0.0022, 0.05, 1.1);
  return look;
}

function tickMenuActions(actions) {
  const p = G.player;
  if (actions & ACTION_PAUSE) {
    if (G.screen === 'play') {
      showScreen('paused');
      document.getElementById('pause-stats').innerHTML = `Cash $${p.cash} · Jobs ${G.stats.missionsDone}/10 · Races won ${G.stats.racesWon} · Day ${G.day}`;
    } else if (G.screen === 'paused') showScreen('play');
  }
  if (G.screen !== 'play') return false;
  if (actions & 128) hud.toast(sound.toggleMute() ? 'Sound off' : 'Sound on');
  if (actions & ACTION_SHOOT) shoot();
  if (actions & ACTION_HONK && p.inCar) sound.honk();
  if (actions & ACTION_RELOAD && p.weapon === 'smg') hud.toast(`SMG ${p.smgAmmo} rounds left.`);
  if (actions & ACTION_RADIO) {
    const st = sound.radioNext();
    G.radioStation = RADIO.indexOf(st);
    hud.toast(`Radio: ${st.name} — ${st.tag}`, 3000);
  }
  for (const slot of [1, 2, 3, 4, 5]) {
    if (actions & [ACTION_SHOP1, ACTION_SHOP2, ACTION_SHOP3, ACTION_SHOP4, ACTION_SHOP5][slot - 1]) buyFromShop(slot);
  }
  return true;
}

function tickDriving(dt, mv, look, actions) {
  const p = G.player;
  const car = p.car;
  const wasBoosting = car.nosActive;
  const wasLocked = car.nosLockout;
  stepDrivenCar(car, mv.y, -mv.x, input.driftHeld(), dt, city, input.nosHeld());
  if (car.nosActive && !wasBoosting) { sound.nos(); renderer.punchFov(6); }
  if (car.nosLockout > 0 && wasLocked <= 0) {
    sound.nosOverheat();
    hud.toast('NOS OVERHEAT — lift off and let it cool.', 2600);
  }
  if (car.drifting && G.time - G.driftT > 0.5) { G.driftT = G.time; sound.drift(); }
  // Job 6: every knock in the hot car scuffs the cargo.
  if (G.mission.active && G.mission.index === 5 && G.smuggleCar === car && car.hp < 100) {
    G.mission.carDamage = Math.max(G.mission.carDamage, 100 - car.hp);
  }
  p.x = car.x; p.z = car.z; p.y = 0;
  p.angle = car.angle;
  p.moving = Math.abs(car.speed) > 0.5;
  // Let the camera settle behind the car unless the player is dragging it.
  if (Math.abs(look.dx) < 1) p.camYaw += (car.angle - p.camYaw) * Math.min(1, dt * 1.5);
  sound.engine(Math.abs(car.speed) / CAR.maxSpeed, true);
  if (actions & ACTION_ENTER) {
    // A fare waiting beats a race flag beats getting out (v3 fix: the fare
    // used to be unreachable because E always exited the car first).
    if (taxiPedNear()) startTaxi();
    else if (!tryStartRace()) exitCar();
  }
}

function tickOnFoot(dt, mv, actions) {
  const p = G.player;
  sound.engine(0, false);
  const pace = mv.sprint ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
  const fwd = { x: Math.sin(p.camYaw), z: Math.cos(p.camYaw) };
  const right = { x: Math.cos(p.camYaw), z: -Math.sin(p.camYaw) };
  const len = Math.hypot(mv.x, mv.y) || 1;
  const pushing = (mv.x || mv.y) ? 1 : 0;
  const mx = (fwd.x * mv.y + right.x * mv.x) / len * pushing;
  const mz = (fwd.z * mv.y + right.z * mv.x) / len * pushing;
  p.moving = pushing === 1;
  if (p.moving) {
    p.x += mx * pace * dt;
    p.z += mz * pace * dt;
    p.angle = Math.atan2(mx, mz);
  }
  // Gravity and the jump.
  p.vy -= 22 * dt;
  p.y += p.vy * dt;
  if (p.y <= 0) { p.y = 0; p.vy = 0; }
  if ((actions & ACTION_JUMP) && p.y === 0) p.vy = PLAYER.jumpSpeed;
  const pos = { x: p.x, z: p.z };
  if (collideBuildings(city, pos, PLAYER.radius)) { p.x = pos.x; p.z = pos.z; }
  if (actions & ACTION_ENTER) {
    if (taxiPedNear()) { /* on foot: the fare needs a car */ }
    else if (nearSafehouse()) useSafehouse();
    else if (!enterCar()) tryStartMission();
  }
}

function tickWorld(dt) {
  const p = G.player;
  stepTraffic(G.traffic, dt, city, p.car, random);
  const pedEv = stepPeds(G.peds, dt, city, p, G.gunfire, random);
  G.gunfire = null;
  if (pedEv.damage > 0 && !p.inCar) {
    damagePlayer(pedEv.damage);
    hud.toast(pedEv.shotBy ? 'Shots fired — take cover!' : 'You are being hit!');
  }
  G.district = districtAt(p.x, p.z);
  sound.stepRadio(dt, p.inCar);
  for (const pk of city.pickups) {
    if (pk.taken) continue;
    if (Math.hypot(p.x - pk.x, p.z - pk.z) < 1.8 && !p.inCar) {
      pk.taken = true;
      if (pk.kind === 'health') { p.health = Math.min(100, p.health + 40); hud.toast('Health +40'); }
      else { p.weapon = 'smg'; p.smgAmmo += 60; hud.toast('SMG picked up — 60 rounds'); }
      sound.pickup();
      renderer.addTrauma(0.15);
    }
  }
}

function tickTaxi(dt) {
  const p = G.player;
  const fare = G.mission.taxi;
  if (!fare) { maybeSpawnTaxi(); return; }
  fare.timer -= dt;
  if (Math.hypot(p.x - fare.to.x, p.z - fare.to.z) < 9) {
    p.cash += fare.fare;
    G.stats.fares += 1;
    G.stats.earned += fare.fare;
    hud.toast(`Fare complete — +$${fare.fare}`);
    sound.cash();
    G.mission.taxi = null;
    G.mission.marker = null;
    G.taxiCooldown = 12;
  } else if (fare.timer <= 0) {
    hud.toast('Fare lost — passenger walked.');
    G.mission.taxi = null;
    G.mission.marker = null;
    G.taxiCooldown = 12;
  }
}

function tickRaces(dt) {
  const p = G.player;
  if (!G.race.active) return;
  const rev = stepRace(G.race, dt, { x: p.x, z: p.z, inCar: p.inCar });
  const gates = G.race.event ? G.race.event.gates : [];
  const elapsed = G.race.event ? G.race.event.time - G.race.timer : 0;
  for (const rival of G.raceRivals) {
    stepRival(rival, gates[rival.gateIndex], dt, {
      collide: (pp, rr) => collideBuildings(city, pp, rr),
      gatesLen: gates.length,
      elapsed,
    });
  }
  if (rev.message) hud.toast(rev.message, 3000);
  if (rev.completed) finishRace(rev);
  else if (rev.failed) {
    hud.toast(`RACE LOST — ${rev.reason}`, 4200);
    clearRivals();
  }
}

function tickMissions(dt) {
  const p = G.player;
  if (!G.mission.active) return;
  const ev = stepMission(G.mission, dt, {
    x: p.x, z: p.z, inCar: p.inCar, gullKills: G.gullKills,
    holdingE: G.holdingE, marina: landmarkApproach(city, 'marina'),
    safehouse: landmarkApproach(city, 'safehouse'),
    garage: landmarkApproach(city, 'garage'),
    inSmuggleCar: !!(p.inCar && p.car && G.smuggleCar === p.car),
  });
  if (ev.setWanted) addWanted(ev.setWanted - G.wanted, 'the heat is on');
  if (ev.message) hud.toast(ev.message, 3800);
  if (ev.completed) finishMission(ev);
  else if (ev.failed) { hud.toast(`JOB FAILED — ${ev.reason}`, 4200); G.mission.marker = null; }
}

function tickHeat(dt) {
  const p = G.player;
  const wantCars = G.wanted > 0 ? Math.min(3, G.wanted) : 0;
  const wantCops = G.wanted >= 2 ? Math.min(3, G.wanted - 1) : 0;
  if (G.wanted > 0) {
    while (G.police.length < wantCars) G.police.push(createPoliceCar(random, city, p.x, p.z));
    const copsOut = G.peds.filter((q) => q.alive && q.kind === 'cop').length;
    for (let i = copsOut; i < wantCops; i += 1) G.peds.push(spawnCop(random, city, p));
  } else {
    // Heat gone: pull the cruisers out of the scene too, not just the list —
    // the renderer pools a mesh per car, so a dropped list leaves frozen cars.
    for (const car of G.police) renderer.removeCar(car);
    G.police = [];
    for (const q of G.peds) if (q.kind === 'cop') q.alive = false;
  }
  for (const car of G.police) {
    const res = stepPolice(car, p.x, p.z, p.inCar, dt, city);
    if (res.damage > 0) {
      damagePlayer(res.damage);
      // A police ram is heavy contact: brief hitstop so the impact lands.
      G.hitstopT = Math.max(G.hitstopT, 0.07);
      if (!p.inCar) hud.toast('Police ram!');
    }
  }
  // The helicopter arrives at 4–5 stars, orbits overhead, blocks heat decay,
  // and at 5 stars radios in a fresh ground unit every HELI.callSec seconds.
  if (G.wanted >= HELI.minWanted && !G.heli) {
    G.heli = makeHeli(p.x + 24, p.z - 24);
    hud.toast('SBPD air unit overhead — the helicopter is on you!', 4200);
  } else if (G.wanted < HELI.minWanted && G.heli) {
    G.heli = null;
  }
  if (G.heli) {
    stepHeli(G.heli, p.x, p.z, dt, G.wanted, p.inCar && p.car ? p.car.angle : p.angle);
    if (G.heli.callReinforcements) {
      G.heli.callReinforcements = false;
      G.police.push(createPoliceCar(random, city, p.x, p.z));
      hud.toast('Air unit called in backup — another SBPD car is coming.', 3800);
    }
    sound.heli(true, dt);
  } else {
    sound.heli(false, dt);
  }
  // Cool off: hide long enough with no police close and the stars fall away —
  // unless the helicopter is overhead watching, in which case they never do.
  if (G.wanted > 0 && !G.heli && G.time - G.lastCrimeT > WANTED.decayDelay) {
    const distances = [
      ...G.police.map((c) => Math.hypot(c.x - p.x, c.z - p.z)),
      ...G.peds.filter((q) => q.alive && q.kind === 'cop').map((q) => Math.hypot(q.x - p.x, q.z - p.z)),
    ];
    const nearestPolice = distances.length ? Math.min(...distances) : Infinity;
    if (nearestPolice > 45) {
      G.decayT += dt;
      if (G.decayT >= WANTED.decayInterval) {
        G.wanted -= 1;
        G.decayT = 0;
        hud.toast(G.wanted === 0 ? 'Heat gone — you are clean.' : `Heat cooling — ${G.wanted} star${G.wanted === 1 ? '' : 's'} left.`);
      }
    } else G.decayT = 0;
  }
  // Busted: a cop on foot closes in while you are wanted.
  if (G.wanted > 0 && !p.inCar) {
    const closingIn = G.peds.some((q) => q.alive && q.kind === 'cop' && Math.hypot(q.x - p.x, q.z - p.z) < WANTED.bustRange);
    if (closingIn) {
      G.bustT += dt;
      if (G.bustT > WANTED.bustTime) {
        const fine = Math.min(p.cash, 150);
        p.cash -= fine;
        endScreen('busted', 'Busted', `SBPD hauled you in. Fine $${fine}, car impounded, pride bruised. The hospital patched you up — Delia is still waiting.`);
      }
    } else G.bustT = 0;
  }
  // Wasted.
  if (p.health <= 0) {
    const lost = Math.min(p.cash, 200);
    p.cash -= lost;
    endScreen('wasted', 'Wasted', `You flatlined on the streets of Solmar Bay. The hospital bill took $${lost}. Get back out there.`);
  }
}

function tickHints(actions) {
  const p = G.player;
  if (!p.inCar) {
    const nearCar = nearestParkedCar([...G.parked, ...G.traffic], p.x, p.z, 4.5);
    const garageNear = nearLandmark('garage', 12);
    if (nearCar) hud.setHint('E — steal this car');
    else if (nearShop()) hud.setHint('Shop: 1 armor $200 · 2 SMG ammo $150 · 3 NOS $100 · 4 shotgun $600 · 5 rifle $900');
    else if (nearSafehouse()) hud.setHint('E — safehouse: heal, repair, refill NOS, save');
    else if (garageNear && !G.mission.active && G.mission.index < 10 && !G.freeRoam) hud.setHint(`E — start job: ${MISSIONS[G.mission.index].name}`);
    else if (G.mission.active && G.mission.index === 4 && G.mission.step === 1) hud.setHint('Hold E at the vault marker');
    else if (G.mission.active && G.mission.index === 7 && G.mission.step === 1) hud.setHint('Hold E at the evidence vault marker');
    else if (G.mission.active && G.mission.index === 8 && G.mission.step === 1) hud.setHint('Hold E at the crates to load them');
    else if (G.mission.active && G.mission.index === 9 && G.mission.step === 1) hud.setHint('Hold E at the counting room marker');
    else hud.setHint('WASD move · E enter car · Click shoot · Q radio · P pause');
  } else {
    const raceEv = raceEventAt(p.x, p.z);
    if (taxiPedNear()) hud.setHint('E — pick up the fare');
    else if (raceEv && !G.mission.active && !G.race.active) hud.setHint(`E — start the ${raceEv.name} street race ($${raceEv.prize})`);
    else hud.setHint('WASD drive · Shift NOS · Space drift · E exit car · H honk · Q radio');
  }
}

function step(dt) {
  const p = G.player;
  tickClock(dt);
  const look = tickLook();
  const actions = input.takeActions();
  if (!tickMenuActions(actions)) return;
  const mv = input.move();
  if (p.inCar && p.car) tickDriving(dt, mv, look, actions);
  else tickOnFoot(dt, mv, actions);
  // E in the car near a waiting fare picks it up (kept as a fallback next to
  // the driving branch, which tries the fare first).
  if (p.inCar && taxiPedNear() && (actions & ACTION_ENTER)) startTaxi();
  tickWorld(dt);
  tickTaxi(dt);
  tickRaces(dt);
  tickMissions(dt);
  // A race in progress owns the objective line; otherwise the mission does.
  G.objective = raceObjectiveText(G.race) || objectiveText(G.mission);
  tickHeat(dt);
  tickHints(actions);
  sound.siren(G.wanted, dt);
  hud.update(G);
}

// ---- Camera: chase cam behind the player, higher and further in a car ----
function updateCamera() {
  const p = G.player;
  const dist = p.inCar ? 13 : 9;
  const height = p.inCar ? 5.5 : 4.2;
  const tx = p.x, ty = p.y + (p.inCar ? 1.6 : 1.7), tz = p.z;
  const fwd = { x: Math.sin(p.camYaw), z: Math.cos(p.camYaw) };
  const behind = dist * Math.cos(p.camPitch);
  const eye = {
    x: tx - fwd.x * behind,
    y: ty + dist * Math.sin(p.camPitch) + (p.inCar ? 1.5 : 0),
    z: tz - fwd.z * behind,
  };
  renderer.setCamera(eye, { x: tx + fwd.x * 4, y: ty, z: tz + fwd.z * 4 });
}

// ---- Buttons ----
function bindClick(id, fn) { document.getElementById(id).addEventListener('click', fn); }
bindClick('btn-start', () => newGame(false));
bindClick('btn-continue', () => { const s = loadSave(); if (s) newGame(false, s); });
bindClick('btn-freeroam', () => newGame(true));
bindClick('btn-resume', () => showScreen('play'));
bindClick('btn-save', () => saveGame(false));
bindClick('btn-quit', () => { saveGame(true); refreshTitle(); showScreen('title'); });
bindClick('btn-retry', () => {
  if (G.endKind === 'story') { showScreen('play'); return; }
  respawn();
});
bindClick('btn-end-title', () => { saveGame(true); refreshTitle(); showScreen('title'); });
window.addEventListener('keydown', (e) => { if (e.code === 'KeyE') G.holdingE = true; });
window.addEventListener('keyup', (e) => { if (e.code === 'KeyE') G.holdingE = false; });
document.addEventListener('visibilitychange', () => {
  if (document.hidden && G.screen === 'play') showScreen('paused');
});

refreshTitle();

// Debug / play-test handle: lets a test harness read live state.
window.__game = G;

// ---- Shot mode / main loop ----
function runShot(name) {
  showScreen('play');
  stageShot(name, G, { enterCar, addWanted, startMission, spawnGulls });
  let painted = 0;
  function paint() {
    updateCamera();
    renderer.sync(G, G.time);
    renderer.render();
    hud.update(G);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  let acc = 0;
  let prev = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const realDt = Math.min((now - prev) / 1000, MAX_FRAME);
    prev = now;
    // Hitstop freezes the simulation (not the render) for a beat so heavy
    // contact reads as weight; camera, shake and HUD stay live.
    if (G.hitstopT > 0) {
      G.hitstopT -= realDt;
    } else {
      acc += realDt;
      while (acc >= STEP) {
        step(STEP);
        acc -= STEP;
      }
    }
    // Title screen: slow orbit over the city.
    if (G.screen === 'title') {
      G.time += STEP;
      const t = G.time * 0.05;
      renderer.setCamera({ x: Math.sin(t) * 90, y: 55, z: Math.cos(t) * 90 }, { x: 0, y: 4, z: 0 });
      stepTraffic(G.traffic, STEP, city, null, random);
    } else {
      updateCamera();
    }
    renderer.hideTracer(G.time);
    renderer.sync(G, G.time);
    renderer.render();
    if (G.screen === 'play') hud.update(G);
  }
  announce('Solmar Heist. Press Start, Continue, or Free roam.');
  requestAnimationFrame(frame);
}

if (shotName) runShot(shotName);
else runGame();
