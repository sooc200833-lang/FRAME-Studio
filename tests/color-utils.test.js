import test from 'node:test';
import assert from 'node:assert/strict';
import { hexToHsv, hexToRgb, hsvToHex, rgbToHex, rgbToHsv, sampleImageDataColor } from '../apps/web/src/color/color-utils.js';

test('hex and rgb conversions round-trip and reject invalid input', () => {
  assert.deepEqual(hexToRgb('#24242a'), [36, 36, 42]);
  assert.deepEqual(hexToRgb('E5B85C'), [229, 184, 92]);
  assert.equal(hexToRgb('#abc'), null);
  assert.equal(rgbToHex(36, 36, 42), '#24242a');
  assert.equal(rgbToHex(300, -4, 12.6), '#ff000d');
});

test('rgb/hsv conversions cover primaries and greys', () => {
  assert.deepEqual(rgbToHsv(255, 0, 0), { h: 0, s: 1, v: 1 });
  assert.equal(rgbToHsv(0, 255, 0).h, 120);
  assert.equal(rgbToHsv(0, 0, 255).h, 240);
  assert.deepEqual(rgbToHsv(128, 128, 128), { h: 0, s: 0, v: 128 / 255 });
  assert.equal(hsvToHex(0, 1, 1), '#ff0000');
  assert.equal(hsvToHex(360, 1, 1), '#ff0000');
  assert.equal(hsvToHex(200, 0, 0), '#000000');
});

test('hex → hsv → hex is stable for palette colors', () => {
  for (const hex of ['#24242a', '#e5b85c', '#3c6c9e', '#f2c6c7', '#ffffff', '#000000', '#4f8a62']) {
    const { h, s, v } = hexToHsv(hex);
    assert.equal(hsvToHex(h, s, v), hex);
  }
});

test('eyedropper sampling averages a neighborhood and composites transparency over paper', () => {
  const width = 3;
  const height = 3;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index++) {
    data.set([200, 100, 0, 255], index * 4);
  }
  assert.equal(sampleImageDataColor(data, width, height, 1, 1), '#c86400');

  const transparent = new Uint8ClampedArray(width * height * 4);
  assert.equal(sampleImageDataColor(transparent, width, height, 1, 1, { background: '#f4f0e8' }), '#f4f0e8');
  assert.equal(sampleImageDataColor(data, width, height, 5, 1), null);
});

test('eyedropper radius 0 reads one pixel', () => {
  const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]);
  assert.equal(sampleImageDataColor(data, 2, 1, 1, 0, { radius: 0 }), '#0000ff');
});
