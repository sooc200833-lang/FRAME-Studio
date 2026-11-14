// Perspective guides for the 3D Background Studio: vanishing points of the
// scene's main axes and the horizon, in viewport pixels (y down), plus a
// Canvas 2D painter used both for the on-screen overlay and for the guide
// layer sent to the drawing studio.

import { Vector4 } from 'three';

export const GUIDE_AXES = Object.freeze([
  { id: 'x', direction: [1, 0, 0], color: '#d0574b' },
  { id: 'z', direction: [0, 0, 1], color: '#3d7fc4' },
  { id: 'y', direction: [0, 1, 0], color: '#4a9a5c' },
]);

/** Projects a world direction (a point at infinity) to clip space (a new vector). */
function projectDirection(camera, [x, y, z]) {
  return new Vector4(x, y, z, 0).applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
}

/**
 * For each axis: a vanishing point in pixels, or — when the axis is (nearly)
 * parallel to the picture plane or the camera is orthographic — the on-screen
 * direction its lines run in. Vanishing points far outside the frame
 * (beyond `farFactor` × the frame size) are treated as parallel too.
 */
export function perspectiveGuides(camera, { width, height, farFactor = 12 } = {}) {
  camera.updateMatrixWorld();
  const toPixels = (ndcX, ndcY) => ({ x: (ndcX + 1) / 2 * width, y: (1 - ndcY) / 2 * height });
  const families = GUIDE_AXES.map(axis => {
    const c = projectDirection(camera, axis.direction);
    const finite = Math.abs(c.w) > 1e-6;
    if (finite) {
      const point = toPixels(c.x / c.w, c.y / c.w);
      const far = Math.abs(point.x - width / 2) > width * farFactor || Math.abs(point.y - height / 2) > height * farFactor;
      if (!far) return { ...axis, vanishingPoint: point, screenDirection: null };
    }
    // Lines of this axis look parallel: take the screen direction of a short
    // segment through the view centre.
    const direction = { x: c.x * width, y: -c.y * height };
    const length = Math.hypot(direction.x, direction.y);
    return { ...axis, vanishingPoint: null, screenDirection: length > 1e-9 ? { x: direction.x / length, y: direction.y / length } : null };
  });
  // Horizon: through the vanishing points of two horizontal directions.
  const horizontal = [[1, 0, 0], [0, 0, 1], [1, 0, 1], [1, 0, -1]]
    .map(direction => projectDirection(camera, direction))
    .filter(c => Math.abs(c.w) > 1e-6)
    .map(c => toPixels(c.x / c.w, c.y / c.w));
  let horizon = null;
  if (horizontal.length >= 2 && !camera.isOrthographicCamera) {
    const [a, b] = horizontal.sort((p, q) => Math.hypot(p.x - width / 2, p.y - height / 2) - Math.hypot(q.x - width / 2, q.y - height / 2));
    if (Math.hypot(b.x - a.x, b.y - a.y) > 1e-3) horizon = [a, b];
  }
  return { width, height, families, horizon };
}

/** Clips the infinite line through p in direction d to the frame; null if it misses. */
export function clipLine(p, d, width, height) {
  let t0 = -Infinity;
  let t1 = Infinity;
  for (const [origin, delta, max] of [[p.x, d.x, width], [p.y, d.y, height]]) {
    if (Math.abs(delta) < 1e-12) {
      if (origin < 0 || origin > max) return null;
      continue;
    }
    const a = (0 - origin) / delta;
    const b = (max - origin) / delta;
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
  }
  if (t0 > t1) return null;
  return [{ x: p.x + d.x * t0, y: p.y + d.y * t0 }, { x: p.x + d.x * t1, y: p.y + d.y * t1 }];
}

/**
 * Draws the guides: `rays` lines per family (fanning out of a vanishing point,
 * or evenly spaced parallels), and the horizon. `scale` multiplies line width.
 */
export function drawPerspectiveGuides(context, guides, { rays = 28, scale = 1, alpha = 0.55, axes = ['x', 'z', 'y'] } = {}) {
  const { width, height } = guides;
  context.save();
  context.lineCap = 'round';
  for (const family of guides.families) {
    if (!axes.includes(family.id)) continue;
    context.strokeStyle = family.color;
    context.globalAlpha = alpha;
    context.lineWidth = 1 * scale;
    context.beginPath();
    if (family.vanishingPoint) {
      const vp = family.vanishingPoint;
      for (let index = 0; index < rays; index++) {
        const angle = index / rays * Math.PI;
        const segment = clipLine(vp, { x: Math.cos(angle), y: Math.sin(angle) }, width, height);
        if (!segment) continue;
        context.moveTo(segment[0].x, segment[0].y);
        context.lineTo(segment[1].x, segment[1].y);
      }
    } else if (family.screenDirection) {
      const d = family.screenDirection;
      const normal = { x: -d.y, y: d.x };
      const reach = Math.hypot(width, height) / 2;
      const count = Math.max(4, Math.round(rays / 2));
      for (let index = 0; index <= count; index++) {
        const offset = (index / count * 2 - 1) * reach;
        const segment = clipLine({ x: width / 2 + normal.x * offset, y: height / 2 + normal.y * offset }, d, width, height);
        if (!segment) continue;
        context.moveTo(segment[0].x, segment[0].y);
        context.lineTo(segment[1].x, segment[1].y);
      }
    }
    context.stroke();
  }
  if (guides.horizon) {
    const [a, b] = guides.horizon;
    const segment = clipLine(a, { x: b.x - a.x, y: b.y - a.y }, width, height);
    if (segment) {
      context.globalAlpha = Math.min(1, alpha + 0.3);
      context.strokeStyle = '#1c1b20';
      context.lineWidth = 1.5 * scale;
      context.setLineDash([8 * scale, 6 * scale]);
      context.beginPath();
      context.moveTo(segment[0].x, segment[0].y);
      context.lineTo(segment[1].x, segment[1].y);
      context.stroke();
    }
  }
  context.restore();
}
