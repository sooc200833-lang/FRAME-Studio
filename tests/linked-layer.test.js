import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_LINKED_SCENE_CHARS, buildProjectDocument, linkedScene, parseProjectDocument, retargetProjectDocument,
} from '../apps/web/src/document/project-format.js';
import { createSceneDocument, parseSceneDocument } from '../apps/web/src/studio3d/scene-document.js';

function projectWith(layers) {
  return buildProjectDocument({
    id: 'project-a', name: '배경 테스트', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    width: 1200, height: 900, layers,
    timeline: { fps: 12, playhead: 0, nextClipId: 1, tracks: {} },
    nextLayerId: 5,
  }).doc;
}

test('a layer keeps its linked 3D scene through save and load', () => {
  const scene = createSceneDocument('room');
  const doc = projectWith([
    { id: 'layer-3', name: '3D 배경', source3d: scene },
    { id: 'layer-4', name: '투시선', guidesFor: 'layer-3' },
    { id: 'layer-1', name: '선화' },
  ]);
  const parsed = parseProjectDocument(JSON.parse(JSON.stringify(doc)), { width: 1200, height: 900 });
  const [background, guides, lines] = parsed.layers;
  assert.deepEqual(background.source3d, scene);
  assert.equal(guides.guidesFor, 'layer-3');
  assert.equal(lines.source3d, null);
  assert.equal(lines.guidesFor, null);
  // The stored scene is still a valid scene for the 3D studio.
  assert.equal(parseSceneDocument(background.source3d).dropped, 0);
});

test('linked scenes are copied, checked for shape and size', () => {
  const scene = createSceneDocument('empty');
  const copy = linkedScene(scene);
  assert.deepEqual(copy, scene);
  assert.notEqual(copy, scene);
  assert.equal(linkedScene({ format: 'other', objects: [] }), null);
  assert.equal(linkedScene({ format: 'frame-3d-scene' }), null);
  assert.equal(linkedScene('frame-3d-scene'), null);
  const huge = { ...scene, name: 'x'.repeat(MAX_LINKED_SCENE_CHARS) };
  assert.equal(linkedScene(huge), null);
});

test('a guide link to a missing layer is dropped on load', () => {
  const doc = projectWith([{ id: 'layer-4', name: '투시선', guidesFor: 'layer-9' }]);
  assert.equal(parseProjectDocument(doc, { width: 1200, height: 900 }).layers[0].guidesFor, null);
});

test('older projects without these fields still load', () => {
  const doc = projectWith([{ id: 'layer-1', name: '선화' }]);
  for (const layer of doc.layers) { delete layer.source3d; delete layer.guidesFor; }
  const parsed = parseProjectDocument(doc, { width: 1200, height: 900 });
  assert.equal(parsed.layers[0].source3d, null);
});

test('duplicating a project keeps the 3D link', () => {
  const doc = projectWith([{ id: 'layer-3', name: '3D 배경', source3d: createSceneDocument('street') }]);
  const { doc: copy } = retargetProjectDocument(doc, 'project-b');
  assert.equal(copy.layers[0].source3d.preset, 'street');
});
