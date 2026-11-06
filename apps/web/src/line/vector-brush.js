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
export function getVectorPointWidth(stroke, point, index) {
  const preset = getVectorBrushPreset(stroke.brushPreset);
  const pressure = normalizeVectorPressure(point.pressure ?? 0.5);
  const curve = Math.max(0.35, Math.min(2.5, Number(stroke.pressureCurve) || 1));
  const shaped = Math.pow(pressure, preset.pressurePower * curve);
  const profile = Array.isArray(stroke.pressureProfile) && stroke.pressureProfile.length
    ? stroke.pressureProfile[Math.min(index, stroke.pressureProfile.length - 1)] : 1;
  return Math.max(0.35, stroke.width * Math.max(preset.minWidth, shaped) * Math.max(0.1, Number(profile) || 1));
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
