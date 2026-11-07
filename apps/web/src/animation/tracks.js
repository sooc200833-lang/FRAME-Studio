// Multi-track timeline model. Pure data, no DOM.
//
// Every raster layer (and the shared vector-line layer) owns a track: an
// ordered list of clips laid end to end from tick 0. A clip is one drawing for
// that layer and stays on screen for `hold` ticks. Tracks are independent, so
// a background can hold one drawing for 24 frames while a character track
// changes every 2 frames.
//
// Clip payload (raster `cel`/`transformCel`, vector `strokes`) is opaque here;
// main.js decides what to store.

import { cloneRasterCels, cloneRasterTransformCels } from './frame-cels.js';

export const MAX_CLIP_HOLD = 240;

export function normalizeHold(hold) {
  return Math.max(1, Math.min(MAX_CLIP_HOLD, Math.round(Number(hold)) || 1));
}

export function createTimelineDocument({ fps = 12 } = {}) {
  return {
    fps: Math.max(1, Math.min(60, Number(fps) || 12)),
    playhead: 0,
    tracks: {},
    nextClipId: 1,
  };
}

function cloneStrokes(strokes) {
  return Array.isArray(strokes) ? structuredCloneSafe(strokes) : undefined;
}

function structuredCloneSafe(value) {
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

export function makeClip(doc, { hold = 1, cel = null, transformCel = [], strokes } = {}) {
  const clip = {
    id: `clip-${doc.nextClipId++}`,
    hold: normalizeHold(hold),
    cel: cel ?? null,
    transformCel: cloneRasterTransformCels([transformCel])[0] || [],
  };
  if (strokes !== undefined) clip.strokes = cloneStrokes(strokes) || [];
  return clip;
}

export function cloneClip(doc, clip) {
  return makeClip(doc, {
    hold: clip.hold,
    cel: cloneRasterCels([clip.cel])[0] ?? null,
    transformCel: clip.transformCel || [],
    strokes: clip.strokes,
  });
}

/** Returns the track, creating it with one blank clip spanning the timeline. */
export function ensureTrack(doc, trackId, { vector = false } = {}) {
  if (!doc.tracks[trackId]) {
    doc.tracks[trackId] = {
      id: trackId,
      clips: [makeClip(doc, { hold: timelineLength(doc), ...(vector ? { strokes: [] } : {}) })],
    };
  }
  return doc.tracks[trackId];
}

export function trackLength(track) {
  return (track?.clips || []).reduce((sum, clip) => sum + normalizeHold(clip.hold), 0);
}

export function timelineLength(doc) {
  return Math.max(1, ...Object.values(doc.tracks).map(trackLength));
}

/** Clip covering `tick` with its index and start tick, or null past the track end. */
export function clipAt(track, tick) {
  const t = Math.floor(Number(tick) || 0);
  if (!track || t < 0) return null;
  let start = 0;
  for (let index = 0; index < track.clips.length; index++) {
    const clip = track.clips[index];
    const hold = normalizeHold(clip.hold);
    if (t < start + hold) return { clip, index, start };
    start += hold;
  }
  return null;
}

export function clipStart(track, clipId) {
  let start = 0;
  for (const clip of track?.clips || []) {
    if (clip.id === clipId) return start;
    start += normalizeHold(clip.hold);
  }
  return -1;
}

/**
 * Makes sure a clip exists at `tick`, padding the track with one empty clip
 * if it ends earlier, then adding a 1-tick clip at `tick`.
 */
export function ensureClipAt(doc, track, tick, blank = {}) {
  const found = clipAt(track, tick);
  if (found) return found;
  const length = trackLength(track);
  const t = Math.max(0, Math.floor(Number(tick) || 0));
  if (t > length) track.clips.push(makeClip(doc, { hold: t - length, ...blank }));
  const clip = makeClip(doc, { hold: 1, ...blank });
  track.clips.push(clip);
  return { clip, index: track.clips.length - 1, start: t };
}

/**
 * Inserts a clip right after the clip covering `tick` (or at the track end)
 * and ripples later clips to the right. Returns the clip and its start tick.
 */
export function insertClipAfter(doc, track, tick, { duplicate = false, blank = {} } = {}) {
  const found = clipAt(track, tick);
  const source = found?.clip || track.clips.at(-1) || null;
  const clip = duplicate && source
    ? cloneClip(doc, source)
    : makeClip(doc, { hold: 1, ...blank });
  if (found) {
    track.clips.splice(found.index + 1, 0, clip);
    return { clip, start: found.start + normalizeHold(found.clip.hold) };
  }
  const start = trackLength(track);
  const t = Math.max(0, Math.floor(Number(tick) || 0));
  if (t > start) track.clips.push(makeClip(doc, { hold: t - start, ...blank }));
  track.clips.push(clip);
  return { clip, start: Math.max(start, t) };
}

export function setClipHold(track, clipId, hold) {
  const clip = track?.clips.find(item => item.id === clipId);
  if (!clip) return false;
  clip.hold = normalizeHold(hold);
  return true;
}

/** Removes a clip; later clips ripple left. A track always keeps one clip. */
export function deleteClip(track, clipId) {
  if (!track || track.clips.length <= 1) return false;
  const index = track.clips.findIndex(clip => clip.id === clipId);
  if (index < 0) return false;
  track.clips.splice(index, 1);
  return true;
}

export function duplicateTrack(doc, sourceTrack, trackId) {
  doc.tracks[trackId] = { id: trackId, clips: sourceTrack.clips.map(clip => cloneClip(doc, clip)) };
  return doc.tracks[trackId];
}

/** Tick where the previous/next clip of a track begins, for stepping. */
export function neighborClipStart(track, tick, direction) {
  const found = clipAt(track, tick);
  if (!found) {
    const last = track?.clips.length ? clipAt(track, trackLength(track) - 1) : null;
    return direction < 0 && last ? last.start : null;
  }
  if (direction < 0) {
    if (Math.floor(tick) > found.start) return found.start;
    const previous = track.clips[found.index - 1];
    return previous ? found.start - normalizeHold(previous.hold) : null;
  }
  const next = found.start + normalizeHold(found.clip.hold);
  return next < trackLength(track) ? next : null;
}
