import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProjectDocument, duplicateProjectName, parseProjectDocument, referencedImageKeys, retargetProjectDocument,
} from '../apps/web/src/document/project-format.js';

function sampleDoc() {
  return buildProjectDocument({
    id: 'project-a',
    name: '산책',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    width: 800,
    height: 600,
    layers: [
      { id: 'layer-1', name: '면', maskEnabled: true, maskDataUrl: 'data:image/png;base64,MASK' },
      { id: 'layer-2', name: '선' },
    ],
    timeline: {
      fps: 12, playhead: 0, nextClipId: 3,
      tracks: {
        'layer-1': { clips: [{ id: 'clip-1', hold: 1, cel: 'data:image/png;base64,CEL', transformCel: [] }] },
        'layer-2': { clips: [{ id: 'clip-2', hold: 2, cel: null, transformCel: [], strokes: [{ id: 'line-1', layerId: 'layer-2', points: [] }] }] },
      },
    },
    nextLayerId: 3,
  }).doc;
}

test('retargetProjectDocument remaps id, name, dates and every image key', () => {
  const original = sampleDoc();
  const { doc, keyMap } = retargetProjectDocument(original, 'project-b', { now: '2026-03-03T00:00:00.000Z' });
  assert.equal(doc.id, 'project-b');
  assert.equal(doc.name, '산책 사본');
  assert.equal(doc.createdAt, '2026-03-03T00:00:00.000Z');
  assert.equal(doc.updatedAt, '2026-03-03T00:00:00.000Z');
  assert.deepEqual([...referencedImageKeys(doc)].sort(), ['project-b/clip/clip-1', 'project-b/mask/layer-1']);
  assert.deepEqual([...keyMap].sort(), [
    ['project-a/clip/clip-1', 'project-b/clip/clip-1'],
    ['project-a/mask/layer-1', 'project-b/mask/layer-1'],
  ]);
  // Unreferenced images stay null; strokes are copied.
  assert.equal(doc.tracks['layer-2'].clips[0].celImage, null);
  assert.equal(doc.tracks['layer-2'].clips[0].strokes[0].id, 'line-1');
});

test('retargetProjectDocument does not mutate the original', () => {
  const original = sampleDoc();
  const snapshot = structuredClone(original);
  const { doc } = retargetProjectDocument(original, 'project-b', { name: '새 이름' });
  doc.tracks['layer-2'].clips[0].strokes[0].id = 'changed';
  assert.deepEqual(original, snapshot);
  assert.equal(doc.name, '새 이름');
});

test('a retargeted document still parses', () => {
  const { doc } = retargetProjectDocument(sampleDoc(), 'project-b');
  const parsed = parseProjectDocument(doc, { width: 800, height: 600 });
  assert.equal(parsed.id, 'project-b');
  assert.equal(parsed.layers.length, 2);
});

test('retargetProjectDocument rejects bad input', () => {
  assert.throws(() => retargetProjectDocument(null, 'x'), TypeError);
  assert.throws(() => retargetProjectDocument(sampleDoc(), ''), TypeError);
});

test('duplicateProjectName avoids clashes', () => {
  assert.equal(duplicateProjectName('산책', []), '산책 사본');
  assert.equal(duplicateProjectName('산책', ['산책 사본']), '산책 사본 2');
  assert.equal(duplicateProjectName('산책', ['산책 사본', '산책 사본 2']), '산책 사본 3');
  assert.equal(duplicateProjectName('  ', []), '제목 없음 사본');
});
