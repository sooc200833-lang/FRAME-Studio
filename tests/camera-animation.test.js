import test from 'node:test';
import assert from 'node:assert/strict';
import {
  animationFrames, boilStep, cameraAt, createCameraAnimation, isAnimated, normalizeCameraAnimation,
  removeCameraKey, retimeHolds, setAnimationLength, setCameraKey,
} from '../apps/web/src/studio3d/camera-animation.js';

const near = (actual, expected, eps = 1e-9) => assert.ok(Math.abs(actual - expected) <= eps, `${actual} ≈ ${expected}`);
const cam = (x, fov = 50, zoom = 1) => ({ position: [x, 2, 10], target: [x, 1, 0], fov, zoom });

test('without keys the scene camera is used; keys hold before the first and after the last', () => {
  let animation = createCameraAnimation();
  assert.deepEqual(cameraAt(animation, cam(3), 5), cam(3));
  animation = setCameraKey(animation, 4, cam(0));
  animation = setCameraKey(animation, 12, cam(8));
  assert.deepEqual(cameraAt(animation, cam(99), 0).position, [0, 2, 10]);
  assert.deepEqual(cameraAt(animation, cam(99), 20).position, [8, 2, 10]);
});

test('between keys the camera eases; linear keys move evenly', () => {
  let animation = createCameraAnimation();
  animation = setCameraKey(animation, 0, cam(0, 40, 1), 'linear');
  animation = setCameraKey(animation, 10, cam(10, 60, 4));
  const middle = cameraAt(animation, cam(0), 5);
  near(middle.position[0], 5);
  near(middle.target[0], 5);
  near(middle.fov, 50);
  near(middle.zoom, 2, 1e-12); // geometric: halfway between ×1 and ×4
  const smooth = setCameraKey(animation, 0, cam(0, 40, 1), 'easeInOut');
  assert.ok(cameraAt(smooth, cam(0), 2).position[0] < 2, 'eases in slowly');
  near(cameraAt(smooth, cam(0), 5).position[0], 5);
});

test('keys are replaced at the same frame and removed; length trims keys', () => {
  let animation = createCameraAnimation();
  animation = setCameraKey(animation, 3, cam(1), 'linear');
  animation = setCameraKey(animation, 3, cam(2));
  assert.equal(animation.keys.length, 1);
  assert.equal(animation.keys[0].position[0], 2);
  assert.equal(animation.keys[0].easing, 'linear', 'keeps the easing when not given');
  animation = setCameraKey(animation, 20, cam(5));
  assert.deepEqual(animation.keys.map(key => key.tick), [3, 20]);
  assert.deepEqual(setAnimationLength(animation, 10).keys.map(key => key.tick), [3]);
  assert.equal(removeCameraKey(animation, 3).keys.length, 1);
  assert.equal(setCameraKey(animation, 500, cam(0)).keys.at(-1).tick, animation.length - 1, 'clamped to the last frame');
});

test('boil steps follow the rhythm in real time', () => {
  // 12 fps, 4 redraws per second → a new drawing every 3 frames.
  assert.deepEqual(Array.from({ length: 9 }, (_, tick) => boilStep(tick, 12, 4)), [0, 0, 0, 1, 1, 1, 2, 2, 2]);
  // 12 fps, 12 per second → every frame.
  assert.deepEqual(Array.from({ length: 4 }, (_, tick) => boilStep(tick, 12, 12)), [0, 1, 2, 3]);
  // 24 fps, 8 per second → every 3 frames.
  assert.equal(boilStep(5, 24, 8), 1);
  assert.equal(boilStep(6, 24, 8), 2);
  assert.equal(boilStep(7, 12, 0), 0, 'off');
});

test('frames: a still camera with boil becomes held drawings', () => {
  const animation = { ...createCameraAnimation(), length: 12, boil: 4 };
  const frames = animationFrames(animation, cam(1));
  assert.deepEqual(frames.map(frame => frame.hold), [3, 3, 3, 3]);
  assert.deepEqual(frames.map(frame => frame.step), [0, 1, 2, 3]);
  assert.equal(frames.reduce((sum, frame) => sum + frame.hold, 0), 12);
});

test('frames: a moving camera gives one frame per tick, still stretches are merged', () => {
  let animation = { ...createCameraAnimation(), length: 10 };
  animation = setCameraKey(animation, 0, cam(0), 'linear');
  animation = setCameraKey(animation, 4, cam(4), 'linear');
  const frames = animationFrames(animation, cam(0));
  // Ticks 0–4 move; ticks 4–9 hold the last key → one frame held 6.
  assert.deepEqual(frames.map(frame => frame.hold), [1, 1, 1, 1, 6]);
  assert.deepEqual(frames.map(frame => frame.tick), [0, 1, 2, 3, 4]);
});

test('isAnimated: two keys or boil, and more than one frame', () => {
  const base = createCameraAnimation();
  assert.equal(isAnimated(base), false);
  assert.equal(isAnimated(setCameraKey(base, 0, cam(0))), false, 'one key is a still');
  assert.equal(isAnimated({ ...base, boil: 8 }), true);
  assert.equal(isAnimated({ ...base, boil: 8, length: 1 }), false);
  assert.equal(isAnimated(setCameraKey(setCameraKey(base, 0, cam(0)), 5, cam(1))), true);
});

test('retime keeps frames at the same moment at another frame rate', () => {
  // 12 → 24 fps doubles every hold.
  assert.deepEqual(retimeHolds([3, 3, 6], 12, 24).map(item => item.hold), [6, 6, 12]);
  // 24 → 12 fps: total time kept; frames with no time left are dropped.
  const half = retimeHolds([1, 1, 1, 1, 2], 24, 12);
  assert.equal(half.reduce((sum, item) => sum + item.hold, 0), 3);
  assert.ok(half.every(item => item.hold >= 1));
  // Same rate: unchanged.
  assert.deepEqual(retimeHolds([2, 5], 12, 12), [{ index: 0, hold: 2 }, { index: 1, hold: 5 }]);
});

test('stored animations are validated', () => {
  const animation = normalizeCameraAnimation({ fps: 30, length: 9999, boil: 5, keys: [{ tick: 2, position: [1, 2, 3], target: 'x', fov: 500, easing: 'bounce' }, { tick: -1 }, null] });
  assert.equal(animation.fps, 12);
  assert.equal(animation.length, 240);
  assert.equal(animation.boil, 0);
  assert.equal(animation.keys.length, 1);
  assert.deepEqual(animation.keys[0].position, [1, 2, 3]);
  assert.equal(animation.keys[0].fov, 100);
  assert.equal(animation.keys[0].easing, 'easeInOut');
  assert.deepEqual(normalizeCameraAnimation(undefined), createCameraAnimation());
});
