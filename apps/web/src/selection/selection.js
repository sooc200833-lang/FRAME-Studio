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
