import test from 'node:test';
import assert from 'node:assert/strict';
import { AbortController as WorkerAbortController, AbortSignal as WorkerAbortSignal } from '../src/abort.mjs';

test('abort is synchronous, idempotent and retains the original reason', () => {
  const controller = new WorkerAbortController();
  const reason = new Error('stop');
  const calls = [];
  controller.signal.addEventListener('abort', event => calls.push(event.target));
  controller.signal.onabort = () => calls.push('onabort');
  controller.abort(reason);
  controller.abort(new Error('ignored'));
  assert.equal(controller.signal.reason, reason);
  assert.deepEqual(calls, [controller.signal, 'onabort']);
  assert.throws(() => controller.signal.throwIfAborted(), error => error === reason);
});

test('once and removeEventListener do not retain callbacks', () => {
  const controller = new WorkerAbortController();
  let calls = 0;
  const listener = () => { calls++; };
  controller.signal.addEventListener('abort', listener, { once: true });
  controller.signal.addEventListener('abort', () => { calls += 10; });
  controller.signal.removeEventListener('abort', listener);
  controller.abort();
  assert.equal(calls, 10);
});

test('any propagates the winning reason and unregisters remaining signals', () => {
  const a = new WorkerAbortController();
  const b = new WorkerAbortController();
  const joint = WorkerAbortSignal.any([a.signal, b.signal]);
  const reason = new Error('b');
  b.abort(reason);
  assert.equal(joint.aborted, true);
  assert.equal(joint.reason, reason);
  assert.equal(a.signal.listeners.size, 0);
  a.abort(new Error('late'));
  assert.equal(joint.reason, reason);
});

test('timeout aborts with TimeoutError and abort() uses AbortError', async () => {
  const timeout = WorkerAbortSignal.timeout(1);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(timeout.reason.name, 'TimeoutError');
  assert.equal(WorkerAbortSignal.abort().reason.name, 'AbortError');
});

test('a throwing abort listener cannot prevent transport or combined signal cancellation',()=>{
 const c=new WorkerAbortController();let stopped=false;const reported=[];
 const original=console.error;console.error=(...values)=>reported.push(values);
 try{
  c.signal.addEventListener('abort',()=>{throw Error('listener fixture')});
  const combined=WorkerAbortSignal.any([c.signal]);
  c.signal.addEventListener('abort',()=>{stopped=true});
  assert.doesNotThrow(()=>c.abort());
  assert.equal(stopped,true);assert.equal(combined.aborted,true);assert.equal(reported.length,1);
 }finally{console.error=original}
});
