import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPORT_FORMATS, exportFileName, gifFrameDelays, resolveExportPlan, sequenceFileNames } from '../apps/web/src/export/export-plan.js';

test('single PNG exports only the playhead frame, clamped', () => {
  const plan = resolveExportPlan({ format: 'png', totalTicks: 10, playhead: 4, width: 1200, height: 900 });
  assert.deepEqual(plan.ticks, [4]);
  assert.equal(resolveExportPlan({ format: 'png', totalTicks: 3, playhead: 9, width: 10, height: 10 }).ticks[0], 2);
});

test('animated formats export the whole timeline or a clamped range', () => {
  assert.deepEqual(resolveExportPlan({ format: 'gif', totalTicks: 4, width: 100, height: 100 }).ticks, [0, 1, 2, 3]);
  assert.deepEqual(resolveExportPlan({ format: 'gif', totalTicks: 10, range: { start: 2, end: 5 }, width: 100, height: 100 }).ticks, [2, 3, 4, 5]);
  assert.deepEqual(resolveExportPlan({ format: 'mp4', totalTicks: 5, range: { start: 4, end: 1 }, width: 100, height: 100 }).ticks, [4]);
  assert.deepEqual(resolveExportPlan({ format: 'webm', totalTicks: 5, range: { start: -3, end: 99 }, width: 100, height: 100 }).ticks, [0, 1, 2, 3, 4]);
});

test('video sizes are even; image sizes follow the scale', () => {
  const video = resolveExportPlan({ format: 'mp4', totalTicks: 1, scale: 0.33, width: 1200, height: 900 });
  assert.equal(video.width % 2, 0);
  assert.equal(video.height % 2, 0);
  assert.deepEqual([video.width, video.height], [396, 296]);
  const gif = resolveExportPlan({ format: 'gif', totalTicks: 1, scale: 0.5, width: 1200, height: 900 });
  assert.deepEqual([gif.width, gif.height], [600, 450]);
});

test('timing and duration follow fps', () => {
  const plan = resolveExportPlan({ format: 'mp4', totalTicks: 24, fps: 12, width: 100, height: 100 });
  assert.equal(plan.durationSeconds, 2);
  assert.ok(Math.abs(plan.frameDurationMs - 83.333) < 0.01);
  assert.throws(() => resolveExportPlan({ format: 'avi', width: 1, height: 1 }));
  assert.ok(Object.values(EXPORT_FORMATS).every(format => format.extension));
});

test('GIF delays keep the total length right despite centisecond rounding', () => {
  const delays = gifFrameDelays(12, 12);
  assert.equal(delays.reduce((sum, delay) => sum + delay, 0), 100);
  assert.ok(delays.every(delay => delay === 8 || delay === 9));
  assert.ok(gifFrameDelays(3, 60).every(delay => delay >= 2), 'browsers ignore delays under 2 cs');
});

test('file names are safe and sequence names sort correctly', () => {
  const date = new Date(2026, 10, 8, 9, 5);
  assert.equal(exportFileName('내 작품: 1/2', 'gif', date), '내 작품 1 2-20261108-0905.gif');
  assert.equal(exportFileName('', 'mp4', date), 'frame-studio-20261108-0905.mp4');
  assert.deepEqual(sequenceFileNames(3), ['frame-0001.png', 'frame-0002.png', 'frame-0003.png']);
  assert.equal(sequenceFileNames(12345)[0], 'frame-00001.png');
});
