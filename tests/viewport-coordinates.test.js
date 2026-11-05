import test from 'node:test';
import assert from 'node:assert/strict';
import { clientToCanvasPoint, parseCssTransformMatrix } from '../apps/web/src/viewport/coordinates.js';

test('identity transform maps CSS canvas coordinates into logical pixels', () => {
  const point = clientToCanvasPoint({ clientX: 350, clientY: 250 }, {
    rect: { left: 100, top: 50, width: 500, height: 400 },
    elementWidth: 500,
    elementHeight: 400,
    canvasWidth: 1200,
    canvasHeight: 900,
  });
  assert.deepEqual(point, { x: 600, y: 450 });
});

test('CSS matrix parsing supports none, matrix and matrix3d', () => {
  assert.deepEqual(parseCssTransformMatrix('none'), { a: 1, b: 0, c: 0, d: 1 });
  assert.deepEqual(parseCssTransformMatrix('matrix(0, 2, -2, 0, 0, 0)'), { a: 0, b: 2, c: -2, d: 0 });
  assert.deepEqual(parseCssTransformMatrix('matrix3d(0, 2, 0, 0, -2, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)'), { a: 0, b: 2, c: -2, d: 0 });
});

test('inverse CSS transform maps rotated and scaled pointer positions to the same canvas point', () => {
  const angle = Math.PI / 4;
  const scale = 1.7;
  const a = Math.cos(angle) * scale;
  const b = Math.sin(angle) * scale;
  const c = -Math.sin(angle) * scale;
  const d = Math.cos(angle) * scale;
  const width = 1200, height = 900;
  const local = { x: 250, y: 310 };
  const dx = local.x - width / 2;
  const dy = local.y - height / 2;
  const center = { x: 900, y: 700 };
  const event = {
    clientX: center.x + a * dx + c * dy,
    clientY: center.y + b * dx + d * dy,
  };
  const point = clientToCanvasPoint(event, {
    rect: { left: center.x - 1000, top: center.y - 1000, width: 2000, height: 2000 },
    elementWidth: width,
    elementHeight: height,
    canvasWidth: width,
    canvasHeight: height,
    matrix: { a, b, c, d },
  });
  assert.deepEqual(point, local);
});

test('singular transform falls back safely and coordinates stay inside canvas', () => {
  const point = clientToCanvasPoint({ clientX: -1000, clientY: 3000 }, {
    rect: { left: 0, top: 0, width: 500, height: 400 },
    elementWidth: 500,
    elementHeight: 400,
    canvasWidth: 1200,
    canvasHeight: 900,
    matrix: { a: 0, b: 0, c: 0, d: 0 },
  });
  assert.deepEqual(point, { x: 0, y: 899 });
});
