// Solmar Heist — boot and the one loop.
// Screens: title, play, paused, end (busted / wasted / story complete). The world advances in
// fixed 1/60 s steps; the renderer paints what is there. ?seed=N fixes the city; ?shot=start|
// drive|chase|heist (with &seed=N) stages that scene instead of running the loop, paints it
// twice and sets window.__shotReady for a screenshot.
import { STEP, SAVE_KEY, PLAYER, CAR, WANTED, MISSIONS, CITY } from './config.js';
import { createRandom } from './random.js';
import { createInput, ACTION_ENTER, ACTION_PAUSE, ACTION_SHOOT, ACTION_JUMP, ACTION_HONK, ACTION_RELOAD, ACTION_INTERACT } from './input.js';
import { createCity, collideBuildings, nearestRoadPoint, landmarkApproach } from './world.js';
import { makeCar, stepDrivenCar, createTraffic, stepTraffic, createPoliceCar, stepPolice, nearestParkedCar } from './vehicles.js';
import { createPeds, stepPeds, damagePedsAt, spawnGulls, spawnCop } from './peds.js';
import { createMissionState, startMission, stepMission, objectiveText } from './missions.js';
import { createSound } from './sound.js';
import { createHud } from './hud.js';
import { createRenderer } from './render.js';
import { stageShot } from './shots.js';

const MAX_FRAME = 0.25;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : 1337;

const canvas = document.getElementById('game');
const statusEl = document.getElementById('status');
const random = createRandom(seed);
const city = createCity(random);
const sound = createSound();
const hud = createHud();
const renderer = createRenderer(canvas, city);
const input = createInput(canvas);

const G = {
  seed, city, random,
  player: {
    // Start on the plaza in front of Delia's garage (the approach point), NOT at the
    // landmark centre — the garage building is 26 m wide and would swallow the spawn.
    x: city.landmarks.garage.x + 18, z: city.landmarks.garage.z, y: 0, vy: 0,
    angle: 0, camYaw: Math.PI * 0.75, camPitch: 0.32,
    health: PLAYER.health, cash: 150, weapon: 'pistol', smgAmmo: 0,
    inCar: false, car: null, moving: false,
  },
  parked: [], traffic: [], police: [], peds: [],
  mission: createMissionState(),
  objective: { title: 'FREE ROAM', text: 'Explore Solmar Bay.', sub: '' },
  wanted: 0, lastCrimeT: -999, decayT: 0, bustT: 0,
  day: 1, clockMin: 8 * 60, time: 0,
  screen: 'title', freeRoam: false, storyDone: false,
  fireCooldown: 0, taxiPed: null, taxiCooldown: 8, gunfire: null,
  gullKills: 0, holdingE: false, shotCam: null,
  stats: { carsStolen: 0, shotsFired: 0, pedsDown: 0, missionsDone: 0, fares: 0, earned: 0 },
};

// Parked cars from the city's parking spots.
for (const spot of city.parkSpots) {
  G.parked.push(makeCar(spot.x, spot.z, spot.angle, [0xc0392b, 0x2471a3, 0xf1c40f, 0x7d3c98, 0x1abc9c, 0xe67e22, 0xecf0f1, 0x2c3e50][G.parked.length % 8], { parked: true }));
}
G.traffic = createTraffic(random, city, 14);
G.peds = createPeds(random, city, 26);

function announce(msg) { statusEl.textContent = msg; }

function addWanted(n, reason) {
  if (G.wanted >= 5 && n > 0) return;
  G.wanted = Math.max(0, Math.min(5, G.wanted + n));
  G.lastCrimeT = G.time;
  G.decayT = 0;
  if (n > 0) hud.toast(`WANTED ${'★'.repeat(G.wanted)} — ${reason || 'the city saw that'}`);
}

