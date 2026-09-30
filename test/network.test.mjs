import test from 'node:test';
import assert from 'node:assert/strict';
import {networkError, NETWORK_ERROR_PREFIX, RCP_CODE_BASE} from '../src/network-error.mjs';
import {connectNetworkBridge} from '../src/network-bridge.mjs';

const cases=[...[5,6,7,16,18,35,52,55,56,92,95,97].map(n=>[RCP_CODE_BASE+n,'TRANSPORT']),[RCP_CODE_BASE+28,'TIMEOUT'],[RCP_CODE_BASE+60,'TLS_CERTIFICATE'],
 [RCP_CODE_BASE+27,'RESOURCE_EXHAUSTED'],[RCP_CODE_BASE+42,'ABORTED'],[RCP_CODE_BASE+67,'AUTH'],[RCP_CODE_BASE+3,'INVALID_REQUEST'],[999,'NATIVE_UNKNOWN']];
for(const phase of ['start','stream'])for(const [code,expected] of cases)test(`${phase}: ${code} => ${expected}`,()=>{
 const error=networkError({code,phase});
 assert.equal(error.code,expected);
 // The category survives SDKs that keep only the message.
 assert.ok(error.message.startsWith(`${NETWORK_ERROR_PREFIX}${expected};code=${code};phase=${phase};`));
});
for(const [message,expected] of [['Native request deadline exceeded','TIMEOUT'],['Network runtime disposed','RUNTIME_DISPOSED'],['Native stream buffer exceeded','RESOURCE_EXHAUSTED'],['Response ended without headers','TRANSPORT'],['native_network_start_failed','NATIVE_UNKNOWN'],['HTTPS required','INVALID_REQUEST']])
 test(message,()=>assert.equal(networkError(message).code,expected));
test('explicit user cancellation wins over a transient native error',()=>assert.equal(networkError({code:RCP_CODE_BASE+56,cancelReason:'user'}).code,'ABORTED'));

function fakeHost(){const sent=[],cancelled=[];return {sent,cancelled,request:json=>sent.push(JSON.parse(json)),cancel:id=>cancelled.push(id)}}

test('bridge streams host events into a fetch Response',async()=>{
 const host=fakeHost();const bridge=connectNetworkBridge(host);
 const pending=bridge.fetch('https://api.example.invalid/v1/stream',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
 await new Promise(r=>setImmediate(r));
 const [request]=host.sent;
 assert.equal(request.method,'POST');assert.equal(request.body,'{}');assert.deepEqual(request.headers,[['content-type','application/json']]);
 bridge.receive({id:request.id,type:'headers',status:200,headers:{'content-type':'text/event-stream'}});
 const response=await pending;
 bridge.receive({id:request.id,type:'bytes',bytes:[...new TextEncoder().encode('data: a\n\n')]});
 bridge.receive({id:request.id,type:'end'});
 assert.equal(await response.text(),'data: a\n\n');
 assert.deepEqual(host.cancelled,[]);
 bridge.dispose();
});

test('bridge maps a host error to a classified error and ignores unknown ids',async()=>{
 const host=fakeHost();const bridge=connectNetworkBridge(host);
 const pending=bridge.fetch('https://api.example.invalid');
 await new Promise(r=>setImmediate(r));
 bridge.receive({id:'unknown',type:'end'});
 bridge.receive({id:host.sent[0].id,type:'error',code:RCP_CODE_BASE+28});
 await assert.rejects(pending,{code:'TIMEOUT',phase:'start'});
 bridge.dispose();
});

test('bridge times out a silent request and cancels it on the host',async()=>{
 const host=fakeHost();const bridge=connectNetworkBridge(host,{idleTimeoutMs:10});
 await assert.rejects(bridge.fetch('https://api.example.invalid'),{code:'TIMEOUT'});
 assert.deepEqual(host.cancelled,[host.sent[0].id]);
 bridge.dispose();
});

test('dispose fails pending requests, cancels them and refuses new ones',async()=>{
 const host=fakeHost();const bridge=connectNetworkBridge(host);
 const pending=bridge.fetch('https://api.example.invalid');
 await new Promise(r=>setImmediate(r));
 bridge.dispose();
 await assert.rejects(pending,{code:'RUNTIME_DISPOSED'});
 assert.deepEqual(host.cancelled,[host.sent[0].id]);
 await assert.rejects(bridge.fetch('https://api.example.invalid'),{code:'RUNTIME_DISPOSED'});
});

test('plain http is refused before reaching the host',async()=>{
 const host=fakeHost();const bridge=connectNetworkBridge(host);
 await assert.rejects(bridge.fetch('http://api.example.invalid'),/HTTPS required/);
 assert.equal(host.sent.length,0);
 bridge.dispose();
});

test('pinned addresses reach the host and allow plain http only when pinned',async()=>{
 const host=fakeHost();const bridge=connectNetworkBridge(host);
 const pinnedAddresses=[{address:'93.184.215.14',family:4}];
 const pending=bridge.fetch('http://example.invalid/page',{pinnedAddresses});
 await new Promise(r=>setImmediate(r));
 assert.deepEqual(host.sent[0].pinnedAddresses,pinnedAddresses);
 bridge.receive({id:host.sent[0].id,type:'headers',status:200,headers:{}});bridge.receive({id:host.sent[0].id,type:'end'});
 assert.equal((await pending).status,200);
 await assert.rejects(bridge.fetch('http://example.invalid/page',{pinnedAddresses:[]}),/HTTPS required/);
 const unpinned=bridge.fetch('https://example.invalid/');await new Promise(r=>setImmediate(r));
 assert.equal('pinnedAddresses' in host.sent[1],false);
 bridge.dispose();
 await assert.rejects(unpinned,{code:'RUNTIME_DISPOSED'});
});
