import test from 'node:test';
import assert from 'node:assert/strict';
import {
  coalescedPointerEvents,
  createBrushOutline,
  normalizePointerPressure,
  pressureToWidth,
  stabilizePoint,
} from '../apps/web/src/brush/brush-engine.js';

test('mouse and touch use a stable neutral pressure', () => {
  assert.equal(normalizePointerPressure({ pointerType: 'mouse', pressure: 1 }), 0.5);
  assert.equal(normalizePointerPressure({ pointerType: 'touch', pressure: 0.8 }), 0.5);
});

test('pen pressure is clamped and can be disabled', () => {
  assert.equal(normalizePointerPressure({ pointerType: 'pen', pressure: 0.8 }), 0.8);
  assert.equal(normalizePointerPressure({ pointerType: 'pen', pressure: 2 }), 1);
  assert.equal(normalizePointerPressure({ pointerType: 'pen', pressure: 0.8 }, false), 0.5);
});

test('pressure maps to a variable brush width', () => {
  const light = pressureToWidth(10, 0.1);
  const firm = pressureToWidth(10, 0.9);
  assert.ok(light > 0);
  assert.ok(firm > light);
  assert.ok(firm <= 11.8);
});

test('stabilization eases jitter but keeps fast movement responsive', () => {
  const previous = { x: 0, y: 0 };
  const jittered = stabilizePoint(previous, { x: 10, y: 0 }, 0.5);
  const responsive = stabilizePoint(previous, { x: 200, y: 0 }, 0.5);
  assert.ok(jittered.x > 0 && jittered.x < 10);
  assert.ok(responsive.x > jittered.x);
  assert.deepEqual(stabilizePoint(previous, { x: 10, y: 2 }, 0), { x: 10, y: 2 });
});

test('coalesced pointer samples are used when available', () => {
  const samples = [{ x: 1 }, { x: 2 }];
  assert.deepEqual(coalescedPointerEvents({ getCoalescedEvents: () => samples }), samples);
  const event = { x: 3 };
  assert.deepEqual(coalescedPointerEvents(event), [event]);
});

function outlineThickness(points) {
  const ys = points.map(point => point[1]);
  return Math.max(...ys) - Math.min(...ys);
}

test('perfect-freehand creates a closed-area polygon from pointer samples', () => {
  const outline = createBrushOutline([
    { x: 0, y: 0, pressure: 0.5 },
    { x: 20, y: 3, pressure: 0.5 },
    { x: 40, y: 0, pressure: 0.5 },
  ], { size: 12, stylus: true, pressureEnabled: true });
  assert.ok(outline.length > 8);
  assert.ok(outline.every(point => Number.isFinite(point[0]) && Number.isFinite(point[1])));
});

test('stylus pressure changes the generated stroke outline thickness', () => {
  const points = pressure => [
    { x: 0, y: 0, pressure },
    { x: 20, y: 0, pressure },
    { x: 40, y: 0, pressure },
  ];
  const light = createBrushOutline(points(0.12), { size: 18, stylus: true, pressureEnabled: true });
  const firm = createBrushOutline(points(0.92), { size: 18, stylus: true, pressureEnabled: true });
  assert.ok(outlineThickness(firm) > outlineThickness(light));
});

test('disabled stylus pressure keeps a steady-width outline', () => {
  const outline = createBrushOutline([
    { x: 0, y: 0, pressure: 0.1 },
    { x: 20, y: 0, pressure: 0.9 },
    { x: 40, y: 0, pressure: 0.2 },
  ], { size: 12, stylus: true, pressureEnabled: false });
  const thickness = outlineThickness(outline);
  assert.ok(thickness > 8 && thickness < 16);
});
