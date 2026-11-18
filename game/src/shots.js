// The screenshot scenes behind ?shot=start|drive|chase|heist. Each one plays the real rules
// forward from a fresh world for a fixed number of steps — traffic drives, peds walk, police
// chase — so the frame is what a short game really looks like, and the same seed always gives
// the same frame. The drive/chase scenes steer with a simple autopilot: pick a road point ahead,
// steer toward it, keep the throttle down. v2: the drive scene burns NOS, the chase scene
// runs at 4 stars with the police helicopter overhead, and the heist scene is the finale
// (mission 8) at SBPD Central with the helicopter already in.
// v3: the heist scene is now job 10, The Solmar Crown, at the casino — 5 stars, the
// helicopter orbiting and calling in backup — and there is a race scene staging the
// Cayo Verde GP with its rivals on the start line.
import { STEP } from './config.js';
import { stepDrivenCar, stepTraffic, createPoliceCar, stepPolice, makeHeli, stepHeli } from './vehicles.js';
import { stepPeds } from './peds.js';
import { objectiveText } from './missions.js';
import { startRace } from './races.js';
import { nearestRoadPoint } from './world.js';

const DRIVE_SECONDS = 6;
const CHASE_SECONDS = 5;

function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function autopilotDrive(G, dt, waypoint, nos = false) {
  const car = G.player.car;
  const dx = waypoint.x - car.x, dz = waypoint.z - car.z;
  if (Math.hypot(dx, dz) < 8) return null;
  const want = Math.atan2(dx, dz);
  const steer = Math.max(-1, Math.min(1, angleDiff(car.angle, want) * 2.2));
  stepDrivenCar(car, 1, steer, false, dt, G.city, nos);
  return waypoint;
}

function simulateAmbient(G, seconds) {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i += 1) {
    stepTraffic(G.traffic, STEP, G.city, G.player.car, G.random);
    stepPeds(G.peds, STEP, G.city, G.player, null, G.random);
    G.time += STEP;
  }
}

function putPlayerInCar(G) {
  const car = G.parked[0];
  G.parked.splice(0, 1);
  car.stolen = true;
  const road = nearestRoadPoint(G.city, 0, -40);
  car.x = road.x; car.z = -40;
  car.angle = 0;
  car.speed = 8;
  G.player.inCar = true;
  G.player.car = car;
  G.player.x = car.x; G.player.z = car.z;
  // View direction = car heading, so the camera sits behind the car looking forward.
  G.player.camYaw = car.angle;
  G.player.camPitch = 0.3;
  return car;
}

function driveScene(G, seconds, chase) {
  putPlayerInCar(G);
  // Clear the corridor ahead so the autopilot is not glued behind a traffic jam that
  // formed further up the same road (traffic still shows on cross streets and the minimap).
  const sx = G.player.car.x, sz = G.player.car.z;
  G.traffic = G.traffic.filter((c) => !(Math.abs(c.x - sx) < 12 && c.z > sz - 10 && c.z < sz + 220));
  let waypoint = { x: G.player.car.x, z: G.player.car.z + 60 };
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i += 1) {
    if (i % 30 === 0) {
      const ahead = {
        x: G.player.car.x + Math.sin(G.player.car.angle) * 45,
        z: G.player.car.z + Math.cos(G.player.car.angle) * 45,
      };
      waypoint = nearestRoadPoint(G.city, ahead.x, ahead.z) || waypoint;
    }
    // Drive shot: burn NOS for the last stretch so the flame shows.
    const nos = !chase && i > steps * 0.6;
    autopilotDrive(G, STEP, waypoint, nos);
    stepTraffic(G.traffic, STEP, G.city, G.player.car, G.random);
    stepPeds(G.peds, STEP, G.city, G.player, null, G.random);
    if (chase) {
      for (const cop of G.police) stepPolice(cop, G.player.x, G.player.z, true, STEP, G.city);
      if (G.heli) stepHeli(G.heli, G.player.x, G.player.z, STEP, G.wanted, G.player.car.angle);
    }
    G.time += STEP;
  }
  // Keep the player position on the car — the HUD, minimap and camera all read it.
  G.player.x = G.player.car.x;
  G.player.z = G.player.car.z;
  G.player.camYaw = G.player.car.angle;
}

