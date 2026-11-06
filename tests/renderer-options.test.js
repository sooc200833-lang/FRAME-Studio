import test from 'node:test';
import assert from 'node:assert/strict';
import { createRendererInitOptions, initializeWithBackendFallback, RENDERER_BACKEND_ORDER } from '../apps/web/src/renderer/renderer-options.js';

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

test('renderer initialization retries the next backend after a failure', async () => {
  const attempts = [];
  const result = await initializeWithBackendFallback(async backend => {
    attempts.push(backend);
    if (backend === 'webgl') throw new Error('context creation failed');
    return { ready: true };
  });

  assert.deepEqual(attempts, ['webgl', 'webgpu']);
  assert.equal(result.backend, 'webgpu');
  assert.deepEqual(result.value, { ready: true });
});

test('renderer initialization reports every backend failure', async () => {
  await assert.rejects(
    initializeWithBackendFallback(async backend => { throw new Error(`${backend} unavailable`); }),
    error => {
      assert.equal(error.causes.length, 3);
      assert.match(error.message, /webgl: webgl unavailable/);
      assert.match(error.message, /canvas: canvas unavailable/);
      return true;
    },
  );
});
