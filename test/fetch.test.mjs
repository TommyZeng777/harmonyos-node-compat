import test from 'node:test';
import assert from 'node:assert/strict';
import {createFetch} from '../src/fetch.mjs';
import {AbortController as WorkerAbortController} from '../src/abort.mjs';
test('streams UTF8 bytes before end and preserves HTTP error status',async()=>{
 let sink,request,cancelled=0;
 const fetch=createFetch((r,s)=>{request=r;sink=s;return{cancel(){cancelled++}}});
 const pending=fetch('https://api.example.invalid/v1/stream',{method:'POST',body:'{}'});
 await new Promise(r=>setImmediate(r));sink.headers(401,{'content-type':'text/event-stream'});
 const response=await pending;assert.equal(response.status,401);assert.equal(response.ok,false);assert.equal(request.body,'{}');
 const reader=response.body.getReader();const bytes=new TextEncoder().encode('数据');
 const first=reader.read();sink.bytes(bytes.slice(0,2));assert.deepEqual((await first).value,bytes.slice(0,2));
 sink.bytes(bytes.slice(2));sink.end();assert.deepEqual((await reader.read()).value,bytes.slice(2));assert.equal((await reader.read()).done,true);assert.equal(cancelled,0);
});
test('abort after headers errors body and cancels host once',async()=>{
 let sink,cancelled=0;const abort=new AbortController();
 const pending=createFetch((r,s)=>{sink=s;return{cancel(){cancelled++}}})('https://api.example.invalid',{signal:abort.signal});
 sink.headers(200,{});const response=await pending;const read=response.body.getReader().read();abort.abort();
 await assert.rejects(read,{name:'AbortError'});sink.end();assert.equal(cancelled,1);
});
test('Worker AbortSignal cancels the host request through Request',async()=>{
 let sink,cancelled=0;
 const abort=new WorkerAbortController();
 const pending=createFetch((r,s)=>{sink=s;return{cancel(){cancelled++}}})('https://api.example.invalid',{signal:abort.signal});
 sink.headers(200,{});
 const response=await pending;
 const read=response.body.getReader().read();
 abort.abort(new Error('worker stopped'));
 await assert.rejects(read,/worker stopped/);
 assert.equal(cancelled,1);
 assert.equal(abort.signal.listeners.size,0);
});
test('abort after streamed bytes errors the next read and ignores late host events',async()=>{
 let sink,cancelled=0;
 const abort=new WorkerAbortController();
 const pending=createFetch((r,s)=>{sink=s;return{cancel(){cancelled++}}})('https://api.example.invalid',{signal:abort.signal});
 sink.headers(200,{'content-type':'text/event-stream'});
 const response=await pending;
 const reader=response.body.getReader();
 const first=reader.read();
 const bytes=new TextEncoder().encode('data: partial\n\n');
 sink.bytes(bytes);
 assert.deepEqual((await first).value,bytes);
 const next=reader.read();
 abort.abort(new Error('cancel after partial output'));
 await assert.rejects(next,/cancel after partial output/);
 sink.bytes(new TextEncoder().encode('data: late\n\n'));
 sink.end();
 assert.equal(cancelled,1);
 assert.equal(abort.signal.listeners.size,0);
});
test('rejects ordering errors and bounded buffer overflow',async()=>{
 let cancelled=0;
 await assert.rejects(createFetch((r,s)=>{s.bytes([1]);return{cancel(){cancelled++}}})('https://api.example.invalid'),/before response status/);
 assert.equal(cancelled,1);
 let sink;const pending=createFetch((r,s)=>{sink=s;return{cancel(){cancelled++}}},{maxBufferedBytes:2})('https://api.example.invalid');
 sink.headers(200,{});const response=await pending;sink.bytes([1,2,3]);await assert.rejects(response.text(),/buffer exceeded/);assert.equal(cancelled,2);
});
