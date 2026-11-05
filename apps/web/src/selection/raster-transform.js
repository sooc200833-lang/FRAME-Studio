/**
 * Serializable affine transform primitives for non-destructive raster selections.
 *
 * Matrix convention follows CanvasRenderingContext2D.transform():
 * [a, b, c, d, e, f] maps (x, y) to (a*x + c*y + e, b*x + d*y + f).
 */
export const IDENTITY_AFFINE_MATRIX = Object.freeze([1, 0, 0, 1, 0, 0]);
const MATRIX_EPSILON = 1e-12;

function finiteNumber(value) {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizePoint(point) {
  const x = finiteNumber(point?.x);
  const y = finiteNumber(point?.y);
  return x === null || y === null ? null : { x, y };
}

export function normalizeAffineMatrix(value = IDENTITY_AFFINE_MATRIX) {
  const values = Array.isArray(value)
    ? value
    : value && typeof value === 'object'
      ? [value.a, value.b, value.c, value.d, value.e, value.f]
      : null;
  if (!values || values.length !== 6) return null;
  const normalized = values.map(finiteNumber);
  return normalized.some(item => item === null) ? null : normalized;
}

export function multiplyAffineMatrices(leftValue, rightValue) {
  const left = normalizeAffineMatrix(leftValue);
  const right = normalizeAffineMatrix(rightValue);
  if (!left || !right) return null;
  const [a1, b1, c1, d1, e1, f1] = left;
  const [a2, b2, c2, d2, e2, f2] = right;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

export function transformAffinePoint(matrixValue, pointValue) {
  const matrix = normalizeAffineMatrix(matrixValue);
  const point = normalizePoint(pointValue);
  if (!matrix || !point) return null;
  const [a, b, c, d, e, f] = matrix;
  return {
    x: a * point.x + c * point.y + e,
    y: b * point.x + d * point.y + f,
  };
}

export function createTranslationMatrix(x = 0, y = 0) {
  const dx = finiteNumber(x);
  const dy = finiteNumber(y);
  if (dx === null || dy === null) return null;
  return [1, 0, 0, 1, dx, dy];
}

export function createScaleMatrix(scaleX = 1, scaleY = scaleX, origin = { x: 0, y: 0 }) {
  const sx = finiteNumber(scaleX);
  const sy = finiteNumber(scaleY);
  const center = normalizePoint(origin);
  if (sx === null || sy === null || !center) return null;
  return [sx, 0, 0, sy, center.x * (1 - sx), center.y * (1 - sy)];
}

export function createRotationMatrix(degrees = 0, origin = { x: 0, y: 0 }) {
  const angle = finiteNumber(degrees);
  const center = normalizePoint(origin);
  if (angle === null || !center) return null;
  const radians = angle * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return [
    cosine,
    sine,
    -sine,
    cosine,
    center.x - cosine * center.x + sine * center.y,
    center.y - sine * center.x - cosine * center.y,
  ];
}

export function invertAffineMatrix(matrixValue) {
  const matrix = normalizeAffineMatrix(matrixValue);
  if (!matrix) return null;
  const [a, b, c, d, e, f] = matrix;
  const determinant = a * d - b * c;
  if (Math.abs(determinant) <= MATRIX_EPSILON) return null;
  const inverseDeterminant = 1 / determinant;
  const inverseA = d * inverseDeterminant;
  const inverseB = -b * inverseDeterminant;
  const inverseC = -c * inverseDeterminant;
  const inverseD = a * inverseDeterminant;
  return [
    inverseA,
    inverseB,
    inverseC,
    inverseD,
    -(inverseA * e + inverseC * f),
    -(inverseB * e + inverseD * f),
  ];
}

export function getTransformedBounds(points, matrixValue = IDENTITY_AFFINE_MATRIX) {
  if (!Array.isArray(points) || points.length === 0) return null;
  const transformed = points.map(point => transformAffinePoint(matrixValue, point));
  if (transformed.some(point => !point)) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const point of transformed) {
    left = Math.min(left, point.x);
    top = Math.min(top, point.y);
    right = Math.max(right, point.x);
    bottom = Math.max(bottom, point.y);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Create a JSON-safe transform operation.
 * sourceDataUrl stores the untouched selected pixels; clipPolygon identifies
 * where those pixels came from in the layer's prior presentation.
 */
export function createRasterTransformRecord({
  id,
  sourceDataUrl,
  clipPolygon,
  matrix = IDENTITY_AFFINE_MATRIX,
} = {}) {
  if (typeof id !== 'string' || !id.trim()) return null;
  if (typeof sourceDataUrl !== 'string' || !sourceDataUrl.startsWith('data:image/')) return null;
  if (!Array.isArray(clipPolygon) || clipPolygon.length < 3) return null;
  const polygon = clipPolygon.map(normalizePoint);
  const normalizedMatrix = normalizeAffineMatrix(matrix);
  if (polygon.some(point => !point) || !normalizedMatrix) return null;
  return {
    id,
    sourceDataUrl,
    clipPolygon: polygon,
    matrix: normalizedMatrix,
  };
}

export function cloneRasterTransformRecords(records = []) {
  if (!Array.isArray(records)) return [];
  return records
    .map(record => createRasterTransformRecord(record || {}))
    .filter(Boolean);
}

/**
 * Replay serializable transform operations over an untouched layer canvas.
 * Runtime records must provide sourceCanvas decoded from sourceDataUrl.
 * Each operation removes its source polygon from the accumulated result, then
 * draws the untouched source snapshot through its affine matrix.
 */
export function composeRasterTransformStack(baseCanvas, records = [], outputCanvas = baseCanvas) {
  if (!baseCanvas || !outputCanvas || outputCanvas === baseCanvas || !Array.isArray(records)) return null;
  const width = Math.max(1, Math.floor(baseCanvas.width || 1));
  const height = Math.max(1, Math.floor(baseCanvas.height || 1));
  if (outputCanvas.width !== width) outputCanvas.width = width;
  if (outputCanvas.height !== height) outputCanvas.height = height;
  const context = outputCanvas.getContext('2d');
  if (!context) return null;
  context.clearRect(0, 0, width, height);
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalCompositeOperation = 'source-over';
  context.drawImage(baseCanvas, 0, 0);
  context.restore();

  for (const rawRecord of records) {
    const record = createRasterTransformRecord(rawRecord || {});
    const sourceCanvas = rawRecord?.sourceCanvas;
    if (!record || !sourceCanvas) continue;
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.beginPath();
    record.clipPolygon.forEach((point, index) => {
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    });
    context.closePath();
    context.clip();
    context.clearRect(0, 0, width, height);
    context.restore();

    context.save();
    context.setTransform(...record.matrix);
    context.globalCompositeOperation = 'source-over';
    context.drawImage(sourceCanvas, 0, 0);
    context.restore();
  }
  return outputCanvas;
}

/** Bake the currently composed presentation into the source canvas. */
export function rasterizeRasterTransformStack(layer) {
  if (!layer?.canvas || !layer?.presentationCanvas || layer.canvas === layer.presentationCanvas || !Array.isArray(layer.transformRecords)) return false;
  const context = layer.canvas.getContext('2d');
  if (!context) return false;
  context.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
  context.drawImage(layer.presentationCanvas, 0, 0);
  layer.transformRecords = [];
  composeRasterTransformStack(layer.canvas, [], layer.presentationCanvas);
  return true;
}