function saveGame(silent) {
  try {
    const p = G.player;
    const data = {
      cash: p.cash, health: p.health, x: p.x, z: p.z, angle: p.angle,
      weapon: p.weapon, smgAmmo: p.smgAmmo,
      missionIndex: G.mission.index, missionDone: G.mission.done,
      day: G.day, clockMin: G.clockMin, savedAt: Date.now(),
    };
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    if (!silent) { document.getElementById('save-note').textContent = 'Saved — cash, jobs and position stored in this browser.'; }
    return true;
  } catch { return false; }
}

function loadSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function applySave(data) {
  const p = G.player;
  p.cash = data.cash; p.health = data.health;
  p.x = data.x; p.z = data.z; p.angle = data.angle || 0;
  p.weapon = data.weapon || 'pistol'; p.smgAmmo = data.smgAmmo || 0;
  G.mission.index = data.missionIndex || 0;
  G.mission.done = data.missionDone || [false, false, false, false, false];
  G.day = data.day || 1; G.clockMin = data.clockMin || 480;
}

function showScreen(name) {
  G.screen = name;
  document.getElementById('screen-title').classList.toggle('hidden', name !== 'title');
  document.getElementById('screen-pause').classList.toggle('hidden', name !== 'paused');
  document.getElementById('screen-end').classList.toggle('hidden', name !== 'end');
}

function refreshTitle() {
  const save = loadSave();
  document.getElementById('btn-continue').style.display = save ? '' : 'none';
  const list = document.getElementById('mission-list');
  list.innerHTML = MISSIONS.map((m, i) => {
    const cls = G.mission.done[i] ? 'done' : (i === G.mission.index ? 'now' : '');
    return `<li class="${cls}">${m.name} — $${m.pay}</li>`;
  }).join('');
}

function newGame(freeRoam, fromSave) {
  const p = G.player;
  p.health = PLAYER.health; p.inCar = false; p.car = null;
  p.weapon = 'pistol'; p.smgAmmo = 0;
  G.wanted = 0; G.bustT = 0; G.gullKills = 0;
  G.mission = createMissionState();
  G.freeRoam = freeRoam;
  if (freeRoam) { G.mission.index = 5; G.mission.done = [true, true, true, true, true]; }
  if (fromSave) applySave(fromSave);
  else if (!freeRoam) { p.cash = 150; const g = landmarkApproach(city, 'garage'); p.x = g.x; p.z = g.z; }
  showScreen('play');
  sound.unlock();
  announce(freeRoam ? 'Free roam. Solmar Bay is yours.' : 'Story started. Delia is waiting at the garage.');
  if (!freeRoam && !fromSave) hud.toast('Job 1: Wheels — press E at the garage to start', 4200);
}

// ---- Cars: enter / exit ----
function enterCar() {
  const p = G.player;
  const car = nearestParkedCar([...G.parked, ...G.traffic], p.x, p.z, 4.5);
  if (!car) return false;
  const wasTraffic = G.traffic.includes(car);
  if (wasTraffic) G.traffic.splice(G.traffic.indexOf(car), 1);
  else G.parked.splice(G.parked.indexOf(car), 1);
  if (!car.stolen) {
    car.stolen = true;
    G.stats.carsStolen += 1;
    addWanted(1, 'car stolen');
  }
  p.inCar = true;
  p.car = car;
  // Camera yaw IS the view direction: to look where the car points, yaw = car angle.
  // (car.angle + PI faces backwards — the drive shot proved it.)
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
  const f = { x: Math.sin(car.angle), z: Math.cos(car.angle) };
  p.x = car.x - f.z * 2.2;
  p.z = car.z + f.x * 2.2;
  p.y = 0;
  p.inCar = false;
  p.car = null;
}

