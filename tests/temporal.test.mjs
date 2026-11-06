import test from 'node:test';
import assert from 'node:assert/strict';
import { createTemporalState } from '../dist/esm/index.js';

test('returns the last state at or before a point in time', () => {
  const state = createTemporalState();
  state.set('cart', 10, { items: 1 });
  state.set('cart', 20, { items: 2 });
  assert.deepEqual(state.getAt('cart', 19), { items: 1 });
  assert.deepEqual(state.getAt('cart', 20), { items: 2 });
  assert.equal(state.getAt('cart', 9), undefined);
});

test('clones values when writing and reading', () => {
  const state = createTemporalState();
  const value = { list: [1] };
  state.set('x', 1, value);
  value.list.push(2);
  const read = state.getAt('x', 1);
  read.list.push(3);
  assert.deepEqual(state.getAt('x', 1), { list: [1] });
});

test('records deletion and allows a later recreation', () => {
  const state = createTemporalState();
  state.set('x', 1, 1);
  state.delete('x', 2);
  state.set('x', 3, 3);
  assert.equal(state.getAt('x', 2), undefined);
  assert.equal(state.getAt('x', 3), 3);
});

test('preserves append order for equal timestamps', () => {
  const state = createTemporalState();
  state.set('x', 4, 'first');
  state.set('x', 4, 'second');
  assert.equal(state.getAt('x', 4), 'second');
});

test('rejects per-key out-of-order writes', () => {
  const state = createTemporalState();
  state.set('x', 10, 'later');
  assert.throws(() => state.set('x', 9, 'earlier'), { code: 'out-of-order' });
});

test('builds a point-in-time snapshot excluding absent and deleted keys', () => {
  const state = createTemporalState();
  state.set('a', 1, true);
  state.set('b', 1, null);
  state.delete('a', 2);
  assert.deepEqual(state.snapshotAt(1), { a: true, b: null });
  assert.deepEqual(state.snapshotAt(2), { b: null });
  assert.equal(Object.isFrozen(state.snapshotAt(2)), true);
});

test('compaction preserves the cutoff baseline and newer history', () => {
  const state = createTemporalState();
  state.set('x', 1, 'one');
  state.set('x', 3, 'three');
  state.set('x', 7, 'seven');
  assert.equal(state.compact(5), 1);
  assert.equal(state.getAt('x', 5), 'three');
  assert.equal(state.getAt('x', 7), 'seven');
  assert.throws(() => state.getAt('x', 4), { code: 'pruned' });
  assert.deepEqual(state.snapshot(), {
    events: 2,
    keys: 1,
    oldestAvailableAt: 5,
    latestAt: 7,
  });
});

test('compaction keeps a deletion baseline', () => {
  const state = createTemporalState();
  state.set('x', 1, 'present');
  state.delete('x', 2);
  assert.equal(state.compact(4), 1);
  assert.equal(state.getAt('x', 4), undefined);
  assert.deepEqual(state.snapshotAt(4), {});
});

test('rejects backward compaction and writes before the watermark', () => {
  const state = createTemporalState();
  state.set('x', 3, 1);
  state.compact(5);
  assert.throws(() => state.compact(4), { code: 'conflict' });
  assert.throws(() => state.set('x', 4, 2), { code: 'pruned' });
});

test('enforces event and key limits without dropping history', () => {
  const state = createTemporalState({ maxEvents: 1, maxKeys: 1 });
  state.set('x', 1, true);
  assert.throws(() => state.set('x', 2, false), { code: 'capacity' });
  assert.throws(() => state.set('y', 1, true), { code: 'capacity' });
  assert.equal(state.getAt('x', 1), true);
});

test('rejects invalid keys, timestamps, depth, and non-JSON values', () => {
  const state = createTemporalState({ maxDepth: 1 });
  assert.throws(() => state.set('', 0, null), { code: 'invalid' });
  assert.throws(() => state.set('x', -1, null), { code: 'invalid' });
  assert.throws(() => state.set('x', 0.5, null), { code: 'invalid' });
  assert.throws(() => state.set('x', 1, { nested: { too: true } }), { code: 'capacity' });
  assert.throws(() => state.set('x', 1, new Date()), { code: 'invalid' });
});

test('rejects sparse arrays and accessors without evaluating them', () => {
  const state = createTemporalState();
  const sparse = [];
  sparse.length = 1;
  assert.throws(() => state.set('sparse', 1, sparse), { code: 'invalid' });
  const accessor = [];
  Object.defineProperty(accessor, '0', {
    enumerable: true,
    get() {
      throw new Error('executed');
    },
  });
  accessor.length = 1;
  assert.throws(() => state.set('accessor', 1, accessor), { code: 'invalid' });
});

test('treats prototype-like keys as ordinary data keys', () => {
  const state = createTemporalState();
  state.set('__proto__', 1, 'safe');
  const snapshot = state.snapshotAt(1);
  assert.equal(Object.hasOwn(snapshot, '__proto__'), true);
  assert.equal(snapshot.__proto__, 'safe');
});
