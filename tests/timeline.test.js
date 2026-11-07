import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activeFrame, addFrame, createTimeline, deleteFrame, frameAtTime,
  getOnionSkin, selectFrame, updateFrameCels, updateFrameStrokes, updateFrameTransformCels,
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

test('raster cels are stored per frame and duplicated independently', () => {
  const timeline = createTimeline();
  const first = activeFrame(timeline);
  updateFrameCels(timeline, first.id, ['png:first', null]);
  const duplicate = addFrame(timeline, { duplicate: true });
  assert.deepEqual(duplicate.cels, ['png:first', null]);
  duplicate.cels[0] = 'png:changed';
  assert.equal(first.cels[0], 'png:first');
  const blank = addFrame(timeline);
  assert.deepEqual(blank.cels, []);
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

test('onion skin exposes read-only frame stroke references without deep cloning geometry', () => {
  const timeline = createTimeline();
  updateFrameStrokes(timeline, 'frame-1', [line]);
  const middle = addFrame(timeline, { duplicate: true });
  addFrame(timeline, { duplicate: true });
  selectFrame(timeline, middle.id);
  const ghosts = getOnionSkin(timeline);
  assert.equal(ghosts[0].strokes, timeline.frames[0].strokes);
  assert.equal(ghosts[0].strokes[0].points, timeline.frames[0].strokes[0].points);
});

test('transform stacks are stored per frame and duplicated independently', () => {
  const timeline = createTimeline();
  const first = activeFrame(timeline);
  const transform = {
    id: 'transform-1',
    sourceDataUrl: 'data:image/png;base64,AA==',
    clipPolygon: [{ x: 1, y: 2 }, { x: 5, y: 2 }, { x: 5, y: 6 }],
    matrix: [1, 0, 0, 1, 10, 20],
  };
  assert.equal(updateFrameTransformCels(timeline, first.id, [[transform]]), true);
  const duplicate = addFrame(timeline, { duplicate: true });
  assert.deepEqual(duplicate.transformCels, [[transform]]);
  duplicate.transformCels[0][0].clipPolygon[0].x = 999;
  assert.equal(first.transformCels[0][0].clipPolygon[0].x, 1);
  const blank = addFrame(timeline);
  assert.deepEqual(blank.transformCels, []);
});


test('frame snapshots deep-clone editable Bézier geometry', () => {
  const timeline = createTimeline();
  const stroke = {
    ...line,
    bezierPath: {
      id: 'curve',
      anchors: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 40, y: 0 }],
      anchorModes: ['corner', 'smooth', 'corner'],
      segments: [
        { control1: { x: 5, y: 10 }, control2: { x: 15, y: 10 } },
        { control1: { x: 25, y: 10 }, control2: { x: 35, y: 10 } },
      ],
    },
  };
  updateFrameStrokes(timeline, 'frame-1', [stroke]);
  const duplicate = addFrame(timeline, { duplicate: true });
  duplicate.strokes[0].bezierPath.segments[0].control1.x = 999;
  duplicate.strokes[0].bezierPath.anchorModes[1] = 'corner';
  assert.equal(timeline.frames[0].strokes[0].bezierPath.segments[0].control1.x, 5);
  assert.equal(timeline.frames[0].strokes[0].bezierPath.anchorModes[1], 'smooth');
});

test('holds extend drawings across ticks and drive playback duration', async () => {
  const { setFrameHold, totalTicks, frameAtTick, frameStartTick, seekTick, applyTimelineFps } = await import('../apps/web/src/animation/timeline.js');
  const timeline = createTimeline({ fps: 10 });
  const first = timeline.frames[0];
  const second = addFrame(timeline);
  assert.equal(timeline.playhead, 1);
  setFrameHold(timeline, first.id, 3);
  assert.equal(totalTicks(timeline), 4);
  assert.equal(frameStartTick(timeline, second.id), 3);
  assert.equal(frameAtTick(timeline, 2).id, first.id);
  assert.equal(frameAtTick(timeline, 3).id, second.id);
  assert.equal(frameAtTick(timeline, 4).id, first.id, 'ticks wrap');
  assert.equal(first.durationMs, 300);
  assert.equal(frameAtTime(timeline, 250).id, first.id);
  assert.equal(frameAtTime(timeline, 310).id, second.id);
  applyTimelineFps(timeline, 20);
  assert.equal(first.durationMs, 150);
  assert.equal(seekTick(timeline, 1).id, first.id);
  assert.equal(timeline.activeFrameId, first.id);
  assert.equal(timeline.playhead, 1);
  assert.equal(seekTick(timeline, 99).id, second.id, 'seek clamps to the last tick');
  assert.equal(timeline.playhead, 3);
});

test('hold is clamped, selectFrame keeps an in-hold playhead, duplicate keeps hold', async () => {
  const { setFrameHold, MAX_FRAME_HOLD, frameHold } = await import('../apps/web/src/animation/timeline.js');
  const timeline = createTimeline();
  const first = timeline.frames[0];
  setFrameHold(timeline, first.id, 0);
  assert.equal(frameHold(first), 1);
  setFrameHold(timeline, first.id, 500);
  assert.equal(frameHold(first), MAX_FRAME_HOLD);
  setFrameHold(timeline, first.id, 4);
  timeline.playhead = 2;
  selectFrame(timeline, first.id);
  assert.equal(timeline.playhead, 2);
  const copy = addFrame(timeline, { duplicate: true });
  assert.equal(frameHold(copy), 4);
  assert.equal(timeline.playhead, 4);
  deleteFrame(timeline, copy.id);
  assert.equal(timeline.playhead, 0);
});
