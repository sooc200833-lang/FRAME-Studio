import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyBrushTexture,
  coalescedPointerEvents,
  createBrushTextureMarks,
  getBrushPreset,
  listBrushPresets,
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


test('brush presets expose distinct, stable drawing profiles', () => {
  const presets = listBrushPresets();
  assert.deepEqual(presets.map(item => item.id), ['pencil', 'ink', 'marker', 'brush']);
  assert.ok(getBrushPreset('marker').sizeMultiplier > getBrushPreset('ink').sizeMultiplier);
  assert.ok(getBrushPreset('marker').opacity < getBrushPreset('ink').opacity);
  assert.equal(getBrushPreset('unknown'), getBrushPreset('ink'));
});

test('preset choice changes generated brush geometry', () => {
  const samples = [
    { x: 0, y: 0, pressure: 0.6 },
    { x: 20, y: 0, pressure: 0.6 },
    { x: 40, y: 0, pressure: 0.6 },
  ];
  const pencil = createBrushOutline(samples, { size: 12, stylus: true, preset: 'pencil' });
  const marker = createBrushOutline(samples, { size: 12, stylus: true, preset: 'marker' });
  assert.ok(outlineThickness(marker) > outlineThickness(pencil));
});


test('pencil texture produces deterministic grain marks', () => {
  const samples = [{ x: 0, y: 0 }, { x: 40, y: 0 }];
  const first = createBrushTextureMarks(samples, { preset: 'pencil', size: 8 });
  const second = createBrushTextureMarks(samples, { preset: 'pencil', size: 8 });
  assert.ok(first.length > 0);
  assert.deepEqual(first, second);
  assert.ok(first.every(mark => mark.type === 'grain' && mark.radius > 0));
});

test('marker and brush textures use different directional marks', () => {
  const samples = [{ x: 0, y: 0 }, { x: 80, y: 12 }];
  const marker = createBrushTextureMarks(samples, { preset: 'marker', size: 14 });
  const brush = createBrushTextureMarks(samples, { preset: 'brush', size: 14 });
  assert.ok(marker.length > 0 && brush.length > 0);
  assert.ok(marker.every(mark => mark.type === 'band'));
  assert.ok(brush.every(mark => mark.type === 'bristle'));
  assert.notDeepEqual(marker, brush);
});

test('ink preset does not add artificial surface texture', () => {
  assert.deepEqual(createBrushTextureMarks([{ x: 0, y: 0 }, { x: 20, y: 0 }], { preset: 'ink' }), []);
});

test('texture painting clips marks to the brush outline and restores context', () => {
  const calls = [];
  const stateStack = [];
  const context = {
    globalAlpha: 0.6,
    save() { stateStack.push(this.globalAlpha); calls.push('save'); },
    restore() { this.globalAlpha = stateStack.pop(); calls.push('restore'); },
    beginPath() { calls.push('beginPath'); },
    moveTo() {},
    lineTo() {},
    closePath() {},
    clip() { calls.push('clip'); },
    ellipse() {},
    fill() { calls.push('fill'); },
    stroke() { calls.push('stroke'); },
  };
  const outline = [[0, 0], [30, 0], [30, 10], [0, 10]];
  const count = applyBrushTexture(context, outline, [{ x: 0, y: 5 }, { x: 30, y: 5 }], { preset: 'pencil', size: 6 });
  assert.ok(count > 0);
  assert.ok(calls.includes('clip'));
  assert.equal(calls[0], 'save');
  assert.equal(calls.at(-1), 'restore');
  assert.equal(context.globalAlpha, 0.6);
});
