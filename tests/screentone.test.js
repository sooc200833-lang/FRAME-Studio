import test from 'node:test';
import assert from 'node:assert/strict';
import { getScreentoneAngles, getScreentoneDotRadius, normalizeScreentoneSettings } from '../apps/web/src/tone/screentone.js';

test('normalizes screentone settings and clamps unsafe ranges', () => {
  assert.deepEqual(normalizeScreentoneSettings({ pattern: 'dots', spacing: 100, dotSize: 20, angle: -20, opacity: 150, color: '#abcdef' }), {
    pattern: 'dots', spacing: 48, dotSize: 8, angle: 160, opacity: 1, color: '#abcdef',
  });
});

test('uses two distinct screen angles for crosshatch', () => {
  assert.deepEqual(getScreentoneAngles('crosshatch', 15), [15, 60]);
  assert.deepEqual(getScreentoneAngles('lines', 210), [30]);
});

test('gradient dot radius fades toward the canvas edges', () => {
  const center = getScreentoneDotRadius({ pattern: 'gradient', dotSize: 4, x: 50, y: 50, width: 100, height: 100 });
  const edge = getScreentoneDotRadius({ pattern: 'gradient', dotSize: 4, x: 100, y: 100, width: 100, height: 100 });
  assert.equal(center, 4);
  assert.ok(edge < center);
  assert.equal(getScreentoneDotRadius({ pattern: 'dots', dotSize: 3 }), 3);
});
