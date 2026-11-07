import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IDENTITY_MOTION, applyMatrix, ease, evaluateMotionTrack, invertMatrix, isIdentityMotion,
  keyframeAt, motionMatrix, orderedKeyframes, removeKeyframe, setKeyframe,
} from '../apps/web/src/animation/motion.js';

const close = (actual, expected, epsilon = 1e-6) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} ≈ ${expected}`);

test('an empty track evaluates to identity', () => {
  assert.deepEqual(evaluateMotionTrack([], 2), { ...IDENTITY_MOTION });
  assert.ok(isIdentityMotion(evaluateMotionTrack(undefined, 0)));
});

test('setKeyframe creates, replaces and keeps easing; removeKeyframe deletes', () => {
  let track = setKeyframe([], 0, { x: 10 });
  assert.equal(track.length, 1);
  assert.equal(keyframeAt(track, 0).easing, 'easeInOut');
  track = setKeyframe(track, 0, { y: 5 }, 'linear');
  assert.equal(track.length, 1);
  assert.deepEqual({ x: keyframeAt(track, 0).x, y: keyframeAt(track, 0).y }, { x: 10, y: 5 });
  track = setKeyframe(track, 0, { rotation: 30 });
  assert.equal(keyframeAt(track, 0).easing, 'linear');
  assert.equal(removeKeyframe(track, 0).length, 0);
});

test('ticks are normalized to non-negative integers', () => {
  const track = setKeyframe([], 2.6, { x: 1 });
  assert.equal(track[0].tick, 3);
  assert.equal(setKeyframe([], -4, {})[0].tick, 0);
  assert.deepEqual(orderedKeyframes(setKeyframe(setKeyframe([], 8, {}), 2, {})).map(key => key.tick), [2, 8]);
});

test('linear interpolation between keyframes, holding outside the range', () => {
  let track = setKeyframe([], 1, { x: 0, opacity: 1 }, 'linear');
  track = setKeyframe(track, 3, { x: 100, opacity: 0 });
  assert.equal(evaluateMotionTrack(track, 0).x, 0);
  assert.equal(evaluateMotionTrack(track, 2).x, 50);
  close(evaluateMotionTrack(track, 2).opacity, 0.5);
  assert.equal(evaluateMotionTrack(track, 2.5).x, 75, 'fractional ticks interpolate during playback');
  assert.equal(evaluateMotionTrack(track, 9).x, 100);
});

test('hold easing steps and ease curves keep endpoints', () => {
  let track = setKeyframe([], 0, { x: 0 }, 'hold');
  track = setKeyframe(track, 2, { x: 80 });
  assert.equal(evaluateMotionTrack(track, 1.9).x, 0);
  assert.equal(evaluateMotionTrack(track, 2).x, 80);
  for (const easing of ['linear', 'easeIn', 'easeOut', 'easeInOut']) {
    close(ease(easing, 0), 0);
    close(ease(easing, 1), 1);
  }
  assert.ok(ease('easeIn', 0.5) < 0.5);
  assert.ok(ease('easeOut', 0.5) > 0.5);
});

test('scale interpolates geometrically', () => {
  let track = setKeyframe([], 0, { scale: 0.5 }, 'linear');
  track = setKeyframe(track, 2, { scale: 2 });
  close(evaluateMotionTrack(track, 1).scale, 1);
});

test('motion matrix rotates and scales about the canvas center and inverts', () => {
  const matrix = motionMatrix({ x: 30, y: -10, rotation: 90, scale: 2 }, 200, 100);
  const center = applyMatrix(matrix, { x: 100, y: 50 });
  close(center.x, 130);
  close(center.y, 40);
  const right = applyMatrix(matrix, { x: 110, y: 50 });
  close(right.x, 130);
  close(right.y, 60);
  const back = applyMatrix(invertMatrix(matrix), right);
  close(back.x, 110);
  close(back.y, 50);
  const identity = motionMatrix(IDENTITY_MOTION, 200, 100);
  [1, 0, 0, 1, 0, 0].forEach((value, index) => close(identity[index], value));
});
