import test from 'node:test';
import assert from 'node:assert/strict';
import { structuredClone as cloneValue } from '../src/structured-clone.mjs';

test('clones nested values without losing undefined, bigint or cycles', () => {
  const input = { id: 'record', sequence: 7n, optional: undefined, events: [{ type: 'created' }] };
  input.self = input;
  const copy = cloneValue(input);
  assert.deepEqual(copy.events, input.events);
  assert.notEqual(copy.events, input.events);
  assert.equal(copy.self, copy);
  assert.equal(copy.sequence, 7n);
  assert.equal(Object.hasOwn(copy, 'optional'), true);
});

test('copies binary views while preserving shared buffers and offsets', () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const input = { bytes, tail: new DataView(bytes.buffer, 2, 2), repeated: bytes };
  const copy = cloneValue(input);
  assert.deepEqual([...copy.bytes], [1, 2, 3, 4]);
  assert.equal(copy.bytes, copy.repeated);
  assert.equal(copy.tail.buffer, copy.bytes.buffer);
  assert.notEqual(copy.bytes.buffer, bytes.buffer);
  bytes[0] = 9;
  assert.equal(copy.bytes[0], 1);
});

test('clones collections and value objects', () => {
  const key = { id: 1 };
  const input = { key, map: new Map([[key, new Set([key])]]), date: new Date(1000), regex: /ab/gi };
  const copy = cloneValue(input);
  assert.equal(copy.map.get(copy.key).has(copy.key), true);
  assert.notEqual(copy.key, key);
  assert.equal(copy.date.getTime(), 1000);
  assert.equal(copy.regex.source, 'ab');
  assert.equal(copy.regex.flags, 'gi');
});

test('rejects the values Node rejects instead of dropping them', () => {
  for (const value of [() => {}, Symbol('x'), new WeakMap(), Promise.resolve(), new URL('https://example.com'), { handler() {} }])
    assert.throws(() => cloneValue(value), { name: 'DataCloneError' });
});

// Symbol-keyed objects must not throw: Node's structuredClone skips symbol keys, and
// code that works on Node would otherwise fail only on the device.
test('skips symbol keys and copies class instances as plain objects, as Node does', () => {
  class Point { constructor() { this.x = 1; } }
  const copy = cloneValue({ [Symbol('metadata')]: 'skipped', kept: 2, point: new Point() });
  assert.deepEqual(Object.getOwnPropertySymbols(copy), []);
  assert.equal(copy.kept, 2);
  assert.equal(Object.getPrototypeOf(copy.point), Object.prototype);
  assert.deepEqual(copy.point, { x: 1 });
});
