import { sampleBezierPath, cloneBezierPath } from './bezier-path.js';

import { createVectorBrushStyle, normalizeVectorPressure, normalizeStrokeWidthProfile } from './vector-brush.js';

export function createLineStroke({ id, points, color = '#24242a', width = 7, brushPreset = 'ink', pressureCurve = 1, opacity, motionStyle = 'none', motionStrength = 3, pressureProfile }) {
  if (!id) throw new TypeError('A stable line id is required.');
  if (!Array.isArray(points) || points.length < 2) throw new RangeError('A line needs at least two points.');
  return {
    id,
    points: points.map(point => ({ x: Number(point.x), y: Number(point.y), pressure: Number.isFinite(Number(point.pressure)) ? normalizeVectorPressure(point.pressure) : 0.5 })),
    color,
    width: Math.max(0.5, Number(width) || 1),
    ...createVectorBrushStyle({ brushPreset, pressureCurve, opacity, motionStyle, motionStrength }),
    pressureProfile: normalizeStrokeWidthProfile(pressureProfile),
  };
}
function pointSegmentDistance(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  const projection = { x: a.x + t * dx, y: a.y + t * dy };
  return Math.hypot(point.x - projection.x, point.y - projection.y);
}

/**
 * Sample the exact quadratic path convention used by the canvas renderer.
 * Each sampled segment retains the editable control-segment index that produced it.
 */
export function sampleLineStrokePath(points, subdivisions = 24) {
  if (!Array.isArray(points) || points.length < 2) return { points: [], segmentIndices: [] };
  const steps = Math.max(2, Math.min(64, Math.floor(Number(subdivisions) || 24)));
  const sampled = [{ x: points[0].x, y: points[0].y }];
  const segmentIndices = [];
  if (points.length === 2) {
    sampled.push({ x: points[1].x, y: points[1].y });
    segmentIndices.push(0);
    return { points: sampled, segmentIndices };
  }

  for (let index = 1; index < points.length - 1; index++) {
    const control = points[index];
    const next = points[index + 1];
    const end = { x: (control.x + next.x) / 2, y: (control.y + next.y) / 2 };
    const start = sampled.at(-1);
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      const inverse = 1 - t;
      sampled.push({
        x: inverse * inverse * start.x + 2 * inverse * t * control.x + t * t * end.x,
        y: inverse * inverse * start.y + 2 * inverse * t * control.y + t * t * end.y,
      });
      segmentIndices.push(index - 1);
    }
  }

  sampled.push({ x: points.at(-1).x, y: points.at(-1).y });
  segmentIndices.push(points.length - 2);
  return { points: sampled, segmentIndices };
}

export function sampleStrokePath(stroke, options = {}) {
  return stroke?.bezierPath ? sampleBezierPath(stroke.bezierPath, options) : sampleLineStrokePath(stroke?.points || []);
}

export function hitTestLineStroke(stroke, point, tolerance = 8) {
  if (!stroke || !Array.isArray(stroke.points) || stroke.points.length < 2) return false;
  const threshold = Math.max(0, Number(tolerance) || 0) + Math.max(0, Number(stroke.width) || 0) / 2;
  const path = sampleStrokePath(stroke);
  for (let index = 1; index < path.points.length; index++) {
    if (pointSegmentDistance(point, path.points[index - 1], path.points[index]) <= threshold) return true;
  }
  return false;
}

export function hitTestLineStrokes(strokes, point, tolerance = 8) {
  for (let index = strokes.length - 1; index >= 0; index--) {
    if (hitTestLineStroke(strokes[index], point, tolerance)) return strokes[index];
  }
  return null;
}

function translateBezierPath(path, dx, dy) {
  return {
    ...path,
    anchors: path.anchors.map(point => ({ x: point.x + dx, y: point.y + dy })),
    segments: path.segments.map(segment => ({
      control1: { x: segment.control1.x + dx, y: segment.control1.y + dy },
      control2: { x: segment.control2.x + dx, y: segment.control2.y + dy },
    })),
  };
}

export function translateLineStroke(stroke, dx, dy) {
  return {
    ...stroke,
    points: stroke.points.map(point => ({ ...point, x: point.x + dx, y: point.y + dy })),
    ...(stroke.bezierPath ? { bezierPath: translateBezierPath(stroke.bezierPath, dx, dy) } : {}),
  };
}

export function updateLineStrokeStyle(stroke, changes) {
  return {
    ...stroke,
    color: changes.color ?? stroke.color,
    width: changes.width === undefined ? stroke.width : Math.max(0.5, Number(changes.width) || 0.5),
    ...createVectorBrushStyle({ ...stroke, ...changes }),
    pressureProfile: changes.pressureProfile === undefined
      ? normalizeStrokeWidthProfile(stroke.pressureProfile)
      : normalizeStrokeWidthProfile(changes.pressureProfile),
  };
}

