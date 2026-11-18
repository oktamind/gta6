// Drawing only, in three.js: the city, the cars, the people, the light. The renderer owns the
// THREE scene and every mesh; gameplay modules own the numbers. Meshes are pooled per entity
// (one group per car / ped) and moved each frame — nothing is rebuilt after boot except
// tracers and the mission beacon. v2 adds the police helicopter (body + spinning rotor +
// spotlight cone), green/amber beacons for the safehouse and shop, and a NOS flame
// cone behind a boosting car — all built from primitives, no new assets.
import * as THREE from 'three';
import { CITY, PALETTE } from './config.js';

function windowTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const g = c.getContext('2d');
  // Light concrete base so the material colour still reads in dusk light; windows are dark
  // glass with some lit warm/cool panes. (A dark base made whole facades read black.)
  g.fillStyle = '#c9ced6';
  g.fillRect(0, 0, 128, 256);
  for (let y = 8; y < 248; y += 18) {
    for (let x = 8; x < 120; x += 16) {
      const lit = Math.random() < 0.45;
      g.fillStyle = lit ? (Math.random() < 0.7 ? '#ffd88a' : '#9fd8ff') : '#2a2f38';
      g.fillRect(x, y, 10, 12);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeCarMesh(color, police) {
  const group = new THREE.Group();
  const paint = new THREE.MeshLambertMaterial({ color });
  const dark = new THREE.MeshLambertMaterial({ color: 0x14181f });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.62, 4.4), paint);
  body.position.y = 0.55;
  group.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.55, 2.2), dark);
  cabin.position.set(0, 1.1, -0.25);
  group.add(cabin);
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 12);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x0c0e11 });
  const wheels = [];
  for (const [wx, wz] of [[-0.95, 1.45], [0.95, 1.45], [-0.95, -1.45], [0.95, -1.45]]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(wx, 0.36, wz);
    group.add(w);
    wheels.push(w);
  }
  if (police) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.16, 0.4), new THREE.MeshLambertMaterial({ color: 0xdddddd }));
    bar.position.set(0, 1.45, -0.25);
    group.add(bar);
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.42), new THREE.MeshBasicMaterial({ color: 0xff2222 }));
    red.position.set(-0.32, 1.56, -0.25);
    group.add(red);
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.42), new THREE.MeshBasicMaterial({ color: 0x2266ff }));
    blue.position.set(0.32, 1.56, -0.25);
    group.add(blue);
    group.userData.red = red;
    group.userData.blue = blue;
    const badge = new THREE.Mesh(new THREE.BoxGeometry(2.02, 0.2, 1.0), new THREE.MeshBasicMaterial({ color: 0xf5f5f5 }));
    badge.position.set(0, 0.62, 0.6);
    group.add(badge);
  }
  group.userData.wheels = wheels;
  return group;
}

function makePedMesh(color, kind) {
  const group = new THREE.Group();
  const shirt = new THREE.MeshLambertMaterial({ color });
  const skin = new THREE.MeshLambertMaterial({ color: 0xd9a066 });
  const legs = new THREE.MeshLambertMaterial({ color: kind === 'cop' ? 0x1e2a3a : 0x2b2f36 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.38, 0.9, 8), shirt);
  body.position.y = 0.95;
  group.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), skin);
  head.position.y = 1.62;
  group.add(head);
  if (kind === 'cop') {
    const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.1, 10), new THREE.MeshLambertMaterial({ color: 0x10151c }));
    hat.position.y = 1.84;
    group.add(hat);
  }
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.55, 0.16), legs);
  legL.position.set(-0.14, 0.28, 0);
  group.add(legL);
  const legR = legL.clone();
  legR.position.x = 0.14;
  group.add(legR);
  group.userData.legL = legL;
  group.userData.legR = legR;
  return group;
}

