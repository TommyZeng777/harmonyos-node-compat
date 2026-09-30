import { rcp } from '@kit.RemoteCommunicationKit';
import { url } from '@kit.ArkTS';

// ArkTS side of src/network-bridge.mjs: performs HTTPS requests with RCP
// (@kit.RemoteCommunicationKit) and streams the response back as events.
// Event order per request id: headers, bytes..., then end or error.

interface ActiveRequest { session: rcp.Session; request: rcp.Request; }
interface NetworkFailure { code?: number; message?: string; }
export interface PinnedAddress { address: string; family: number; }
interface NetworkRequest { id: string; url: string; method: string; headers: string[][]; body?: string; pinnedAddresses?: PinnedAddress[]; }
export interface NetworkEvent { id: string; type: string; status?: number; headers?: Record<string, string>; bytes?: Uint8Array; message?: string; code?: number; phase?: string; }
export interface NativeFetchHostOptions {
  // Proxy for every request; 'no-proxy' (default) ignores a system proxy.
  proxy?: rcp.ProxyConfiguration;
  // Called with a short scope and a message that never contains headers or bodies.
  onDiagnostic?: (scope: string, message: string) => void;
}

const RCP_SSL_CONNECT_ERROR = 1007900035;
const RCP_CANCELLED = 1007900992;
const CHUNK_BYTES = 16384;

export class NativeFetchHost {
  private pending: Map<string, number> = new Map();
  private sequence: number = 0;
  private active: Map<string, ActiveRequest> = new Map();
  // One session per route keeps TCP/TLS connections alive between requests;
  // a new session per request re-handshakes every time.
  private sessions: Map<string, rcp.Session> = new Map();
  private emit: (event: NetworkEvent) => void;
  private proxy: rcp.ProxyConfiguration;
  private diagnostic: (scope: string, message: string) => void;

  constructor(emit: (event: NetworkEvent) => void, options?: NativeFetchHostOptions) {
    this.emit = emit;
    this.proxy = options?.proxy ?? 'no-proxy';
    this.diagnostic = options?.onDiagnostic ?? ((_scope: string, _message: string): void => {});
  }

  private sessionFor(key: string): rcp.Session {
    let session = this.sessions.get(key);
    if (!session) { session = rcp.createSession(); this.sessions.set(key, session); }
    return session;
  }

  // Unpools a session; it closes once no request still streams on it.
  private dropSession(key: string, session: rcp.Session): void {
    if (this.sessions.get(key) === session) this.sessions.delete(key);
    for (const entry of this.active.values()) if (entry.session === session) return;
    session.close();
  }

  cancel(id: string): void {
    this.pending.delete(id);
    const entry = this.active.get(id);
    if (entry) entry.session.cancel(entry.request);
    this.active.delete(id);
  }

  // Closes every pooled session; pending requests end with an error event.
  dispose(): void {
    for (const id of Array.from(this.active.keys())) this.cancel(id);
    for (const session of this.sessions.values()) session.close();
    this.sessions.clear();
  }

  request(text: string): void {
    let input: NetworkRequest;
    // A request that cannot be answered by id (or reuses a live id, whose events belong
    // to the first request) is dropped; the Worker's idle deadline reports it.
    try { input = JSON.parse(text) as NetworkRequest; }
    catch (_) { this.diagnostic('network.request', 'invalid_network_envelope'); return; }
    if (!input.id || input.id.length > 80 || this.pending.has(input.id)) {
      this.diagnostic('network.request', this.pending.has(input.id) ? 'duplicate_network_request_id' : 'invalid_network_request_id');
      return;
    }
    const pinned = (input.pinnedAddresses?.length ?? 0) > 0;
    if ((!input.url.startsWith('https://') && !(pinned && input.url.startsWith('http://'))) || (input.method !== 'GET' && input.method !== 'POST') || text.length > 32 * 1024 * 1024) {
      this.emit({ id: input.id, type: 'error', message: 'invalid_network_request' });
      return;
    }
    const requestHeaders: Record<string, string> = {};
    for (const pair of input.headers) requestHeaders[pair[0]] = pair[1];
    const token = ++this.sequence;
    this.pending.set(input.id, token);
    this.attempt(input, requestHeaders, token, 0);
  }

