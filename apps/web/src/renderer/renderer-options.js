export const RENDERER_BACKEND_ORDER = Object.freeze(['webgl', 'webgpu', 'canvas']);

export function createRendererInitOptions({
  width,
  height,
  devicePixelRatio = 1,
  backend = 'webgl',
} = {}) {
  if (!RENDERER_BACKEND_ORDER.includes(backend)) {
    throw new RangeError(`Unsupported renderer backend: ${backend}`);
  }

  const ratio = Number(devicePixelRatio);
  const resolution = Math.min(2, Math.max(1, Number.isFinite(ratio) && ratio > 0 ? ratio : 1));

  return {
    width,
    height,
    backgroundColor: 0xf4f0e8,
    antialias: backend !== 'canvas',
    autoDensity: true,
    resolution,
    preference: [backend],
    ...(backend === 'webgl' ? { webgl: { antialias: true } } : {}),
    ...(backend === 'webgpu' ? { webgpu: { antialias: false } } : {}),
    ...(backend === 'canvas' ? { canvasOptions: { backgroundAlpha: 1 } } : {}),
  };
}

export async function initializeWithBackendFallback(createAttempt, backends = RENDERER_BACKEND_ORDER) {
  if (typeof createAttempt !== 'function') {
    throw new TypeError('createAttempt must be a function');
  }

  const failures = [];
  for (const backend of backends) {
    try {
      return { backend, value: await createAttempt(backend) };
    } catch (error) {
      failures.push({ backend, error });
    }
  }

  const details = failures
    .map(({ backend, error }) => `${backend}: ${error?.message || error}`)
    .join('; ');
  const failure = new Error(`No supported renderer could be initialized. ${details}`);
  failure.causes = failures;
  throw failure;
}
