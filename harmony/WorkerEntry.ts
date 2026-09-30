import { worker, util, url } from '@kit.ArkTS';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
// WorkerBundle.js is examples/worker-main.mjs bundled with esbuild (see README).
import { mount } from './WorkerBundle';

// ThreadWorker entry: hands the ArkTS primitives to installWorkerPlatform.
const port = worker.workerPort;
try {
  mount(port, {
    crypto: {
      randomUUID: (): string => util.generateRandomUUID(),
      getRandomValues: (values: Uint8Array): Uint8Array => {
        values.set(cryptoFramework.createRandom().generateRandomSync(values.length).data);
        return values;
      }
    },
    URL: url.URL,
    URLSearchParams: url.URLSearchParams,
    TextEncoder: util.TextEncoder,
    TextDecoder: util.TextDecoder,
    createSha256: () => {
      const md = cryptoFramework.createMd('SHA256');
      return {
        // HarmonyOS rejects a zero-byte update; skipping it keeps the standard empty digest.
        update: (bytes: Uint8Array): void => { if (bytes.length > 0) md.updateSync({ data: bytes }); },
        digest: (): Uint8Array => md.digestSync().data
      };
    }
  });
  // Sent once now and again for every host 'ping' (examples/worker-main.mjs): a message
  // posted while the Worker starts up can be lost, so the host must also ping.
  port.postMessage({ type: 'worker-ready' });
} catch (error) {
  port.postMessage({ type: 'worker-failed', message: String(error) });
}
