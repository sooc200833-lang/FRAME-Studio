import { sampleStrokePath } from '../line/line-engine.js';
import { transformBezierPath } from '../line/bezier-path.js';
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

function pointToSegmentDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= Number.EPSILON) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + dx * t), point.y - (start.y + dy * t));
}

export function lineStrokeIntersectsPolygon(stroke, polygon) {
  const controlPoints = stroke?.points || [];
  if (!Array.isArray(polygon) || polygon.length < 3 || controlPoints.length < 2) return false;
  const points = sampleStrokePath(stroke).points;
  if (points.some(point => pointInPolygon(point, polygon))) return true;

  // A vector stroke is a visible area, not an infinitely thin centerline.
  // Include near misses where its rendered width overlaps the selection edge.
  const radius = Math.max(0, Number(stroke.width) || 0) / 2;
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i], end = points[i + 1];
    for (let j = 0; j < polygon.length; j++) {
      const edgeStart = polygon[j], edgeEnd = polygon[(j + 1) % polygon.length];
      if (segmentsIntersect(start, end, edgeStart, edgeEnd)) return true;
      if (radius > 0 && Math.min(
        pointToSegmentDistance(start, edgeStart, edgeEnd),
        pointToSegmentDistance(end, edgeStart, edgeEnd),
        pointToSegmentDistance(edgeStart, start, end),
        pointToSegmentDistance(edgeEnd, start, end),
      ) <= radius) return true;
    }
  }
  return false;
}

export function transformLineStrokes(strokes, polygon, angleDegrees = 0, scale = 1) {
  const selectedIds = new Set(strokes.filter(stroke => lineStrokeIntersectsPolygon(stroke, polygon)).map(stroke => stroke.id));
  const center = polygon.reduce((sum, point) => ({
    x: sum.x + point.x / polygon.length,
    y: sum.y + point.y / polygon.length,
  }), { x: 0, y: 0 });
  const radians = angleDegrees * Math.PI / 180;
  const cos = Math.cos(radians), sin = Math.sin(radians);
  const matrix = [
    scale * cos, scale * sin, -scale * sin, scale * cos,
    center.x - scale * cos * center.x + scale * sin * center.y,
    center.y - scale * sin * center.x - scale * cos * center.y,
  ];
  return strokes.map(stroke => {
    const selected = selectedIds.has(stroke.id);
    return {
      ...stroke,
      width: selected ? stroke.width * scale : stroke.width,
      points: stroke.points.map(point => selected ? ({
        x: matrix[0] * point.x + matrix[2] * point.y + matrix[4],
        y: matrix[1] * point.x + matrix[3] * point.y + matrix[5],
      }) : ({ ...point })),
      ...(stroke.bezierPath ? {
        bezierPath: transformBezierPath(stroke.bezierPath, selected ? matrix : [1, 0, 0, 1, 0, 0]),
      } : {}),
    };
  });
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

export function getPolygonBounds(polygon) {
  if (!polygon || polygon.length < 3) return null;
  const xs = polygon.map(point => point.x);
  const ys = polygon.map(point => point.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export function getPolygonCentroid(polygon) {
  if (!polygon?.length) return null;
  return polygon.reduce((center, point) => ({
    x: center.x + point.x / polygon.length,
    y: center.y + point.y / polygon.length,
  }), { x: 0, y: 0 });
}

export function getPolygonTransformHandles(polygon, rotationOffset = 36) {
  const bounds = getPolygonBounds(polygon);
  if (!bounds || bounds.width < 1 || bounds.height < 1) return [];
  const { x, y, width, height } = bounds;
  const cx = x + width / 2;
  return [
    { id: 'nw', x, y }, { id: 'n', x: cx, y },
    { id: 'ne', x: x + width, y }, { id: 'e', x: x + width, y: y + height / 2 },
    { id: 'se', x: x + width, y: y + height }, { id: 's', x: cx, y: y + height },
    { id: 'sw', x, y: y + height }, { id: 'w', x, y: y + height / 2 },
    { id: 'rotate', x: cx, y: y - rotationOffset },
  ];
}

export function hitTestPolygonTransformHandle(point, polygon, radius = 20) {
  for (const handle of getPolygonTransformHandles(polygon)) {
    if (Math.hypot(point.x - handle.x, point.y - handle.y) <= radius) return handle.id;
  }
  return null;
}

export function resizePolygonFromHandle(polygon, handle, point, bounds, minSize = 2) {
  const original = getPolygonBounds(polygon);
  if (!original || !['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].includes(handle)) return polygon;
  const target = resizeSelectionRectFromHandle(original, handle, point, bounds, minSize);
  if (!target || original.width <= 0 || original.height <= 0) return polygon;
  const scaleX = target.width / original.width;
  const scaleY = target.height / original.height;
  return polygon.map(vertex => ({
    x: target.x + (vertex.x - original.x) * scaleX,
    y: target.y + (vertex.y - original.y) * scaleY,
  }));
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


/**
 * Apply an affine selection transform to vector strokes intersecting a polygon.
 * Matrix follows the Canvas2D [a, b, c, d, e, f] convention.
 */
export function transformLineStrokesByMatrix(strokes, polygon, matrix) {
  if (!Array.isArray(matrix) || matrix.length !== 6 || !matrix.every(Number.isFinite)) {
    throw new TypeError('A finite six-value affine matrix is required.');
  }
  const [a, b, c, d, e, f] = matrix;
  const determinantScale = Math.sqrt(Math.abs(a * d - b * c));
  const selectedIds = new Set(
    strokes.filter(stroke => lineStrokeIntersectsPolygon(stroke, polygon)).map(stroke => stroke.id),
  );
  return strokes.map(stroke => {
    const points = stroke.points.map(point => selectedIds.has(stroke.id)
      ? { x: a * point.x + c * point.y + e, y: b * point.x + d * point.y + f }
      : { x: point.x, y: point.y });
    const bezierPath = stroke.bezierPath
      ? transformBezierPath(stroke.bezierPath, selectedIds.has(stroke.id) ? matrix : [1, 0, 0, 1, 0, 0])
      : null;
    let widthScale = determinantScale;
    if (selectedIds.has(stroke.id) && stroke.points.length > 1) {
      // Stroke width is perpendicular to the path tangent. Under anisotropic
      // scaling, use the transformed normal instead of a global area scale.
      let weightedScale = 0;
      let totalLength = 0;
      const widthPath = sampleStrokePath(stroke).points;
      for (let index = 0; index < widthPath.length - 1; index++) {
        const start = widthPath[index], end = widthPath[index + 1];
        const dx = end.x - start.x, dy = end.y - start.y;
        const length = Math.hypot(dx, dy);
        if (length <= Number.EPSILON) continue;
        const nx = -dy / length, ny = dx / length;
        const transformedNormalLength = Math.hypot(a * nx + c * ny, b * nx + d * ny);
        weightedScale += transformedNormalLength * length;
        totalLength += length;
      }
      if (totalLength > 0) widthScale = weightedScale / totalLength;
    }
    return {
      ...stroke,
      width: selectedIds.has(stroke.id) ? Math.max(0.5, stroke.width * widthScale) : stroke.width,
      points,
      ...(bezierPath ? { bezierPath } : {}),
    };
  });
}
