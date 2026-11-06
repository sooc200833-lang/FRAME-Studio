import test from 'node:test';
import assert from 'node:assert/strict';
import { BRUSH_BLEND_MODES, normalizeBrushBlendMode, toPixiBrushBlendMode } from '../apps/web/src/brush/blend-modes.js';

test('brush blend modes are restricted to supported canvas and Pixi modes', () => {
  assert.deepEqual(BRUSH_BLEND_MODES, ['source-over', 'multiply', 'screen', 'overlay']);
  for (const mode of BRUSH_BLEND_MODES) assert.equal(normalizeBrushBlendMode(mode), mode);
});

test('default canvas compositing maps to Pixi normal blend mode', () => {
  assert.equal(toPixiBrushBlendMode('source-over'), 'normal');
  assert.equal(toPixiBrushBlendMode('multiply'), 'multiply');
  assert.equal(toPixiBrushBlendMode('screen'), 'screen');
  assert.equal(toPixiBrushBlendMode('overlay'), 'overlay');
});

test('unknown brush blend modes safely fall back to normal compositing', () => {
  assert.equal(normalizeBrushBlendMode('unsupported'), 'source-over');
  assert.equal(toPixiBrushBlendMode('unsupported'), 'normal');
});
