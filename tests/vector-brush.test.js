import test from 'node:test';
import assert from 'node:assert/strict';
import { createVectorBrushStyle, getVectorBrushPreset, getVectorPointWidth, normalizeStrokeWidthProfile, sampleStrokeWidthProfile, normalizeVectorPressure } from '../apps/web/src/line/vector-brush.js';

test('vector brush pressure is normalized and bounded', () => {
  assert.equal(normalizeVectorPressure(-1), 0.02);
  assert.equal(normalizeVectorPressure(3), 1);
  assert.equal(normalizeVectorPressure(NaN), 0.5);
});
test('pressure changes vector stroke width according to brush profile', () => {
  const stroke = { width: 10, brushPreset: 'ink', pressureCurve: 1 };
  assert.ok(getVectorPointWidth(stroke, { pressure: 0.9 }, 1) > getVectorPointWidth(stroke, { pressure: 0.2 }, 0));
});
test('vector brush presets have distinct profiles and style is serializable', () => {
  assert.notEqual(getVectorBrushPreset('pencil').pressurePower, getVectorBrushPreset('marker').pressurePower);
  assert.deepEqual(createVectorBrushStyle({ brushPreset: 'dry', motionStyle: 'redraw' }), { brushPreset: 'dry', pressureCurve: 1, opacity: 0.88, motionStyle: 'redraw', motionStrength: 3 });
});

test('stroke width profile is clamped and sampled continuously along the stroke', () => {
  assert.deepEqual(normalizeStrokeWidthProfile([0, 1, 4]), [0.1, 0.5, 1, 2.2, 2.2]);
  assert.equal(sampleStrokeWidthProfile([0.5, 1, 1.5, 1, 0.5], 0.5), 1.5);
  assert.equal(sampleStrokeWidthProfile([1, 2], 0.25), 1.25);
});
test('vector width profile changes the stroke width at the corresponding path position', () => {
  const stroke = { width: 10, brushPreset: 'ink', pressureCurve: 1, pressureProfile: [0.5, 1, 2, 1, 0.5] };
  const start = getVectorPointWidth(stroke, { pressure: 1 }, 0, 5);
  const middle = getVectorPointWidth(stroke, { pressure: 1 }, 2, 5);
  const end = getVectorPointWidth(stroke, { pressure: 1 }, 4, 5);
  assert.ok(middle > start);
  assert.equal(start, end);
});
