import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_CLIP_HOLD, clipAt, clipStart, createTimelineDocument, deleteClip, duplicateTrack, ensureClipAt,
  ensureTrack, insertClipAfter, neighborClipStart, setClipHold, timelineLength, trackLength,
} from '../apps/web/src/animation/tracks.js';

test('a new track gets one blank clip spanning the current timeline', () => {
  const doc = createTimelineDocument();
  const first = ensureTrack(doc, 'layer-1');
  assert.equal(first.clips.length, 1);
  assert.equal(timelineLength(doc), 1);
  setClipHold(first, first.clips[0].id, 8);
  const second = ensureTrack(doc, 'layer-2');
  assert.equal(trackLength(second), 8);
  assert.equal(ensureTrack(doc, 'layer-2'), second, 'ensureTrack is idempotent');
  const vector = ensureTrack(doc, 'vector', { vector: true });
  assert.deepEqual(vector.clips[0].strokes, []);
});

test('tracks keep independent timing', () => {
  const doc = createTimelineDocument();
  const background = ensureTrack(doc, 'bg');
  setClipHold(background, background.clips[0].id, 6);
  const character = ensureTrack(doc, 'char');
  setClipHold(character, character.clips[0].id, 2);
  insertClipAfter(doc, character, 0);
  insertClipAfter(doc, character, 2);
  character.clips.forEach(clip => setClipHold(character, clip.id, 2));
  assert.equal(clipAt(background, 5).index, 0);
  assert.deepEqual([0, 2, 4].map(tick => clipAt(character, tick).index), [0, 1, 2]);
  assert.equal(timelineLength(doc), 6);
});

test('insertClipAfter ripples later clips and can duplicate', () => {
  const doc = createTimelineDocument();
  const track = ensureTrack(doc, 'a');
  track.clips[0].cel = 'data:first';
  setClipHold(track, track.clips[0].id, 3);
  insertClipAfter(doc, track, 0);
  const { clip, start } = insertClipAfter(doc, track, 1, { duplicate: true });
  assert.equal(start, 3);
  assert.equal(clip.cel, 'data:first');
  assert.equal(clip.hold, 3);
  assert.notEqual(clip.id, track.clips[0].id);
  assert.equal(clipStart(track, track.clips[2].id), 6, 'the blank clip moved right');
});

test('insertClipAfter and ensureClipAt pad past the track end', () => {
  const doc = createTimelineDocument();
  const track = ensureTrack(doc, 'a');
  const inserted = insertClipAfter(doc, track, 4);
  assert.equal(inserted.start, 4);
  assert.equal(track.clips.length, 3);
  assert.equal(track.clips[1].hold, 3);
  const vector = ensureTrack(doc, 'v', { vector: true });
  const found = ensureClipAt(doc, vector, 7, { strokes: [] });
  assert.equal(found.start, 7);
  assert.equal(clipAt(vector, 7).clip, found.clip);
  assert.deepEqual(found.clip.strokes, []);
  assert.equal(ensureClipAt(doc, vector, 2).clip, clipAt(vector, 2).clip, 'no new clip when one exists');
});

test('holds clamp and deleteClip keeps at least one clip', () => {
  const doc = createTimelineDocument();
  const track = ensureTrack(doc, 'a');
  setClipHold(track, track.clips[0].id, 0);
  assert.equal(track.clips[0].hold, 1);
  setClipHold(track, track.clips[0].id, 10_000);
  assert.equal(track.clips[0].hold, MAX_CLIP_HOLD);
  assert.equal(deleteClip(track, track.clips[0].id), false);
  insertClipAfter(doc, track, 0);
  assert.equal(deleteClip(track, track.clips[0].id), true);
  assert.equal(track.clips.length, 1);
});

test('clipAt returns null past the end; neighborClipStart steps by clip', () => {
  const doc = createTimelineDocument();
  const track = ensureTrack(doc, 'a');
  setClipHold(track, track.clips[0].id, 2);
  insertClipAfter(doc, track, 0);
  setClipHold(track, track.clips[1].id, 3);
  assert.equal(clipAt(track, 5), null);
  assert.equal(neighborClipStart(track, 0, 1), 2);
  assert.equal(neighborClipStart(track, 3, -1), 2, 'inside a clip, back goes to its start');
  assert.equal(neighborClipStart(track, 2, -1), 0);
  assert.equal(neighborClipStart(track, 2, 1), null);
  assert.equal(neighborClipStart(track, 9, -1), 2);
});

test('duplicateTrack deep-copies clips with new ids', () => {
  const doc = createTimelineDocument();
  const source = ensureTrack(doc, 'v', { vector: true });
  source.clips[0].strokes.push({ id: 'line-1', points: [{ x: 1, y: 2 }] });
  const copy = duplicateTrack(doc, source, 'v2');
  copy.clips[0].strokes[0].points[0].x = 99;
  assert.equal(source.clips[0].strokes[0].points[0].x, 1);
  assert.notEqual(copy.clips[0].id, source.clips[0].id);
});
