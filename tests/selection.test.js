import test from 'node:test';
import assert from 'node:assert/strict';
import { containsSelectionPoint, moveSelectionRect, normalizeSelectionRect, pointInPolygon, resizeSelectionRect, translatePolygon } from '../apps/web/src/selection/selection.js';

test('normalizes a drag rectangle in any direction', () => {
  assert.deepEqual(normalizeSelectionRect({ x: 90, y: 80 }, { x: 10, y: 20 }), { x: 10, y: 20, width: 80, height: 60 });
});

test('hit tests points within the selected bounds', () => {
  const rect = { x: 10, y: 20, width: 80, height: 60 };
  assert.equal(containsSelectionPoint(rect, { x: 20, y: 30 }), true);
  assert.equal(containsSelectionPoint(rect, { x: 100, y: 90 }), false);
});

test('moves a selection while clamping it to the canvas', () => {
  const rect = { x: 10, y: 20, width: 80, height: 60 };
  assert.deepEqual(moveSelectionRect(rect, 50, 70, { width: 120, height: 100 }), { x: 40, y: 40, width: 80, height: 60 });
});

test('resizes a selection from its top-left corner and clamps to canvas', () => {
  const rect = { x: 10, y: 20, width: 30, height: 20 };
  assert.deepEqual(resizeSelectionRect(rect, { x: 100, y: 90 }, { width: 80, height: 70 }), { x: 10, y: 20, width: 70, height: 50 });
});

test('detects points inside and outside a freeform polygon', () => {
  const polygon = [{ x: 10, y: 10 }, { x: 70, y: 15 }, { x: 55, y: 65 }, { x: 20, y: 55 }];
  assert.equal(pointInPolygon({ x: 30, y: 30 }, polygon), true);
  assert.equal(pointInPolygon({ x: 90, y: 90 }, polygon), false);
  assert.equal(pointInPolygon({ x: 1, y: 1 }, [{ x: 0, y: 0 }, { x: 1, y: 1 }]), false);
});

test('translates freeform polygon while keeping it inside canvas bounds', () => {
  const polygon = [{ x: 10, y: 10 }, { x: 40, y: 10 }, { x: 30, y: 40 }];
  assert.deepEqual(translatePolygon(polygon, 100, 100, { width: 80, height: 70 }), [
    { x: 50, y: 40 }, { x: 80, y: 40 }, { x: 70, y: 70 },
  ]);
});
