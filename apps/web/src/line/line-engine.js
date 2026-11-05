export function createLineStroke({ id, points, color = '#24242a', width = 7 }) {
  if (!id) throw new TypeError('A stable line id is required.');
  if (!Array.isArray(points) || points.length < 2) throw new RangeError('A line needs at least two points.');
  return {
    id,
    points: points.map(point => ({ x: Number(point.x), y: Number(point.y) })),
    color,
    width: Math.max(0.5, Number(width) || 1),
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

export function hitTestLineStroke(stroke, point, tolerance = 8) {
  if (!stroke || !Array.isArray(stroke.points) || stroke.points.length < 2) return false;
  const threshold = Math.max(0, Number(tolerance) || 0) + Math.max(0, Number(stroke.width) || 0) / 2;
  for (let index = 1; index < stroke.points.length; index++) {
    if (pointSegmentDistance(point, stroke.points[index - 1], stroke.points[index]) <= threshold) return true;
  }
  return false;
}

export function hitTestLineStrokes(strokes, point, tolerance = 8) {
  for (let index = strokes.length - 1; index >= 0; index--) {
    if (hitTestLineStroke(strokes[index], point, tolerance)) return strokes[index];
  }
  return null;
}

export function translateLineStroke(stroke, dx, dy) {
  return {
    ...stroke,
    points: stroke.points.map(point => ({ x: point.x + dx, y: point.y + dy })),
  };
}

export function updateLineStrokeStyle(stroke, changes) {
  return {
    ...stroke,
    color: changes.color ?? stroke.color,
    width: changes.width === undefined ? stroke.width : Math.max(0.5, Number(changes.width) || 0.5),
  };
}

export function cloneLineStrokes(strokes) {
  return strokes.map(stroke => ({
    ...stroke,
    points: stroke.points.map(point => ({ x: point.x, y: point.y })),
  }));
}

/**
 * Smooth a vector stroke with Chaikin corner cutting.
 * Endpoints remain fixed; each iteration replaces interior corners with
 * two weighted points, producing a softer editable polyline.
 */
export function smoothLineStroke(stroke, iterations = 1) {
  if (!stroke || !Array.isArray(stroke.points) || stroke.points.length < 3) return stroke;
  const count = Math.max(1, Math.min(4, Math.floor(Number(iterations) || 1)));
  let points = stroke.points.map(point => ({ x: point.x, y: point.y }));
  for (let pass = 0; pass < count; pass++) {
    const next = [points[0]];
    for (let index = 0; index < points.length - 1; index++) {
      const a = points[index], b = points[index + 1];
      next.push(
        { x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 },
        { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 },
      );
    }
    next.push(points[points.length - 1]);
    points = next;
  }
  return { ...stroke, points };
}

function pointLineDistance(point, start, end) {
  const dx = end.x - start.x, dy = end.y - start.y;
  const length = dx * dx + dy * dy;
  if (!length) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / length));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

/** Reduce redundant vector nodes with the Ramer-Douglas-Peucker algorithm. */
export function simplifyLineStroke(stroke, tolerance = 1.5) {
  if (!stroke || !Array.isArray(stroke.points) || stroke.points.length <= 2) return stroke;
  const epsilon = Math.max(0, Number(tolerance) || 0);
  const points = stroke.points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop();
    let maxDistance = epsilon, maxIndex = -1;
    for (let index = start + 1; index < end; index++) {
      const distance = pointLineDistance(points[index], points[start], points[end]);
      if (distance > maxDistance) { maxDistance = distance; maxIndex = index; }
    }
    if (maxIndex >= 0) {
      keep[maxIndex] = 1;
      stack.push([start, maxIndex], [maxIndex, end]);
    }
  }
  return { ...stroke, points: points.filter((_, index) => keep[index]).map(point => ({ x: point.x, y: point.y })) };
}