  private attempt(input: NetworkRequest, requestHeaders: Record<string, string>, token: number, retry: number): void {
    if (this.pending.get(input.id) !== token) return;
    let retryScheduled = false;
    let host = 'invalid';
    let status: number = 0;
    let responseHeaders: Record<string, string> = {};
    let sentHeaders: boolean = false;
    const sendHeaders = (): void => {
      if (sentHeaders) return;
      if (status < 200 || status > 599) throw new Error('response_status_unavailable');
      sentHeaders = true;
      this.emit({ id: input.id, type: 'headers', status: status, headers: responseHeaders });
    };
    // Pinned requests get their own session, keyed by the addresses they may reach.
    const sessionKey = (input.pinnedAddresses || []).map((item: PinnedAddress): string => item.address).join(',');
    try {
      const session = this.sessionFor(sessionKey);
      const target = new url.URL(input.url);
      host = target.hostname;
      const dns: rcp.DnsConfiguration | undefined = input.pinnedAddresses?.length ? { dnsRules: [{ host: target.hostname,
        port: target.port ? Number(target.port) : target.protocol === 'https:' ? 443 : 80,
        ipAddresses: input.pinnedAddresses.map((item: PinnedAddress): string => item.address) }] } : undefined;
      const request = new rcp.Request(input.url, input.method === 'POST' ? 'POST' : 'GET', requestHeaders, input.body, undefined, undefined, {
        dns: dns,
        // RCP defaults to a 60 s total transfer deadline, which truncates long SSE
        // streams. Bound the whole request separately; the Worker has its own idle timeout.
        transfer: { autoRedirect: false, timeout: { connectMs: 60000, transferMs: 1800000 } },
        proxy: input.pinnedAddresses?.length ? 'no-proxy' : this.proxy,
        tracing: { httpEventsHandler: {
          onStatusCodeReceive: (code: number): void => { status = code; },
          onHeaderReceive: (raw: rcp.ResponseHeaders): void => {
            const next: Record<string, string> = {};
            for (const key of Object.keys(raw)) {
              const value = raw[key];
              if (typeof value === 'string') next[key] = value;
            }
            responseHeaders = next;
          },
          onDataReceive: (bytes: ArrayBuffer): void => {
            if (this.pending.get(input.id) !== token) return;
            sendHeaders();
            const view = new Uint8Array(bytes);
            for (let start = 0; start < view.length; start += CHUNK_BYTES) {
              this.emit({ id: input.id, type: 'bytes', bytes: view.slice(start, start + CHUNK_BYTES) });
            }
          }
        } }
      });
      this.active.set(input.id, { session: session, request: request });
      session.fetch(request).then((response: rcp.Response): void => {
        if (this.pending.get(input.id) !== token) return;
        if (sentHeaders && response.statusCode !== status) throw new Error('response_status_changed');
        status = response.statusCode; sendHeaders();
        this.emit({ id: input.id, type: 'end' });
      }).catch((error: Error): void => {
        const failure = error as NetworkFailure;
        // A failed transfer may leave a broken pooled connection; later requests start clean.
        if (this.pending.get(input.id) === token) this.dropSession(sessionKey, session);
        // cancel() already removed the request: the caller stopped reading. Not a failure.
        const cancelledHere = failure.code === RCP_CANCELLED && this.pending.get(input.id) !== token;
        if (!cancelledHere) this.diagnostic('network.fetch', 'code=' + (failure.code || 0).toString() + ' host=' + host);
        if (this.pending.get(input.id) !== token) return;
        const phase = sentHeaders ? 'stream' : status > 0 ? 'headers' : 'start';
        // SSL connect fails before an HTTP request is delivered, so it is safe to retry.
        // Never replay a request once any response byte has arrived.
        if (failure.code === RCP_SSL_CONNECT_ERROR && status === 0 && !sentHeaders && retry < 2) {
          retryScheduled = true;
          setTimeout((): void => this.attempt(input, requestHeaders, token, retry + 1), retry === 0 ? 500 : 1500);
          return;
        }
        this.emit({ id: input.id, type: 'error', code: failure.code || 0, phase: phase, message: 'native_network_failed: code=' + (failure.code || 0).toString() });
      }).finally((): void => {
        if (this.active.get(input.id)?.request === request) this.active.delete(input.id);
        if (!retryScheduled && this.pending.get(input.id) === token) this.pending.delete(input.id);
        if (this.sessions.get(sessionKey) !== session) this.dropSession(sessionKey, session);
      });
    } catch (error) {
      if (this.pending.get(input.id) !== token) return;
      this.pending.delete(input.id);
      const failure = error as NetworkFailure;
      this.diagnostic('network.start', 'code=' + (failure.code || 0).toString() + ' host=' + host);
      this.emit({ id: input.id, type: 'error', code: failure.code || 0, phase: 'start', message: 'native_network_start_failed' });
    }
  }
}
