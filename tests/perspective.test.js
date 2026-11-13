import test from 'node:test';
import assert from 'node:assert/strict';
import { OrthographicCamera, PerspectiveCamera, Vector3 } from 'three';
import { clipLine, perspectiveGuides } from '../apps/web/src/studio3d/perspective.js';

const size = { width: 800, height: 600 };
const near = (a, b, eps = 0.5) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

function camera(position, target, fov = 50) {
  const cam = new PerspectiveCamera(fov, 4 / 3, 0.1, 400);
  cam.position.set(...position);
  cam.lookAt(new Vector3(...target));
  cam.updateMatrixWorld();
  return cam;
}

test('one-point perspective: Z lines meet at the centre, X lines run flat', () => {
  const guides = perspectiveGuides(camera([0, 1.6, 10], [0, 1.6, 0]), size);
  const [x, z, y] = guides.families;
  near(z.vanishingPoint.x, 400); near(z.vanishingPoint.y, 300);
  assert.equal(x.vanishingPoint, null);
  near(Math.abs(x.screenDirection.x), 1, 1e-6);
  assert.equal(y.vanishingPoint, null, 'level camera: verticals stay vertical');
  near(Math.abs(y.screenDirection.y), 1, 1e-6);
  // Horizon is the horizontal line through the centre at eye level.
  near(guides.horizon[0].y, 300); near(guides.horizon[1].y, 300);
});

test('two-point perspective: X and Z vanish on the horizon, left and right', () => {
  const guides = perspectiveGuides(camera([10, 1.6, 10], [0, 1.6, 0]), size);
  const [x, z] = guides.families;
  assert.ok(x.vanishingPoint && z.vanishingPoint);
  near(x.vanishingPoint.y, 300); near(z.vanishingPoint.y, 300);
  assert.ok((x.vanishingPoint.x - 400) * (z.vanishingPoint.x - 400) < 0, 'on opposite sides');
});

test('looking down: verticals get a third vanishing point below the frame', () => {
  const guides = perspectiveGuides(camera([8, 9, 8], [0, 0, 0]), size);
  const y = guides.families[2];
  assert.ok(y.vanishingPoint, 'three-point');
  assert.ok(y.vanishingPoint.y > 300);
  // The horizon is above the view centre when looking down.
  assert.ok(guides.horizon[0].y < 300);
});

test('orthographic: no vanishing points and no horizon', () => {
  const cam = new OrthographicCamera(-4, 4, 3, -3, 0.1, 100);
  cam.position.set(5, 5, 5);
  cam.lookAt(0, 0, 0);
  const guides = perspectiveGuides(cam, size);
  assert.ok(guides.families.every(family => family.vanishingPoint === null && family.screenDirection));
  assert.equal(guides.horizon, null);
});

test('clipLine keeps lines inside the frame and drops misses', () => {
  const segment = clipLine({ x: 400, y: 300 }, { x: 1, y: 0 }, 800, 600);
  near(segment[0].x, 0); near(segment[1].x, 800);
  assert.equal(clipLine({ x: 400, y: -50 }, { x: 1, y: 0 }, 800, 600), null);
  const diagonal = clipLine({ x: -100, y: -100 }, { x: 1, y: 1 }, 800, 600);
  near(diagonal[0].x, 0); near(diagonal[0].y, 0); near(diagonal[1].y, 600);
});