export function cloneLineStrokes(strokes) {
  return strokes.map(stroke => ({
    ...stroke,
    points: stroke.points.map(point => ({ ...point })),
    ...(Array.isArray(stroke.pressureProfile) ? { pressureProfile: [...stroke.pressureProfile] } : {}),
    ...(stroke.bezierPath ? { bezierPath: cloneBezierPath(stroke.bezierPath) } : {}),
  }));
}


/** Return the closest point and segment index for an editable vector path. */
export function projectPointToLineStroke(stroke, point) {
  if (!stroke?.points || stroke.points.length < 2) return null;
  const path = sampleStrokePath(stroke);
  let best = { distance: Infinity, segmentIndex: -1, renderedSegmentIndex: -1, point: null, t: 0 };
  for (let index = 0; index < path.points.length - 1; index++) {
    const a = path.points[index], b = path.points[index + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared
      ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared))
      : 0;
    const projected = { x: a.x + dx * t, y: a.y + dy * t };
    const distance = Math.hypot(point.x - projected.x, point.y - projected.y);
    if (distance < best.distance) {
      best = {
        distance,
        segmentIndex: path.segmentIndices[index],
        renderedSegmentIndex: index,
        point: projected,
        t,
      };
    }
  }
  return best;
}

/** Insert a node at the nearest segment projection without changing stroke identity. */
export function insertLineStrokePoint(stroke, point) {
  if (!stroke?.points || stroke.points.length < 2) return stroke;
  const projection = projectPointToLineStroke(stroke, point);
  if (!projection) return stroke;
  const points = stroke.points.map(item => ({ ...item }));
  const left = stroke.points[projection.segmentIndex];
  const right = stroke.points[projection.segmentIndex + 1];
  const pressure = (left.pressure ?? 0.5) + ((right.pressure ?? 0.5) - (left.pressure ?? 0.5)) * projection.t;
  points.splice(projection.segmentIndex + 1, 0, { ...projection.point, pressure });
  return { ...stroke, bezierPath: undefined, points };
}

/** Remove a node while always retaining the two endpoints of a valid stroke. */
export function removeLineStrokePoint(stroke, pointIndex) {
  if (!stroke?.points || stroke.points.length <= 2) return stroke;
  const index = Math.floor(Number(pointIndex));
  if (!Number.isInteger(index) || index <= 0 || index >= stroke.points.length - 1) return stroke;
  const points = stroke.points.filter((_, point) => point !== index).map(item => ({ ...item }));
  return { ...stroke, bezierPath: undefined, points };
}

/**
 * Smooth a polyline with Catmull-Rom interpolation. The output remains a
 * polyline for compatibility with existing renderers and editable node tools.
 */
export function smoothLineStroke(stroke, subdivisions = 5, tension = 0.5) {
  if (!stroke?.points || stroke.points.length < 3) return stroke;
  const steps = Math.max(2, Math.min(16, Math.floor(Number(subdivisions) || 5)));
  const alpha = Math.max(0, Math.min(1, Number(tension) || 0));
  const source = stroke.points;
  const points = [{ ...source[0] }];
  for (let index = 0; index < source.length - 1; index++) {
    const p0 = source[Math.max(0, index - 1)];
    const p1 = source[index];
    const p2 = source[index + 1];
    const p3 = source[Math.min(source.length - 1, index + 2)];
    const m1x = (p2.x - p0.x) * alpha * 0.5;
    const m1y = (p2.y - p0.y) * alpha * 0.5;
    const m2x = (p3.x - p1.x) * alpha * 0.5;
    const m2y = (p3.y - p1.y) * alpha * 0.5;
    for (let step = 1; step <= steps; step++) {
      const t = step / steps, t2 = t * t, t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1;
      const h10 = t3 - 2 * t2 + t;
      const h01 = -2 * t3 + 3 * t2;
      const h11 = t3 - t2;
      points.push({
        x: h00 * p1.x + h10 * m1x + h01 * p2.x + h11 * m2x,
        y: h00 * p1.y + h10 * m1y + h01 * p2.y + h11 * m2y,
        pressure: (p1.pressure ?? 0.5) + ((p2.pressure ?? 0.5) - (p1.pressure ?? 0.5)) * t,
      });
    }
  }
  points[points.length - 1] = { ...source.at(-1) };
  return { ...stroke, bezierPath: undefined, points };
}


/** Restore an in-progress vector edit from its serialized pre-drag snapshot. */
export function restoreLineStrokeSnapshot(strokes, snapshot) {
  if (!Array.isArray(strokes) || typeof snapshot !== 'string') return false;
  let restored;
  try {
    restored = JSON.parse(snapshot);
  } catch {
    return false;
  }
  if (!Array.isArray(restored)) return false;
  strokes.splice(0, strokes.length, ...restored);
  return true;
}

/** Detect whether an in-progress vector edit changed geometry or style. */
export function lineStrokeSnapshotChanged(strokes, snapshot) {
  if (!Array.isArray(strokes) || typeof snapshot !== 'string') return false;
  try {
    return JSON.stringify(strokes) !== snapshot;
  } catch {
    return true;
  }
}
