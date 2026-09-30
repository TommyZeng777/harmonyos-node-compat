// Code written for Node runs in the HarmonyOS ThreadWorker on this package's
// substitutes for Node/Web APIs. Every substitute must return what Node returns for
// the same input: a single empty-string edge case is enough to corrupt stored data
// that only the device reads. This suite compares each substitute with Node on fixed
// edge cases and on seeded random inputs. A documented, intentional difference is
// asserted explicitly instead of being skipped.
import test from 'node:test';
import assert from 'node:assert/strict';
import posix from 'node:path/posix';
import {createHash as nodeHash} from 'node:crypto';
import * as ours from '../src/path.mjs';
import {Buffer as Bytes} from '../src/buffer.mjs';
import {createHash,setSha256Factory} from '../src/crypto.mjs';
import {structuredClone as cloneValue} from '../src/structured-clone.mjs';
import {AbortController as WorkerAbortController, AbortSignal as WorkerAbortSignal} from '../src/abort.mjs';
import {installFetchPrimitives} from '../src/fetch-primitives.mjs';

// Deterministic PRNG so a failure is reproducible from the printed seed.
function random(seed){let s=seed>>>0;return ()=>{s=(s+0x6D2B79F5)>>>0;let t=s;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296}}
const pick=(next,items)=>items[Math.floor(next()*items.length)];
const outcome=f=>{try{return {value:f()}}catch(error){return {throws:error.name}}};
const same=(label,actual,expected)=>assert.deepEqual(actual,expected,label);

// Device-like runtime: ArkTS codecs return undefined for empty input.
const NodeEncoder=globalThis.TextEncoder,NodeDecoder=globalThis.TextDecoder;
// Measured on device (conformance.mjs, HarmonyOS 7.0.0.106/109): a lone surrogate encodes as
// ED A0 80 and a UTF-8 BOM is kept.
class DeviceEncoder{encodeInto(value){if(!value)return undefined;if(!value.isWellFormed())return new Uint8Array([0xED,0xA0,0x80]);return new NodeEncoder().encode(value)}}
class DeviceDecoder{constructor(){this.native=new NodeDecoder('utf-8',{ignoreBOM:true})}decode(value,options){return value.length?this.native.decode(value,options):undefined}}
function device(){const target={AbortController};installFetchPrimitives(target,{TextEncoderClass:DeviceEncoder,TextDecoderClass:DeviceDecoder});return target}

test('path matches node:path/posix on edge cases and random paths',()=>{
 const edge=['','.','..','/','//','///','a','a/','/a/b/','a/../..','/a/../..','./a','a//b','/a/./b/../c','.bashrc','a.b.c','a/b.','/..','../a/b','a/.','..a','a..','/.x/','.x.y'];
 const next=random(20260929);const segments=['a','bc','.','..','','.x','x.','x.y','中','..y'];
 const paths=[...edge];
 for(let i=0;i<400;i++){let p=next()<0.5?'/':'';const n=1+Math.floor(next()*5);for(let j=0;j<n;j++)p+=pick(next,segments)+(next()<0.8?'/':'');paths.push(p)}
 for(const p of paths){
  for(const f of ['normalize','dirname','basename','extname','isAbsolute'])same(`${f}(${JSON.stringify(p)})`,outcome(()=>ours[f](p)),outcome(()=>posix[f](p)));
  for(const suffix of ['.x','y','a'])same(`basename(${JSON.stringify(p)},${suffix})`,ours.basename(p,suffix),posix.basename(p,suffix));
 }
 for(let i=0;i<300;i++){
  const a=pick(next,paths),b=pick(next,paths);
  same(`join(${JSON.stringify([a,b])})`,ours.join(a,b),posix.join(a,b));
  // Node resolves relative input against process.cwd(); the Worker has none and uses '/'.
  const absA='/'+a,absB='/'+b;
  same(`resolve(${JSON.stringify([absA,b])})`,ours.resolve(absA,b),posix.resolve(absA,b));
  same(`relative(${JSON.stringify([absA,absB])})`,ours.relative(absA,absB),posix.relative(absA,absB));
 }
 same('resolve without an absolute part uses / as cwd',ours.resolve('a','b'),'/a/b');
});

