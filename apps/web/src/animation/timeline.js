import { cloneRasterCels, cloneRasterTransformCels } from './frame-cels.js';

function cloneStrokes(strokes = []) {
  return strokes.map(stroke => ({
    ...stroke,
    points: (stroke.points || []).map(point => ({ ...point })),
    ...(Array.isArray(stroke.pressureProfile) ? { pressureProfile: [...stroke.pressureProfile] } : {}),
    ...(stroke.bezierPath ? { bezierPath: {
      ...stroke.bezierPath,
      anchorModes: stroke.bezierPath.anchorModes ? [...stroke.bezierPath.anchorModes] : stroke.bezierPath.anchors.map((_, index) => index > 0 && index < stroke.bezierPath.anchors.length - 1 ? 'smooth' : 'corner'),
      anchors: stroke.bezierPath.anchors.map(point => ({ ...point })),
      segments: stroke.bezierPath.segments.map(segment => ({ control1: { ...segment.control1 }, control2: { ...segment.control2 } })),
    } } : {}),
  }));
}

export const MAX_FRAME_HOLD = 96;

export function normalizeHold(hold) {
  return Math.max(1, Math.min(MAX_FRAME_HOLD, Math.round(Number(hold)) || 1));
}

function makeFrame(id, strokes = [], durationMs = 1000 / 12, cels = [], transformCels = [], hold = 1) {
  return {
    id,
    // `hold` is how many timeline frames (ticks) this drawing stays on screen.
    hold: normalizeHold(hold),
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
    frame.durationMs || normalizeHold(frame.hold) * 1000 / safeFps,
    frame.cels,
    frame.transformCels,
    frame.hold,
  ));
  const initialFrames = normalized.length ? normalized : [makeFrame('frame-1')];
  return {
    fps: safeFps,
    frames: initialFrames,
    activeFrameId: initialFrames[0].id,
    playhead: 0,
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
  // Keep the playhead if it already lies inside this drawing's hold.
  const start = frameStartTick(timeline, frameId);
  const playhead = Number(timeline.playhead) || 0;
  if (playhead < start || playhead >= start + frameHold(timeline.frames.find(frame => frame.id === frameId))) {
    timeline.playhead = start;
  }
  return true;
}

export function addFrame(timeline, { duplicate = false } = {}) {
  const current = activeFrame(timeline);
  const hold = duplicate && current ? frameHold(current) : 1;
  const frame = makeFrame(
    `frame-${timeline.nextId++}`,
    duplicate && current ? current.strokes : [],
    hold * 1000 / timeline.fps,
    duplicate && current ? current.cels : [],
    duplicate && current ? current.transformCels : [],
    hold,
  );
  const index = current ? timeline.frames.indexOf(current) + 1 : timeline.frames.length;
  timeline.frames.splice(index, 0, frame);
  timeline.activeFrameId = frame.id;
  timeline.playhead = frameStartTick(timeline, frame.id);
  return frame;
}

export function deleteFrame(timeline, frameId = timeline.activeFrameId) {
  if (timeline.frames.length <= 1) return false;
  const index = timeline.frames.findIndex(frame => frame.id === frameId);
  if (index < 0) return false;
  timeline.frames.splice(index, 1);
  if (timeline.activeFrameId === frameId) {
    timeline.activeFrameId = timeline.frames[Math.max(0, index - 1)].id;
    timeline.playhead = frameStartTick(timeline, timeline.activeFrameId);
  }
  timeline.playhead = Math.min(Number(timeline.playhead) || 0, totalTicks(timeline) - 1);
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

// ── Holds (exposures) and the tick-based playhead ──

export function frameHold(frame) {
  return normalizeHold(frame?.hold);
}

export function totalTicks(timeline) {
  return timeline.frames.reduce((sum, frame) => sum + frameHold(frame), 0) || 1;
}

export function frameStartTick(timeline, frameId) {
  let tick = 0;
  for (const frame of timeline.frames) {
    if (frame.id === frameId) return tick;
    tick += frameHold(frame);
  }
  return 0;
}

/** Drawing visible at `tick`; ticks wrap around the timeline length. */
export function frameAtTick(timeline, tick) {
  const total = totalTicks(timeline);
  let cursor = ((Math.floor(Number(tick) || 0) % total) + total) % total;
  for (const frame of timeline.frames) {
    const hold = frameHold(frame);
    if (cursor < hold) return frame;
    cursor -= hold;
  }
  return timeline.frames.at(-1) || null;
}

/** Moves the playhead to `tick` (clamped) and activates the drawing under it. */
export function seekTick(timeline, tick) {
  const clamped = Math.max(0, Math.min(totalTicks(timeline) - 1, Math.floor(Number(tick) || 0)));
  timeline.playhead = clamped;
  const frame = frameAtTick(timeline, clamped);
  if (frame) timeline.activeFrameId = frame.id;
  return frame;
}

export function setFrameHold(timeline, frameId, hold) {
  const frame = timeline.frames.find(item => item.id === frameId);
  if (!frame) return false;
  frame.hold = normalizeHold(hold);
  frame.durationMs = frame.hold * 1000 / timeline.fps;
  const start = frameStartTick(timeline, frameId);
  if (timeline.activeFrameId === frameId) {
    timeline.playhead = Math.min(Math.max(Number(timeline.playhead) || 0, start), start + frame.hold - 1);
  }
  return true;
}

export function applyTimelineFps(timeline, fps) {
  timeline.fps = Math.max(1, Math.min(60, Number(fps) || 12));
  for (const frame of timeline.frames) frame.durationMs = frameHold(frame) * 1000 / timeline.fps;
  return timeline.fps;
}
