// Keyboard and pointer input for Solmar Heist.
// Held keys give movement; one-shot presses (enter car, pause, shoot, honk, reload) are queued
// as bit flags and taken once by the loop, so a press between two frames is never lost.
// Mouse: drag to orbit the camera; click (on the canvas) shoots. Pointer lock is requested on
// click when the game is running, with drag as a fallback if the browser refuses it.
export const ACTION_ENTER = 1;
export const ACTION_PAUSE = 2;
export const ACTION_SHOOT = 4;
export const ACTION_JUMP = 8;
export const ACTION_HONK = 16;
export const ACTION_RELOAD = 32;
export const ACTION_INTERACT = 64;

const FORWARD = new Set(['KeyW', 'ArrowUp']);
const BACK = new Set(['KeyS', 'ArrowDown']);
const LEFT = new Set(['KeyA', 'ArrowLeft']);
const RIGHT = new Set(['KeyD', 'ArrowRight']);
const SPRINT = new Set(['ShiftLeft', 'ShiftRight']);

export function createInput(canvas) {
  const keys = new Set();
  let actions = 0;
  let lookDX = 0;
  let lookDY = 0;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  window.addEventListener('keydown', (event) => {
    if (event.repeat) {
      if (FORWARD.has(event.code) || BACK.has(event.code) || LEFT.has(event.code) || RIGHT.has(event.code)) event.preventDefault();
      return;
    }
    keys.add(event.code);
    if (event.code === 'KeyE') actions |= ACTION_ENTER | ACTION_INTERACT;
    else if (event.code === 'KeyP' || event.code === 'Escape') actions |= ACTION_PAUSE;
    else if (event.code === 'Space') { actions |= ACTION_JUMP; event.preventDefault(); }
    else if (event.code === 'KeyH') actions |= ACTION_HONK;
    else if (event.code === 'KeyR') actions |= ACTION_RELOAD;
    else if (event.code === 'KeyM') actions |= 128; // ACTION_MUTE
    if (FORWARD.has(event.code) || BACK.has(event.code) || LEFT.has(event.code) || RIGHT.has(event.code)) event.preventDefault();
  });
  window.addEventListener('keyup', (event) => keys.delete(event.code));
  window.addEventListener('blur', () => keys.clear());

  canvas.addEventListener('pointerdown', (event) => {
    if (event.button === 0) {
      actions |= ACTION_SHOOT;
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      if (document.pointerLockElement !== canvas) {
        try { canvas.requestPointerLock(); } catch { /* drag fallback */ }
      }
    }
  });
  window.addEventListener('pointerup', () => { dragging = false; });
  window.addEventListener('pointermove', (event) => {
    if (document.pointerLockElement === canvas) {
      lookDX += event.movementX || 0;
      lookDY += event.movementY || 0;
    } else if (dragging) {
      lookDX += event.clientX - lastX;
      lookDY += event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;
    }
  });
  document.addEventListener('pointerlockchange', () => { if (document.pointerLockElement !== canvas) dragging = false; });

  return {
    move() {
      let x = 0, y = 0;
      for (const code of keys) {
        if (FORWARD.has(code)) y += 1;
        if (BACK.has(code)) y -= 1;
        if (LEFT.has(code)) x -= 1;
        if (RIGHT.has(code)) x += 1;
      }
      return { x, y, sprint: [...keys].some((c) => SPRINT.has(c)) };
    },
    takeLook() {
      const dx = lookDX, dy = lookDY;
      lookDX = 0; lookDY = 0;
      return { dx, dy };
    },
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
  };
}