test('Buffer matches Node for every supported encoding, including empty and malformed input',()=>{
 const next=random(7);
 const texts=['','a','é','中','😀','\uD800','a\uDC00b','􏿿','x'.repeat(70)];
 for(let i=0;i<200;i++){let t='';const n=Math.floor(next()*12);for(let j=0;j<n;j++)t+=String.fromCharCode(pick(next,[0x41,0xe9,0x9898,0xd83d,0xde00,0xd800,0x7f,0x100,0x20]));texts.push(t)}
 for(const t of texts){
  same(`byteLength(${JSON.stringify(t)})`,Bytes.byteLength(t),Buffer.byteLength(t));
  for(const encoding of ['utf8','utf-8','UTF8','latin1','binary','ascii','utf16le','ucs2']){
   same(`from(${JSON.stringify(t)},${encoding})`,[...Bytes.from(t,encoding)],[...Buffer.from(t,encoding)]);
   same(`byteLength(${JSON.stringify(t)},${encoding})`,Bytes.byteLength(t,encoding),Buffer.byteLength(t,encoding));
  }
 }
 for(let i=0;i<300;i++){
  const bytes=Uint8Array.from({length:Math.floor(next()*40)},()=>Math.floor(next()*256));
  for(const encoding of ['utf8','latin1','ascii','hex','base64','base64url','utf16le'])
   same(`toString(${[...bytes]},${encoding})`,Bytes.from(bytes).toString(encoding),Buffer.from(bytes).toString(encoding));
  same(`toString range ${[...bytes]}`,Bytes.from(bytes).toString('hex',1,5),Buffer.from(bytes).toString('hex',1,5));
 }
 const base64Chars='ABCXYZabxyz0189+/-_= \n*.';
 for(let i=0;i<500;i++){
  let s='';const n=Math.floor(next()*16);for(let j=0;j<n;j++)s+=pick(next,[...base64Chars]);
  for(const encoding of ['base64','base64url'])same(`from(${JSON.stringify(s)},${encoding})`,[...Bytes.from(s,encoding)],[...Buffer.from(s,encoding)]);
 }
 const hexChars='0123456789abcdefABCDEFgz ';
 for(let i=0;i<300;i++){let s='';const n=Math.floor(next()*10);for(let j=0;j<n;j++)s+=pick(next,[...hexChars]);same(`from(${JSON.stringify(s)},hex)`,[...Bytes.from(s,'hex')],[...Buffer.from(s,'hex')])}
 same('byteLength of bytes',Bytes.byteLength(new Uint8Array(5)),Buffer.byteLength(new Uint8Array(5)));
 same('unknown encoding',outcome(()=>Bytes.from('a','utf32')).throws,outcome(()=>Buffer.from('a','utf32')).throws);
});

test('device codecs are corrected to Node: empty input, lone surrogates and BOM',()=>{
 const target=device();
 for(const t of ['','中','\uD800','a\uDC00b','😀'])same(`encode ${JSON.stringify(t)}`,[...new target.TextEncoder().encode(t)],[...new NodeEncoder().encode(t)]);
 for(const bytes of [[],[239,187,191,97],[97,239,187,191],[255]])same(`decode ${bytes}`,new target.TextDecoder().decode(new Uint8Array(bytes)),new NodeDecoder().decode(new Uint8Array(bytes)));
 const mine=new target.TextDecoder(),node=new NodeDecoder();
 same('streamed BOM',mine.decode(new Uint8Array([239,187]),{stream:true})+mine.decode(new Uint8Array([191,97])),node.decode(new Uint8Array([239,187]),{stream:true})+node.decode(new Uint8Array([191,97])));
 same('ignoreBOM',new target.TextDecoder('utf-8',{ignoreBOM:true}).decode(new Uint8Array([239,187,191,97])),new NodeDecoder('utf-8',{ignoreBOM:true}).decode(new Uint8Array([239,187,191,97])));
});

test('Buffer utf8 stays correct on a device whose encoder fails on empty input',()=>{
 const original=[globalThis.TextEncoder,globalThis.TextDecoder];
 const target=device();globalThis.TextEncoder=target.TextEncoder;globalThis.TextDecoder=target.TextDecoder;
 try{for(const t of ['','中','😀'])same(`device utf8 ${t}`,Bytes.from(t).toString(),t);same('empty bytes',Bytes.from(new Uint8Array()).toString(),'')}
 finally{[globalThis.TextEncoder,globalThis.TextDecoder]=original}
});

test('createHash sha256 matches Node, including empty and non-BMP input',()=>{
 // Like the ArkTS cryptoFramework factory in harmony/WorkerEntry.ts: skip zero-byte updates.
 setSha256Factory(()=>{const h=nodeHash('sha256');return {update:bytes=>{if(bytes.length)h.update(bytes)},digest:()=>new Uint8Array(h.digest())}});
 const next=random(3);const texts=['','a','中😀','\uD800'];
 for(let i=0;i<50;i++)texts.push(Array.from({length:Math.floor(next()*20)},()=>String.fromCharCode(Math.floor(next()*0xffff))).join(''));
 for(const t of texts){
  same(`sha256 hex ${JSON.stringify(t)}`,createHash('sha256').update(t).digest('hex'),nodeHash('sha256').update(t).digest('hex'));
  same(`sha256 bytes ${JSON.stringify(t)}`,[...createHash('sha256').update(new TextEncoder().encode(t)).digest()],[...nodeHash('sha256').update(t).digest()]);
 }
 same('chained updates',createHash('sha256').update('a').update('').update('b').digest('hex'),nodeHash('sha256').update('a').update('').update('b').digest('hex'));
});

