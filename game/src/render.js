// Drawing only, in three.js: the city, the cars, the people, the light.
// The renderer owns the THREE scene and every mesh; the gameplay modules own
// the numbers. Meshes are pooled per entity (one group per car / ped) and
// moved each frame — nothing is rebuilt after boot except tracers and the
// mission beacon. Beacons mark the landmarks (safehouse green, shop amber,
// casino gold), blue beams mark the street-race gates, and the police
// helicopter aims its spotlight at the player instead of straight down.
// Feel layer (v3 refactor): a trauma-based shake rig and an FOV punch ride on
// top of the chase camera — small events barely move it, big ones snap hard,
// and both decay every rendered frame so feedback stays live even in hitstop.
import * as THREE from 'three';
import { CITY, PALETTE } from './config.js';

const BASE_FOV = 62;

// Deterministic value noise in [-1, 1] from accumulated frames, per axis.
function frameNoise(t, seed) {
  const x = Math.sin(t * 12.9898 + seed * 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

// One mesh from a spec: { geo, mat, at: [x, y, z], rot: [x, y, z] }.
function partMesh(spec) {
  const m = new THREE.Mesh(spec.geo, spec.mat);
  if (spec.at) m.position.set(spec.at[0], spec.at[1], spec.at[2]);
  if (spec.rot) m.rotation.set(spec.rot[0], spec.rot[1], spec.rot[2]);
  return m;
}

function lambert(color, extra) {
  return new THREE.MeshLambertMaterial({ color, ...(extra || {}) });
}

function windowTexture(rng) {
  const pick = rng || Math.random;
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const g = c.getContext('2d');
  // A light concrete base so the material colour still reads at dusk; the
  // panes are dark glass with some lit warm/cool. A dark base turned whole
  // facades black.
  g.fillStyle = '#c9ced6';
  g.fillRect(0, 0, 128, 256);
  const panes = ['#ffd88a', '#9fd8ff'];
  for (let y = 8; y < 248; y += 18) {
    for (let x = 8; x < 120; x += 16) {
      const lit = pick() < 0.45;
      g.fillStyle = lit ? panes[pick() < 0.7 ? 0 : 1] : '#2a2f38';
      g.fillRect(x, y, 10, 12);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// A car is a list of boxes and cylinders; police cars add the light bar,
// the two beacons and the white door badge.
function carParts(color, police) {
  const paint = lambert(color);
  const dark = lambert(0x14181f);
  const list = [
    { geo: new THREE.BoxGeometry(2.0, 0.62, 4.4), mat: paint, at: [0, 0.55, 0] },
    { geo: new THREE.BoxGeometry(1.7, 0.55, 2.2), mat: dark, at: [0, 1.1, -0.25] },
  ];
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 12);
  const wheelMat = lambert(0x0c0e11);
  for (const [wx, wz] of [[-0.95, 1.45], [0.95, 1.45], [-0.95, -1.45], [0.95, -1.45]]) {
    list.push({ geo: wheelGeo, mat: wheelMat, at: [wx, 0.36, wz], rot: [0, 0, Math.PI / 2], wheel: true });
  }
  if (!police) return { list, red: null, blue: null };
  const bar = lambert(0xdddddd);
  const redMat = new THREE.MeshBasicMaterial({ color: 0xff2222 });
  const blueMat = new THREE.MeshBasicMaterial({ color: 0x2266ff });
  const white = new THREE.MeshBasicMaterial({ color: 0xf5f5f5 });
  list.push(
    { geo: new THREE.BoxGeometry(1.2, 0.16, 0.4), mat: bar, at: [0, 1.45, -0.25] },
    { geo: new THREE.BoxGeometry(0.5, 0.14, 0.42), mat: redMat, at: [-0.32, 1.56, -0.25], tag: 'red' },
    { geo: new THREE.BoxGeometry(0.5, 0.14, 0.42), mat: blueMat, at: [0.32, 1.56, -0.25], tag: 'blue' },
    { geo: new THREE.BoxGeometry(2.02, 0.2, 1.0), mat: white, at: [0, 0.62, 0.6] },
  );
  return { list, red: 'red', blue: 'blue' };
}

function makeCarMesh(color, police) {
  const group = new THREE.Group();
  const { list } = carParts(color, police);
  const wheels = [];
  for (const spec of list) {
    const m = partMesh(spec);
    group.add(m);
    if (spec.wheel) wheels.push(m);
    if (spec.tag === 'red') group.userData.red = m;
    if (spec.tag === 'blue') group.userData.blue = m;
  }
  group.userData.wheels = wheels;
  return group;
}

// A ped is a cylinder torso, a sphere head, and two box legs that swing.
function makePedMesh(color, kind) {
  const group = new THREE.Group();
  const shirt = lambert(color);
  const skin = lambert(0xd9a066);
  const legs = lambert(kind === 'cop' ? 0x1e2a3a : 0x2b2f36);
  const specs = [
    { geo: new THREE.CylinderGeometry(0.32, 0.38, 0.9, 8), mat: shirt, at: [0, 0.95, 0] },
    { geo: new THREE.SphereGeometry(0.26, 10, 8), mat: skin, at: [0, 1.62, 0] },
    { geo: new THREE.BoxGeometry(0.16, 0.55, 0.16), mat: legs, at: [-0.14, 0.28, 0], tag: 'legL' },
    { geo: new THREE.BoxGeometry(0.16, 0.55, 0.16), mat: legs, at: [0.14, 0.28, 0], tag: 'legR' },
  ];
  if (kind === 'cop') {
    specs.push({ geo: new THREE.CylinderGeometry(0.28, 0.28, 0.1, 10), mat: lambert(0x10151c), at: [0, 1.84, 0] });
  }
  for (const spec of specs) {
    const m = partMesh(spec);
    group.add(m);
    if (spec.tag === 'legL') group.userData.legL = m;
    if (spec.tag === 'legR') group.userData.legR = m;
  }
  return group;
}

function buildGround(scene) {
  const ground = partMesh({
    geo: new THREE.PlaneGeometry(CITY.half * 2 + 260, CITY.half * 2 + 260),
    mat: lambert(PALETTE.ground),
    at: [0, -0.05, 0], rot: [-Math.PI / 2, 0, 0],
  });
  scene.add(ground);
}

function buildRoads(scene, city) {
  const roadMat = lambert(PALETTE.asphalt);
  const walkMat = lambert(PALETTE.sidewalk);
  const span = CITY.half * 2 + CITY.road;
  const dashMat = new THREE.MeshBasicMaterial({ color: 0xd8c98a });
  for (const c of city.centres) {
    for (const [mat, w, y] of [[walkMat, CITY.road + 6, 0.01], [roadMat, CITY.road, 0.03]]) {
      scene.add(partMesh({ geo: new THREE.PlaneGeometry(span, w), mat, at: [0, y, c], rot: [-Math.PI / 2, 0, 0] }));
      scene.add(partMesh({ geo: new THREE.PlaneGeometry(w, span), mat, at: [c, y, 0], rot: [-Math.PI / 2, 0, 0] }));
    }
    for (let t = -CITY.half; t < CITY.half; t += 12) {
      scene.add(partMesh({ geo: new THREE.PlaneGeometry(0.35, 4), mat: dashMat, at: [t, 0.05, c], rot: [-Math.PI / 2, 0, 0] }));
      scene.add(partMesh({ geo: new THREE.PlaneGeometry(0.35, 4), mat: dashMat, at: [c, 0.05, t], rot: [-Math.PI / 2, 0, Math.PI / 2] }));
    }
  }
}

function buildBuildings(scene, city, winTex) {
  for (const b of city.buildings) {
    const mesh = partMesh({
      geo: new THREE.BoxGeometry(b.w, b.h, b.d),
      mat: lambert(b.color, { map: winTex }),
      at: [b.x, b.h / 2, b.z],
    });
    scene.add(mesh);
    if (b.h <= 26) continue;
    scene.add(partMesh({
      geo: new THREE.BoxGeometry(b.w * 0.4, 3, b.d * 0.4),
      mat: lambert(0x3a3f47),
      at: [b.x, b.h + 1.5, b.z],
    }));
  }
}

function buildStreetlights(scene, city) {
  const poleMat = lambert(0x2c313a);
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffe6a3 });
  for (const cx of city.centres) {
    for (const cz of city.centres) {
      scene.add(partMesh({ geo: new THREE.CylinderGeometry(0.09, 0.09, 7, 6), mat: poleMat, at: [cx + 6.5, 3.5, cz + 6.5] }));
      scene.add(partMesh({ geo: new THREE.SphereGeometry(0.32, 8, 6), mat: lampMat, at: [cx + 6.5, 7.1, cz + 6.5] }));
    }
  }
}

const BEACON_COLORS = { safehouse: 0x58c96b, shop: 0xffb02e, casino: 0xc9a227 };

function buildLandmarks(scene, city) {
  const out = {};
  for (const lm of Object.values(city.landmarks)) {
    const color = BEACON_COLORS[lm.id] ?? 0xffd23e;
    const beacon = partMesh({
      geo: new THREE.CylinderGeometry(0.5, 0.5, 14, 8),
      mat: new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35 }),
      at: [lm.x, 7, lm.z],
    });
    scene.add(beacon);
    out[lm.id] = beacon;
  }
  return out;
}

