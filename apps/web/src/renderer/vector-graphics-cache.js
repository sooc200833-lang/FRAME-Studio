/** Reuse a cached renderer object while the immutable stroke snapshot is unchanged. */
export function getVectorGraphicsCacheEntry(cache, stroke, createGraphics, drawStroke) {
  let entry = cache.get(stroke.id);
  if (!entry) {
    entry = { stroke: null, points: null, color: null, width: null, graphics: createGraphics() };
    cache.set(stroke.id, entry);
  }
  if (entry.stroke !== stroke || entry.points !== stroke.points || entry.color !== stroke.color || entry.width !== stroke.width) {
    entry.graphics.clear();
    drawStroke(entry.graphics, stroke);
    entry.stroke = stroke;
    entry.points = stroke.points;
    entry.color = stroke.color;
    entry.width = stroke.width;
  }
  return entry;
}

export function pruneVectorGraphicsCache(cache, activeIds, releaseGraphics) {
  for (const [id, entry] of cache) {
    if (activeIds.has(id)) continue;
    cache.delete(id);
    releaseGraphics(entry.graphics);
  }
}