test('structuredClone follows Node for errors, class instances, symbols and boxed values',()=>{
 class K{constructor(){this.a=1}}
 class CustomError extends Error{}
 const named=new Error('n');named.name='AbortError';
 const cases={error:new Error('boom'),typeError:new TypeError('t'),cause:new Error('c',{cause:new RangeError('inner')}),custom:new CustomError('q'),named,
  klass:new K(),symbolKey:{[Symbol('s')]:1,a:2},boxedString:new String('x'),boxedNumber:new Number(3),sparse:[1,,3],trailingHole:[1,,],
  nested:{e:[new SyntaxError('r')]},date:new Date(0),undefinedValue:{a:undefined},nullPrototype:Object.assign(Object.create(null),{a:1}),
  func:()=>{},withFunction:{f(){}},weak:new WeakMap(),url:new URL('https://a.test/x')};
 const describe=r=>r.throws?{throws:r.throws}:{tag:Object.prototype.toString.call(r.value),proto:Object.getPrototypeOf(Object(r.value))?.constructor?.name??null,
  json:JSON.stringify(r.value),message:r.value?.message,name:r.value?.name,cause:r.value?.cause?.message,length:r.value?.length,keys:r.value&&typeof r.value==='object'?Reflect.ownKeys(r.value).map(String):null};
 for(const [label,value] of Object.entries(cases))same(`structuredClone ${label}`,describe(outcome(()=>cloneValue(value))),describe(outcome(()=>structuredClone(value))));
});

test('AbortController and AbortSignal match Node reasons and validation',async()=>{
 const reason=signal=>({name:signal.reason?.name,message:signal.reason?.message});
 const mine=new WorkerAbortController(),node=new AbortController();mine.abort();node.abort();
 same('default reason',reason(mine.signal),reason(node.signal));
 const mineTimeout=WorkerAbortSignal.timeout(0),nodeTimeout=AbortSignal.timeout(0);
 await new Promise(resolve=>setTimeout(resolve,20));
 same('timeout reason',reason(mineTimeout),reason(nodeTimeout));
 for(const ms of [1.5,-1,Number.NaN])same(`timeout(${ms})`,outcome(()=>WorkerAbortSignal.timeout(ms)&&'ok').throws,outcome(()=>AbortSignal.timeout(ms)&&'ok').throws);
 same('any([])',WorkerAbortSignal.any([]).aborted,AbortSignal.any([]).aborted);
});

test('Headers, Response and Base64 match Node',async()=>{
 const target=device();
 const pairs=[['B','2'],['a','1'],['a','3'],['Set-Cookie','x=1'],['set-cookie','y=2'],['X-Key','  sk-1\n']];
 same('entries',[...new target.Headers(pairs)],[...new Headers(pairs)]);
 same('get',new target.Headers(pairs).get('x-key'),new Headers(pairs).get('x-key'));
 same('getSetCookie',new target.Headers(pairs).getSetCookie(),new Headers(pairs).getSetCookie());
 for(const [name,value] of [['bad name','x'],['ok','a\nb'],['',''],[':status','200']])
  same(`Headers ${JSON.stringify([name,value])}`,outcome(()=>new target.Headers([[name,value]])&&'ok').throws,outcome(()=>new Headers([[name,value]])&&'ok').throws);
 for(const status of [0,199,200,204,599,600])same(`Response status ${status}`,outcome(()=>new target.Response(null,{status}).ok),outcome(()=>new Response(null,{status}).ok));
 for(const body of ['','{"a":1}','中',new Uint8Array([104,105])]){
  const a=new target.Response(body),b=new Response(body);
  same(`body stream ${body}`,typeof a.body?.getReader,typeof b.body?.getReader);
  const [x,y]=[a.clone(),b.clone()];
  same(`text ${body}`,await a.text(),await b.text());same(`clone text ${body}`,await x.text(),await y.text());
  same(`bodyUsed ${body}`,a.bodyUsed,b.bodyUsed);
 }
 same('null body text',await new target.Response(null).text(),await new Response(null).text());
 same('clone after use',await (async()=>{const r=new target.Response('x');await r.text();return outcome(()=>r.clone()).throws})(),await (async()=>{const r=new Response('x');await r.text();return outcome(()=>r.clone()).throws})());
 same('empty json',await new target.Response('').json().then(()=>'ok',e=>e.name),await new Response('').json().then(()=>'ok',e=>e.name));
 // Intentional: every method is sent upper-case; Node keeps 'patch' and warns it will likely get 405.
 same('Request method',new target.Request('https://a.test',{method:'patch'}).method,'PATCH');
 const next=random(11);
 for(let i=0;i<400;i++){let s='';const n=Math.floor(next()*10);for(let j=0;j<n;j++)s+=pick(next,[...'ABab09+/= \t*é']);same(`atob(${JSON.stringify(s)})`,outcome(()=>target.atob(s)),outcome(()=>atob(s)));same(`btoa(${JSON.stringify(s)})`,outcome(()=>target.btoa(s)),outcome(()=>btoa(s)))}
});
