import { cloneRasterCels, cloneRasterTransformCels } from './frame-cels.js';

function cloneStrokes(strokes = []) {
  return strokes.map(stroke => ({
    ...stroke,
    points: (stroke.points || []).map(point => ({ ...point })),
    ...(stroke.bezierPath ? { bezierPath: {
      ...stroke.bezierPath,
      anchorModes: stroke.bezierPath.anchorModes ? [...stroke.bezierPath.anchorModes] : stroke.bezierPath.anchors.map((_, index) => index > 0 && index < stroke.bezierPath.anchors.length - 1 ? 'smooth' : 'corner'),
      anchors: stroke.bezierPath.anchors.map(point => ({ ...point })),
      segments: stroke.bezierPath.segments.map(segment => ({ control1: { ...segment.control1 }, control2: { ...segment.control2 } })),
    } } : {}),
  }));
}

function makeFrame(id, strokes = [], durationMs = 1000 / 12, cels = [], transformCels = []) {
  return {
    id,
    durationMs: Math.max(1, Number(durationMs) || 1000 / 12),
    strokes: cloneStrokes(strokes),
    cels: cloneRasterCels(cels),
    transformCels: cloneRasterTransformCels(transformCels),
  };
}

export function createTimeline({ fps = 12, frames = [] } = {}) {
  const safeFps = Math.max(1, Math.min(60, Number(fps) || 12));
  const normalized = frames.map((frame, index) => makeFrame(
    frame.id || `frame-${index + 1}`,
    frame.strokes,
    frame.durationMs || 1000 / safeFps,
    frame.cels,
    frame.transformCels,
  ));
  const initialFrames = normalized.length ? normalized : [makeFrame('frame-1')];
  return {
    fps: safeFps,
    frames: initialFrames,
    activeFrameId: initialFrames[0].id,
    nextId: initialFrames.length + 1,
  };
}

export function activeFrame(timeline) {
  return timeline.frames.find(frame => frame.id === timeline.activeFrameId) || timeline.frames[0] || null;
}

export function updateFrameStrokes(timeline, frameId, strokes) {
  const frame = timeline.frames.find(item => item.id === frameId);
  if (!frame) return false;
  frame.strokes = cloneStrokes(strokes);
  return true;
}

export function updateFrameCels(timeline, frameId, cels) {
  const frame = timeline.frames.find(item => item.id === frameId);
  if (!frame) return false;
  frame.cels = cloneRasterCels(cels);
  return true;
}

export function updateFrameTransformCels(timeline, frameId, transformCels) {
  const frame = timeline.frames.find(item => item.id === frameId);
  if (!frame) return false;
  frame.transformCels = cloneRasterTransformCels(transformCels);
  return true;
}

export function selectFrame(timeline, frameId) {
  if (!timeline.frames.some(frame => frame.id === frameId)) return false;
  timeline.activeFrameId = frameId;
  return true;
}

export function addFrame(timeline, { duplicate = false } = {}) {
  const current = activeFrame(timeline);
  const frame = makeFrame(
    `frame-${timeline.nextId++}`,
    duplicate && current ? current.strokes : [],
    current?.durationMs || 1000 / timeline.fps,
    duplicate && current ? current.cels : [],
    duplicate && current ? current.transformCels : [],
  );
  const index = current ? timeline.frames.indexOf(current) + 1 : timeline.frames.length;
  timeline.frames.splice(index, 0, frame);
  timeline.activeFrameId = frame.id;
  return frame;
}

export function deleteFrame(timeline, frameId = timeline.activeFrameId) {
  if (timeline.frames.length <= 1) return false;
  const index = timeline.frames.findIndex(frame => frame.id === frameId);
  if (index < 0) return false;
  timeline.frames.splice(index, 1);
  if (timeline.activeFrameId === frameId) {
    timeline.activeFrameId = timeline.frames[Math.max(0, index - 1)].id;
  }
  return true;
}

export function getOnionSkin(timeline, { previous = true, next = true, opacity = 0.22 } = {}) {
  const index = timeline.frames.findIndex(frame => frame.id === timeline.activeFrameId);
  if (index < 0) return [];
  const result = [];
  if (previous && timeline.frames[index - 1]) {
    result.push({ side: 'previous', tint: 0x55aaff, alpha: opacity, strokes: timeline.frames[index - 1].strokes });
  }
  if (next && timeline.frames[index + 1]) {
    result.push({ side: 'next', tint: 0xff6b8a, alpha: opacity, strokes: timeline.frames[index + 1].strokes });
  }
  return result;
}

export function frameAtTime(timeline, elapsedMs) {
  const total = timeline.frames.reduce((sum, frame) => sum + frame.durationMs, 0);
  if (!total) return timeline.frames[0] || null;
  let cursor = ((Math.max(0, elapsedMs) % total) + total) % total;
  for (const frame of timeline.frames) {
    if (cursor < frame.durationMs) return frame;
    cursor -= frame.durationMs;
  }
  return timeline.frames.at(-1) || null;
}