export function createRenderer(canvas, city) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.skyBottom);
  scene.fog = new THREE.Fog(PALETTE.fog, 120, 420);

  const hemi = new THREE.HemisphereLight(0xffd9a0, 0x2a3242, 1.25);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffc27a, 2.0);
  sun.position.set(120, 180, 60);
  scene.add(sun);

  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 900);
  scene.add(camera);

  // Ground: big grass/dirt plane under everything.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY.half * 2 + 260, CITY.half * 2 + 260),
    new THREE.MeshLambertMaterial({ color: PALETTE.ground }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  scene.add(ground);

  // Roads: dark strips along every centreline, plus sidewalk borders.
  const roadMat = new THREE.MeshLambertMaterial({ color: PALETTE.asphalt });
  const walkMat = new THREE.MeshLambertMaterial({ color: PALETTE.sidewalk });
  const span = CITY.half * 2 + CITY.road;
  for (const c of city.centres) {
    for (const [mat, w, y] of [[walkMat, CITY.road + 6, 0.01], [roadMat, CITY.road, 0.03]]) {
      const a = new THREE.Mesh(new THREE.PlaneGeometry(span, w), mat);
      a.rotation.x = -Math.PI / 2;
      a.position.set(0, y, c);
      scene.add(a);
      const b = new THREE.Mesh(new THREE.PlaneGeometry(w, span), mat);
      b.rotation.x = -Math.PI / 2;
      b.position.set(c, y, 0);
      scene.add(b);
    }
    // Centre dashes.
    const dashMat = new THREE.MeshBasicMaterial({ color: 0xd8c98a });
    for (let t = -CITY.half; t < CITY.half; t += 12) {
      const d = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 4), dashMat);
      d.rotation.x = -Math.PI / 2;
      d.position.set(t, 0.05, c);
      scene.add(d);
      const d2 = d.clone();
      d2.rotation.z = Math.PI / 2;
      d2.position.set(c, 0.05, t);
      scene.add(d2);
    }
  }

  // Buildings with lit windows, plus a few rooftop boxes for silhouette.
  const winTex = windowTexture();
  const buildingMeshes = [];
  for (const b of city.buildings) {
    const mat = new THREE.MeshLambertMaterial({ color: b.color, map: winTex });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), mat);
    mesh.position.set(b.x, b.h / 2, b.z);
    scene.add(mesh);
    buildingMeshes.push(mesh);
    if (b.h > 26) {
      const roof = new THREE.Mesh(new THREE.BoxGeometry(b.w * 0.4, 3, b.d * 0.4), new THREE.MeshLambertMaterial({ color: 0x3a3f47 }));
      roof.position.set(b.x, b.h + 1.5, b.z);
      scene.add(roof);
    }
  }

  // Streetlights at intersections.
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x2c313a });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffe6a3 });
  for (const cx of city.centres) {
    for (const cz of city.centres) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 7, 6), poleMat);
      pole.position.set(cx + 6.5, 3.5, cz + 6.5);
      scene.add(pole);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 6), lampMat);
      lamp.position.set(cx + 6.5, 7.1, cz + 6.5);
      scene.add(lamp);
    }
  }

  // Landmark signs: floating coloured beacons so the player can find places.
  // v2: safehouse beacons are green, the shop is amber, the rest stay gold.
  const landmarkMeshes = {};
  for (const lm of Object.values(city.landmarks)) {
    const beaconColor = lm.id === 'safehouse' ? 0x58c96b : lm.id === 'shop' ? 0xffb02e : 0xffd23e;
    const beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.5, 14, 8),
      new THREE.MeshBasicMaterial({ color: beaconColor, transparent: true, opacity: 0.35 }),
    );
    beacon.position.set(lm.x, 7, lm.z);
    scene.add(beacon);
    landmarkMeshes[lm.id] = beacon;
  }

  // Mission marker: a tall pulsing beam + a ring on the ground.
  const markerBeam = new THREE.Mesh(
    new THREE.CylinderGeometry(1.6, 1.6, 60, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffd23e, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false }),
  );
  markerBeam.visible = false;
  scene.add(markerBeam);
  const markerRing = new THREE.Mesh(
    new THREE.RingGeometry(3, 4.2, 24),
    new THREE.MeshBasicMaterial({ color: 0xffd23e, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
  );
  markerRing.rotation.x = -Math.PI / 2;
  markerRing.visible = false;
  scene.add(markerRing);

  // Pickups: spinning green crosses (health) / gold boxes (SMG).
  const pickupMeshes = [];
  for (const pk of city.pickups) {
    const mat = new THREE.MeshBasicMaterial({ color: pk.kind === 'smg' ? 0xffb02e : 0x58c96b });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 1.1), mat);
    mesh.position.set(pk.x, 1.0, pk.z);
    scene.add(mesh);
    pickupMeshes.push(mesh);
  }

  // The player: jacket, dark trousers, cap.
  const playerMesh = makePedMesh(PALETTE.player, 'player');
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.12, 10), new THREE.MeshLambertMaterial({ color: 0x1c2733 }));
  cap.position.y = 1.86;
  playerMesh.add(cap);
  scene.add(playerMesh);

  // v2: police helicopter — dark body, glass nose, tail boom, spinning rotor,
  // and a spotlight cone that tracks the player. Built once, moved in sync().
  const heliGroup = new THREE.Group();
  const heliBody = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.6, 5.2), new THREE.MeshLambertMaterial({ color: 0x1e2a3a }));
  heliGroup.add(heliBody);
  const heliNose = new THREE.Mesh(new THREE.SphereGeometry(1.0, 10, 8), new THREE.MeshLambertMaterial({ color: 0x2f7fe0 }));
  heliNose.position.set(0, -0.2, 2.4);
  heliGroup.add(heliNose);
  const heliTail = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 4.2), new THREE.MeshLambertMaterial({ color: 0x1e2a3a }));
  heliTail.position.set(0, 0.3, -4.2);
  heliGroup.add(heliTail);
  const heliRotor = new THREE.Mesh(new THREE.BoxGeometry(11, 0.12, 0.5), new THREE.MeshLambertMaterial({ color: 0x11151c }));
  heliRotor.position.y = 1.1;
  heliGroup.add(heliRotor);
  const heliRotor2 = heliRotor.clone();
  heliRotor2.rotation.y = Math.PI / 2;
  heliGroup.add(heliRotor2);
  const heliSpot = new THREE.Mesh(
    new THREE.ConeGeometry(7, 34, 16, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }),
  );
  heliSpot.position.y = -17;
  heliGroup.add(heliSpot);
  const heliLight = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff2b0 }));
  heliLight.position.y = -0.9;
  heliGroup.add(heliLight);
  heliGroup.visible = false;
  scene.add(heliGroup);

  // v2: NOS flame — a small orange cone behind the player's car while boosting.
  const nosFlame = new THREE.Mesh(
    new THREE.ConeGeometry(0.55, 2.2, 8),
    new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.9 }),
  );
  nosFlame.rotation.x = -Math.PI / 2;
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

  return {
    scene, camera, renderer,
    setCamera(pos, lookAt) {
      camera.position.set(pos.x, pos.y, pos.z);
      camera.lookAt(lookAt.x, lookAt.y, lookAt.z);
    },
    sync(state, time) {
      // Player
      playerMesh.visible = !state.player.inCar;
      playerMesh.position.set(state.player.x, state.player.y, state.player.z);
      playerMesh.rotation.y = state.player.angle;
      const swing = state.player.moving ? Math.sin(time * 11) * 0.55 : 0;
      playerMesh.userData.legL.rotation.x = swing;
      playerMesh.userData.legR.rotation.x = -swing;
      // Cars: parked, traffic, police — plus the car the player is driving, which lives
      // outside those lists (it was spliced out of parked/traffic when stolen).
      for (const car of [...state.parked, ...state.traffic, ...state.police]) syncCar(car, time);
      if (state.player.inCar && state.player.car) syncCar(state.player.car, time);
      // Peds
      for (const ped of state.peds) syncPed(ped, time);
      // Marker
      if (state.mission.marker) {
        const m = state.mission.marker;
        markerBeam.visible = true;
        markerRing.visible = true;
        markerBeam.position.set(m.x, 30, m.z);
        markerBeam.material.color.setHex(m.color);
        markerRing.position.set(m.x, 0.08, m.z);
        markerRing.material.color.setHex(m.color);
        const s = 1 + Math.sin(time * 3) * 0.12;
        markerRing.scale.set(s, s, 1);
      } else {
        markerBeam.visible = false;
        markerRing.visible = false;
      }
      // Pickups spin / hide when taken
      state.city.pickups.forEach((pk, i) => {
        const mesh = pickupMeshes[i];
        if (!mesh) return;
        mesh.visible = !pk.taken;
        mesh.rotation.y = time * 2;
        mesh.position.y = 1.0 + Math.sin(time * 2 + i) * 0.15;
      });
      // Landmark beacons bob gently
      for (const [id, mesh] of Object.entries(landmarkMeshes)) {
        mesh.position.y = 7 + Math.sin(time * 1.2 + id.length) * 0.6;
      }
      // v2: helicopter — visible at 4-5 stars, rotor spins, spotlight tracks the player.
      if (state.heli) {
        const h = state.heli;
        heliGroup.visible = true;
        heliGroup.position.set(h.x, h.y, h.z);
        heliGroup.rotation.y = h.angle;
        heliRotor.rotation.y = h.rotor;
        heliRotor2.rotation.y = h.rotor + Math.PI / 2;
        // Spotlight cone stays vertical: the heli hovers almost directly above
        // the player, so a vertical cone already covers the spotlight target.
        heliSpot.rotation.set(0, 0, 0);
      } else {
        heliGroup.visible = false;
      }
      // v2: NOS flame behind the player's car while boosting.
      if (state.player.inCar && state.player.car && state.player.car.nosActive) {
        const car = state.player.car;
        const bx = Math.sin(car.angle), bz = Math.cos(car.angle);
        nosFlame.visible = true;
        nosFlame.position.set(car.x - bx * 2.6, 0.7, car.z - bz * 2.6);
        nosFlame.rotation.y = car.angle;
        nosFlame.rotation.x = -Math.PI / 2;
        const fl = 1 + Math.sin(time * 40) * 0.25;
        nosFlame.scale.set(fl, fl, fl);
      } else {
        nosFlame.visible = false;
      }
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
    render() { renderer.render(scene, camera); },
    removeCar, removePed,
  };
}
