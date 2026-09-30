import test from 'node:test';
import assert from 'node:assert/strict';
import {installFetchPrimitives} from '../src/fetch-primitives.mjs';
import {patchOpenAIUrlQuery} from '../src/sdk-patches/openai-url-query.mjs';

class HarmonyEncoder {
  encodeInto(value) { return new TextEncoder().encode(value); }
}
class HarmonyDecoder {
  decode(value) { return value.length ? new TextDecoder().decode(value) : undefined; }
}

test('device codecs give SDKs Web-compatible empty lines', () => {
  const target={AbortController};
  installFetchPrimitives(target,{TextEncoderClass:HarmonyEncoder,TextDecoderClass:HarmonyDecoder});
  assert.equal(new target.TextDecoder().decode(new Uint8Array()),'');
  assert.equal(new target.TextDecoder().decode(new target.TextEncoder().encode('正文')),'正文');
});

test('device encoder returns empty bytes for an empty string', () => {
  // Device encodeInto('') returns undefined; callers that byte-count text need bytes.
  class EmptyUndefinedEncoder { encodeInto(value) { return value ? new TextEncoder().encode(value) : undefined; } }
  const target={AbortController};
  installFetchPrimitives(target,{TextEncoderClass:EmptyUndefinedEncoder,TextDecoderClass:HarmonyDecoder});
  const bytes=new target.TextEncoder().encode('');
  assert.ok(bytes instanceof Uint8Array);
  assert.equal(bytes.length,0);
  assert.equal(new target.TextEncoder().encode('中').length,3);
});

test('native Encoding globals that break on empty input are replaced, working ones kept', () => {
  // The device Worker already has TextEncoder/TextDecoder, but encode('') returns undefined.
  class BrokenEncoder { encode(value) { return value ? new TextEncoder().encode(value) : undefined; } }
  class BrokenDecoder { decode(value) { return value.length ? new TextDecoder().decode(value) : undefined; } }
  const broken={AbortController,TextEncoder:BrokenEncoder,TextDecoder:BrokenDecoder};
  installFetchPrimitives(broken,{TextEncoderClass:HarmonyEncoder,TextDecoderClass:HarmonyDecoder});
  assert.notEqual(broken.TextEncoder,BrokenEncoder);
  assert.equal(new broken.TextEncoder().encode('').length,0);
  assert.equal(new broken.TextDecoder().decode(new Uint8Array()),'');
  const fixed={AbortController};
  Object.defineProperty(fixed,'TextEncoder',{value:BrokenEncoder,writable:false,configurable:true});
  Object.defineProperty(fixed,'TextDecoder',{value:BrokenDecoder,writable:false,configurable:true});
  installFetchPrimitives(fixed,{TextEncoderClass:HarmonyEncoder,TextDecoderClass:HarmonyDecoder});
  assert.equal(new fixed.TextEncoder().encode('').length,0);
  const healthy={AbortController,TextEncoder,TextDecoder};
  installFetchPrimitives(healthy,{TextEncoderClass:HarmonyEncoder,TextDecoderClass:HarmonyDecoder});
  assert.equal(healthy.TextEncoder,TextEncoder);
});

test('response streams preserve ordered SSE bytes and headers', async () => {
  const target={AbortController,TextEncoder,TextDecoder};
  installFetchPrimitives(target,{});
  const stream=new target.ReadableStream({start(controller){
    controller.enqueue(new TextEncoder().encode('data: first\n'));
    controller.enqueue(new TextEncoder().encode('\n'));
    controller.close();
  }},{highWaterMark:1024,size:chunk=>chunk.byteLength});
  const response=new target.Response(stream,{status:200,headers:{'Content-Type':'text/event-stream'}});
  assert.equal(response.headers.get('content-type'),'text/event-stream');
  assert.equal(await response.text(),'data: first\n\n');
  await assert.rejects(response.text(),/already consumed/);
});

test('stream discards queued bytes after a terminal error', async () => {
  const target={AbortController,TextEncoder,TextDecoder};
  installFetchPrimitives(target,{});
  let controller;
  const stream=new target.ReadableStream({start(value){ controller=value; }});
  const reader=stream.getReader();
  controller.enqueue(new Uint8Array([1]));
  controller.error(new Error('request cancelled'));
  await assert.rejects(reader.read(),/request cancelled/);
});

test('Base64 globals preserve binary bytes and reject malformed input', () => {
  const target={AbortController,TextEncoder,TextDecoder};
  installFetchPrimitives(target,{});
  const bytes=Uint8Array.from([0,1,127,128,254,255]);
  const binary=String.fromCharCode(...bytes);
  assert.equal(target.btoa(binary),'AAF/gP7/');
  assert.equal(target.atob('AAF/gP7/'),binary);
  assert.equal(target.atob(' AA F/ gP7/ \n'),binary);
  assert.throws(()=>target.atob('%%%'),{name:'InvalidCharacterError'});
  assert.throws(()=>target.atob('A==='),{name:'InvalidCharacterError'});
  assert.throws(()=>target.btoa('中文'),{name:'InvalidCharacterError'});
});

