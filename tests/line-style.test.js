import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_LINE_HAND, LINE_STYLES, LINE_STYLE_IDS, distanceTaper, lineStyleParams, normalizeLineHand, normalizeLineStyle } from '../apps/web/src/studio3d/line-style.js';
import { createSceneDocument, parseSceneDocument, serializeScene } from '../apps/web/src/studio3d/scene-document.js';

test('clean style is the old ink: equal widths, no irregularity', () => {
  const clean = lineStyleParams('clean', 1);
  assert.equal(clean.outline, 1);
  assert.equal(clean.crease, 1);
  for (const key of ['taper', 'wobble', 'jitter', 'grain', 'breakup', 'sketch']) assert.equal(clean[key], 0, key);
  assert.equal(clean.opacity, 1);
});

test('hand-drawn styles: thick outlines, thinner folds, distant lines thinner', () => {
  for (const id of ['pen', 'pencil', 'brush']) {
    const style = LINE_STYLES[id];
    assert.ok(style.outline > style.crease, `${id}: outlines heavier than folds`);
    assert.ok(style.taper > 0, `${id}: tapers with distance`);
    assert.ok(style.wobble > 0, `${id}: wobbles`);
  }
  assert.ok(LINE_STYLES.pencil.grain > 0 && LINE_STYLES.pencil.sketch > 0, 'pencil has tooth and a sketch line');
  assert.ok(LINE_STYLES.brush.breakup > 0 && LINE_STYLES.brush.jitter > LINE_STYLES.pen.jitter, 'brush skips and varies most');
});

test('hand amount scales only the irregular parts', () => {
  const none = lineStyleParams('brush', 0);
  const full = lineStyleParams('brush', 1);
  const half = lineStyleParams('brush', 0.5);
  for (const key of ['wobble', 'jitter', 'grain', 'breakup', 'sketch']) {
    assert.equal(none[key], 0, key);
    assert.ok(Math.abs(half[key] - full[key] / 2) < 1e-12, key);
  }
  for (const key of ['outline', 'crease', 'taper', 'wobbleSize', 'opacity']) assert.equal(none[key], full[key], key);
});

test('unknown styles and amounts fall back safely', () => {
  assert.equal(normalizeLineStyle('crayon'), 'clean');
  assert.equal(normalizeLineStyle(undefined), 'clean');
  assert.equal(normalizeLineHand('x'), DEFAULT_LINE_HAND);
  assert.equal(normalizeLineHand(3), 1);
  assert.equal(normalizeLineHand(-1), 0);
  assert.deepEqual(lineStyleParams('nope', 0.5), lineStyleParams('clean', 0.5));
  assert.deepEqual(LINE_STYLE_IDS, ['clean', 'pen', 'pencil', 'brush']);
});

test('distance taper: full width up close, thinner far away, never below the floor', () => {
  assert.equal(distanceTaper(3, 1), 1);
  assert.ok(Math.abs(distanceTaper(16, 1) - 0.5) < 1e-12);
  assert.equal(distanceTaper(1000, 1), 0.35);
  assert.equal(distanceTaper(1000, 0), 1, 'no taper');
  assert.ok(Math.abs(distanceTaper(16, 0.5) - 0.75) < 1e-12);
});

test('scenes keep their line style; old scenes open with clean lines', () => {
  const fresh = createSceneDocument('room');
  assert.equal(fresh.render.lineStyle, 'pen', 'new scenes start with pen lines');
  const saved = parseSceneDocument(JSON.parse(serializeScene({ ...fresh, render: { ...fresh.render, lineStyle: 'pencil', lineHand: 0.3 } }))).doc;
  assert.equal(saved.render.lineStyle, 'pencil');
  assert.equal(saved.render.lineHand, 0.3);
  const old = JSON.parse(serializeScene(fresh));
  delete old.render.lineStyle;
  delete old.render.lineHand;
  const opened = parseSceneDocument(old).doc;
  assert.equal(opened.render.lineStyle, 'clean');
  assert.equal(opened.render.lineHand, DEFAULT_LINE_HAND);
  assert.equal(parseSceneDocument({ ...old, render: { ...old.render, lineStyle: 'laser', lineHand: 9 } }).doc.render.lineHand, 1);
});
