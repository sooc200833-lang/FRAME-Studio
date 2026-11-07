import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IDENTITY_MOTION, applyMatrix, ease, evaluateMotionTrack, invertMatrix, isIdentityMotion,
  keyframeAt, motionMatrix, orderedKeyframes, removeKeyframe, setKeyframe,
} from '../apps/web/src/animation/motion.js';

const close = (actual, expected, epsilon = 1e-6) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} ≈ ${expected}`);
const frames = ['f1', 'f2', 'f3', 'f4', 'f5'];

test('an empty track evaluates to identity', () => {
  assert.deepEqual(evaluateMotionTrack([], frames, 2), { ...IDENTITY_MOTION });
  assert.ok(isIdentityMotion(evaluateMotionTrack(undefined, frames, 0)));
});

test('setKeyframe creates, replaces and keeps easing; removeKeyframe deletes', () => {
  let track = setKeyframe([], 'f1', { x: 10 });
  assert.equal(track.length, 1);
  assert.equal(keyframeAt(track, 'f1').easing, 'easeInOut');
  track = setKeyframe(track, 'f1', { y: 5 }, 'linear');
  assert.equal(track.length, 1);
  assert.deepEqual({ x: keyframeAt(track, 'f1').x, y: keyframeAt(track, 'f1').y }, { x: 10, y: 5 });
  track = setKeyframe(track, 'f1', { rotation: 30 });
  assert.equal(keyframeAt(track, 'f1').easing, 'linear');
  assert.equal(removeKeyframe(track, 'f1').length, 0);
});

test('linear interpolation between keyframes, holding outside the range', () => {
  let track = setKeyframe([], 'f2', { x: 0, opacity: 1 }, 'linear');
  track = setKeyframe(track, 'f4', { x: 100, opacity: 0 });
  assert.equal(evaluateMotionTrack(track, frames, 0).x, 0);
  assert.equal(evaluateMotionTrack(track, frames, 2).x, 50);
  close(evaluateMotionTrack(track, frames, 2).opacity, 0.5);
  assert.equal(evaluateMotionTrack(track, frames, 4).x, 100);
});

test('hold easing steps and ease curves keep endpoints', () => {
  let track = setKeyframe([], 'f1', { x: 0 }, 'hold');
  track = setKeyframe(track, 'f3', { x: 80 });
  assert.equal(evaluateMotionTrack(track, frames, 1.9).x, 0);
  assert.equal(evaluateMotionTrack(track, frames, 2).x, 80);
  for (const easing of ['linear', 'easeIn', 'easeOut', 'easeInOut']) {
    close(ease(easing, 0), 0);
    close(ease(easing, 1), 1);
  }
  assert.ok(ease('easeIn', 0.5) < 0.5);
  assert.ok(ease('easeOut', 0.5) > 0.5);
});

test('scale interpolates geometrically', () => {
  let track = setKeyframe([], 'f1', { scale: 0.5 }, 'linear');
  track = setKeyframe(track, 'f3', { scale: 2 });
  close(evaluateMotionTrack(track, frames, 1).scale, 1);
});

test('keyframes follow their frame when frames are reordered or deleted', () => {
  let track = setKeyframe([], 'f2', { x: 10 });
  track = setKeyframe(track, 'f5', { x: 50 });
  assert.deepEqual(orderedKeyframes(track, ['f5', 'f2']).map(key => key.frameId), ['f5', 'f2']);
  // Deleting f5 leaves only the f2 keyframe, which is then held everywhere.
  assert.equal(evaluateMotionTrack(track, ['f1', 'f2', 'f3'], 2).x, 10);
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
  assert.deepEqual(motionMatrix(IDENTITY_MOTION, 200, 100).map(value => Math.round(value * 1e9) / 1e9), [1, 0, -0, 1, 0, 0]);
});
