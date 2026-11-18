// The screenshot scenes behind ?shot=start|drive|chase|heist. Each one plays the real rules
// forward from a fresh world for a fixed number of steps — traffic drives, peds walk, police
// chase — so the frame is what a short game really looks like, and the same seed always gives
// the same frame. The drive/chase scenes steer with a simple autopilot: pick a road point ahead,
// steer toward it, keep the throttle down.
import { STEP } from './config.js';
import { stepDrivenCar, stepTraffic, createPoliceCar, stepPolice } from './vehicles.js';
import { stepPeds } from './peds.js';
import { objectiveText } from './missions.js';
import { nearestRoadPoint } from './world.js';

const DRIVE_SECONDS = 6;
const CHASE_SECONDS = 5;

function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function autopilotDrive(G, dt, waypoint) {
  const car = G.player.car;
  const dx = waypoint.x - car.x, dz = waypoint.z - car.z;
  if (Math.hypot(dx, dz) < 8) return null;
  const want = Math.atan2(dx, dz);
  const steer = Math.max(-1, Math.min(1, angleDiff(car.angle, want) * 2.2));
  stepDrivenCar(car, 1, steer, false, dt, G.city);
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
    autopilotDrive(G, STEP, waypoint);
    stepTraffic(G.traffic, STEP, G.city, G.player.car, G.random);
    stepPeds(G.peds, STEP, G.city, G.player, null, G.random);
    if (chase) {
      for (const cop of G.police) stepPolice(cop, G.player.x, G.player.z, true, STEP, G.city);
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
    G.wanted = 3;
    driveScene(G, 1, false);
    G.police.push(createPoliceCar(G.random, G.city, G.player.x, G.player.z));
    G.police.push(createPoliceCar(G.random, G.city, G.player.x, G.player.z));
    driveScene(G, CHASE_SECONDS, true);
    G.objective = { title: 'WANTED ★★★', text: 'SBPD is on you — lose them or outrun them.', sub: 'Heat cools when no police can see you.' };
  } else if (name === 'heist') {
    G.mission.index = 4;
    api.startMission(G.mission, G.city, G.random);
    G.mission.step = 1;
    G.mission.holdT = 1.8;
    // Stand on the bank's approach plaza, facing the vault building — not inside it.
    G.player.x = L.bank.x + 18;
    G.player.z = L.bank.z;
    G.player.angle = Math.atan2(L.bank.x - G.player.x, L.bank.z - G.player.z);
    G.player.camYaw = G.player.angle;
    G.player.camPitch = 0.28;
    G.wanted = 4;
    G.police.push(createPoliceCar(G.random, G.city, G.player.x, G.player.z));
    simulateAmbient(G, 2);
    G.objective = objectiveText(G.mission);
  } else {
    // start: Rae on foot on the plaza outside Delia's garage at golden hour, city alive
    // behind her — standing clear of the garage walls, facing downtown.
    G.player.x = L.garage.x + 18;
    G.player.z = L.garage.z;
    G.player.angle = Math.atan2(0 - G.player.x, 0 - G.player.z);
    G.player.camYaw = G.player.angle;
    G.player.camPitch = 0.3;
    simulateAmbient(G, 5);
    G.objective = { title: 'NEXT JOB — 1 · Wheels', text: 'Delia needs wheels. Steal any car and bring it to her garage.', sub: 'Press E near the garage marker to start.' };
  }
  G.objective = G.objective || objectiveText(G.mission);
}
