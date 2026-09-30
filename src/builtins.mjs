// Built-ins that Node-targeted code calls but the HarmonyOS ThreadWorker lacks or answers
// differently, found by the on-device self-check (conformance.mjs; HarmonyOS 7.0.0.106
// emulator and 7.0.0.109 tablet gave identical results). Each is added only when the
// runtime lacks it and follows Node; test/builtins.test.mjs compares with Node.
// Not added: EventTarget/Event, Intl.Collator `numeric` and IDN hostnames
// (see ACCEPTED_DIFFERENCES in conformance.mjs).
function define(target, key, value) {
  try { Object.defineProperty(target, key, { value, writable: true, configurable: true }); } catch (_) {}
}
function defineFixed(target, key, value) {
  try { Object.defineProperty(target, key, { value, writable: false, configurable: true }); } catch (_) {}
}

// ArkTS url.URL returns an empty href for input it cannot parse instead of throwing,
// and has no canParse/parse. zod URL validation and MCP OAuth rely on both.
export function strictURL(NativeURL) {
  const StrictURL = new Proxy(NativeURL, {
    construct(target, args, newTarget) {
      const url = Reflect.construct(target, args, newTarget);
      if (!url.href) throw new TypeError('Invalid URL: ' + String(args[0]));
      return url;
    },
  });
  if (typeof NativeURL.canParse !== 'function') define(NativeURL, 'canParse', (input, base) => { try { new StrictURL(input, base); return true; } catch (_) { return false; } });
  if (typeof NativeURL.parse !== 'function') define(NativeURL, 'parse', (input, base) => { try { return new StrictURL(input, base); } catch (_) { return null; } });
  return StrictURL;
}

// crypto.subtle.digest('SHA-256') for OAuth PKCE (pi-ai, pkce-challenge), on the
// runtime's native digest. Other algorithms reject like an unsupported WebCrypto call.
export function sha256Subtle(createSha256) {
  return {
    digest(algorithm, data) {
      const name = String(typeof algorithm === 'string' ? algorithm : algorithm?.name).toUpperCase();
      if (name !== 'SHA-256') return Promise.reject(Object.assign(new Error('Unsupported digest ' + name), { name: 'NotSupportedError' }));
      try {
        const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        const hash = createSha256();
        hash.update(bytes);
        const digest = hash.digest();
        return Promise.resolve(digest.buffer.slice(digest.byteOffset, digest.byteOffset + digest.byteLength));
      } catch (error) { return Promise.reject(error); }
    },
  };
}

function setLike(other) {
  if (!other || typeof other.has !== 'function' || typeof other.keys !== 'function' || !(other.size >= 0)) throw new TypeError('Set-like argument required');
  return other;
}

export function installMissingBuiltins(target, { createSha256 } = {}) {
  // Non-writable on purpose: zone.js wraps every writable global it finds and runs
  // wrapped microtasks as callback.apply(null, null). ArkTS throws "Type of target is
  // not Object" for that call, so a wrapped queueMicrotask silently stalls every
  // streamed HTTP response. zone.js skips non-writable properties.
  if (typeof target.queueMicrotask !== 'function') {
    defineFixed(target, 'queueMicrotask', callback => {
      if (typeof callback !== 'function') throw new TypeError('queueMicrotask requires a function');
      // An exception still surfaces as an uncaught error, as in Node.
      Promise.resolve().then(callback).catch(error => setTimeout(() => { throw error; }, 0));
    });
  }
  if (typeof Error.captureStackTrace !== 'function') {
    define(Error, 'captureStackTrace', object => {
      if (object && (typeof object === 'object' || typeof object === 'function')) define(object, 'stack', new Error(object.message).stack);
    });
  }
  if (target.crypto && !target.crypto.subtle && createSha256) define(target.crypto, 'subtle', sha256Subtle(createSha256));
  if (typeof Object.groupBy !== 'function') {
    define(Object, 'groupBy', (items, callback) => {
      const groups = Object.create(null); let index = 0;
      for (const item of items) { const key = callback(item, index++); (groups[key] ??= []).push(item); }
      return groups;
    });
  }
  if (typeof Map.groupBy !== 'function') {
    define(Map, 'groupBy', (items, callback) => {
      const groups = new Map(); let index = 0;
      for (const item of items) { const key = callback(item, index++); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(item); }
      return groups;
    });
  }
  const setMethods = {
    union(other) { const out = new Set(this); for (const value of setLike(other).keys()) out.add(value); return out; },
    intersection(other) { setLike(other); const out = new Set(); for (const value of this) if (other.has(value)) out.add(value); return out; },
    difference(other) { setLike(other); const out = new Set(); for (const value of this) if (!other.has(value)) out.add(value); return out; },
    symmetricDifference(other) { const out = new Set(this); for (const value of setLike(other).keys()) { if (this.has(value)) out.delete(value); else out.add(value); } return out; },
    isSubsetOf(other) { setLike(other); for (const value of this) if (!other.has(value)) return false; return true; },
    isSupersetOf(other) { for (const value of setLike(other).keys()) if (!this.has(value)) return false; return true; },
    isDisjointFrom(other) { setLike(other); for (const value of this) if (other.has(value)) return false; return true; },
  };
  for (const [name, method] of Object.entries(setMethods)) if (typeof Set.prototype[name] !== 'function') define(Set.prototype, name, method);
}
