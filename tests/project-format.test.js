import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROJECT_FORMAT, PROJECT_VERSION, buildProjectDocument, clipImageKey, migrateProjectDocument,
  parseProjectDocument, referencedImageKeys,
} from '../apps/web/src/document/project-format.js';

const timeline = {
  fps: 8,
  playhead: 3,
  nextClipId: 5,
  tracks: {
    'layer-1': { clips: [{ id: 'clip-1', hold: 2, cel: 'data:image/png;base64,AAA', transformCel: [] }, { id: 'clip-2', hold: 1, cel: null, transformCel: [] }] },
    vector: { clips: [{ id: 'clip-3', hold: 4, cel: null, transformCel: [], strokes: [{ id: 'line-1', points: [{ x: 1, y: 2 }] }] }] },
  },
};
const layers = [
  { id: 'layer-1', name: '선화', visible: true, opacity: 0.8, blendMode: 'multiply', groupId: 'group-1', maskEnabled: true, maskDataUrl: 'data:mask', motionTrack: [{ tick: 2, x: 10 }] },
  { id: 'layer-2', name: '배경', visible: false, opacity: 1, blendMode: 'normal', groupId: null, maskEnabled: false, motionTrack: [] },
];

function build() {
  return buildProjectDocument({
    id: 'p1', name: '테스트', width: 1200, height: 900, layers, groups: [{ id: 'group-1', name: '그룹 1' }],
    timeline, active: 1, activeTrackId: 'vector', nextLayerId: 3, updatedAt: '2026-11-07T00:00:00.000Z',
  });
}

test('build keeps images out of the JSON and lists them by key', () => {
  const { doc, images } = build();
  assert.equal(doc.format, PROJECT_FORMAT);
  assert.equal(doc.version, PROJECT_VERSION);
  assert.ok(!JSON.stringify(doc).includes('base64'));
  assert.deepEqual(images.map(image => image.key).sort(), ['p1/clip/clip-1', 'p1/mask/layer-1']);
  assert.equal(doc.tracks['layer-1'].clips[0].celImage, clipImageKey('p1', 'clip-1'));
  assert.equal(doc.tracks['layer-1'].clips[1].celImage, null);
  assert.deepEqual(doc.tracks.vector.clips[0].strokes[0].points, [{ x: 1, y: 2 }]);
  assert.deepEqual(referencedImageKeys(doc), new Set(images.map(image => image.key)));
});

test('a built document survives a JSON round trip and parses back', () => {
  const { doc } = build();
  const parsed = parseProjectDocument(JSON.parse(JSON.stringify(doc)), { width: 1200, height: 900 });
  assert.equal(parsed.name, '테스트');
  assert.equal(parsed.fps, 8);
  assert.equal(parsed.playhead, 3);
  assert.equal(parsed.active, 1);
  assert.equal(parsed.activeTrackId, 'vector');
  assert.equal(parsed.layers[0].opacity, 0.8);
  assert.equal(parsed.layers[0].blendMode, 'multiply');
  assert.equal(parsed.layers[0].groupId, 'group-1');
  assert.equal(parsed.layers[1].visible, false);
  assert.deepEqual(parsed.layers[0].motionTrack, [{ tick: 2, x: 10 }]);
  assert.equal(parsed.tracks['layer-1'].clips[0].hold, 2);
  assert.equal(parsed.tracks.vector.clips[0].strokes.length, 1);
});

test('id counters stay above every saved id', () => {
  const { doc } = build();
  doc.nextClipId = 1;
  doc.nextLayerId = 1;
  const parsed = parseProjectDocument(doc);
  assert.equal(parsed.nextClipId, 4);
  assert.equal(parsed.nextLayerId, 3);
});

test('broken parts are dropped instead of failing the project', () => {
  const { doc } = build();
  doc.layers.push(null, { name: 'no id' });
  doc.layers[0].groupId = 'missing-group';
  doc.groups = [];
  doc.tracks.broken = { clips: [null, { hold: 2 }] };
  doc.layers[0].motionTrack.push({ tick: 'x' });
  doc.active = 99;
  const parsed = parseProjectDocument(doc);
  assert.equal(parsed.layers.length, 2);
  assert.equal(parsed.layers[0].groupId, null);
  assert.equal(parsed.tracks.broken, undefined);
  assert.equal(parsed.layers[0].motionTrack.length, 1);
  assert.equal(parsed.active, 1);
});

test('rejects foreign, future-version, empty and wrong-size documents', () => {
  assert.throws(() => migrateProjectDocument(null));
  assert.throws(() => migrateProjectDocument({ format: 'other' }));
  assert.throws(() => migrateProjectDocument({ format: PROJECT_FORMAT, version: PROJECT_VERSION + 1 }));
  const { doc } = build();
  assert.throws(() => parseProjectDocument({ ...doc, layers: [] }));
  assert.throws(() => parseProjectDocument(doc, { width: 800, height: 600 }));
});
