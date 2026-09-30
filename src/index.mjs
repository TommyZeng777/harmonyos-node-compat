import {AbortController, AbortSignal} from './abort.mjs';
import {structuredClone} from './structured-clone.mjs';
import {installFetchPrimitives} from './fetch-primitives.mjs';
import {installMissingBuiltins, strictURL} from './builtins.mjs';
import {setSha256Factory} from './crypto.mjs';
import {ReadableStream, WritableStream, TransformStream} from 'web-streams-polyfill';

export {AbortController, AbortSignal} from './abort.mjs';
export {structuredClone} from './structured-clone.mjs';
export {installFetchPrimitives} from './fetch-primitives.mjs';
export {installMissingBuiltins, strictURL, sha256Subtle} from './builtins.mjs';
export {createFetch} from './fetch.mjs';
export {connectNetworkBridge} from './network-bridge.mjs';
export {networkError, NETWORK_ERROR_PREFIX} from './network-error.mjs';
export {PLATFORM_CHECKS, ACCEPTED_DIFFERENCES, checkPlatform} from './conformance.mjs';

const WATCHED_GLOBALS = ['TextEncoder', 'TextDecoder', 'TextDecoderStream', 'URL', 'URLSearchParams', 'atob', 'btoa',
  'structuredClone', 'Headers', 'Request', 'Response', 'ReadableStream', 'AbortController', 'AbortSignal', 'DOMException',
  'EventTarget', 'CustomEvent', 'performance', 'queueMicrotask', 'crypto'];

// Fills the Web/Node globals the HarmonyOS ThreadWorker lacks, keeping any the runtime
// already implements correctly. Call once, at the top of the Worker, before loading
// Node-targeted code. The ArkTS side passes its own primitives (see harmony/WorkerEntry.ts):
//   crypto           {randomUUID(), getRandomValues(bytes)}  (required)
//   URL              ArkTS url.URL                          (required)
//   URLSearchParams  ArkTS url.URLSearchParams              (required unless present)
//   TextEncoder, TextDecoder  ArkTS util.TextEncoder / util.TextDecoder
//   createSha256     () => {update(bytes), digest(): Uint8Array}, for crypto.subtle and createHash
// Returns the names of the watched globals the runtime brought itself, before any shim.
export function installWorkerPlatform({crypto, URL: URLClass, URLSearchParams: URLSearchParamsClass, TextEncoder: TextEncoderClass,
  TextDecoder: TextDecoderClass, createSha256} = {}) {
  const nativeGlobals = WATCHED_GLOBALS.filter(name => typeof globalThis[name] !== 'undefined');
  if (!crypto?.getRandomValues || !crypto?.randomUUID) throw Error('Secure random source required');
  if (typeof URLClass !== 'function') throw Error('URL class required');
  if (createSha256) setSha256Factory(createSha256);
  // Native runtimes may expose these as read-only globals. Keep supported
  // implementations in place and only fill actual gaps.
  if (!globalThis.crypto) globalThis.crypto = crypto;
  // ArkTS URL does not throw on invalid input; see builtins.mjs.
  if (!globalThis.URL) globalThis.URL = strictURL(URLClass);
  if (!globalThis.URLSearchParams) globalThis.URLSearchParams = URLSearchParamsClass;
  if (!globalThis.URLSearchParams) throw Error('URLSearchParams required');
  globalThis.ReadableStream ??= ReadableStream;
  globalThis.WritableStream ??= WritableStream;
  globalThis.TransformStream ??= TransformStream;
  installFetchPrimitives(globalThis, {TextEncoderClass, TextDecoderClass});
  installMissingBuiltins(globalThis, {createSha256});
  globalThis.TextDecoderStream ??= class TextDecoderStream {
    constructor(label='utf-8', options={}) {
      const decoder=new globalThis.TextDecoder(label, options);
      const stream=new globalThis.TransformStream({
        transform(chunk, controller) { const text=decoder.decode(chunk,{stream:true});if(text)controller.enqueue(text); },
        flush(controller) { const text=decoder.decode();if(text)controller.enqueue(text); }
      });
      this.readable=stream.readable;this.writable=stream.writable;
    }
  };
  globalThis.performance ??= {now: () => Date.now()};
  globalThis.structuredClone ??= structuredClone;
  globalThis.AbortController ??= AbortController;
  globalThis.AbortSignal ??= AbortSignal;
  Symbol.dispose ??= Symbol.for('Symbol.dispose');
  Symbol.asyncDispose ??= Symbol.for('Symbol.asyncDispose');
  Promise.withResolvers ??= function () {
    let resolve, reject;
    const promise = new this((yes, no) => { resolve = yes; reject = no; });
    return {promise, resolve, reject};
  };
  return nativeGlobals;
}
