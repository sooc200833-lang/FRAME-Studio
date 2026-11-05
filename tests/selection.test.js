import test from 'node:test';
import assert from 'node:assert/strict';
import { containsSelectionPoint, getSelectionRectHandles, hitTestSelectionHandle, moveSelectionRect, normalizeSelectionRect, lineStrokeIntersectsPolygon, pointInPolygon, resizeSelectionRect, resizeSelectionRectFromHandle, resolveSelectionTargets, transformLineStrokes, transformPolygon, translatePolygon } from '../apps/web/src/selection/selection.js';

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

test('rotates a polygon around its centroid', () => {
  const polygon = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 0, y: 10 }];
  const rotated = transformPolygon(polygon, 90, 1);
  const expected = [{ x: 15, y: -5 }, { x: 15, y: 15 }, { x: 5, y: 15 }, { x: 5, y: -5 }];
  rotated.forEach((point, index) => {
    assert.ok(Math.abs(point.x - expected[index].x) < 1e-9);
    assert.ok(Math.abs(point.y - expected[index].y) < 1e-9);
  });
});

test('scales a polygon around its centroid', () => {
  const polygon = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 0, y: 10 }];
  assert.deepEqual(transformPolygon(polygon, 0, 2), [
    { x: -10, y: -5 }, { x: 30, y: -5 }, { x: 30, y: 15 }, { x: -10, y: 15 },
  ]);
});

test('uses checked layers as transform targets, falling back to active layer', () => {
  const lower = { name: 'lower' }, middle = { name: 'middle' }, upper = { name: 'upper' };
  const layers = [lower, middle, upper];
  assert.deepEqual(resolveSelectionTargets(layers, new Set([lower, upper]), middle), [lower, upper]);
  assert.deepEqual(resolveSelectionTargets(layers, new Set(), middle), [middle]);
  assert.deepEqual(resolveSelectionTargets(layers, new Set([{}]), middle), []);
});

test('selects vector strokes that cross a polygon even when endpoints are outside', () => {
  const polygon = [{ x: 10, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 30 }, { x: 10, y: 30 }];
  assert.equal(lineStrokeIntersectsPolygon({ points: [{ x: 0, y: 20 }, { x: 40, y: 20 }] }, polygon), true);
  assert.equal(lineStrokeIntersectsPolygon({ points: [{ x: 0, y: 0 }, { x: 5, y: 5 }] }, polygon), false);
});

test('transforms selected vector strokes and preserves unrelated strokes', () => {
  const polygon = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }];
  const strokes = [
    { id: 'inside', width: 4, color: '#000', points: [{ x: 2, y: 10 }, { x: 8, y: 10 }] },
    { id: 'outside', width: 2, color: '#f00', points: [{ x: 50, y: 50 }, { x: 60, y: 50 }] },
  ];
  const result = transformLineStrokes(strokes, polygon, 90, 2);
  assert.equal(result[0].width, 8);
  assert.ok(Math.abs(result[0].points[0].x - 10) < 1e-9);
  assert.ok(Math.abs(result[0].points[0].y - (-6)) < 1e-9);
  assert.deepEqual(result[1], strokes[1]);
});

test('exposes eight resize handles and a rotation handle with hit testing', () => {
  const rect = { x: 10, y: 20, width: 80, height: 60 };
  const handles = getSelectionRectHandles(rect);
  assert.equal(handles.length, 9);
  assert.deepEqual(handles.find(handle => handle.id === 'rotate'), { id: 'rotate', x: 50, y: -16 });
  assert.equal(hitTestSelectionHandle({ x: 10, y: 20 }, rect), 'nw');
  assert.equal(hitTestSelectionHandle({ x: 50, y: -16 }, rect), 'rotate');
  assert.equal(hitTestSelectionHandle({ x: 50, y: 50 }, rect), null);
});

test('resizes from edges and corners while preserving opposite anchors', () => {
  const rect = { x: 10, y: 20, width: 80, height: 60 };
  assert.deepEqual(resizeSelectionRectFromHandle(rect, 'nw', { x: 0, y: 5 }, { width: 120, height: 100 }), { x: 0, y: 5, width: 90, height: 75 });
  assert.deepEqual(resizeSelectionRectFromHandle(rect, 'e', { x: 110, y: 60 }, { width: 120, height: 100 }), { x: 10, y: 20, width: 100, height: 60 });
  assert.deepEqual(resizeSelectionRectFromHandle(rect, 's', { x: 50, y: 95 }, { width: 120, height: 100 }), { x: 10, y: 20, width: 80, height: 75 });
});

test('clamps resized handles to canvas and enforces a minimum size', () => {
  const rect = { x: 10, y: 20, width: 80, height: 60 };
  assert.deepEqual(resizeSelectionRectFromHandle(rect, 'nw', { x: 500, y: 500 }, { width: 120, height: 100 }), { x: 88, y: 78, width: 2, height: 2 });
});
