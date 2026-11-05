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

export function resolveSelectionTargets(layers, selectedLayers, activeLayer) {
  if (selectedLayers?.size) return layers.filter(layer => selectedLayers.has(layer));
  return activeLayer && layers.includes(activeLayer) ? [activeLayer] : [];
}

function segmentsIntersect(a, b, c, d) {
  const cross = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const onSegment = (p, q, r) =>
    Math.min(p.x, q.x) - 1e-9 <= r.x && r.x <= Math.max(p.x, q.x) + 1e-9 &&
    Math.min(p.y, q.y) - 1e-9 <= r.y && r.y <= Math.max(p.y, q.y) + 1e-9;
  const abC = cross(a, b, c), abD = cross(a, b, d);
  const cdA = cross(c, d, a), cdB = cross(c, d, b);
  if (((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) &&
      ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))) return true;
  return (Math.abs(abC) < 1e-9 && onSegment(a, b, c)) ||
    (Math.abs(abD) < 1e-9 && onSegment(a, b, d)) ||
    (Math.abs(cdA) < 1e-9 && onSegment(c, d, a)) ||
    (Math.abs(cdB) < 1e-9 && onSegment(c, d, b));
}

export function lineStrokeIntersectsPolygon(stroke, polygon) {
  const points = stroke?.points || [];
  if (points.some(point => pointInPolygon(point, polygon))) return true;
  if (points.length < 2 || polygon.length < 3) return false;
  for (let i = 0; i < points.length - 1; i++) {
    for (let j = 0; j < polygon.length; j++) {
      if (segmentsIntersect(points[i], points[i + 1], polygon[j], polygon[(j + 1) % polygon.length])) return true;
    }
  }
  return false;
}

export function transformLineStrokes(strokes, polygon, angleDegrees = 0, scale = 1) {
  const selectedIds = new Set(strokes.filter(stroke => lineStrokeIntersectsPolygon(stroke, polygon)).map(stroke => stroke.id));
  if (!selectedIds.size) return strokes.map(stroke => ({ ...stroke, points: stroke.points.map(point => ({ ...point })) }));
  const center = polygon.reduce((sum, point) => ({
    x: sum.x + point.x / polygon.length,
    y: sum.y + point.y / polygon.length,
  }), { x: 0, y: 0 });
  const radians = angleDegrees * Math.PI / 180;
  const cos = Math.cos(radians), sin = Math.sin(radians);
  return strokes.map(stroke => selectedIds.has(stroke.id) ? ({
    ...stroke,
    width: stroke.width * scale,
    points: stroke.points.map(point => {
      const x = (point.x - center.x) * scale;
      const y = (point.y - center.y) * scale;
      return {
        x: center.x + x * cos - y * sin,
        y: center.y + x * sin + y * cos,
      };
    }),
  }) : ({ ...stroke, points: stroke.points.map(point => ({ ...point })) }));
}

export function getSelectionRectHandles(rect, rotationOffset = 36) {
  if (!rect || rect.width < 1 || rect.height < 1) return [];
  const { x, y, width, height } = rect;
  const cx = x + width / 2;
  return [
    { id: 'nw', x, y }, { id: 'n', x: cx, y },
    { id: 'ne', x: x + width, y }, { id: 'e', x: x + width, y: y + height / 2 },
    { id: 'se', x: x + width, y: y + height }, { id: 's', x: cx, y: y + height },
    { id: 'sw', x, y: y + height }, { id: 'w', x, y: y + height / 2 },
    { id: 'rotate', x: cx, y: y - rotationOffset },
  ];
}

export function hitTestSelectionHandle(point, rect, radius = 20) {
  for (const handle of getSelectionRectHandles(rect)) {
    if (Math.hypot(point.x - handle.x, point.y - handle.y) <= radius) return handle.id;
  }
  return null;
}

export function resizeSelectionRectFromHandle(rect, handle, point, bounds, minSize = 2) {
  if (!rect || !['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].includes(handle)) return rect;
  let left = rect.x, top = rect.y;
  let right = rect.x + rect.width, bottom = rect.y + rect.height;
  if (handle.includes('w')) left = Math.max(0, Math.min(right - minSize, point.x));
  if (handle.includes('e')) right = Math.min(bounds.width, Math.max(left + minSize, point.x));
  if (handle.includes('n')) top = Math.max(0, Math.min(bottom - minSize, point.y));
  if (handle.includes('s')) bottom = Math.min(bounds.height, Math.max(top + minSize, point.y));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function getSelectionPreviewTransform(originalRect, targetRect = null, rotationDegrees = 0) {
  if (!originalRect || originalRect.width <= 0 || originalRect.height <= 0) return null;
  const target = targetRect || originalRect;
  return {
    center: {
      x: originalRect.x + originalRect.width / 2,
      y: originalRect.y + originalRect.height / 2,
    },
    scaleX: target.width / originalRect.width,
    scaleY: target.height / originalRect.height,
    rotationRadians: rotationDegrees * Math.PI / 180,
  };
}
