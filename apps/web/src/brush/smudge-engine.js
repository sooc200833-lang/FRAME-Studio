const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));

export function normalizeSmudgeOptions({
  size = 24,
  strength = 0.55,
  spacing = 0.22,
} = {}) {
  return {
    size: clamp(size, 1, 256),
    strength: clamp(strength, 0.02, 1),
    spacing: clamp(spacing, 0.08, 1),
  };
}

function copyRegion(data, width, left, top, regionWidth, regionHeight) {
  const result = new Uint8ClampedArray(regionWidth * regionHeight * 4);
  for (let row = 0; row < regionHeight; row++) {
    const sourceStart = ((top + row) * width + left) * 4;
    result.set(data.subarray(sourceStart, sourceStart + regionWidth * 4), row * regionWidth * 4);
  }
  return result;
}

/**
 * Smears the pixels behind the brush into the area under the current dab.
 * The local source patch is snapshotted before each dab so writes never feed
 * back into later reads within the same dab.
 */
export function smudgeDab(imageData, centerX, centerY, deltaX, deltaY, radius, strength) {
  const { width, height, data } = imageData || {};
  if (!data || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) return 0;

  const r = clamp(radius, 0.5, 256);
  const amount = clamp(strength, 0, 1);
  if (amount <= 0 || (Math.abs(deltaX) < 0.001 && Math.abs(deltaY) < 0.001)) return 0;

  const left = Math.max(0, Math.floor(Math.min(centerX - r, centerX - r - deltaX)));
  const top = Math.max(0, Math.floor(Math.min(centerY - r, centerY - r - deltaY)));
  const right = Math.min(width - 1, Math.ceil(Math.max(centerX + r, centerX + r - deltaX)));
  const bottom = Math.min(height - 1, Math.ceil(Math.max(centerY + r, centerY + r - deltaY)));
  if (right < left || bottom < top) return 0;

  const regionWidth = right - left + 1;
  const regionHeight = bottom - top + 1;
  const source = copyRegion(data, width, left, top, regionWidth, regionHeight);
  const radiusSquared = r * r;
  let touched = 0;

  for (let y = Math.max(0, Math.floor(centerY - r)); y <= Math.min(height - 1, Math.ceil(centerY + r)); y++) {
    for (let x = Math.max(0, Math.floor(centerX - r)); x <= Math.min(width - 1, Math.ceil(centerX + r)); x++) {
      const distanceSquared = (x - centerX) ** 2 + (y - centerY) ** 2;
      if (distanceSquared > radiusSquared) continue;

      const sourceX = Math.round(x - deltaX);
      const sourceY = Math.round(y - deltaY);
      if (sourceX < 0 || sourceY < 0 || sourceX >= width || sourceY >= height) continue;

      const distance = Math.sqrt(distanceSquared) / r;
      const edge = Math.max(0, Math.min(1, (1 - distance) / 0.28));
      const falloff = edge * edge * (3 - 2 * edge);
      const mix = amount * falloff;
      if (mix <= 0) continue;

      const targetIndex = (y * width + x) * 4;
      const sourceIndex = ((sourceY - top) * regionWidth + (sourceX - left)) * 4;
      if (sourceIndex < 0 || sourceIndex + 3 >= source.length) continue;

      const sourceAlpha = source[sourceIndex + 3] / 255;
      const targetAlpha = data[targetIndex + 3] / 255;
      const outputAlpha = targetAlpha * (1 - mix) + sourceAlpha * mix;
      for (let channel = 0; channel < 3; channel++) {
        const sourcePremultiplied = source[sourceIndex + channel] * sourceAlpha;
        const targetPremultiplied = data[targetIndex + channel] * targetAlpha;
        const outputPremultiplied = targetPremultiplied * (1 - mix) + sourcePremultiplied * mix;
        data[targetIndex + channel] = outputAlpha > 0 ? outputPremultiplied / outputAlpha : 0;
      }
      data[targetIndex + 3] = outputAlpha * 255;
      touched++;
    }
  }

  return touched;
}

export function createSmudgeSession(imageData, options = {}) {
  if (!imageData?.data || !Number.isInteger(imageData.width) || !Number.isInteger(imageData.height)) {
    throw new TypeError('A valid ImageData buffer is required');
  }

  const settings = normalizeSmudgeOptions(options);
  const spacing = Math.max(1, settings.size * settings.spacing);
  const radius = Math.max(0.5, settings.size / 2);
  let previousPoint = null;
  let lastDabPoint = null;
  let distanceSinceDab = 0;
  let dabCount = 0;

  const dabAt = (point, from) => {
    const deltaX = point.x - from.x;
    const deltaY = point.y - from.y;
    if (Math.hypot(deltaX, deltaY) < 0.001) return 0;
    const pressure = clamp(point.pressure ?? 1, 0.05, 1);
    const count = smudgeDab(
      imageData,
      point.x,
      point.y,
      deltaX,
      deltaY,
      radius * (0.35 + pressure * 0.65),
      settings.strength,
    );
    if (count) dabCount++;
    return count;
  };

  return {
    imageData,
    addPoint(point) {
      if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return 0;
      const next = { x: point.x, y: point.y, pressure: point.pressure ?? 1 };
      if (!previousPoint) {
        previousPoint = next;
        lastDabPoint = next;
        return 0;
      }

      const segmentX = next.x - previousPoint.x;
      const segmentY = next.y - previousPoint.y;
      const segmentLength = Math.hypot(segmentX, segmentY);
      if (segmentLength < 0.001) {
        previousPoint = next;
        return 0;
      }

      let travelled = 0;
      let nextDabDistance = spacing - distanceSinceDab;
      let touched = 0;
      while (travelled + nextDabDistance <= segmentLength + 1e-6) {
        travelled += nextDabDistance;
        const ratio = travelled / segmentLength;
        const dab = {
          x: previousPoint.x + segmentX * ratio,
          y: previousPoint.y + segmentY * ratio,
          pressure: previousPoint.pressure + (next.pressure - previousPoint.pressure) * ratio,
        };
        touched += dabAt(dab, lastDabPoint);
        lastDabPoint = dab;
        distanceSinceDab = 0;
        nextDabDistance = spacing;
      }
      distanceSinceDab += segmentLength - travelled;
      previousPoint = next;
      return touched;
    },
    flush() {
      if (!previousPoint || !lastDabPoint) return 0;
      const distance = Math.hypot(previousPoint.x - lastDabPoint.x, previousPoint.y - lastDabPoint.y);
      if (distance < 0.25) return 0;
      const touched = dabAt(previousPoint, lastDabPoint);
      lastDabPoint = previousPoint;
      distanceSinceDab = 0;
      return touched;
    },
    get dabCount() {
      return dabCount;
    },
    get settings() {
      return { ...settings };
    },
  };
}
