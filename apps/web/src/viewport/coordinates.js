/**
 * Convert a DOM pointer position into the drawing surface's logical pixel space.
 * The CSS transform matrix is read from the actual element, so the input path
 * cannot drift from the transform currently used to display the canvas.
 */
export function parseCssTransformMatrix(transform = 'none') {
  if (!transform || transform === 'none') {
    return { a: 1, b: 0, c: 0, d: 1 };
  }

  const values = transform.match(/matrix\(([^)]+)\)/);
  if (values) {
    const [a, b, c, d] = values[1].split(',').map(Number);
    if ([a, b, c, d].every(Number.isFinite)) return { a, b, c, d };
  }

  const values3d = transform.match(/matrix3d\(([^)]+)\)/);
  if (values3d) {
    const values = values3d[1].split(',').map(Number);
    const [a, b, c, d] = [values[0], values[1], values[4], values[5]];
    if ([a, b, c, d].every(Number.isFinite)) return { a, b, c, d };
  }

  return { a: 1, b: 0, c: 0, d: 1 };
}

export function clientToCanvasPoint(event, {
  rect,
  elementWidth,
  elementHeight,
  canvasWidth,
  canvasHeight,
  matrix = { a: 1, b: 0, c: 0, d: 1 },
}) {
  const width = Math.max(1, Number(elementWidth) || canvasWidth);
  const height = Math.max(1, Number(elementHeight) || canvasHeight);
  const a = Number(matrix.a), b = Number(matrix.b);
  const c = Number(matrix.c), d = Number(matrix.d);
  const determinant = a * d - b * c;

  // A singular transform cannot be inverted; safely fall back to identity.
  const safe = Number.isFinite(determinant) && Math.abs(determinant) > 1e-8;
  const dx = event.clientX - (rect.left + rect.width / 2);
  const dy = event.clientY - (rect.top + rect.height / 2);
  const localDx = safe ? (d * dx - c * dy) / determinant : dx;
  const localDy = safe ? (-b * dx + a * dy) / determinant : dy;
  const localX = localDx + width / 2;
  const localY = localDy + height / 2;

  return {
    x: Math.max(0, Math.min(canvasWidth - 1, Math.floor(localX * canvasWidth / width + 1e-6))),
    y: Math.max(0, Math.min(canvasHeight - 1, Math.floor(localY * canvasHeight / height + 1e-6))),
  };
}


/**
 * Convert a desired CSS-pixel interaction size into logical canvas units.
 * This keeps handles and hit targets visually stable at every zoom level.
 */
export function canvasUnitsPerCssPixel(elementWidth, canvasWidth, zoom = 1) {
  const width = Math.max(1, Number(elementWidth) || Number(canvasWidth) || 1);
  const logicalWidth = Math.max(1, Number(canvasWidth) || 1);
  const requestedScale = Number(zoom);
  const scale = Number.isFinite(requestedScale) && requestedScale > 0 ? requestedScale : 1;
  return width * scale / logicalWidth;
}