function beamMesh(color, radius, height, opacity) {
  return partMesh({
    geo: new THREE.CylinderGeometry(radius, radius, height, 12, 1, true),
    mat: new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false }),
  });
}

function ringMesh(color, inner, outer, opacity) {
  const m = partMesh({
    geo: new THREE.RingGeometry(inner, outer, 24),
    mat: new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide }),
  });
  m.rotation.x = -Math.PI / 2;
  return m;
}

function buildHeli(scene) {
  const group = new THREE.Group();
  const hull = lambert(0x1e2a3a);
  const glass = lambert(0x2f7fe0);
  const dark = lambert(0x11151c);
  for (const spec of [
    { geo: new THREE.BoxGeometry(2.4, 1.6, 5.2), mat: hull, at: [0, 0, 0] },
    { geo: new THREE.SphereGeometry(1.0, 10, 8), mat: glass, at: [0, -0.2, 2.4] },
    { geo: new THREE.BoxGeometry(0.7, 0.7, 4.2), mat: hull, at: [0, 0.3, -4.2] },
    { geo: new THREE.BoxGeometry(11, 0.12, 0.5), mat: dark, at: [0, 1.1, 0], tag: 'rotor' },
    { geo: new THREE.BoxGeometry(11, 0.12, 0.5), mat: dark, at: [0, 1.1, 0], rot: [0, Math.PI / 2, 0], tag: 'rotor2' },
  ]) {
    const m = partMesh(spec);
    group.add(m);
    if (spec.tag === 'rotor') group.userData.rotor = m;
    if (spec.tag === 'rotor2') group.userData.rotor2 = m;
  }
  const spot = partMesh({
    geo: new THREE.ConeGeometry(7, 34, 16, 1, true),
    mat: new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }),
    at: [0, -17, 0],
  });
  group.add(spot);
  group.userData.spot = spot;
  group.add(partMesh({
    geo: new THREE.SphereGeometry(0.35, 8, 6),
    mat: new THREE.MeshBasicMaterial({ color: 0xfff2b0 }),
    at: [0, -0.9, 0],
  }));
  group.visible = false;
  scene.add(group);
  return group;
}

