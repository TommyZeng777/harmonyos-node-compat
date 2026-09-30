import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

// installWorkerPlatform mutates globals, so each case runs in a fresh Node process.
function run(source){
 const result=spawnSync(process.execPath,['--input-type=module','-e',source],{cwd:new URL('..',import.meta.url),encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
 return JSON.parse(result.stdout);
}

test('on a complete runtime every global is kept and the self-check passes',()=>{
 const out=run(`import {installWorkerPlatform,checkPlatform} from './src/index.mjs';
  const before={URL,Headers,Response,AbortController,structuredClone,TextEncoder};
  const nativeGlobals=installWorkerPlatform({crypto:globalThis.crypto,URL,URLSearchParams,TextEncoder,TextDecoder});
  const kept=Object.entries(before).every(([name,value])=>globalThis[name]===value);
  console.log(JSON.stringify({kept,nativeGlobals:nativeGlobals.length,mismatches:checkPlatform()}));`);
 assert.equal(out.kept,true);
 assert.deepEqual(out.mismatches,[]);
 assert.ok(out.nativeGlobals>15);
});

test('on a bare runtime the missing globals are filled and behave like Node',()=>{
 const out=run(`import {createHash as nodeHash} from 'node:crypto';
  const saved={URL,URLSearchParams,TextEncoder,TextDecoder};
  for(const name of ['URL','URLSearchParams','TextEncoder','TextDecoder','Headers','Request','Response','structuredClone','atob','btoa','queueMicrotask','DOMException','TextDecoderStream','ReadableStream','WritableStream','TransformStream'])delete globalThis[name];
  // ArkTS-like primitives: encodeInto, URL that does not throw on invalid input.
  // AbortController/AbortSignal stay: Node's own internals need them (test/abort.test.mjs covers ours).
  class ArkEncoder{encodeInto(text){return text?new saved.TextEncoder().encode(text):undefined}}
  class ArkDecoder{constructor(){this.d=new saved.TextDecoder('utf-8',{ignoreBOM:true})}decode(bytes,options){return bytes.length?this.d.decode(bytes,options):undefined}}
  class ArkURL{constructor(input,base){try{const u=new saved.URL(input,base);for(const k of ['href','protocol','host','hostname','port','pathname','search','hash','origin','username','password'])this[k]=u[k];this.searchParams=u.searchParams}catch(_){this.href=''}}}
  const {installWorkerPlatform}=await import('./src/index.mjs');
  installWorkerPlatform({crypto:globalThis.crypto,URL:ArkURL,URLSearchParams:saved.URLSearchParams,TextEncoder:ArkEncoder,TextDecoder:ArkDecoder,
   createSha256:()=>{const h=nodeHash('sha256');return {update:b=>h.update(b),digest:()=>new Uint8Array(h.digest())}}});
  let invalid;try{new URL('not a url');invalid='accepted'}catch(e){invalid=e.name}
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('abc')));
  const microtask=Object.getOwnPropertyDescriptor(globalThis,'queueMicrotask').writable;
  console.log(JSON.stringify({invalid,empty:new TextEncoder().encode('').length,clone:structuredClone({a:[1]}),headers:new Headers({A:' b '}).get('a'),
   text:await new Response('中').text(),digest:Buffer.from(digest).toString('hex'),microtask}));`);
 assert.equal(out.invalid,'TypeError');
 assert.equal(out.empty,0);
 assert.deepEqual(out.clone,{a:[1]});
 assert.equal(out.headers,'b');
 assert.equal(out.text,'中');
 assert.equal(out.digest,'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
 assert.equal(out.microtask,false);
});
