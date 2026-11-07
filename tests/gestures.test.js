import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyMultiTouchTap, pinchViewport, snapViewportRotation } from '../apps/web/src/viewport/gestures.js';

const close = (actual, expected, epsilon = 1e-6) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} ≈ ${expected}`);

// Maps a layout-local offset from the element center to screen space using the
// same CSS transform order as the app: translate → rotate → scale (about center).
function project(viewport, layoutCenter, local) {
  const r = viewport.rotation * Math.PI / 180;
  const sx = local.x * viewport.scale;
  const sy = local.y * viewport.scale;
  return {
    x: layoutCenter.x + viewport.x + sx * Math.cos(r) - sy * Math.sin(r),
    y: layoutCenter.y + viewport.y + sx * Math.sin(r) + sy * Math.cos(r),
  };
}

test('two-finger drag pans without zooming or rotating', () => {
  const viewport = { scale: 1, rotation: 0, x: 0, y: 0 };
  const next = pinchViewport(viewport,
    [{ x: 100, y: 100 }, { x: 200, y: 100 }],
    [{ x: 130, y: 140 }, { x: 230, y: 140 }],
    { x: 400, y: 300 });
  close(next.scale, 1);
  close(next.rotation, 0);
  close(next.x, 30);
  close(next.y, 40);
});

test('pinch keeps the canvas point under the finger midpoint fixed', () => {
  const layoutCenter = { x: 400, y: 300 };
  const viewport = { scale: 1.5, rotation: 20, x: 35, y: -12 };
  const center = { x: layoutCenter.x + viewport.x, y: layoutCenter.y + viewport.y };
  const previous = [{ x: 250, y: 220 }, { x: 390, y: 260 }];
  const current = [{ x: 230, y: 200 }, { x: 430, y: 300 }];
  const next = pinchViewport(viewport, previous, current, center);
  assert.ok(next.scale > viewport.scale);

  // Recover the local point under the previous midpoint, then project it with the new viewport.
  const m0 = { x: 320, y: 240 };
  const r = viewport.rotation * Math.PI / 180;
  const dx = m0.x - center.x;
  const dy = m0.y - center.y;
  const local = {
    x: (dx * Math.cos(r) + dy * Math.sin(r)) / viewport.scale,
    y: (-dx * Math.sin(r) + dy * Math.cos(r)) / viewport.scale,
  };
  const projected = project(next, layoutCenter, local);
  close(projected.x, 330, 1e-6);
  close(projected.y, 250, 1e-6);
});

test('pinch scale is clamped and degenerate touches are ignored', () => {
  const viewport = { scale: 1, rotation: 0, x: 0, y: 0 };
  const huge = pinchViewport(viewport, [{ x: 0, y: 0 }, { x: 10, y: 0 }], [{ x: 0, y: 0 }, { x: 1000, y: 0 }], { x: 0, y: 0 });
  assert.equal(huge.scale, 6);
  const same = pinchViewport(viewport, [{ x: 5, y: 5 }, { x: 5, y: 5 }], [{ x: 0, y: 0 }, { x: 100, y: 0 }], { x: 0, y: 0 });
  assert.deepEqual(same, viewport);
});

test('rotation snaps near right angles only', () => {
  assert.equal(snapViewportRotation(4), 0);
  assert.equal(snapViewportRotation(-87), -90);
  assert.equal(snapViewportRotation(30), 30);
});

test('quick multi-finger taps map to undo and redo', () => {
  assert.equal(classifyMultiTouchTap({ fingers: 2, durationMs: 120, maxTravel: 3 }), 'undo');
  assert.equal(classifyMultiTouchTap({ fingers: 3, durationMs: 200, maxTravel: 8 }), 'redo');
  assert.equal(classifyMultiTouchTap({ fingers: 2, durationMs: 600, maxTravel: 3 }), null);
  assert.equal(classifyMultiTouchTap({ fingers: 2, durationMs: 100, maxTravel: 40 }), null);
  assert.equal(classifyMultiTouchTap({ fingers: 4, durationMs: 100, maxTravel: 0 }), null);
});
