import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activeFrame, addFrame, createTimeline, deleteFrame, frameAtTime,
  getOnionSkin, selectFrame, updateFrameStrokes,
} from '../apps/web/src/animation/timeline.js';

const line = { id: 'line-1', color: '#222222', width: 4, points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] };

test('timeline starts with one frame and clamps fps', () => {
  const timeline = createTimeline({ fps: 120 });
  assert.equal(timeline.fps, 60);
  assert.equal(timeline.frames.length, 1);
});

test('adding a blank frame and duplicating preserves independent snapshots', () => {
  const timeline = createTimeline();
  updateFrameStrokes(timeline, activeFrame(timeline).id, [line]);
  const duplicate = addFrame(timeline, { duplicate: true });
  assert.deepEqual(duplicate.strokes, [line]);
  duplicate.strokes[0].points[0].x = 99;
  assert.equal(activeFrame(timeline).strokes[0].points[0].x, 99);
  assert.equal(timeline.frames[0].strokes[0].points[0].x, 1);
  const blank = addFrame(timeline);
  assert.equal(blank.strokes.length, 0);
});

test('frame selection and deletion keep a valid active frame', () => {
  const timeline = createTimeline();
  const second = addFrame(timeline);
  assert.equal(selectFrame(timeline, 'missing'), false);
  assert.equal(deleteFrame(timeline, second.id), true);
  assert.equal(activeFrame(timeline).id, 'frame-1');
  assert.equal(deleteFrame(timeline), false);
});

test('onion skin returns previous blue and next pink ghost snapshots', () => {
  const timeline = createTimeline();
  updateFrameStrokes(timeline, 'frame-1', [line]);
  const middle = addFrame(timeline, { duplicate: true });
  const next = addFrame(timeline, { duplicate: true });
  selectFrame(timeline, middle.id);
  const ghosts = getOnionSkin(timeline);
  assert.deepEqual(ghosts.map(item => item.side), ['previous', 'next']);
  assert.equal(ghosts[0].tint, 0x55aaff);
  assert.equal(ghosts[1].tint, 0xff6b8a);
  assert.equal(ghosts[0].strokes.length, 1);
  assert.equal(next.strokes.length, 1);
});

test('frameAtTime loops through frame durations', () => {
  const timeline = createTimeline({ fps: 10 });
  const second = addFrame(timeline);
  timeline.frames[0].durationMs = 100;
  second.durationMs = 200;
  assert.equal(frameAtTime(timeline, 50).id, 'frame-1');
  assert.equal(frameAtTime(timeline, 150).id, second.id);
  assert.equal(frameAtTime(timeline, 350).id, 'frame-1');
});
