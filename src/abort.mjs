// AbortController/AbortSignal for the HarmonyOS ThreadWorker, where they are absent.
// fetch.mjs binds these signals to host-side transport cancellation.
// Same default reasons as Node: DOMException when available, else an Error with that name.
const DEFAULT_MESSAGES = { AbortError: 'This operation was aborted', TimeoutError: 'The operation was aborted due to timeout' };
function abortError(name) {
  if (typeof globalThis.DOMException === 'function') return new globalThis.DOMException(DEFAULT_MESSAGES[name], name);
  const error = new Error(DEFAULT_MESSAGES[name]);
  error.name = name;
  return error;
}

export class AbortSignal {
  constructor() {
    this.aborted = false;
    this.reason = undefined;
    this.onabort = null;
    this.listeners = new Map();
  }

  addEventListener(type, listener, options) {
    if (type !== 'abort' || !listener) return;
    this.listeners.set(listener, { once: options === true || options?.once === true });
  }

  removeEventListener(type, listener) {
    if (type === 'abort') this.listeners.delete(listener);
  }

  throwIfAborted() {
    if (this.aborted) throw this.reason;
  }

  dispatchEvent(event) {
    if (event?.type !== 'abort') return true;
    const invoke = listener => {
      try {
        if (typeof listener === 'function') listener.call(this, event);
        else listener.handleEvent?.(event);
      } catch (error) {
        // One consumer must not prevent transport cancellation or signal fan-out.
        console.error('abort listener failed', error);
      }
    };
    for (const [listener, options] of [...this.listeners]) {
      if (!this.listeners.has(listener)) continue;
      if (options.once) this.listeners.delete(listener);
      invoke(listener);
    }
    if (this.onabort) invoke(this.onabort);
    return true;
  }

  static abort(reason = abortError('AbortError')) {
    const controller = new AbortController();
    controller.abort(reason);
    return controller.signal;
  }

  static timeout(milliseconds) {
    if (!Number.isInteger(milliseconds) || milliseconds < 0) throw new RangeError('Invalid timeout');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(abortError('TimeoutError')), milliseconds);
    controller.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
    return controller.signal;
  }

  static any(signals) {
    const controller = new AbortController();
    const registered = [];
    const clear = () => { for (const [signal, listener] of registered) signal.removeEventListener('abort', listener); };
    for (const signal of signals) {
      if (signal.aborted) { clear(); controller.abort(signal.reason); return controller.signal; }
      const listener = () => { clear(); controller.abort(signal.reason); };
      signal.addEventListener('abort', listener, { once: true });
      registered.push([signal, listener]);
    }
    return controller.signal;
  }
}

export class AbortController {
  constructor() { this.signal = new AbortSignal(); }

  abort(reason = abortError('AbortError')) {
    if (this.signal.aborted) return;
    this.signal.aborted = true;
    this.signal.reason = reason;
    this.signal.dispatchEvent({ type: 'abort', target: this.signal });
  }
}
