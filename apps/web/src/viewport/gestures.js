// Pure multi-touch gesture math for the canvas viewport.
//
// The viewport is rendered with CSS `translate(x, y) rotate(r) scale(s)` around
// the element's center. Given the previous and current positions of two
// fingers, `pinchViewport` returns a new viewport in which the canvas point that
// was under the previous finger midpoint stays under the current midpoint.

export const MIN_VIEWPORT_SCALE = 0.25;
export const MAX_VIEWPORT_SCALE = 6;

const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const angle = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);

/**
 * @param viewport {scale, rotation (deg), x, y}
 * @param previous [pointA, pointB] client coordinates
 * @param current  [pointA, pointB] client coordinates
 * @param center   current on-screen center of the transformed element
 */
export function pinchViewport(viewport, previous, current, center, { minScale = MIN_VIEWPORT_SCALE, maxScale = MAX_VIEWPORT_SCALE, rotate = true } = {}) {
  const [a0, b0] = previous;
  const [a1, b1] = current;
  const d0 = distance(a0, b0);
  const d1 = distance(a1, b1);
  if (!(d0 > 1) || !(d1 > 1)) return { ...viewport };

  const nextScale = Math.min(maxScale, Math.max(minScale, viewport.scale * (d1 / d0)));
  const k = nextScale / viewport.scale;
  const deltaRadians = rotate ? angle(a1, b1) - angle(a0, b0) : 0;
  const m0 = midpoint(a0, b0);
  const m1 = midpoint(a1, b1);
  const ox = m0.x - center.x;
  const oy = m0.y - center.y;
  const cos = Math.cos(deltaRadians);
  const sin = Math.sin(deltaRadians);
  const rx = k * (ox * cos - oy * sin);
  const ry = k * (ox * sin + oy * cos);
  // Layout center (untransformed) = on-screen center - translation.
  const layoutX = center.x - viewport.x;
  const layoutY = center.y - viewport.y;
  let rotation = viewport.rotation + deltaRadians * 180 / Math.PI;
  rotation = ((rotation % 360) + 540) % 360 - 180;
  return {
    scale: nextScale,
    rotation,
    x: m1.x - layoutX - rx,
    y: m1.y - layoutY - ry,
  };
}

/** Snaps near-axis rotations so a slightly crooked pinch does not tilt the page. */
export function snapViewportRotation(rotation, threshold = 6) {
  const snapped = Math.round(rotation / 90) * 90;
  return Math.abs(rotation - snapped) <= threshold ? ((snapped + 540) % 360) - 180 : rotation;
}

/**
 * Classifies a finished multi-finger touch as a quick tap shortcut.
 * Two fingers → undo, three fingers → redo (common iPad drawing-app shortcuts).
 */
export function classifyMultiTouchTap({ fingers, durationMs, maxTravel }, { maxDurationMs = 320, maxTravelPx = 14 } = {}) {
  if (!(durationMs <= maxDurationMs) || !(maxTravel <= maxTravelPx)) return null;
  if (fingers === 2) return 'undo';
  if (fingers === 3) return 'redo';
  return null;
}
