// Layer movement keyframes ("움직임"). Pure data + math, no DOM or PixiJS.
//
// A layer's motion track is a list of keyframes placed at absolute timeline
// ticks (frame times), independent of which drawing is exposed there. A held
// drawing therefore keeps moving smoothly while it stays on screen.

export const IDENTITY_MOTION = Object.freeze({ x: 0, y: 0, rotation: 0, scale: 1, opacity: 1 });
export const MOTION_EASINGS = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'hold'];

const finite = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function normalizeMotion(motion = {}) {
  return {
    x: finite(motion.x, 0),
    y: finite(motion.y, 0),
    rotation: finite(motion.rotation, 0),
    scale: clamp(finite(motion.scale, 1), 0.05, 20),
    opacity: clamp(finite(motion.opacity, 1), 0, 1),
  };
}

const normalizeTick = tick => Math.max(0, Math.round(finite(tick, 0)));

export function normalizeKeyframe(keyframe) {
  return {
    tick: normalizeTick(keyframe.tick),
    ...normalizeMotion(keyframe),
    easing: MOTION_EASINGS.includes(keyframe.easing) ? keyframe.easing : 'easeInOut',
  };
}

export function isIdentityMotion(motion, epsilon = 1e-6) {
  return Math.abs(motion.x) < epsilon
    && Math.abs(motion.y) < epsilon
    && Math.abs(motion.rotation) < epsilon
    && Math.abs(motion.scale - 1) < epsilon
    && Math.abs(motion.opacity - 1) < epsilon;
}

export function ease(easing, t) {
  const u = clamp(t, 0, 1);
  switch (easing) {
    case 'hold': return u >= 1 ? 1 : 0;
    case 'easeIn': return u * u * u;
    case 'easeOut': return 1 - (1 - u) ** 3;
    case 'easeInOut': return u < 0.5 ? 4 * u * u * u : 1 - ((-2 * u + 2) ** 3) / 2;
    default: return u;
  }
}

/** Returns a new track with the keyframe at `tick` created or replaced. */
export function setKeyframe(track = [], tick, values, easing) {
  const at = normalizeTick(tick);
  const existing = track.find(keyframe => keyframe.tick === at);
  const next = normalizeKeyframe({
    ...(existing || {}),
    ...values,
    tick: at,
    easing: easing ?? existing?.easing,
  });
  return [...track.filter(keyframe => keyframe.tick !== at), next];
}

export function removeKeyframe(track = [], tick) {
  const at = normalizeTick(tick);
  return track.filter(keyframe => keyframe.tick !== at);
}

export function keyframeAt(track = [], tick) {
  const at = normalizeTick(tick);
  return track?.find(keyframe => keyframe.tick === at) || null;
}

export function orderedKeyframes(track = []) {
  return [...(track || [])].sort((a, b) => a.tick - b.tick);
}

/**
 * Motion at `tick` (may be fractional during playback). Before the first
 * keyframe and after the last one the nearest keyframe is held. Between two
 * keyframes the earlier keyframe's easing shapes the segment.
 */
export function evaluateMotionTrack(track, tick) {
  const keys = orderedKeyframes(track);
  if (!keys.length) return { ...IDENTITY_MOTION };
  const time = finite(tick, 0);
  if (time <= keys[0].tick) return normalizeMotion(keys[0]);
  const last = keys[keys.length - 1];
  if (time >= last.tick) return normalizeMotion(last);
  let segment = 0;
  while (segment < keys.length - 2 && time >= keys[segment + 1].tick) segment++;
  const from = keys[segment];
  const to = keys[segment + 1];
  const t = ease(from.easing, (time - from.tick) / (to.tick - from.tick));
  const mix = (a, b) => a + (b - a) * t;
  return normalizeMotion({
    x: mix(from.x, to.x),
    y: mix(from.y, to.y),
    rotation: mix(from.rotation, to.rotation),
    // Interpolate scale geometrically so 0.5→2 passes through 1 at the midpoint.
    scale: Math.exp(mix(Math.log(from.scale), Math.log(to.scale))),
    opacity: mix(from.opacity, to.opacity),
  });
}

/**
 * Affine matrix [a, b, c, d, e, f] (canvas setTransform / Pixi Matrix order)
 * mapping layer-local pixels to stage pixels: rotate and scale about the
 * canvas center, then translate by (x, y).
 */
export function motionMatrix(motion, width, height) {
  const { x, y, rotation, scale } = normalizeMotion(motion);
  const radians = rotation * Math.PI / 180;
  const a = scale * Math.cos(radians);
  const b = scale * Math.sin(radians);
  const c = -b;
  const d = a;
  const cx = width / 2;
  const cy = height / 2;
  return [a, b, c, d, cx + x - (a * cx + c * cy), cy + y - (b * cx + d * cy)];
}

export function applyMatrix([a, b, c, d, e, f], point) {
  return { x: a * point.x + c * point.y + e, y: b * point.x + d * point.y + f };
}

export function invertMatrix([a, b, c, d, e, f]) {
  const det = a * d - b * c;
  if (!det) return [1, 0, 0, 1, 0, 0];
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}
