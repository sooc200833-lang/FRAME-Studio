import test from 'node:test';
import assert from 'node:assert/strict';
import {
  coalescedPointerEvents,
  createFrameScheduler,
  normalizePointerPressure,
  stabilizePoint,
} from '../apps/web/src/brush/brush-engine.js';

test('mouse and touch use a stable neutral pressure', () => {
  assert.equal(normalizePointerPressure({ pointerType: 'mouse', pressure: 1 }), 0.5);
  assert.equal(normalizePointerPressure({ pointerType: 'touch', pressure: 0.8 }), 0.5);
});

test('pen pressure is clamped and can be disabled', () => {
  assert.equal(normalizePointerPressure({ pointerType: 'pen', pressure: 0.8 }), 0.8);
  assert.equal(normalizePointerPressure({ pointerType: 'pen', pressure: 2 }), 1);
  assert.equal(normalizePointerPressure({ pointerType: 'pen', pressure: 0.8 }, false), 0.5);
});

test('stabilization eases jitter but keeps fast movement responsive', () => {
  const previous = { x: 0, y: 0 };
  const jittered = stabilizePoint(previous, { x: 10, y: 0 }, 0.5);
  const responsive = stabilizePoint(previous, { x: 200, y: 0 }, 0.5);
  assert.ok(jittered.x > 0 && jittered.x < 10);
  assert.ok(responsive.x > jittered.x);
  assert.deepEqual(stabilizePoint(previous, { x: 10, y: 2 }, 0), { x: 10, y: 2 });
});

test('coalesced pointer samples are used when available', () => {
  const samples = [{ x: 1 }, { x: 2 }];
  assert.deepEqual(coalescedPointerEvents({ getCoalescedEvents: () => samples }), samples);
  const event = { x: 3 };
  assert.deepEqual(coalescedPointerEvents(event), [event]);
});

function outlineThickness(points) {
  const ys = points.map(point => point[1]);
  return Math.max(...ys) - Math.min(...ys);
}

test('coalesced pointer samples preserve inherited event coordinates and final sample', () => {
  const sample = { clientX: 10, clientY: 20, pressure: 0.4, pointerType: 'pen' };
  const prototype = { clientX: 30, clientY: 40, pressure: 0.8, pointerType: 'pen' };
  const event = Object.assign(Object.create(prototype), {
    getCoalescedEvents: () => [sample],
  });
  const result = coalescedPointerEvents(event);
  assert.equal(result.length, 2);
  assert.equal(result[1].clientX, 30);
  assert.equal(result[1].clientY, 40);
  assert.equal(result[1].pressure, 0.8);
  assert.equal(result[1].pointerType, 'pen');
  assert.equal('getCoalescedEvents' in result[1], false);
});

test('brush preview scheduler coalesces many pointer updates into one frame', () => {
  const callbacks = new Map();
  const cancelled = [];
  const rendered = [];
  let nextId = 1;
  const scheduler = createFrameScheduler(
    () => rendered.push('render'),
    {
      requestFrame(callback) {
        const id = nextId++;
        callbacks.set(id, callback);
        return id;
      },
      cancelFrame(id) {
        cancelled.push(id);
        callbacks.delete(id);
      },
    },
  );

  scheduler.schedule();
  scheduler.schedule();
  scheduler.schedule();
  assert.equal(callbacks.size, 1);
  assert.equal(scheduler.pending, true);
  callbacks.get(1)();
  assert.deepEqual(rendered, ['render']);
  assert.equal(scheduler.pending, false);

  scheduler.schedule();
  callbacks.get(2)();
  assert.deepEqual(rendered, ['render', 'render']);
});

test('cancelling a pending brush preview prevents a stale render', () => {
  const callbacks = new Map();
  const cancelled = [];
  let rendered = 0;
  const scheduler = createFrameScheduler(
    () => rendered++,
    {
      requestFrame(callback) { callbacks.set(7, callback); return 7; },
      cancelFrame(id) { cancelled.push(id); callbacks.delete(id); },
    },
  );
  scheduler.schedule();
  scheduler.cancel();
  assert.deepEqual(cancelled, [7]);
  assert.equal(scheduler.pending, false);
  assert.equal(rendered, 0);
  callbacks.get(7)?.();
  assert.equal(rendered, 0);
});

test('disposed brush preview scheduler ignores future updates', () => {
  let requested = 0;
  let rendered = 0;
  const scheduler = createFrameScheduler(
    () => rendered++,
    {
      requestFrame() { requested++; return requested; },
      cancelFrame() {},
    },
  );
  scheduler.dispose();
  scheduler.schedule();
  assert.equal(requested, 0);
  assert.equal(rendered, 0);
});
