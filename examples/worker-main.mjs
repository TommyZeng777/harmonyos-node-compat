// Worker-side entry. Bundle it for the ThreadWorker, e.g.:
//   npx esbuild examples/worker-main.mjs --bundle --format=esm --target=es2016 \
//     --outfile=entry/src/main/ets/workers/WorkerBundle.js
import {installWorkerPlatform, connectNetworkBridge, checkPlatform, ACCEPTED_DIFFERENCES} from 'harmonyos-node-compat';

export function mount(port, primitives) {
  installWorkerPlatform(primitives);
  const bridge = connectNetworkBridge({
    request: text => port.postMessage({type: 'network', text}),
    cancel: id => port.postMessage({type: 'network-cancel', id}),
  });
  globalThis.fetch = bridge.fetch;
  port.onmessage = event => {
    const message = event.data;
    // A message the Worker posts while starting up can be lost on HarmonyOS, so the
    // host also pings; answer every ping with 'worker-ready' (see harmony/WorkerEntry.ts).
    if (message?.type === 'ping') { port.postMessage({type: 'worker-ready'}); return; }
    if (message?.type === 'network-event') { bridge.receive(message.event); return; }
    if (message?.type === 'self-check') {
      const unexpected = checkPlatform().filter(item => !(item.id in ACCEPTED_DIFFERENCES));
      port.postMessage({type: 'self-check-result', unexpected});
      return;
    }
    if (message?.type === 'fetch-demo') {
      // Streams a response through the ArkTS host and reports its size.
      fetch(message.url).then(response => response.text())
        .then(text => port.postMessage({type: 'fetch-demo-result', length: text.length}),
          error => port.postMessage({type: 'fetch-demo-result', error: String(error?.message ?? error)}));
    }
  };
  // Code that reads Web/Node globals when its module loads must start here, after
  // installWorkerPlatform, not from a top-level import of this file.
}
