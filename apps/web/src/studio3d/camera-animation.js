// Camera animation for the 3D Background Studio. Pure data and math (no
// Three.js, no DOM): camera keyframes, line re-draw (boil) steps, the list of
// frames to render, and fitting frame holds to another frame rate.
//
// A key stores the whole camera view at a frame: position, the point looked
// at, field of view and orthographic zoom. Between keys every value is eased
// with the drawing timeline's easing curves.

import { ease } from '../animation/motion.js';

export const CAMERA_FPS = Object.freeze([8, 12, 24]);
export const BOIL_RATES = Object.freeze([0, 12, 8, 6, 4]);
export const CAMERA_EASINGS = Object.freeze(['easeInOut', 'linear']);
export const MAX_ANIMATION_LENGTH = 240;

const DEFAULT_ANIMATION = Object.freeze({ fps: 12, length: 24, boil: 0, keys: Object.freeze([]) });

const finite = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const vec3 = (value, fallback) => (Array.isArray(value) && value.length === 3 && value.every(item => Number.isFinite(Number(item)))
  ? value.map(Number)
  : [...fallback]);

export function createCameraAnimation() {
  return { ...DEFAULT_ANIMATION, keys: [] };
}

function normalizeKey(raw, length) {
  if (!raw || typeof raw !== 'object') return null;
  const tick = Math.round(finite(raw.tick, NaN));
  if (!Number.isFinite(tick) || tick < 0 || tick >= length) return null;
  return {
    tick,
    position: vec3(raw.position, [7, 5, 9]),
    target: vec3(raw.target, [0, 1.2, 0]),
    fov: clamp(finite(raw.fov, 50), 15, 100),
    zoom: clamp(finite(raw.zoom, 1), 0.05, 40),
    easing: CAMERA_EASINGS.includes(raw.easing) ? raw.easing : 'easeInOut',
  };
}

/** Validates a stored animation; missing or broken parts fall back to defaults. */
export function normalizeCameraAnimation(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const fps = CAMERA_FPS.includes(Number(source.fps)) ? Number(source.fps) : DEFAULT_ANIMATION.fps;
  const length = clamp(Math.round(finite(source.length, DEFAULT_ANIMATION.length)), 1, MAX_ANIMATION_LENGTH);
  const boil = BOIL_RATES.includes(Number(source.boil)) ? Number(source.boil) : 0;
  const byTick = new Map();
  for (const item of Array.isArray(source.keys) ? source.keys : []) {
    const key = normalizeKey(item, length);
    if (key) byTick.set(key.tick, key);
  }
  return { fps, length, boil, keys: [...byTick.values()].sort((a, b) => a.tick - b.tick) };
}

/** Camera values that a key stores, taken from a scene camera. */
function cameraValues(camera) {
  return {
    position: [...camera.position],
    target: [...camera.target],
    fov: camera.fov,
    zoom: camera.zoom ?? 1,
  };
}

/** Adds or replaces the key at `tick` with the given camera. Returns a new animation. */
export function setCameraKey(animation, tick, camera, easing) {
  const at = clamp(Math.round(tick), 0, animation.length - 1);
  const previous = animation.keys.find(key => key.tick === at);
  const key = normalizeKey({ tick: at, ...cameraValues(camera), easing: easing ?? previous?.easing }, animation.length);
  return { ...animation, keys: [...animation.keys.filter(item => item.tick !== at), key].sort((a, b) => a.tick - b.tick) };
}

export function removeCameraKey(animation, tick) {
  return { ...animation, keys: animation.keys.filter(key => key.tick !== Math.round(tick)) };
}

/** Changing the length drops keys past the new end. */
export function setAnimationLength(animation, length) {
  const next = clamp(Math.round(finite(length, animation.length)), 1, MAX_ANIMATION_LENGTH);
  return { ...animation, length: next, keys: animation.keys.filter(key => key.tick < next) };
}

const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Camera view at `tick` (may be fractional). Without keys this is the scene's
 * own camera; before the first / after the last key that key holds.
 */
export function cameraAt(animation, baseCamera, tick) {
  const keys = animation?.keys || [];
  if (!keys.length) return cameraValues(baseCamera);
  if (tick <= keys[0].tick) return cameraValues(keys[0]);
  const last = keys[keys.length - 1];
  if (tick >= last.tick) return cameraValues(last);
  let index = 0;
  while (keys[index + 1].tick <= tick) index++;
  const from = keys[index];
  const to = keys[index + 1];
  const t = ease(from.easing, (tick - from.tick) / (to.tick - from.tick));
  return {
    position: from.position.map((value, axis) => lerp(value, to.position[axis], t)),
    target: from.target.map((value, axis) => lerp(value, to.target[axis], t)),
    fov: lerp(from.fov, to.fov, t),
    // Zoom is a ratio, so it changes evenly on a log scale.
    zoom: from.zoom * (to.zoom / from.zoom) ** t,
  };
}

/**
 * Line re-draw step at a frame: lines are drawn anew `boil` times per second.
 * The step number seeds the ink noise, so the same frame always looks the
 * same (screen and export agree). 0 when boil is off.
 */
export function boilStep(tick, fps, boil) {
  if (!boil) return 0;
  return Math.floor((Math.floor(tick) * boil) / fps + 1e-9);
}

/** True when sending should produce several frames instead of one picture. */
export function isAnimated(animation) {
  return Boolean(animation) && (animation.keys.length >= 2 || animation.boil > 0) && animation.length > 1;
}

const sameView = (a, b) => a.fov === b.fov && a.zoom === b.zoom
  && a.position.every((value, axis) => value === b.position[axis])
  && a.target.every((value, axis) => value === b.target[axis]);

/**
 * Frames to render for the whole animation: [{ tick, hold, camera, step }].
 * Consecutive frames with the same camera and the same boil step become one
 * frame held longer, so a still camera with slow boil makes few drawings.
 */
export function animationFrames(animation, baseCamera) {
  const frames = [];
  for (let tick = 0; tick < animation.length; tick++) {
    const camera = cameraAt(animation, baseCamera, tick);
    const step = boilStep(tick, animation.fps, animation.boil);
    const previous = frames[frames.length - 1];
    if (previous && previous.step === step && sameView(previous.camera, camera)) {
      previous.hold++;
    } else {
      frames.push({ tick, hold: 1, camera, step });
    }
  }
  return frames;
}

/**
 * Fits holds made at `fromFps` to a timeline at `toFps`, keeping every frame
 * at the same moment in time (rounded to the target's frames). Frames that
 * would get no time at the target rate are dropped. Returns
 * [{ index, hold }] with `index` into the original list.
 */
export function retimeHolds(holds, fromFps, toFps) {
  const out = [];
  let start = 0;
  let previousEnd = 0;
  holds.forEach((hold, index) => {
    start += hold;
    const end = Math.round((start * toFps) / fromFps);
    if (end > previousEnd) {
      out.push({ index, hold: end - previousEnd });
      previousEnd = end;
    }
  });
  return out;
}
