export function normalizeSelectionRect(start, end) {
  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  return {
    x: left,
    y: top,
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

export function containsSelectionPoint(rect, point, padding = 0) {
  if (!rect) return false;
  return point.x >= rect.x - padding
    && point.y >= rect.y - padding
    && point.x <= rect.x + rect.width + padding
    && point.y <= rect.y + rect.height + padding;
}

export function moveSelectionRect(rect, dx, dy, bounds) {
  if (!rect) return null;
  const x = Math.max(0, Math.min(bounds.width - rect.width, rect.x + dx));
  const y = Math.max(0, Math.min(bounds.height - rect.height, rect.y + dy));
  return { ...rect, x, y };
}

export function resizeSelectionRect(rect, point, bounds, minSize = 2) {
  if (!rect) return null;
  const right = Math.max(rect.x + minSize, Math.min(bounds.width, point.x));
  const bottom = Math.max(rect.y + minSize, Math.min(bounds.height, point.y));
  return { ...rect, width: right - rect.x, height: bottom - rect.y };
}

export function pointInPolygon(point, polygon) {
  if (!polygon || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    const crosses = (a.y > point.y) !== (b.y > point.y)
      && point.x < ((b.x - a.x) * (point.y - a.y)) / ((b.y - a.y) || Number.EPSILON) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function translatePolygon(polygon, dx, dy, bounds) {
  if (!polygon) return [];
  const xs = polygon.map(point => point.x);
  const ys = polygon.map(point => point.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const clampedX = Math.max(-minX, Math.min(bounds.width - maxX, dx));
  const clampedY = Math.max(-minY, Math.min(bounds.height - maxY, dy));
  return polygon.map(point => ({ x: point.x + clampedX, y: point.y + clampedY }));
}

export function transformPolygon(polygon, angleDegrees = 0, scale = 1) {
  if (!polygon || polygon.length < 3) return [];
  const center = polygon.reduce((sum, point) => ({
    x: sum.x + point.x / polygon.length,
    y: sum.y + point.y / polygon.length,
  }), { x: 0, y: 0 });
  const angle = angleDegrees * Math.PI / 180;
  const cosine = Math.cos(angle), sine = Math.sin(angle);
  return polygon.map(point => {
    const x = (point.x - center.x) * scale;
    const y = (point.y - center.y) * scale;
    return {
      x: center.x + x * cosine - y * sine,
      y: center.y + x * sine + y * cosine,
    };
  });
}
