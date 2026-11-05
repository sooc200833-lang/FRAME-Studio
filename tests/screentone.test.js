import test from 'node:test';
import assert from 'node:assert/strict';
import { getScreentoneAngles, getScreentoneDotRadius, normalizeScreentoneSettings } from '../apps/web/src/tone/screentone.js';

test('normalizes screentone settings and clamps unsafe ranges', () => {
  assert.deepEqual(normalizeScreentoneSettings({ pattern: 'dots', spacing: 100, coverage: 90, angle: -20, opacity: 150, color: '#abcdef' }), {
    pattern: 'dots', spacing: 48, coverage: 70, angle: 160, opacity: 1, color: '#abcdef',
  });
});

test('uses two distinct screen angles for crosshatch', () => {
  assert.deepEqual(getScreentoneAngles('crosshatch', 15), [15, 60]);
  assert.deepEqual(getScreentoneAngles('lines', 210), [30]);
});

test('coverage controls dot radius independently from screen frequency', () => {
  const sparse = getScreentoneDotRadius({ spacing: 12, coverage: 10 });
  const dense = getScreentoneDotRadius({ spacing: 12, coverage: 40 });
  assert.ok(dense > sparse);
  assert.ok(Math.abs((dense * dense) / (12 * 12) * Math.PI - 0.4) < 1e-10);
});

test('spacing changes dot radius at fixed coverage while preserving area ratio', () => {
  const small = getScreentoneDotRadius({ spacing: 8, coverage: 30 });
  const large = getScreentoneDotRadius({ spacing: 24, coverage: 30 });
  assert.equal(large / small, 3);
  for (const [radius, spacing] of [[small, 8], [large, 24]]) {
    assert.ok(Math.abs((radius * radius) / (spacing * spacing) * Math.PI - 0.3) < 1e-10);
  }
});

test('gradient dot radius fades toward the canvas edges', () => {
  const center = getScreentoneDotRadius({ spacing: 12, coverage: 30, x: 50, y: 50, width: 100, height: 100, gradient: true });
  const edge = getScreentoneDotRadius({ spacing: 12, coverage: 30, x: 100, y: 100, width: 100, height: 100, gradient: true });
  assert.equal(center, getScreentoneDotRadius({ spacing: 12, coverage: 30 }));
  assert.ok(edge < center);
});
