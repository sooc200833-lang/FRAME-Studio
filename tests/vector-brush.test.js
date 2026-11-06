import test from 'node:test';
import assert from 'node:assert/strict';
import { createVectorBrushStyle, getVectorBrushPreset, getVectorPointWidth, normalizeVectorPressure } from '../apps/web/src/line/vector-brush.js';

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
