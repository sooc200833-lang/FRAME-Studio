import test from 'node:test';
import assert from 'node:assert/strict';
import { createSmudgeSession, normalizeSmudgeOptions, smudgeDab } from '../apps/web/src/brush/smudge-engine.js';

function image(width, height, fill = [0, 0, 0, 255]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) data.set(fill, index);
  return { width, height, data };
}

function pixel(buffer, x, y) {
  const index = (y * buffer.width + x) * 4;
  return [...buffer.data.slice(index, index + 4)];
}

test('smudge options are clamped to safe brush bounds', () => {
  assert.deepEqual(normalizeSmudgeOptions({ size: 999, strength: 2, spacing: 0 }), {
    size: 256,
    strength: 1,
    spacing: 0.08,
  });
  assert.deepEqual(normalizeSmudgeOptions({ size: 20, strength: 0.4, spacing: 0.3 }), {
    size: 20,
    strength: 0.4,
    spacing: 0.3,
  });
});

test('smudge dab blends source pixels from behind the brush into the target', () => {
  const buffer = image(9, 5, [0, 0, 255, 255]);
  const sourceIndex = (2 * buffer.width + 3) * 4;
  buffer.data.set([255, 0, 0, 255], sourceIndex);

  const touched = smudgeDab(buffer, 4, 2, 1, 0, 2.4, 1);
  assert.ok(touched > 0);
  assert.deepEqual(pixel(buffer, 4, 2), [255, 0, 0, 255]);
});

test('smudge dab leaves pixels outside its circular footprint unchanged', () => {
  const buffer = image(20, 20, [20, 40, 60, 255]);
  const before = pixel(buffer, 19, 19);
  smudgeDab(buffer, 5, 5, 1, 0, 2, 0.8);
  assert.deepEqual(pixel(buffer, 19, 19), before);
});

test('smudge dab handles canvas edges and transparent pixels safely', () => {
  const buffer = image(4, 4, [0, 0, 0, 0]);
  const touched = smudgeDab(buffer, 0, 0, -1, -1, 3, 0.7);
  assert.ok(touched >= 0);
  assert.ok(buffer.data.every(Number.isFinite));
});

test('smudge session spaces dabs along the pointer path and flushes the end', () => {
  const buffer = image(80, 20, [30, 50, 70, 255]);
  const session = createSmudgeSession(buffer, { size: 12, strength: 0.6, spacing: 0.2 });
  assert.equal(session.addPoint({ x: 5, y: 10 }), 0);
  session.addPoint({ x: 8, y: 10 });
  session.addPoint({ x: 20, y: 10 });
  session.flush();
  assert.ok(session.dabCount >= 3);
  assert.equal(session.imageData, buffer);
});

test('smudge session rejects invalid image buffers', () => {
  assert.throws(() => createSmudgeSession(null), TypeError);
  assert.throws(() => createSmudgeSession({ width: 4, height: 4 }), TypeError);
});
