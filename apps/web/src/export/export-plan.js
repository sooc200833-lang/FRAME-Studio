// Export planning: which frames to render, at what size and timing, and the
// output file name. Pure, no DOM.

export const EXPORT_FORMATS = Object.freeze({
  png: { id: 'png', label: 'PNG 한 장', extension: 'png', animated: false, video: false },
  'png-sequence': { id: 'png-sequence', label: 'PNG 시퀀스 (zip)', extension: 'zip', animated: true, video: false },
  gif: { id: 'gif', label: 'GIF', extension: 'gif', animated: true, video: false },
  mp4: { id: 'mp4', label: 'MP4 영상', extension: 'mp4', animated: true, video: true },
  webm: { id: 'webm', label: 'WebM 영상', extension: 'webm', animated: true, video: true },
});

const clampInt = (value, min, max) => Math.min(max, Math.max(min, Math.round(Number(value) || 0)));

/** Video encoders need even dimensions. */
function even(value) {
  const rounded = Math.max(2, Math.round(value));
  return rounded % 2 ? rounded - 1 : rounded;
}

/** Safe, readable file name from the project name. */
export function exportFileName(projectName, extension, date = new Date()) {
  const base = String(projectName || '')
    .normalize('NFC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60) || 'frame-studio';
  const pad = number => String(number).padStart(2, '0');
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
  return `${base}-${stamp}.${extension}`;
}

/**
 * @param options.format     key of EXPORT_FORMATS
 * @param options.totalTicks timeline length in frames
 * @param options.playhead   current frame (used by single-frame PNG)
 * @param options.range      { start, end } inclusive frame indices (optional)
 * @param options.scale      output scale (0.1–2)
 * @param options.fps        timeline frames per second
 * @param options.width/height canvas size in pixels
 */
export function resolveExportPlan({ format = 'png', totalTicks = 1, playhead = 0, range = null, scale = 1, fps = 12, width, height, projectName = '' } = {}) {
  const spec = EXPORT_FORMATS[format];
  if (!spec) throw new Error(`알 수 없는 내보내기 형식: ${format}`);
  const total = Math.max(1, Math.floor(Number(totalTicks) || 1));
  const safeFps = Math.min(60, Math.max(1, Number(fps) || 12));
  const factor = Math.min(2, Math.max(0.1, Number(scale) || 1));
  let ticks;
  if (!spec.animated) {
    ticks = [clampInt(playhead, 0, total - 1)];
  } else {
    const start = clampInt(range?.start ?? 0, 0, total - 1);
    const end = clampInt(range?.end ?? total - 1, start, total - 1);
    ticks = Array.from({ length: end - start + 1 }, (_, index) => start + index);
  }
  const outWidth = spec.video ? even(width * factor) : Math.max(1, Math.round(width * factor));
  const outHeight = spec.video ? even(height * factor) : Math.max(1, Math.round(height * factor));
  return {
    format: spec.id,
    ticks,
    fps: safeFps,
    frameDurationMs: 1000 / safeFps,
    width: outWidth,
    height: outHeight,
    durationSeconds: ticks.length / safeFps,
    fileName: exportFileName(projectName, spec.extension),
  };
}

/**
 * GIF frame delays are in centiseconds, so fps like 12 (8.33 cs) can't be
 * exact. Distribute rounding so the total length stays right.
 */
export function gifFrameDelays(frameCount, fps) {
  const ideal = 100 / Math.max(1, fps);
  const delays = [];
  let error = 0;
  for (let index = 0; index < frameCount; index++) {
    const wanted = ideal + error;
    const delay = Math.max(2, Math.round(wanted));
    error = wanted - delay;
    delays.push(delay);
  }
  return delays;
}

/** Zero-padded PNG names for a sequence, e.g. frame-0001.png. */
export function sequenceFileNames(count, prefix = 'frame') {
  const digits = Math.max(4, String(count).length);
  return Array.from({ length: count }, (_, index) => `${prefix}-${String(index + 1).padStart(digits, '0')}.png`);
}
