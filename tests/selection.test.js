import test from 'node:test';
import assert from 'node:assert/strict';
import { containsSelectionPoint, moveSelectionRect, normalizeSelectionRect, resizeSelectionRect } from '../apps/web/src/selection/selection.js';

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