// ---- Combat ----
function shoot() {
  const p = G.player;
  if (G.fireCooldown > 0 || p.inCar) return;
  const isSmg = p.weapon === 'smg';
  if (isSmg && p.smgAmmo <= 0) { p.weapon = 'pistol'; hud.toast('SMG dry — back to the pistol.'); return; }
  G.fireCooldown = isSmg ? 0.09 : 0.3;
  if (isSmg) p.smgAmmo -= 1;
  G.stats.shotsFired += 1;
  sound.shoot(isSmg);
  const dir = { x: Math.sin(p.camYaw), z: Math.cos(p.camYaw) };
  const from = { x: p.x, y: 1.5, z: p.z };
  // Melee first: anyone right in front of you gets punched.
  const close = damagePedsAt(G.peds, p.x + dir.x * 1.6, p.z + dir.z * 1.6, 1.4, 20);
  if (close) {
    sound.punch();
    onPedDown(close, true);
    return;
  }
  // Hitscan: nearest ped inside a narrow cone, out to 46 m.
  let best = null, bestD = 46;
  for (const ped of G.peds) {
    if (!ped.alive) continue;
    const dx = ped.x - p.x, dz = ped.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d > bestD || d < 0.5) continue;
    const dot = (dx * dir.x + dz * dir.z) / d;
    if (dot > 0.985) { bestD = d; best = ped; }
  }
  const to = best
    ? { x: best.x, y: 1.2, z: best.z }
    : { x: p.x + dir.x * 46, y: 1.5, z: p.z + dir.z * 46 };
  renderer.showTracer(from, to, G.time + 0.08);
  G.gunfire = { x: p.x, z: p.z };
  if (best) {
    best.hp -= isSmg ? 18 : 34;
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

// ---- Missions ----
function tryStartMission() {
  if (G.mission.active || G.mission.index >= 5 || G.freeRoam) return false;
  const g = landmarkApproach(city, 'garage');
  const nearGarage = Math.hypot(G.player.x - g.x, G.player.z - g.z) < 12;
  if (!nearGarage) return false;
  const res = startMission(G.mission, city, random);
  if (res.spawnGullsAt) {
    const gulls = spawnGulls(random, res.spawnGullsAt.x, res.spawnGullsAt.z, res.spawnGullsAt.count);
    G.peds.push(...gulls);
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
  announce(`Mission complete. Earned $${ev.pay}. ${ev.message}`);
  saveGame(true);
  if (G.mission.index >= 5 && !G.storyDone) {
    G.storyDone = true;
    endScreen('story', 'Solmar Bay is yours', 'All five jobs done. Delia paid in full, the boat is waiting, and the city finally knows your name. Free roam continues — fares, chaos, whatever you like.');
  }
}

// ---- End screens ----
function endScreen(kind, title, text) {
  const p = G.player;
  document.getElementById('end-title').textContent = title;
  document.getElementById('end-text').textContent = text;
  document.getElementById('end-stats').innerHTML =
    `Cash $${p.cash.toLocaleString('en-US')} · Jobs done ${G.stats.missionsDone}/5 · Cars stolen ${G.stats.carsStolen}<br>` +
    `Fares ${G.stats.fares} · Earned $${G.stats.earned.toLocaleString('en-US')} · Day ${G.day}`;
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
  G.police = [];
  for (const ped of G.peds) if (ped.kind === 'cop') ped.alive = false;
  showScreen('play');
}

// ---- Taxi side job ----
function maybeSpawnTaxi() {
  if (G.mission.active || G.taxiPed || G.taxiCooldown > 0 || !G.player.inCar) return;
  const p = G.player;
  const ahead = { x: p.x + Math.sin(p.car.angle) * 26, z: p.z + Math.cos(p.car.angle) * 26 };
  const road = nearestRoadPoint(city, ahead.x, ahead.z);
  const ped = { x: road.x + 5.6, z: road.z, angle: 0, speed: 0, hp: 100, kind: 'ped', color: 0xffd23e, state: 'wait', stateT: 0, targetX: road.x, targetZ: road.z, fleeX: 0, fleeZ: 0, attackCooldown: 0, shootCooldown: 0, mesh: null, alive: true, taxi: true };
  G.peds.push(ped);
  G.taxiPed = ped;
  hud.toast('Taxi passenger waiting ahead (yellow). Drive close and press E.');
}

function startTaxi() {
  const p = G.player;
  const ped = G.taxiPed;
  ped.alive = false;
  G.taxiPed = null;
  const dest = city.centres[Math.floor(random() * city.centres.length)];
  const to = { x: (random() - 0.5) * 2 * 160, z: dest };
  const fare = 60 + Math.round(Math.hypot(to.x - p.x, to.z - p.z) / 4);
  G.mission.taxi = { to, fare, timer: 55 };
  G.mission.marker = { x: to.x, z: to.z, color: 0x58c96b, label: 'Taxi drop-off' };
  hud.toast(`Fare accepted — $${fare}. Get them there in 55 seconds.`);
}

// ---- One fixed step of gameplay ----
function step(dt) {
  const p = G.player;
  G.time += dt;
  G.clockMin += dt * 0.5;
  if (G.clockMin >= 1440) { G.clockMin -= 1440; G.day += 1; }
  G.fireCooldown = Math.max(0, G.fireCooldown - dt);
  G.taxiCooldown = Math.max(0, G.taxiCooldown - dt);

  const look = input.takeLook();
  p.camYaw -= look.dx * 0.0032;
  p.camPitch = Math.max(0.05, Math.min(1.1, p.camPitch + look.dy * 0.0022));

  const actions = input.takeActions();
  if (actions & ACTION_PAUSE) {
    if (G.screen === 'play') { showScreen('paused'); document.getElementById('pause-stats').innerHTML = `Cash $${p.cash} · Jobs ${G.stats.missionsDone}/5 · Day ${G.day}`; }
    else if (G.screen === 'paused') showScreen('play');
  }
  if (G.screen !== 'play') return;
  if (actions & 128) { const m = sound.toggleMute(); hud.toast(m ? 'Sound off' : 'Sound on'); }
  if (actions & ACTION_SHOOT) shoot();
  if (actions & ACTION_HONK && p.inCar) sound.honk();
  if (actions & ACTION_RELOAD && p.weapon === 'smg') hud.toast(`SMG ${p.smgAmmo} rounds left.`);

  const mv = input.move();

  if (p.inCar && p.car) {
    const car = p.car;
    const drive = mv.y;
    const steer = -mv.x;
    stepDrivenCar(car, drive, steer, mv.sprint, dt, city);
    p.x = car.x; p.z = car.z; p.y = 0;
    p.angle = car.angle;
    p.moving = Math.abs(car.speed) > 0.5;
    // Camera follows behind the car unless the player drags it.
    if (Math.abs(look.dx) < 1) p.camYaw += (car.angle - p.camYaw) * Math.min(1, dt * 1.5);
    sound.engine(Math.abs(car.speed) / CAR.maxSpeed, true);
    if (actions & ACTION_ENTER) exitCar();
  } else {
    sound.engine(0, false);
    const speed = mv.sprint ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
    const f = { x: Math.sin(p.camYaw), z: Math.cos(p.camYaw) };
    const r = { x: Math.cos(p.camYaw), z: -Math.sin(p.camYaw) };
    const len = Math.hypot(mv.x, mv.y) || 1;
    const mx = (f.x * mv.y + r.x * mv.x) / len * (mv.x || mv.y ? 1 : 0);
    const mz = (f.z * mv.y + r.z * mv.x) / len * (mv.x || mv.y ? 1 : 0);
    p.moving = !!(mv.x || mv.y);
    if (p.moving) {
      p.x += mx * speed * dt;
      p.z += mz * speed * dt;
      p.angle = Math.atan2(mx, mz);
    }
    // Gravity + jump.
    p.vy -= 22 * dt;
    p.y += p.vy * dt;
    if (p.y <= 0) { p.y = 0; p.vy = 0; }
    if ((actions & ACTION_JUMP) && p.y === 0) p.vy = PLAYER.jumpSpeed;
    const pos = { x: p.x, z: p.z };
    if (collideBuildings(city, pos, PLAYER.radius)) { p.x = pos.x; p.z = pos.z; }
    if (actions & ACTION_ENTER) {
      if (G.taxiPed && Math.hypot(p.x - G.taxiPed.x, p.z - G.taxiPed.z) < 6) { /* on foot: ignore */ }
      else if (!enterCar()) tryStartMission();
    }
  }

  // In-car E near a taxi passenger picks up the fare.
  if (p.inCar && G.taxiPed && Math.hypot(p.x - G.taxiPed.x, p.z - G.taxiPed.z) < 6 && (actions & ACTION_ENTER)) startTaxi();

  // Traffic + peds.
  stepTraffic(G.traffic, dt, city, p.car, random);
  const pedEv = stepPeds(G.peds, dt, city, p, G.gunfire, random);
  G.gunfire = null;
  if (pedEv.damage > 0 && !p.inCar) {
    p.health -= pedEv.damage;
    hud.toast(pedEv.shotBy ? 'Shots fired — take cover!' : 'You are being hit!');
  }

  // Pickups.
  for (const pk of city.pickups) {
    if (pk.taken) continue;
    if (Math.hypot(p.x - pk.x, p.z - pk.z) < 1.8 && !p.inCar) {
      pk.taken = true;
      if (pk.kind === 'health') { p.health = Math.min(100, p.health + 40); hud.toast('Health +40'); }
      else { p.weapon = 'smg'; p.smgAmmo += 60; hud.toast('SMG picked up — 60 rounds'); }
      sound.pickup();
    }
  }

  // Taxi fare progress.
  if (G.mission.taxi) {
    const t = G.mission.taxi;
    t.timer -= dt;
    if (Math.hypot(p.x - t.to.x, p.z - t.to.z) < 9) {
      p.cash += t.fare;
      G.stats.fares += 1;
      G.stats.earned += t.fare;
      hud.toast(`Fare complete — +$${t.fare}`);
      sound.cash();
      G.mission.taxi = null;
      G.mission.marker = null;
      G.taxiCooldown = 12;
    } else if (t.timer <= 0) {
      hud.toast('Fare lost — passenger walked.');
      G.mission.taxi = null;
      G.mission.marker = null;
      G.taxiCooldown = 12;
    }
  } else {
    maybeSpawnTaxi();
  }

  // Missions.
  if (G.mission.active) {
    const ev = stepMission(G.mission, dt, {
      x: p.x, z: p.z, inCar: p.inCar, gullKills: G.gullKills,
      holdingE: G.holdingE, marina: landmarkApproach(city, 'marina'),
    });
    if (ev.setWanted) addWanted(ev.setWanted - G.wanted, 'the heat is on');
    if (ev.message) hud.toast(ev.message, 3800);
    if (ev.completed) finishMission(ev);
    else if (ev.failed) { hud.toast(`JOB FAILED — ${ev.reason}`, 4200); G.mission.marker = null; }
  }
  G.objective = objectiveText(G.mission);

  // Wanted: police presence scales with stars.
  const wantCars = G.wanted > 0 ? Math.min(3, G.wanted) : 0;
  const wantCops = G.wanted >= 2 ? Math.min(3, G.wanted - 1) : 0;
  if (G.wanted > 0) {
    while (G.police.length < wantCars) G.police.push(createPoliceCar(random, city, p.x, p.z));
    const cops = G.peds.filter((q) => q.alive && q.kind === 'cop').length;
    for (let i = cops; i < wantCops; i += 1) G.peds.push(spawnCop(random, city, p));
  } else {
    G.police = [];
    for (const q of G.peds) if (q.kind === 'cop') q.alive = false;
  }
  for (const car of G.police) {
    const res = stepPolice(car, p.x, p.z, p.inCar, dt, city);
    if (res.damage > 0) {
      p.health -= res.damage;
      if (!p.inCar) hud.toast('Police ram!');
    }
  }
  // Decay: hide long enough and the heat cools off.
  if (G.wanted > 0 && G.time - G.lastCrimeT > WANTED.decayDelay) {
    const nearestPolice = Math.min(
      ...G.police.map((c) => Math.hypot(c.x - p.x, c.z - p.z)),
      ...G.peds.filter((q) => q.alive && q.kind === 'cop').map((q) => Math.hypot(q.x - p.x, q.z - p.z)),
      Infinity,
    );
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
    const nearCop = G.peds.some((q) => q.alive && q.kind === 'cop' && Math.hypot(q.x - p.x, q.z - p.z) < WANTED.bustRange);
    if (nearCop) {
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

  // Hints.
  if (!p.inCar) {
    const nearCar = nearestParkedCar([...G.parked, ...G.traffic], p.x, p.z, 4.5);
    const g = landmarkApproach(city, 'garage');
    const nearGarage = Math.hypot(p.x - g.x, p.z - g.z) < 12;
    if (nearCar) hud.setHint('E — steal this car');
    else if (nearGarage && !G.mission.active && G.mission.index < 5 && !G.freeRoam) hud.setHint(`E — start job: ${MISSIONS[G.mission.index].name}`);
    else if (G.mission.active && G.mission.index === 4 && G.mission.step === 1) hud.setHint('Hold E at the vault marker');
    else hud.setHint('WASD move · E enter car · Click shoot · P pause');
  } else {
    hud.setHint(G.taxiPed && Math.hypot(p.x - G.taxiPed.x, p.z - G.taxiPed.z) < 6 ? 'E — pick up the fare' : 'WASD drive · Shift handbrake · E exit car · H honk');
  }

  sound.siren(G.wanted, dt);
  hud.update(G);
}

// ---- Camera ----
function updateCamera() {
  const p = G.player;
  const dist = p.inCar ? 13 : 9;
  const height = p.inCar ? 5.5 : 4.2;
  const tx = p.x, ty = p.y + (p.inCar ? 1.6 : 1.7), tz = p.z;
  const f = { x: Math.sin(p.camYaw), z: Math.cos(p.camYaw) };
  const pitch = p.camPitch;
  const back = dist * Math.cos(pitch);
  const pos = { x: tx - f.x * back, y: ty + dist * Math.sin(pitch) + (p.inCar ? 1.5 : 0), z: tz - f.z * back };
  renderer.setCamera(pos, { x: tx + f.x * 4, y: ty, z: tz + f.z * 4 });
}

// ---- Buttons ----
document.getElementById('btn-start').addEventListener('click', () => newGame(false));
document.getElementById('btn-continue').addEventListener('click', () => { const s = loadSave(); if (s) newGame(false, s); });
document.getElementById('btn-freeroam').addEventListener('click', () => newGame(true));
document.getElementById('btn-resume').addEventListener('click', () => showScreen('play'));
document.getElementById('btn-save').addEventListener('click', () => saveGame(false));
document.getElementById('btn-quit').addEventListener('click', () => { saveGame(true); refreshTitle(); showScreen('title'); });
document.getElementById('btn-retry').addEventListener('click', () => {
  if (G.endKind === 'story') { showScreen('play'); return; }
  respawn();
});
document.getElementById('btn-end-title').addEventListener('click', () => { saveGame(true); refreshTitle(); showScreen('title'); });
window.addEventListener('keydown', (e) => { if (e.code === 'KeyE') G.holdingE = true; });
window.addEventListener('keyup', (e) => { if (e.code === 'KeyE') G.holdingE = false; });
document.addEventListener('visibilitychange', () => {
  if (document.hidden && G.screen === 'play') showScreen('paused');
});

refreshTitle();

// Debug / play-test handle: lets a test harness read live state (car speed, wanted, mission).
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
  let accumulator = 0;
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    while (accumulator >= STEP) {
      step(STEP);
      accumulator -= STEP;
    }
    // Title screen: slow orbit over the city.
    if (G.screen === 'title') {
      G.time += STEP;
      const t = G.time * 0.05;
      const cx = Math.sin(t) * 90, cz = Math.cos(t) * 90;
      renderer.setCamera({ x: cx, y: 55, z: cz }, { x: 0, y: 4, z: 0 });
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

if (shot) runShot(shot);
else runGame();
