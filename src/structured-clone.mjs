// Synchronous structuredClone for the HarmonyOS ThreadWorker, where it is absent. It
// follows the HTML structured clone rules as Node implements them (test/node-parity.test.mjs
// compares it with Node): Errors keep their standard type, message, cause and stack;
// ordinary class instances become plain objects; symbol keys are skipped; web
// platform objects Node refuses (URL, Headers, streams…) still throw DataCloneError.
const ERROR_TYPES = { Error, EvalError, RangeError, ReferenceError, SyntaxError, TypeError, URIError };
const UNCLONEABLE = ['URL', 'URLSearchParams', 'Headers', 'Request', 'Response', 'ReadableStream', 'WritableStream', 'TransformStream'];
function dataCloneError(message) {
  const error = new Error(message);
  error.name = 'DataCloneError';
  return error;
}

export function structuredClone(input) {
  const seen = new Map();
  function clone(value) {
    if (value === null || typeof value === 'undefined' || typeof value === 'string'
      || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return value;
    if (typeof value !== 'object') throw dataCloneError('Value cannot be cloned');
    if (seen.has(value)) return seen.get(value);
    if (value instanceof ArrayBuffer) {
      const copy = value.slice(0);
      seen.set(value, copy);
      return copy;
    }
    if (typeof SharedArrayBuffer !== 'undefined' && value instanceof SharedArrayBuffer)
      throw dataCloneError('SharedArrayBuffer is not supported');
    if (ArrayBuffer.isView(value)) {
      const buffer = clone(value.buffer);
      const copy = value instanceof DataView
        ? new DataView(buffer, value.byteOffset, value.byteLength)
        : new value.constructor(buffer, value.byteOffset, value.length);
      seen.set(value, copy);
      return copy;
    }
    if (value instanceof Date) {
      const copy = new Date(value.getTime());
      seen.set(value, copy);
      return copy;
    }
    if (value instanceof RegExp) {
      const copy = new RegExp(value.source, value.flags);
      seen.set(value, copy);
      return copy;
    }
    if (value instanceof Map) {
      const copy = new Map();
      seen.set(value, copy);
      for (const [key, item] of value) copy.set(clone(key), clone(item));
      return copy;
    }
    if (value instanceof Set) {
      const copy = new Set();
      seen.set(value, copy);
      for (const item of value) copy.add(clone(item));
      return copy;
    }
    if (value instanceof WeakMap || value instanceof WeakSet || value instanceof Promise
      || UNCLONEABLE.some(name => typeof globalThis[name] === 'function' && value instanceof globalThis[name]))
      throw dataCloneError('Host object cannot be cloned');
    if (value instanceof Error) {
      const type = typeof value.name === 'string' && Object.hasOwn(ERROR_TYPES, value.name) ? value.name : 'Error';
      const copy = new ERROR_TYPES[type]();
      seen.set(value, copy);
      const message = Object.getOwnPropertyDescriptor(value, 'message');
      if (message && 'value' in message) Object.defineProperty(copy, 'message', { value: String(message.value), writable: true, configurable: true });
      if (Object.hasOwn(value, 'cause')) Object.defineProperty(copy, 'cause', { value: clone(value.cause), writable: true, configurable: true });
      if (typeof value.stack === 'string') Object.defineProperty(copy, 'stack', { value: value.stack, writable: true, configurable: true });
      return copy;
    }
    if (value instanceof Boolean || value instanceof Number || value instanceof String
      || (typeof BigInt !== 'undefined' && Object.prototype.toString.call(value) === '[object BigInt]')) {
      const copy = Object(value.valueOf());
      seen.set(value, copy);
      return copy;
    }
    // Arrays keep length and holes; other objects, class instances included, become
    // plain objects with their own enumerable string keys (symbol keys are skipped).
    const copy = Array.isArray(value) ? new Array(value.length) : {};
    seen.set(value, copy);
    for (const key of Object.keys(value))
      Object.defineProperty(copy, key, { value: clone(value[key]), enumerable: true, writable: true, configurable: true });
    return copy;
  }
  return clone(input);
}
