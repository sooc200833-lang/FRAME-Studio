import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Box3, MeshBasicMaterial, Vector3 } from 'three';
import { BUILDER_TYPES, buildSceneObject } from '../apps/web/src/studio3d/builders.js';
import { OBJECT_TYPES, OBJECT_TYPE_IDS, SCENE_PRESETS, createSceneDocument } from '../apps/web/src/studio3d/scene-document.js';
import { containRect } from '../apps/web/src/handoff/handoff-store.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('every object type has a builder whose shape fits its base size', () => {
  assert.deepEqual([...BUILDER_TYPES].sort(), [...OBJECT_TYPE_IDS].sort());
  const material = new MeshBasicMaterial();
  for (const type of OBJECT_TYPE_IDS) {
    const group = buildSceneObject({ id: `t-${type}`, type, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, material);
    group.updateMatrixWorld(true);
    const size = new Box3().setFromObject(group).getSize(new Vector3());
    const [w, h, d] = OBJECT_TYPES[type].size;
    // Details (handles, window frames, lamp arms) may stick out a little.
    assert.ok(size.x <= w * 1.9 + 0.2 && size.y <= h * 1.15 + 0.05 && size.z <= d * 1.9 + 0.2, `${type} ${size.toArray().map(v => v.toFixed(2))}`);
    assert.ok(size.y >= h * 0.85, `${type} uses its height`);
    group.traverse(node => { if (node.isMesh) assert.equal(node.userData.sceneId, `t-${type}`); });
  }
});

test('preset objects sit on or above the ground', () => {
  for (const preset of Object.keys(SCENE_PRESETS)) {
    for (const item of createSceneDocument(preset).objects) {
      const group = buildSceneObject(item, new MeshBasicMaterial());
      group.updateMatrixWorld(true);
      const box = new Box3().setFromObject(group);
      assert.ok(box.min.y > -0.2, `${preset}/${item.type} bottom ${box.min.y.toFixed(2)}`);
    }
  }
});

test('the lobby links to both workspaces and each workspace links back', async () => {
  const lobby = await read('apps/web/index.html');
  assert.match(lobby, /href="\.\/drawing\.html"/);
  assert.match(lobby, /href="\.\/background-studio\.html"/);
  for (const page of ['apps/web/drawing.html', 'apps/web/background-studio.html']) {
    assert.match(await read(page), /href="\.\/"[^>]*로비/, `${page} links back to the lobby`);
  }
  assert.match(await read('apps/web/drawing.html'), /href="\.\/background-studio\.html"/);
});

test('every page is a build input', async () => {
  const config = await read('vite.config.js');
  for (const page of ['index.html', 'drawing.html', 'background-studio.html']) assert.match(config, new RegExp(page.replace('.', '\\.')));
});

test('3D studio ids referenced from code exist exactly once in its page', async () => {
  const html = await read('apps/web/background-studio.html');
  const code = await read('apps/web/src/studio3d/studio.js');
  const ids = new Set([...code.matchAll(/\$\('([A-Za-z0-9_-]+)'\)/g)].map(match => match[1]));
  assert.ok(ids.size > 20, 'sees the ids');
  for (const id of ids) assert.equal(html.split(`id="${id}"`).length - 1, 1, `#${id}`);
});

test('contain fit centres the image inside the canvas', () => {
  assert.deepEqual(containRect(1200, 900, 1200, 900), { x: 0, y: 0, width: 1200, height: 900 });
  assert.deepEqual(containRect(1200, 675, 1200, 900), { x: 0, y: 113, width: 1200, height: 675 });
  assert.deepEqual(containRect(900, 1200, 1200, 900), { x: 263, y: 0, width: 675, height: 900 });
});
