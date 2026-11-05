function matchesPixel(data, pixelIndex, seed, tolerance) {
  const offset = pixelIndex * 4;
  return Math.abs(data[offset] - seed[0]) <= tolerance
    && Math.abs(data[offset + 1] - seed[1]) <= tolerance
    && Math.abs(data[offset + 2] - seed[2]) <= tolerance
    && Math.abs(data[offset + 3] - seed[3]) <= tolerance;
}

export function findConnectedRegion({ data, width, height, x, y, tolerance = 0 }) {
  const total = width * height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new RangeError('Invalid fill dimensions.');
  if (!data || data.length < total * 4) throw new RangeError('RGBA source data is too small.');
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= width || y >= height) throw new RangeError('Fill origin is outside the image.');

  const safeTolerance = Math.max(0, Math.min(255, Number(tolerance) || 0));
  const start = y * width + x;
  const offset = start * 4;
  const seed = [data[offset], data[offset + 1], data[offset + 2], data[offset + 3]];
  const mask = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  let count = 0;
  mask[start] = 1;
  queue[tail++] = start;

  while (head < tail) {
    const point = queue[head++];
    count++;
    const px = point % width;
    const py = Math.floor(point / width);
    if (px > 0) enqueue(point - 1);
    if (px + 1 < width) enqueue(point + 1);
    if (py > 0) enqueue(point - width);
    if (py + 1 < height) enqueue(point + width);
  }

  function enqueue(next) {
    if (mask[next] || !matchesPixel(data, next, seed, safeTolerance)) return;
    mask[next] = 1;
    queue[tail++] = next;
  }

  return { mask, count, seed };
}

export function expandRegionMask(sourceMask, width, height, radius = 0, protectMask = null, protectThreshold = 250) {
  const total = width * height;
  if (!sourceMask || sourceMask.length < total) throw new RangeError('Region mask is too small.');
  if (protectMask && protectMask.length < total) throw new RangeError('Protection mask is too small.');

  let current = sourceMask.slice(0, total);
  const steps = Math.max(0, Math.min(4, Math.floor(Number(radius) || 0)));
  const threshold = Math.max(0, Math.min(255, Number(protectThreshold) || 0));

  for (let step = 0; step < steps; step++) {
    const next = current.slice();
    for (let point = 0; point < total; point++) {
      if (!current[point]) continue;
      const x = point % width;
      const y = Math.floor(point / width);
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const candidate = ny * width + nx;
          if (next[candidate]) continue;
          if (protectMask && protectMask[candidate] >= threshold) continue;
          next[candidate] = 1;
        }
      }
    }
    current = next;
  }
  return current;
}
