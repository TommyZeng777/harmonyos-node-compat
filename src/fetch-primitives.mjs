// The HarmonyOS ThreadWorker has no Fetch globals and incomplete Encoding globals. This
// limited implementation covers JSON and SSE (text/event-stream) requests through fetch.mjs.
// Device runtimes may expose native Encoding globals that return undefined for
// empty input (encode('') / decode of zero bytes). Presence is not enough: a codec
// is kept only when it behaves like the Web API, otherwise it is replaced.
const encoderReady = Encoder => { try { return new Encoder().encode('') instanceof Uint8Array; } catch (_) { return false; } };
const decoderReady = Decoder => { try { return new Decoder().decode(new Uint8Array()) === ''; } catch (_) { return false; } };
function replaceGlobal(target, name, value) {
  try { target[name] = value; } catch (_) {}
  if (target[name] !== value) try { Object.defineProperty(target, name, {value, writable: true, configurable: true}); } catch (_) {}
}
const HEADER_NAME=/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
function headerName(key) { const name=String(key); if (!HEADER_NAME.test(name)) throw new TypeError('Invalid header name: '+name); return name.toLowerCase(); }
function headerValue(value) { const text=String(value).replace(/^[\t\n\r ]+|[\t\n\r ]+$/g,''); if (/[\0\r\n]/.test(text)) throw new TypeError('Invalid header value'); return text; }
export function installFetchPrimitives(target, {TextEncoderClass, TextDecoderClass}) {
  if ((!target.TextEncoder || !encoderReady(target.TextEncoder)) && TextEncoderClass) replaceGlobal(target, 'TextEncoder', class TextEncoder {
    constructor() { this.native = new TextEncoderClass(); this.encoding = 'utf-8'; }
    // ArkTS encodeInto('') returns undefined; callers such as Buffer.byteLength expect bytes.
    // ArkTS also encodes a lone surrogate as invalid UTF-8 (ED A0 80); Web/Node write U+FFFD.
    encode(input='') { const text=String(input); return this.native.encodeInto(typeof text.toWellFormed==='function' ? text.toWellFormed() : text) ?? new Uint8Array(0); }
  });
  if ((!target.TextDecoder || !decoderReady(target.TextDecoder)) && TextDecoderClass) replaceGlobal(target, 'TextDecoder', class TextDecoder {
    constructor(encoding='utf-8', options) { this.native = new TextDecoderClass(encoding, options); this.encoding = encoding; this.ignoreBOM = options?.ignoreBOM === true; this.started = false; }
    decode(input=new Uint8Array(), options) {
      let text = this.native.decode(input, options) ?? '';
      // Like Web/Node, drop one leading BOM per stream unless ignoreBOM (ArkTS keeps it).
      if (!this.ignoreBOM && !this.started && text) { this.started = true; if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); }
      if (!options?.stream) this.started = false;
      return text;
    }
  });
  if (!target.TextEncoder || !target.TextDecoder) throw Error('Native text codecs required');
  if (!target.Headers) target.Headers = class Headers {
    // Fetch-standard names and values, as in Node: invalid names throw, values are
    // trimmed, iteration is sorted, and set-cookie values stay separate.
    constructor(init) {
      this.valuesMap = new Map();
      if (init) {
        if (Array.isArray(init)) for (const [key, value] of init) this.append(key, value);
        else if (typeof init.forEach === 'function') init.forEach((value, key) => this.append(key, value));
        else for (const [key, value] of Object.entries(init)) this.append(key, value);
      }
    }
    append(key, value) { const name=headerName(key), text=headerValue(value); const list=this.valuesMap.get(name); if (list) list.push(text); else this.valuesMap.set(name, [text]); }
    set(key, value) { this.valuesMap.set(headerName(key), [headerValue(value)]); }
    get(key) { const list=this.valuesMap.get(headerName(key)); return list ? list.join(', ') : null; }
    has(key) { return this.valuesMap.has(headerName(key)); }
    delete(key) { this.valuesMap.delete(headerName(key)); }
    getSetCookie() { return [...(this.valuesMap.get('set-cookie') || [])]; }
    forEach(callback, thisArg) { for (const [key,value] of this.entries()) callback.call(thisArg,value,key,this); }
    entries() {
      const pairs=[];
      for (const name of [...this.valuesMap.keys()].sort()) {
        const list=this.valuesMap.get(name);
        if (name === 'set-cookie') for (const value of list) pairs.push([name, value]);
        else pairs.push([name, list.join(', ')]);
      }
      return pairs[Symbol.iterator]();
    }
    keys() { return Array.from(this.entries(), pair => pair[0])[Symbol.iterator](); }
    values() { return Array.from(this.entries(), pair => pair[1])[Symbol.iterator](); }
    [Symbol.iterator]() { return this.entries(); }
  };
  if (!target.ReadableStream) target.ReadableStream = class ReadableStream {
    constructor(source={}, strategy={}) {
      // Every response byte chunk passes through here. Keep enqueue, read and
      // desiredSize O(1), like Node's deque-backed queues.
      const queue=[]; const sizes=[]; let head=0, queued=0;
      const waiters=[]; let closed=false, errored=false, failure;
      const highWaterMark=strategy.highWaterMark ?? 1;
      const size=strategy.size ?? (()=>1);
      const pending=()=>queue.length-head;
      const clear=()=>{ queue.length=0; sizes.length=0; head=0; queued=0; };
      const take=()=>{
        const value=queue[head]; queued-=sizes[head]; queue[head]=undefined; head++;
        if (head===queue.length) clear(); else if (head>=1024 && head*2>=queue.length) { queue.splice(0,head); sizes.splice(0,head); head=0; }
        return value;
      };
      this.controller={
        get desiredSize() { return highWaterMark-queued; },
        enqueue(value) { if (closed || errored) throw Error('Stream is closed'); const waiter=waiters.shift(); if (waiter) waiter.resolve({done:false,value}); else { const bytes=size(value); queue.push(value); sizes.push(bytes); queued+=bytes; } },
        close() { closed=true; while (waiters.length && !pending()) waiters.shift().resolve({done:true,value:undefined}); },
        error(error) { if (errored || (closed && pending()===0)) return; errored=true; failure=error; clear(); while (waiters.length) waiters.shift().reject(error); },
      };
      this.cancel=reason=>{
        if (errored) return Promise.reject(failure);
        // Close before underlying cleanup: its rejection or delay cannot leave
        // readers waiting, and cancelled bytes must never reach another step.
        const alreadyDrained=closed && pending()===0;
        closed=true;clear();
        while(waiters.length)waiters.shift().resolve({done:true,value:undefined});
        if(alreadyDrained)return Promise.resolve();
        try{return Promise.resolve(source.cancel?.(reason)).then(()=>undefined)}
        catch(error){return Promise.reject(error)}
      };
      source.start?.(this.controller);
      this.read=()=>{
        if (errored) return Promise.reject(failure);
        if (pending()) return Promise.resolve({done:false,value:take()});
        if (closed) return Promise.resolve({done:true,value:undefined});
        return new Promise((resolve,reject)=>waiters.push({resolve,reject}));
      };
    }
    getReader() { const stream=this; return {read:()=>stream.read(), releaseLock(){}, cancel:reason=>stream.cancel(reason)}; }
    tee() {
      const reader=this.getReader(); const branches=[];
      const make=()=>new target.ReadableStream({start(controller){ branches.push(controller); }});
      const pair=[make(), make()];
      const pump=()=>reader.read().then(part=>{
        if (part.done) { for (const branch of branches) branch.close(); return; }
        for (const branch of branches) branch.enqueue(part.value);
        return pump();
      }, error=>{ for (const branch of branches) branch.error(error); });
      void pump();
      return pair;
    }
    [Symbol.asyncIterator]() { const reader=this.getReader(); return {next:()=>reader.read(),return:async()=>{await reader.cancel();return {done:true}}}; }
  };
  if (!target.Request) target.Request = class Request {
    constructor(input, init={}) {
      this.url=String(input?.url ?? input);
      this.method=String(init.method ?? input?.method ?? 'GET').toUpperCase();
      this.headers=new target.Headers(init.headers ?? input?.headers);
      this.body=init.body ?? input?.body ?? null;
      this.signal=init.signal ?? input?.signal ?? new target.AbortController().signal;
    }
    async text() { return typeof this.body === 'string' ? this.body : this.body == null ? '' : new target.TextDecoder().decode(this.body); }
  };
  if (!target.Response) target.Response = class Response {
    constructor(body=null, init={}) {
      this.status=init.status ?? 200;
      if (!Number.isInteger(this.status) || this.status<200 || this.status>599) throw new RangeError('Response status must be between 200 and 599');
      this.statusText=init.statusText ?? '';
      this.headers=new target.Headers(init.headers);
      this.ok=this.status>=200 && this.status<300;
      this.type='default'; this.url=''; this.redirected=false;
      // As in Node, a string or byte body is exposed as a stream.
      if (body!=null && !body.getReader) {
        const bytes=typeof body==='string' ? new target.TextEncoder().encode(body) : body instanceof ArrayBuffer ? new Uint8Array(body) : new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
        body=new target.ReadableStream({start(controller){ if (bytes.length) controller.enqueue(bytes); controller.close(); }});
      }
      this.body=body;
      this.bodyUsed=false;
    }
    clone() {
      if (this.bodyUsed) throw new TypeError('Response body is already used');
      let body=null;
      if (this.body) { const [mine, theirs]=this.body.tee(); this.body=mine; body=theirs; }
      return new target.Response(body, {status:this.status, statusText:this.statusText, headers:this.headers});
    }
    arrayBuffer() {
      if (this.bodyUsed) return Promise.reject(Error('Body already consumed'));
      this.bodyUsed=true;
      const chunks=[]; let length=0;
      const append=bytes=>{chunks.push(bytes);length+=bytes.length;};
      const finish=()=>{
        const out=new Uint8Array(length);let offset=0;
        for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.length;}
        return out.buffer;
      };
      // Promise callbacks avoid generator-bound `this` in Ark-compiled methods.
      // SSE consumers read the stream directly; JSON consumers need this path.
      if(this.body?.getReader){
        const reader=this.body.getReader();
        const read=()=>reader.read().then(part=>{
          if(part.done){reader.releaseLock();return finish();}
          append(part.value);return read();
        });
        return read().catch(error=>{reader.releaseLock();throw error;});
      }
      if(typeof this.body==='string')append(new target.TextEncoder().encode(this.body));
      else if(this.body)append(this.body);
      return Promise.resolve(finish());
    }
    text() {
      return this.arrayBuffer().then(buffer=>new target.TextDecoder('utf-8').decode(new Uint8Array(buffer)));
    }
    json() { return this.text().then(text=>JSON.parse(text)); }

  };
  if (!target.DOMException) target.DOMException = class DOMException extends Error { constructor(message,name='Error') { super(message); this.name=name; } };
  // ArkTS ThreadWorker has no browser Base64 globals. Binary request bodies and
  // several SDK auth paths use these before they reach fetch.
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  if (!target.atob) target.atob = input => {
    const source=String(input).replace(/[\t\n\f\r ]/g,'');
    const unpadded=source.replace(/=+$/,'');
    const padding=source.length-unpadded.length;
    if (padding>2 || /[^A-Za-z0-9+/]/.test(unpadded) || unpadded.length%4===1 ||
      (padding>0 && (source.length%4!==0 || unpadded.length%4!==4-padding))) {
      throw new target.DOMException('Invalid Base64 input','InvalidCharacterError');
    }
    // Bound each concatenation so large inputs cannot build a huge chain of
    // dependent strings in the Worker heap.
    let output='';const parts=[];
    for (let start=0;start<unpadded.length;start+=4) {
      const a=alphabet.indexOf(unpadded[start]);
      const b=alphabet.indexOf(unpadded[start+1]);
      const c=start+2<unpadded.length?alphabet.indexOf(unpadded[start+2]):0;
      const d=start+3<unpadded.length?alphabet.indexOf(unpadded[start+3]):0;
      output+=String.fromCharCode((a<<2)|(b>>4));
      if (start+2<unpadded.length) output+=String.fromCharCode(((b&15)<<4)|(c>>2));
      if (start+3<unpadded.length) output+=String.fromCharCode(((c&3)<<6)|d);
      if(output.length>=8192){parts.push(output);output='';}
    }
    parts.push(output);
    return parts.join('');
  };
  if (!target.btoa) target.btoa = input => {
    const source=String(input);
    let output='';const parts=[];
    for (let start=0;start<source.length;start+=3) {
      const a=source.charCodeAt(start),b=start+1<source.length?source.charCodeAt(start+1):0;
      const c=start+2<source.length?source.charCodeAt(start+2):0;
      if (a>255 || b>255 || c>255) throw new target.DOMException('Non-Latin1 Base64 input','InvalidCharacterError');
      output+=alphabet[a>>2]+alphabet[((a&3)<<4)|(b>>4)]+
        (start+1<source.length?alphabet[((b&15)<<2)|(c>>6)]:'=')+
        (start+2<source.length?alphabet[c&63]:'=');
      if(output.length>=8192){parts.push(output);output='';}
    }
    parts.push(output);return parts.join('');
  };
  // SDK JSON paths use instanceof checks even when no multipart body exists.
  // Reject constructing unsupported upload bodies at this boundary.
  if (!target.FormData) target.FormData = class FormData { constructor() { throw Error('multipart upload is not supported'); } };
  if (!target.Blob) target.Blob = class Blob { constructor() { throw Error('Blob upload is not supported'); } };
  if (!target.File) target.File = class File { constructor() { throw Error('File upload is not supported'); } };
}
