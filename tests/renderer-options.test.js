import test from 'node:test';
import assert from 'node:assert/strict';
import { createRendererInitOptions, RENDERER_BACKEND_ORDER } from '../apps/web/src/renderer/renderer-options.js';

test('renderer fallback order prefers WebGL and keeps Canvas as the final fallback', () => {
  assert.deepEqual(RENDERER_BACKEND_ORDER, ['webgl', 'webgpu', 'canvas']);
});

test('renderer options explicitly select one backend per initialization attempt', () => {
  for (const backend of RENDERER_BACKEND_ORDER) {
    const options = createRendererInitOptions({ width: 1200, height: 900, backend });
    assert.deepEqual(options.preference, [backend]);
    assert.equal(options.width, 1200);
    assert.equal(options.height, 900);
  }
});

test('renderer resolution is bounded for high-density mobile displays', () => {
  assert.equal(createRendererInitOptions({ devicePixelRatio: 3, backend: 'webgl' }).resolution, 2);
  assert.equal(createRendererInitOptions({ devicePixelRatio: 1.25, backend: 'webgl' }).resolution, 1.25);
  assert.equal(createRendererInitOptions({ devicePixelRatio: 0, backend: 'webgl' }).resolution, 1);
});

test('unknown renderer backends are rejected', () => {
  assert.throws(() => createRendererInitOptions({ backend: 'unknown' }), RangeError);
});
