const VECTOR_BRUSHES = {
  pencil: { opacity: 0.82, pressurePower: 1.35, minWidth: 0.12, texture: 'grain' },
  ink: { opacity: 1, pressurePower: 0.82, minWidth: 0.16, texture: 'solid' },
  brush: { opacity: 0.92, pressurePower: 1.7, minWidth: 0.08, texture: 'soft' },
  marker: { opacity: 0.48, pressurePower: 0.45, minWidth: 0.72, texture: 'marker' },
  nib: { opacity: 1, pressurePower: 1.05, minWidth: 0.08, texture: 'nib' },
  dry: { opacity: 0.88, pressurePower: 1.25, minWidth: 0.18, texture: 'dry' },
};

export function getVectorBrushPreset(name = 'ink') {
  return VECTOR_BRUSHES[name] ? { name, ...VECTOR_BRUSHES[name] } : { name: 'ink', ...VECTOR_BRUSHES.ink };
}
export function normalizeVectorPressure(value) {
  const pressure = Number(value);
  return Number.isFinite(pressure) ? Math.max(0.02, Math.min(1, pressure)) : 0.5;
}
export function normalizeStrokeWidthProfile(profile, count = 5) {
  const source = Array.isArray(profile) && profile.length ? profile : [1];
  const targetCount = Math.max(2, count);
  return Array.from({ length: targetCount }, (_, index) => {
    const position = targetCount <= 1 ? 0 : index / (targetCount - 1) * (source.length - 1);
    const left = Math.floor(position);
    const right = Math.min(source.length - 1, left + 1);
    const mix = position - left;
    const a = Number(source[left]);
    const b = Number(source[right]);
    const value = (Number.isFinite(a) ? a : 1) * (1 - mix) + (Number.isFinite(b) ? b : 1) * mix;
    return Math.max(0.1, Math.min(2.2, value));
  });
}
export function sampleStrokeWidthProfile(profile, progress) {
  const values = normalizeStrokeWidthProfile(profile);
  const position = Math.max(0, Math.min(1, Number(progress) || 0)) * (values.length - 1);
  const left = Math.floor(position);
  const right = Math.min(values.length - 1, left + 1);
  const mix = position - left;
  return values[left] * (1 - mix) + values[right] * mix;
}

export function getVectorPointWidth(stroke, point, index, pointCount = index + 1) {
  const preset = getVectorBrushPreset(stroke.brushPreset);
  const pressure = normalizeVectorPressure(point.pressure ?? 0.5);
  const curve = Math.max(0.35, Math.min(2.5, Number(stroke.pressureCurve) || 1));
  const shaped = Math.pow(pressure, preset.pressurePower * curve);
  const progress = pointCount <= 1 ? 0 : index / (pointCount - 1);
  const profile = sampleStrokeWidthProfile(stroke.pressureProfile, progress);
  return Math.max(0.35, stroke.width * Math.max(preset.minWidth, shaped) * profile);
}
export function createVectorBrushStyle({ brushPreset = 'ink', pressureCurve = 1, opacity, motionStyle = 'none', motionStrength = 3 } = {}) {
  const preset = getVectorBrushPreset(brushPreset);
  return {
    brushPreset: preset.name,
    pressureCurve: Math.max(0.35, Math.min(2.5, Number(pressureCurve) || 1)),
    opacity: Math.max(0.05, Math.min(1, Number(opacity ?? preset.opacity))),
    motionStyle: ['none', 'redraw', 'flicker', 'wave'].includes(motionStyle) ? motionStyle : 'none',
    motionStrength: Math.max(0, Math.min(16, Number(motionStrength) || 0)),
  };
}


/**
 * Estimate expressive pressure for non-stylus input.
 * Inspired by Quickdraw's documented velocity-sensitive ink behavior:
 * fast movement becomes thinner; slow movement remains fuller.
 * This is an original FRAME Studio adaptation, not copied upstream code.
 */
export function estimateVectorMousePressure(previousPoint, nextPoint, elapsedMs, baseWidth = 7) {
  if (!previousPoint || !nextPoint) return 1;
  const distance = Math.hypot(nextPoint.x - previousPoint.x, nextPoint.y - previousPoint.y);
  const elapsed = Math.max(4, Math.min(80, Number(elapsedMs) || 16));
  const frameDistance = distance * (16 / elapsed);
  const relativeSpeed = frameDistance / Math.max(2, Number(baseWidth) || 7);
  const target = 0.12 + 0.88 * Math.exp(-relativeSpeed * 0.55);
  const previousPressure = normalizeVectorPressure(previousPoint.pressure ?? 1);
  return Math.max(0.12, Math.min(1, previousPressure * 0.32 + target * 0.68));
}
