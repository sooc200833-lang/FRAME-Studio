import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IDENTITY_AFFINE_MATRIX,
  cloneRasterTransformRecords,
  createRasterTransformRecord,
  createRotationMatrix,
  createScaleMatrix,
  createTranslationMatrix,
  getTransformedBounds,
  invertAffineMatrix,
  multiplyAffineMatrices,
  normalizeAffineMatrix,
  transformAffinePoint,
} from '../apps/web/src/selection/raster-transform.js';

const near = (actual, expected, epsilon = 1e-9) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);

test('normalizes array and Canvas-style affine matrix values', () => {
  assert.deepEqual(normalizeAffineMatrix(), IDENTITY_AFFINE_MATRIX);
  assert.deepEqual(normalizeAffineMatrix({ a: 2, b: 0, c: 0, d: 3, e: 4, f: 5 }), [2, 0, 0, 3, 4, 5]);
  assert.equal(normalizeAffineMatrix([1, 2, 3]), null);
  assert.equal(normalizeAffineMatrix([1, 2, 3, 4, 5, Infinity]), null);
  assert.equal(normalizeAffineMatrix([1, 2, 3, 4, 5, null]), null);
  assert.equal(normalizeAffineMatrix([1, 2, 3, 4, 5, '']), null);
});

test('maps points through translation and non-uniform scale', () => {
  assert.deepEqual(transformAffinePoint(createTranslationMatrix(12, -4), { x: 3, y: 7 }), { x: 15, y: 3 });
  assert.deepEqual(transformAffinePoint(createScaleMatrix(2, 3), { x: 3, y: 7 }), { x: 6, y: 21 });
});

test('keeps a scale anchored at its supplied origin', () => {
  const matrix = createScaleMatrix(2, 0.5, { x: 10, y: 20 });
  assert.deepEqual(transformAffinePoint(matrix, { x: 10, y: 20 }), { x: 10, y: 20 });
  assert.deepEqual(transformAffinePoint(matrix, { x: 12, y: 24 }), { x: 14, y: 22 });
});

test('rotates around an arbitrary center without moving the center', () => {
  const matrix = createRotationMatrix(90, { x: 10, y: 20 });
  const center = transformAffinePoint(matrix, { x: 10, y: 20 });
  near(center.x, 10);
  near(center.y, 20);
  const rotated = transformAffinePoint(matrix, { x: 12, y: 20 });
  near(rotated.x, 10);
  near(rotated.y, 22);
});

test('composes affine matrices in application order', () => {
  const translate = createTranslationMatrix(10, 5);
  const scale = createScaleMatrix(2, 3);
  const combined = multiplyAffineMatrices(translate, scale);
  assert.deepEqual(transformAffinePoint(combined, { x: 4, y: 2 }), { x: 18, y: 11 });
});

test('inverts affine matrices and rejects singular transforms', () => {
  const matrix = multiplyAffineMatrices(
    createTranslationMatrix(14, -8),
    multiplyAffineMatrices(createRotationMatrix(32, { x: 3, y: 9 }), createScaleMatrix(2, 0.75)),
  );
  const inverse = invertAffineMatrix(matrix);
  const point = { x: 23.5, y: -4.25 };
  const roundTrip = transformAffinePoint(inverse, transformAffinePoint(matrix, point));
  near(roundTrip.x, point.x);
  near(roundTrip.y, point.y);
  assert.equal(invertAffineMatrix([1, 0, 2, 0, 3, 4]), null);
});

test('computes bounds after rotation and scale', () => {
  const points = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 0, y: 10 }];
  const bounds = getTransformedBounds(points, createRotationMatrix(90, { x: 10, y: 5 }));
  near(bounds.x, 5);
  near(bounds.y, -5);
  near(bounds.width, 10);
  near(bounds.height, 20);
  assert.equal(getTransformedBounds([], IDENTITY_AFFINE_MATRIX), null);
});

test('creates validated serializable raster transform records', () => {
  const record = createRasterTransformRecord({
    id: 'transform-1',
    sourceDataUrl: 'data:image/png;base64,AA==',
    clipPolygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
    matrix: createTranslationMatrix(5, 8),
  });
  assert.deepEqual(record, {
    id: 'transform-1',
    sourceDataUrl: 'data:image/png;base64,AA==',
    clipPolygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
    matrix: [1, 0, 0, 1, 5, 8],
  });
  assert.equal(createRasterTransformRecord({ ...record, matrix: [1, 0, 0] }), null);
  assert.equal(createRasterTransformRecord({ ...record, clipPolygon: [{ x: 0, y: 0 }] }), null);
});

test('clones transform records deeply and skips invalid entries', () => {
  const source = createRasterTransformRecord({
    id: 'transform-1',
    sourceDataUrl: 'data:image/png;base64,AA==',
    clipPolygon: [{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 6 }],
    matrix: IDENTITY_AFFINE_MATRIX,
  });
  const cloned = cloneRasterTransformRecords([source, null, { id: 'bad' }]);
  assert.equal(cloned.length, 1);
  cloned[0].clipPolygon[0].x = 999;
  cloned[0].matrix[0] = 999;
  assert.equal(source.clipPolygon[0].x, 1);
  assert.equal(source.matrix[0], 1);
});

test('composes a transform by clearing its source polygon and drawing its snapshot with a matrix', async () => {
  const { composeRasterTransformStack } = await import('../apps/web/src/selection/raster-transform.js');
  const calls = [];
  const context = {
    save() { calls.push(['save']); },
    restore() { calls.push(['restore']); },
    setTransform(...matrix) { calls.push(['setTransform', ...matrix]); },
    clearRect(...rect) { calls.push(['clearRect', ...rect]); },
    drawImage(image, ...args) { calls.push(['drawImage', image.name, ...args]); },
    beginPath() { calls.push(['beginPath']); },
    moveTo(...point) { calls.push(['moveTo', ...point]); },
    lineTo(...point) { calls.push(['lineTo', ...point]); },
    closePath() { calls.push(['closePath']); },
    clip() { calls.push(['clip']); },
  };
  const output = { width: 32, height: 24, getContext: () => context };
  const base = { width: 32, height: 24, name: 'base' };
  const source = { width: 32, height: 24, name: 'source' };
  const record = createRasterTransformRecord({
    id: 'transform-1',
    sourceDataUrl: 'data:image/png;base64,AA==',
    clipPolygon: [{ x: 2, y: 3 }, { x: 12, y: 3 }, { x: 12, y: 13 }],
    matrix: [1, 0, 0, 1, 5, 7],
  });
  record.sourceCanvas = source;
  assert.equal(composeRasterTransformStack(base, [record], output), output);
  assert.ok(calls.some(call => call[0] === 'drawImage' && call[1] === 'base'));
  assert.ok(calls.some(call => call[0] === 'clearRect' && call[1] === 0 && call[2] === 0 && call[3] === 32 && call[4] === 24));
  assert.ok(calls.some(call => call[0] === 'setTransform' && call[1] === 1 && call[5] === 5 && call[6] === 7));
  assert.ok(calls.some(call => call[0] === 'drawImage' && call[1] === 'source'));
});
