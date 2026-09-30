import { worker, MessageEvents } from '@kit.ArkTS';
import { NativeFetchHost, NetworkEvent } from '../network/NativeFetchHost';

interface WorkerMessage {
  type: string;
  text?: string;
  id?: string;
  message?: string;
  unexpected?: Object[];
  length?: number;
  error?: string;
}
interface NetworkEventEnvelope { type: string; event: NetworkEvent; }
interface DemoRequest { type: string; url?: string; }

// Demo host page: starts the ThreadWorker, serves its network requests with
// NativeFetchHost, and shows the results of the self-check and a fetch.
@Entry
@Component
struct Index {
  @State status: string = 'Starting worker…';
  @State selfCheck: string = '';
  @State fetchResult: string = '';
  @State url: string = 'https://www.example.com/';
  private runtime?: worker.ThreadWorker;
  private network?: NativeFetchHost;

  aboutToAppear(): void {
    const runtime = new worker.ThreadWorker('entry/ets/workers/WorkerEntry.ts');
    const network = new NativeFetchHost((event: NetworkEvent): void => {
      const envelope: NetworkEventEnvelope = { type: 'network-event', event: event };
      runtime.postMessage(envelope);
    }, { onDiagnostic: (scope: string, message: string): void => console.warn(`[${scope}] ${message}`) });
    runtime.onmessage = (event: MessageEvents): void => {
      const message = event.data as WorkerMessage;
      if (message.type === 'network' && message.text) network.request(message.text);
      else if (message.type === 'network-cancel' && message.id) network.cancel(message.id);
      else if (message.type === 'worker-ready') this.status = 'Worker ready';
      else if (message.type === 'worker-failed') this.status = 'Worker failed: ' + (message.message ?? '');
      else if (message.type === 'self-check-result') {
        const unexpected = message.unexpected ?? [];
        this.selfCheck = unexpected.length === 0 ? 'No unexpected differences from Node' : JSON.stringify(unexpected, null, 2);
      } else if (message.type === 'fetch-demo-result') {
        this.fetchResult = message.error ? 'Error: ' + message.error : `Received ${message.length} characters`;
      }
    };
    this.runtime = runtime;
    this.network = network;
    // The Worker's own 'worker-ready' can be lost while it starts; the ping is queued
    // until the Worker listens and is answered with 'worker-ready'.
    const ping: DemoRequest = { type: 'ping' };
    this.send(ping);
  }

  aboutToDisappear(): void {
    this.network?.dispose();
    try { this.runtime?.terminate(); } catch (error) { console.warn('worker terminate failed: ' + String(error)); }
  }

  private send(request: DemoRequest): void {
    try { this.runtime?.postMessage(request); } catch (error) { this.status = 'Worker unavailable: ' + String(error); }
  }

  build() {
    Column({ space: 12 }) {
      Text('harmonyos-node-compat').fontSize(22).fontWeight(FontWeight.Bold)
      Text(this.status).id('status')
      Button('Run self-check').id('selfCheck').onClick(() => {
        this.selfCheck = 'Running…';
        this.send({ type: 'self-check' });
      })
      Text(this.selfCheck).id('selfCheckResult')
      TextInput({ text: this.url }).onChange((value: string) => { this.url = value; })
      Button('Fetch').id('fetch').onClick(() => {
        this.fetchResult = 'Fetching…';
        this.send({ type: 'fetch-demo', url: this.url });
      })
      Text(this.fetchResult).id('fetchResult')
    }
    .padding(16)
    .width('100%')
    .height('100%')
  }
}
