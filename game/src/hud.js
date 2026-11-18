// HUD: the DOM chips (cash, health, ammo, wanted stars, clock, objective, speed) and the
// 2D minimap canvas. The minimap draws the road grid, buildings, the player arrow, police,
// traffic, peds and the mission marker — north-up, scaled to the whole city.
import { CITY } from './config.js';

const $ = (id) => document.getElementById(id);

export function createHud() {
  const els = {
    cash: $('cash'), healthFill: $('health-fill'), healthNum: $('health-num'),
    ammo: $('ammo'), wanted: $('wanted'), clock: $('clock'),
    objTitle: $('obj-title'), objText: $('obj-text'), objSub: $('obj-sub'),
    speed: $('speed'), gear: $('gear'), hint: $('hint'), toast: $('toast'),
    crosshair: $('crosshair'), vignette: $('vignette'),
    minimap: $('minimap'),
  };
  const mm = els.minimap.getContext('2d');
  let toastTimer = 0;

  function toast(text, ms = 2600) {
    els.toast.textContent = text;
    els.toast.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.style.opacity = '0'; }, ms);
  }

  function drawMinimap(state) {
    const W = 190, H = 190;
    const half = CITY.half + 24;
    const scale = W / (half * 2);
    const toX = (x) => (x + half) * scale;
    const toY = (z) => (z + half) * scale;
    mm.fillStyle = '#101623';
    mm.fillRect(0, 0, W, H);
    // Buildings
    mm.fillStyle = '#2c3648';
    for (const b of state.city.buildings) {
      mm.fillRect(toX(b.x - b.w / 2), toY(b.z - b.d / 2), b.w * scale, b.d * scale);
    }
    // Roads
    mm.strokeStyle = '#4a5568';
    mm.lineWidth = (CITY.road) * scale;
    for (const c of state.city.centres) {
      mm.beginPath(); mm.moveTo(toX(-half), toY(c)); mm.lineTo(toX(half), toY(c)); mm.stroke();
      mm.beginPath(); mm.moveTo(toX(c), toY(-half)); mm.lineTo(toX(c), toY(half)); mm.stroke();
    }
    // Marina water corner
    mm.fillStyle = '#1d4e6b';
    mm.fillRect(toX(CITY.half - 40), toY(CITY.half - 40), 40 * scale, 40 * scale);
    // Mission marker
    if (state.mission.marker) {
      const m = state.mission.marker;
      mm.fillStyle = '#ffd23e';
      mm.beginPath(); mm.arc(toX(m.x), toY(m.z), 6, 0, Math.PI * 2); mm.fill();
      mm.strokeStyle = '#ffd23e';
      mm.beginPath(); mm.arc(toX(m.x), toY(m.z), 10 + Math.sin(performance.now() / 300) * 2, 0, Math.PI * 2); mm.stroke();
    }
    // Traffic (white) and peds (faint)
    mm.fillStyle = 'rgba(255,255,255,0.75)';
    for (const car of state.traffic) mm.fillRect(toX(car.x) - 1.5, toY(car.z) - 1.5, 3, 3);
    mm.fillStyle = 'rgba(255,255,255,0.3)';
    for (const ped of state.peds) {
      if (ped.alive && ped.kind === 'ped') mm.fillRect(toX(ped.x) - 1, toY(ped.z) - 1, 2, 2);
    }
    // Police (red/blue)
    for (const car of state.police) {
      mm.fillStyle = '#ff4444';
      mm.beginPath(); mm.arc(toX(car.x), toY(car.z), 3.5, 0, Math.PI * 2); mm.fill();
    }
    for (const ped of state.peds) {
      if (ped.alive && ped.kind === 'cop') {
        mm.fillStyle = '#ff4444';
        mm.beginPath(); mm.arc(toX(ped.x), toY(ped.z), 3, 0, Math.PI * 2); mm.fill();
      }
    }
    // Player arrow (rotates with facing)
    const p = state.player;
    mm.save();
    mm.translate(toX(p.x), toY(p.z));
    mm.rotate(p.inCar ? p.car.angle : p.angle);
    mm.fillStyle = '#ffb02e';
    mm.beginPath();
    mm.moveTo(0, -7); mm.lineTo(5, 6); mm.lineTo(-5, 6); mm.closePath();
    mm.fill();
    mm.restore();
  }

  let last = {};
  function setText(el, key, value) {
    if (last[key] !== value) { last[key] = value; el.textContent = value; }
  }

  return {
    toast,
    update(state) {
      setText(els.cash, 'cash', `$${state.player.cash.toLocaleString('en-US')}`);
      const hp = Math.max(0, Math.round(state.player.health));
      els.healthFill.style.width = `${hp}%`;
      setText(els.healthNum, 'hp', String(hp));
      els.vignette.style.opacity = hp < 35 ? String(0.4 + (35 - hp) / 35 * 0.5) : '0';
      const weapon = state.player.weapon === 'smg' ? `SMG ${state.player.smgAmmo}` : 'PISTOL ∞';
      setText(els.ammo, 'ammo', weapon);
      const stars = '★'.repeat(state.wanted) + '☆'.repeat(5 - state.wanted);
      setText(els.wanted, 'wanted', stars);
      els.wanted.classList.toggle('off', state.wanted === 0);
      const day = state.day;
      const mins = state.clockMin;
      const hh = String(Math.floor(mins / 60) % 24).padStart(2, '0');
      const mm2 = String(Math.floor(mins % 60)).padStart(2, '0');
      setText(els.clock, 'clock', `DAY ${day} · ${hh}:${mm2}`);
      const obj = state.objective;
      setText(els.objTitle, 'ot', obj.title);
      setText(els.objText, 'ox', obj.text);
      setText(els.objSub, 'os', obj.sub || '');
      const speedMph = state.player.inCar ? Math.abs(Math.round(state.player.car.speed * 2.237)) : 0;
      setText(els.speed, 'sp', String(speedMph));
      setText(els.gear, 'gear', state.player.inCar ? (state.player.car.speed > 0.5 ? 'DRIVE' : state.player.car.speed < -0.5 ? 'REVERSE' : 'PARK') : 'ON FOOT');
      els.crosshair.style.display = state.player.inCar ? 'none' : 'block';
      drawMinimap(state);
    },
    setHint(text) { setText(els.hint, 'hint', text); },
  };
}
