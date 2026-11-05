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