test('OpenAI query adapter retains last value and guards source drift', () => {
  const source='const pathQuery = Object.fromEntries(url.searchParams);';
  const adapted=patchOpenAIUrlQuery(source);
  const query=new URL('https://example.invalid/?a=1&a=2').searchParams;
  const result=new Function('url',adapted+' return pathQuery;')({searchParams:query});
  assert.deepEqual(result,{a:'2'});
  assert.throws(()=>patchOpenAIUrlQuery('source changed'),/source changed/);
});

// Multi-megabyte binary bodies must round-trip without building huge string chains.
test('Base64 preserves large binary bodies and chunk-boundary padding', () => {
  const target={AbortController,TextEncoder,TextDecoder};
  installFetchPrimitives(target,{});
  for(const size of [8191,8192,8193,1048577]) {
    const bytes=Buffer.alloc(size);for(let i=0;i<size;i++)bytes[i]=i%256;
    const binary=bytes.toString('latin1'),encoded=bytes.toString('base64');
    assert.equal(target.btoa(binary),encoded);
    assert.equal(target.atob(encoded),binary);
    assert.equal(target.atob(encoded.replace(/=+$/, '')),binary);
  }
});

test('json() reads a complete asynchronously delivered body before decoding', async () => {
  const target={AbortController,TextEncoder,TextDecoder};
  installFetchPrimitives(target,{});
  let controller;
  const stream=new target.ReadableStream({start(value){controller=value;}});
  const response=new target.Response(stream,{status:200});
  const result=response.json();
  controller.enqueue(new TextEncoder().encode('{"outer":{"inner":'));
  await Promise.resolve();
  controller.enqueue(new TextEncoder().encode('{"value":23,"window":18000}}}'));
  controller.close();
  assert.equal((await result).outer.inner.value,23);
  await assert.rejects(response.json(),/already consumed/);
});

test('cancel discards buffered bytes immediately even while source cleanup is pending',async()=>{
 const target={AbortController,TextEncoder,TextDecoder};installFetchPrimitives(target,{});
 let release,calls=0;
 const stream=new target.ReadableStream({start(c){c.enqueue(new Uint8Array([1,2]))},cancel(){calls++;return new Promise(r=>release=r)}});
 const reader=stream.getReader(),cancel=reader.cancel('stop');
 assert.deepEqual(await reader.read(),{done:true,value:undefined});
 await reader.cancel();assert.equal(calls,1);release();await cancel;
});
test('source cancellation rejection still settles pending reads',async()=>{
 const target={AbortController,TextEncoder,TextDecoder};installFetchPrimitives(target,{});
 const stream=new target.ReadableStream({cancel(){throw Error('cleanup failed')}}),reader=stream.getReader();
 const pending=reader.read();await assert.rejects(reader.cancel(),/cleanup failed/);
 assert.deepEqual(await pending,{done:true,value:undefined});
});
test('undefined stream error is terminal and rejects pending and future reads',async()=>{
 const target={AbortController,TextEncoder,TextDecoder};installFetchPrimitives(target,{});
 let c;const stream=new target.ReadableStream({start(value){c=value}}),reader=stream.getReader();
 const pending=reader.read();c.error(undefined);
 const capture=p=>p.then(()=> 'resolved',error=>error===undefined?'rejected undefined':'other');
 assert.equal(await capture(pending),'rejected undefined');assert.equal(await capture(reader.read()),'rejected undefined');
});

test('a slow consumer keeps byte accounting exact and every queue operation constant time',async()=>{
  const target={AbortController,TextEncoder,TextDecoder};
  installFetchPrimitives(target,{});
  let controller;const stream=new target.ReadableStream({start(c){controller=c}},{highWaterMark:1<<20,size:chunk=>chunk.byteLength});
  const reader=stream.getReader(),count=50000,started=performance.now();
  for(let i=0;i<count;i++){controller.enqueue(new Uint8Array([i&255,(i>>8)&255,i>>16]));assert.equal(controller.desiredSize,(1<<20)-3*(i+1))}
  for(let i=0;i<count;i++){
    const {value}=await reader.read();assert.equal(value[0]|(value[1]<<8)|(value[2]<<16),i);
    if(i%9973===0)assert.equal(controller.desiredSize,(1<<20)-3*(count-i-1));
  }
  assert.equal(controller.desiredSize,1<<20);
  controller.enqueue(new Uint8Array(5));controller.close();
  assert.equal((await reader.read()).value.byteLength,5);assert.equal((await reader.read()).done,true);
  assert(performance.now()-started<2000,'queue operations must not scan buffered chunks');
});
