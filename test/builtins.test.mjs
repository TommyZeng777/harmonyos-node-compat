import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,webcrypto} from 'node:crypto';
import {installMissingBuiltins,sha256Subtle,strictURL} from '../src/builtins.mjs';

// ArkTS url.URL as measured on device: unparseable input gives an empty href, no throw.
class ArkURL{constructor(input,base){try{const url=new URL(input,base);this.href=url.href;this.hostname=url.hostname}catch(_){this.href=''}}}

test('strict URL throws, parses and canParses like Node',()=>{
 const Strict=strictURL(ArkURL);
 for(const [input,base] of [['https://a.test/x'],['not a url'],['../c','https://a.test/a/b'],['',undefined],['http://localhost:8080/p?q=1'],['c','nope'],['file:///tmp/x'],['data:text/plain,hi']]){
  const node=(()=>{try{return new URL(input,base).href}catch(error){return error.name}})();
  const ours=(()=>{try{return new Strict(input,base).href}catch(error){return error.name}})();
  assert.equal(ours,node,JSON.stringify([input,base]));
  assert.equal(Strict.canParse(input,base),URL.canParse(input,base));
  assert.equal(Strict.parse(input,base)?.href??null,URL.parse(input,base)?.href??null);
 }
 assert.ok(new Strict('https://a.test') instanceof ArkURL);
});

test('crypto.subtle.digest SHA-256 matches WebCrypto and rejects other algorithms',async()=>{
 const subtle=sha256Subtle(()=>{const hash=createHash('sha256');return {update:bytes=>hash.update(bytes),digest:()=>new Uint8Array(hash.digest())}});
 for(const data of [new Uint8Array(),new TextEncoder().encode('verifier-中'),new Uint8Array([1,2,3]).buffer]){
  assert.deepEqual(new Uint8Array(await subtle.digest('SHA-256',data)),new Uint8Array(await webcrypto.subtle.digest('SHA-256',data)));
  assert.deepEqual(new Uint8Array(await subtle.digest({name:'sha-256'},data)),new Uint8Array(await webcrypto.subtle.digest({name:'SHA-256'},data)));
 }
 await assert.rejects(subtle.digest('SHA-1',new Uint8Array()),{name:'NotSupportedError'});
});

test('missing built-ins are filled with Node behavior and existing ones are kept',async()=>{
 const saved={union:Set.prototype.union,intersection:Set.prototype.intersection,difference:Set.prototype.difference,symmetricDifference:Set.prototype.symmetricDifference,
  isSubsetOf:Set.prototype.isSubsetOf,isSupersetOf:Set.prototype.isSupersetOf,isDisjointFrom:Set.prototype.isDisjointFrom,objectGroupBy:Object.groupBy,mapGroupBy:Map.groupBy,capture:Error.captureStackTrace};
 const a=new Set([1,2,3]),b=new Set([2,3,4]),node={};
 for(const name of ['union','intersection','difference','symmetricDifference','isSubsetOf','isSupersetOf','isDisjointFrom'])node[name]=a[name](b);
 const groups=Object.groupBy([1,2,3],x=>x%2?'odd':'even'),mapGroups=[...Map.groupBy([1,2,3],x=>x%2)];
 try{
  for(const name of Object.keys(node))delete Set.prototype[name];
  delete Object.groupBy;delete Map.groupBy;delete Error.captureStackTrace;
  const target={crypto:{}};let ran=false;
  installMissingBuiltins(target,{createSha256:()=>({update(){},digest:()=>new Uint8Array(32)})});
  for(const [name,value] of Object.entries(node))assert.deepEqual(a[name](b),value,name);
  assert.throws(()=>a.union([1]),TypeError);
  assert.deepEqual({...Object.groupBy([1,2,3],x=>x%2?'odd':'even')},{...groups});
  assert.deepEqual([...Map.groupBy([1,2,3],x=>x%2)],mapGroups);
  const holder={message:'m'};Error.captureStackTrace(holder);assert.equal(typeof holder.stack,'string');
  target.queueMicrotask(()=>{ran=true});assert.equal(ran,false);await Promise.resolve();assert.equal(ran,true);
  // zone.js only wraps writable globals; a wrapped queueMicrotask stalls streamed responses on ArkTS.
  assert.equal(Object.getOwnPropertyDescriptor(target,'queueMicrotask').writable,false);
  assert.equal(typeof target.crypto.subtle.digest,'function');
  const kept={queueMicrotask:()=>{},crypto:{subtle:'native'}};installMissingBuiltins(kept,{createSha256:()=>null});
  assert.equal(kept.crypto.subtle,'native');
 }finally{
  for(const name of Object.keys(node))Set.prototype[name]=saved[name];
  Object.groupBy=saved.objectGroupBy;Map.groupBy=saved.mapGroupBy;Error.captureStackTrace=saved.capture;
 }
});
