// node:crypto subset: randomUUID and createHash('sha256'). The SHA-256 source is the
// factory passed to installWorkerPlatform (ArkTS cryptoFramework on device), or one
// set with setSha256Factory; hex and raw-byte digests only.
// Kept on globalThis so separately bundled copies of this module share one source.
const KEY=Symbol.for('harmonyos-node-compat.sha256');
export function setSha256Factory(factory){globalThis[KEY]=typeof factory==='function'?factory:undefined}
export const randomUUID=()=>globalThis.crypto.randomUUID();
export function createHash(algorithm){
 if(algorithm!=='sha256')throw Error('Unsupported digest '+algorithm);
 const factory=globalThis[KEY];
 if(!factory)throw Error('No SHA-256 source: pass createSha256 to installWorkerPlatform');
 const h=factory();
 return {
  update(value){h.update(typeof value==='string'?new TextEncoder().encode(value):value);return this},
  digest(encoding){
   const bytes=h.digest();
   if(encoding==='hex')return Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
   if(encoding===undefined)return bytes;
   throw Error('Unsupported digest encoding');
  },
 };
}