export function createRenderer(canvas, city, rng) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.skyBottom);
  scene.fog = new THREE.Fog(PALETTE.fog, 120, 420);

  scene.add(new THREE.HemisphereLight(0xffd9a0, 0x2a3242, 1.25));
  const sun = new THREE.DirectionalLight(0xffc27a, 2.0);
  sun.position.set(120, 180, 60);
  scene.add(sun);

  const camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.1, 900);
  scene.add(camera);

  buildGround(scene);
  buildRoads(scene, city);
  buildBuildings(scene, city, windowTexture(rng));
  buildStreetlights(scene, city);
  const landmarkMeshes = buildLandmarks(scene, city);

  // Mission marker: a tall pulsing beam + a ring on the ground.
  const markerBeam = beamMesh(0xffd23e, 1.6, 60, 0.4);
  markerBeam.visible = false;
  scene.add(markerBeam);
  const markerRing = ringMesh(0xffd23e, 3, 4.2, 0.85);
  markerRing.visible = false;
  scene.add(markerRing);

  // Street-race gates: one blue beam + ring per gate of the active race,
  // reused across races (no circuit has more than 7 gates).
  const raceBeams = [];
  for (let i = 0; i < 7; i += 1) {
    const beam = beamMesh(0x4fa8e8, 1.2, 40, 0.35);
    beam.visible = false;
    scene.add(beam);
    const ring = ringMesh(0x4fa8e8, 2.5, 3.6, 0.8);
    ring.visible = false;
    scene.add(ring);
    raceBeams.push({ beam, ring });
  }

  // Pickups: spinning green crosses (health) / gold boxes (SMG).
  const pickupMeshes = [];
  for (const pk of city.pickups) {
    const mesh = partMesh({
      geo: new THREE.BoxGeometry(1.1, 1.1, 1.1),
      mat: new THREE.MeshBasicMaterial({ color: pk.kind === 'smg' ? 0xffb02e : 0x58c96b }),
      at: [pk.x, 1.0, pk.z],
    });
    scene.add(mesh);
    pickupMeshes.push(mesh);
  }

  // The player: jacket, dark trousers, cap.
  const playerMesh = makePedMesh(PALETTE.player, 'player');
  playerMesh.add(partMesh({
    geo: new THREE.CylinderGeometry(0.28, 0.28, 0.12, 10),
    mat: lambert(0x1c2733),
    at: [0, 1.86, 0],
  }));
  scene.add(playerMesh);

  const heliGroup = buildHeli(scene);

  // NOS flame — a small orange cone behind the player's car while boosting.
  const nosFlame = partMesh({
    geo: new THREE.ConeGeometry(0.55, 2.2, 8),
    mat: new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.9 }),
    rot: [-Math.PI / 2, 0, 0],
  });
  nosFlame.visible = false;
  scene.add(nosFlame);

  // Tracers: one reusable line for gunfire.
  const tracerGeo = new THREE.BufferGeometry();
  tracerGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const tracer = new THREE.Line(tracerGeo, new THREE.LineBasicMaterial({ color: 0xffe08a }));
  tracer.visible = false;
  tracer.frustumCulled = false;
  scene.add(tracer);

  const carMeshes = new Map();
  const pedMeshes = new Map();

  // ---- Feel state: trauma shake + FOV punch, decayed per rendered frame ----
  const feel = { trauma: 0, punch: 0, frame: 0 };
  function addTrauma(amount) { feel.trauma = Math.min(1, feel.trauma + amount); }
  function punchFov(deg) { feel.punch = Math.min(10, feel.punch + deg); }

  function syncCar(car, time) {
    let mesh = carMeshes.get(car);
    if (!mesh) {
      mesh = makeCarMesh(car.color, car.police);
      scene.add(mesh);
      carMeshes.set(car, mesh);
    }
    mesh.position.set(car.x, 0, car.z);
    mesh.rotation.y = car.angle;
    if (car.police && car.mesh) {
      const phase = Math.floor(time * 4) % 2 === 0;
      mesh.userData.red.visible = phase;
      mesh.userData.blue.visible = !phase;
    }
    const spin = car.speed * 0.016;
    for (const w of mesh.userData.wheels) w.rotation.x += spin;
    return mesh;
  }

  function syncPed(ped, time) {
    let mesh = pedMeshes.get(ped);
    if (!mesh) {
      mesh = makePedMesh(ped.color, ped.kind);
      scene.add(mesh);
      pedMeshes.set(ped, mesh);
    }
    mesh.visible = ped.alive;
    mesh.position.set(ped.x, 0, ped.z);
    mesh.rotation.y = ped.angle;
    const swing = Math.sin(time * 9 + ped.x) * 0.5;
    mesh.userData.legL.rotation.x = swing;
    mesh.userData.legR.rotation.x = -swing;
    return mesh;
  }

  function removeCar(car) {
    const mesh = carMeshes.get(car);
    if (mesh) { scene.remove(mesh); carMeshes.delete(car); }
  }
  function removePed(ped) {
    const mesh = pedMeshes.get(ped);
    if (mesh) { scene.remove(mesh); pedMeshes.delete(ped); }
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  function syncPlayer(state, time) {
    const p = state.player;
    playerMesh.visible = !p.inCar;
    playerMesh.position.set(p.x, p.y, p.z);
    playerMesh.rotation.y = p.angle;
    const swing = p.moving ? Math.sin(time * 11) * 0.55 : 0;
    playerMesh.userData.legL.rotation.x = swing;
    playerMesh.userData.legR.rotation.x = -swing;
  }

  function syncVehicles(state, time) {
    const all = [...state.parked, ...state.traffic, ...state.police, ...(state.raceRivals || [])];
    for (const car of all) syncCar(car, time);
    // The car the player drives lives outside those lists (it was spliced
    // out of parked/traffic when stolen).
    if (state.player.inCar && state.player.car) syncCar(state.player.car, time);
  }

  function syncMarker(state, time) {
    const m = state.mission.marker;
    if (!m) {
      markerBeam.visible = false;
      markerRing.visible = false;
      return;
    }
    markerBeam.visible = true;
    markerRing.visible = true;
    markerBeam.position.set(m.x, 30, m.z);
    markerBeam.material.color.setHex(m.color);
    markerRing.position.set(m.x, 0.08, m.z);
    markerRing.material.color.setHex(m.color);
    const s = 1 + Math.sin(time * 3) * 0.12;
    markerRing.scale.set(s, s, 1);
  }

  function syncRaceGates(state, time) {
    const race = state.race;
    if (!race || !race.active || !race.event) {
      for (const slot of raceBeams) { slot.beam.visible = false; slot.ring.visible = false; }
      return;
    }
    const gates = race.event.gates;
    gates.forEach((g, i) => {
      const slot = raceBeams[i];
      if (!slot) return;
      slot.beam.visible = true;
      slot.ring.visible = true;
      slot.beam.position.set(g.x, 20, g.z);
      slot.ring.position.set(g.x, 0.08, g.z);
      // The next gate burns brighter; cleared gates dim.
      const next = i === race.gateIndex;
      const s = next ? 1 + Math.sin(time * 4) * 0.15 : 0.8;
      slot.ring.scale.set(s, s, 1);
      slot.beam.material.opacity = next ? 0.5 : 0.18;
      slot.ring.material.opacity = next ? 0.95 : 0.4;
    });
    for (let i = gates.length; i < raceBeams.length; i += 1) {
      raceBeams[i].beam.visible = false;
      raceBeams[i].ring.visible = false;
    }
  }

  function syncPickupsAndBeacons(state, time) {
    state.city.pickups.forEach((pk, i) => {
      const mesh = pickupMeshes[i];
      if (!mesh) return;
      mesh.visible = !pk.taken;
      mesh.rotation.y = time * 2;
      mesh.position.y = 1.0 + Math.sin(time * 2 + i) * 0.15;
    });
    for (const [id, mesh] of Object.entries(landmarkMeshes)) {
      mesh.position.y = 7 + Math.sin(time * 1.2 + id.length) * 0.6;
    }
  }

  function syncHeli(state) {
    const h = state.heli;
    if (!h) {
      heliGroup.visible = false;
      return;
    }
    heliGroup.visible = true;
    heliGroup.position.set(h.x, h.y, h.z);
    heliGroup.rotation.y = h.angle;
    heliGroup.userData.rotor.rotation.y = h.rotor;
    heliGroup.userData.rotor2.rotation.y = h.rotor + Math.PI / 2;
    // The spotlight cone tilts toward its target instead of hanging down.
    const sx = (h.spotX || h.x) - h.x;
    const sz = (h.spotZ || h.z) - h.z;
    const tilt = Math.min(0.35, Math.hypot(sx, sz) / 60);
    const tiltDir = Math.atan2(sx, sz);
    heliGroup.userData.spot.rotation.set(Math.cos(tiltDir) * tilt, 0, -Math.sin(tiltDir) * tilt);
  }

  function syncNosFlame(state, time) {
    const car = state.player.inCar ? state.player.car : null;
    if (!car || !car.nosActive) {
      nosFlame.visible = false;
      return;
    }
    const bx = Math.sin(car.angle), bz = Math.cos(car.angle);
    nosFlame.visible = true;
    nosFlame.position.set(car.x - bx * 2.6, 0.7, car.z - bz * 2.6);
    nosFlame.rotation.y = car.angle;
    nosFlame.rotation.x = -Math.PI / 2;
    const fl = 1 + Math.sin(time * 40) * 0.25;
    nosFlame.scale.set(fl, fl, fl);
  }

  function applyFeel() {
    // Trauma decays every frame; shake is trauma^2 so small events barely
    // move the camera and big ones snap hard. The chase camera re-derives
    // its position from the follow target every frame, so the offset here
    // never accumulates.
    feel.frame += 1;
    feel.trauma = Math.max(0, feel.trauma - 0.02);
    if (feel.trauma > 0) {
      const shake = feel.trauma * feel.trauma;
      const f = feel.frame * 0.5;
      camera.position.x += 0.55 * shake * frameNoise(f, 1);
      camera.position.y += 0.55 * shake * frameNoise(f, 2);
      camera.rotation.z += 0.1 * shake * frameNoise(f, 3);
    }
    if (feel.punch > 0.001) {
      feel.punch *= 0.9;
      camera.fov = BASE_FOV + feel.punch;
      camera.updateProjectionMatrix();
    } else if (camera.fov !== BASE_FOV) {
      feel.punch = 0;
      camera.fov = BASE_FOV;
      camera.updateProjectionMatrix();
    }
  }

  return {
    scene, camera, renderer,
    setCamera(pos, lookAt) {
      camera.position.set(pos.x, pos.y, pos.z);
      camera.lookAt(lookAt.x, lookAt.y, lookAt.z);
    },
    sync(state, time) {
      syncPlayer(state, time);
      syncVehicles(state, time);
      for (const ped of state.peds) syncPed(ped, time);
      syncMarker(state, time);
      syncRaceGates(state, time);
      syncPickupsAndBeacons(state, time);
      syncHeli(state);
      syncNosFlame(state, time);
    },
    showTracer(from, to, ttl) {
      const pos = tracer.geometry.attributes.position;
      pos.setXYZ(0, from.x, from.y, from.z);
      pos.setXYZ(1, to.x, to.y, to.z);
      pos.needsUpdate = true;
      tracer.visible = true;
      tracer.userData.until = ttl;
    },
    hideTracer(time) {
      if (tracer.visible && time > (tracer.userData.until || 0)) tracer.visible = false;
    },
    render() {
      applyFeel();
      renderer.render(scene, camera);
    },
    addTrauma, punchFov,
    removeCar, removePed,
  };
}
