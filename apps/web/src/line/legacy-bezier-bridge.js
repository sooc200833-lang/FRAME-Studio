import { createBezierPath } from './bezier-path.js';

/**
 * Convert the legacy quadratic-control-point convention into an equivalent
 * cubic Bézier path without changing the visible curve.
 *
 * Legacy strokes use each interior point as a quadratic control point and
 * join adjacent controls at their midpoint. The final segment is a straight
 * line to the last point. Quadratic segments are converted exactly to cubic
 * segments using the standard 2/3 control-point relationship.
 */
export function convertLegacyPointsToBezierPath(points, id = null) {
  if (!Array.isArray(points) || points.length < 2) {
    throw new RangeError('A legacy vector stroke needs at least two points.');
  }
  const source = points.map((point, index) => {
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) {
      throw new TypeError(`Legacy point ${index} must contain finite x/y coordinates.`);
    }
    return { x: point.x, y: point.y };
  });

  if (source.length === 2) {
    return createBezierPath({
      id,
      anchors: source,
      segments: [{
        control1: {
          x: source[0].x + (source[1].x - source[0].x) / 3,
          y: source[0].y + (source[1].y - source[0].y) / 3,
        },
        control2: {
          x: source[0].x + (source[1].x - source[0].x) * 2 / 3,
          y: source[0].y + (source[1].y - source[0].y) * 2 / 3,
        },
      }],
    });
  }

  const anchors = [{ x: source[0].x, y: source[0].y }];
  const segments = [];
  let start = source[0];

  for (let index = 1; index < source.length - 1; index++) {
    const control = source[index];
    const next = source[index + 1];
    const end = { x: (control.x + next.x) / 2, y: (control.y + next.y) / 2 };
    segments.push({
      control1: {
        x: start.x + (control.x - start.x) * 2 / 3,
        y: start.y + (control.y - start.y) * 2 / 3,
      },
      control2: {
        x: end.x + (control.x - end.x) * 2 / 3,
        y: end.y + (control.y - end.y) * 2 / 3,
      },
    });
    anchors.push(end);
    start = end;
  }

  const last = source.at(-1);
  segments.push({
    control1: {
      x: start.x + (last.x - start.x) / 3,
      y: start.y + (last.y - start.y) / 3,
    },
    control2: {
      x: start.x + (last.x - start.x) * 2 / 3,
      y: start.y + (last.y - start.y) * 2 / 3,
    },
  });
  anchors.push({ x: last.x, y: last.y });
  return createBezierPath({ id, anchors, segments });
}
