// Copies the ArkTS host files into example-app and bundles examples/worker-main.mjs
// as its Worker bundle. The copies are generated (git-ignored); edit harmony/ and examples/.
import {build} from 'esbuild';
import {copyFile, mkdir} from 'node:fs/promises';
const root=new URL('..',import.meta.url);
const ets=new URL('example-app/entry/src/main/ets/',root);
await mkdir(new URL('workers/',ets),{recursive:true});
await mkdir(new URL('network/',ets),{recursive:true});
await copyFile(new URL('harmony/WorkerEntry.ts',root),new URL('workers/WorkerEntry.ts',ets));
await copyFile(new URL('harmony/NativeFetchHost.ets',root),new URL('network/NativeFetchHost.ets',ets));
await copyFile(new URL('harmony/NativeDns.ets',root),new URL('network/NativeDns.ets',ets));
await build({entryPoints:[new URL('examples/worker-main.mjs',root).pathname],bundle:true,format:'esm',target:'es2016',
  outfile:new URL('workers/WorkerBundle.js',ets).pathname,logLevel:'info'});