export function stageShot(name, G, api) {
  const L = G.city.landmarks;
  if (name === 'drive') {
    driveScene(G, DRIVE_SECONDS, false);
    G.objective = { title: 'FREE ROAM', text: 'Cruising Solmar Bay — traffic, peds, and trouble everywhere.', sub: 'WASD drive · E exit car' };
  } else if (name === 'chase') {
    // Chase: 4 stars, helicopter orbiting from the start of the chase leg.
    G.wanted = 4;
    driveScene(G, 1, false);
    G.police.push(createPoliceCar(G.random, G.city, G.player.x, G.player.z));
    G.police.push(createPoliceCar(G.random, G.city, G.player.x, G.player.z));
    G.heli = makeHeli(G.player.x + 20, G.player.z - 20);
    driveScene(G, CHASE_SECONDS, true);
    // Frame the helicopter: after the chase sim it orbits 30 m off the player,
    // which is behind the chase camera — pull it far ahead (a high object only
    // enters the 62-degree vertical frame at distance) and level the camera so
    // the air unit reads against the sky.
    {
      // Centred over the road ahead (a lateral offset puts it behind the
      // buildings flanking the road), closer and side-on so the body and the
      // 11 m rotor read instead of a nose-on speck.
      const f = { x: Math.sin(G.player.car.angle), z: Math.cos(G.player.car.angle) };
      G.heli.x = G.player.x + f.x * 22;
      G.heli.z = G.player.z + f.z * 22;
      G.heli.y = 10;
      G.heli.angle = G.player.car.angle + Math.PI / 2;
      G.heli.spotX = G.player.x; G.heli.spotZ = G.player.z;
      G.player.camPitch = 0.18;
    }
    G.objective = { title: 'WANTED ★★★★ — HELICOPTER', text: 'SBPD air unit is on you — lose them or outrun them.', sub: 'The helicopter orbits you and blocks heat decay while it watches.' };
  } else if (name === 'heist') {
    // v3 heist shot: job 10, The Solmar Crown, at the casino — 5 stars, heli in,
    // counting room half-cracked.
    G.mission.index = 9;
    api.startMission(G.mission, G.city, G.random);
    G.mission.step = 1;
    G.mission.holdT = 2.5;
    G.player.x = L.casino.x + 18;
    G.player.z = L.casino.z;
    G.player.angle = Math.atan2(L.casino.x - G.player.x, L.casino.z - G.player.z);
    G.player.camYaw = G.player.angle;
    G.player.camPitch = 0.28;
    G.wanted = 5;
    G.heli = makeHeli(G.player.x + 15, G.player.z - 15);
    G.police.push(createPoliceCar(G.random, G.city, G.player.x, G.player.z));
    simulateAmbient(G, 2);
    // The helicopter stays overhead here (it is already proven visible in the
    // chase shot): the finale frame is about the 5-star HUD, the vault beam
    // and the cracking progress — any offset puts the air unit inside the
    // 28 m casino building or against a dark facade.
    G.objective = objectiveText(G.mission);
  } else if (name === 'race') {
    // v3 race shot: the Cayo Verde GP start line — player and two rivals staged,
    // first gate beaming blue ahead.
    const ev = G.raceStarts.find((s) => s.id === 'cayo');
    putPlayerInCar(G);
    G.player.car.x = ev.start.x;
    G.player.car.z = ev.start.z;
    G.player.car.angle = Math.PI / 2;
    G.player.x = ev.start.x;
    G.player.z = ev.start.z;
    G.player.camYaw = G.player.car.angle;
    G.player.camPitch = 0.3;
    G.raceRivals = startRace(G.race, ev, G.random);
    simulateAmbient(G, 1);
    G.objective = { title: 'STREET RACE — CAYO VERDE GP', text: 'Seven gates, two rivals, one prize — $900, 1.5x if you beat them both.', sub: 'Shift = NOS (watch the heat), Space = drift.' };
  } else {
    // start: Rae on foot on the plaza outside Delia's garage at golden hour, city alive
    // behind her — standing clear of the garage walls, facing downtown.
    G.player.x = L.garage.x + 18;
    G.player.z = L.garage.z;
    G.player.angle = Math.atan2(0 - G.player.x, 0 - G.player.z);
    G.player.camYaw = G.player.angle;
    G.player.camPitch = 0.3;
    simulateAmbient(G, 5);
    G.radioStation = 0;
    G.objective = { title: 'NEXT JOB — 1 · Wheels', text: 'Delia needs wheels. Steal any car and bring it to her garage.', sub: 'Ten jobs pay your way out — radio (Q), NOS (Shift), safehouse + shop + street races on the map.' };
  }
  G.objective = G.objective || objectiveText(G.mission);
}
