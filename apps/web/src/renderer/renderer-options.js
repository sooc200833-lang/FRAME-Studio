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
