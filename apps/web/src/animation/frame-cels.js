export function cloneRasterCels(cels = []) {
  return cels.map(cel => cel || null);
}

export function blankRasterCels(layerCount = 0) {
  return Array.from({ length: Math.max(0, Math.floor(Number(layerCount) || 0)) }, () => null);
}

export function normalizeRasterCels(cels, layerCount) {
  const result = cloneRasterCels(cels);
  while (result.length < layerCount) result.push(null);
  return result.slice(0, layerCount);
}
