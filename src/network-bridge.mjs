import {networkError} from './network-error.mjs';
import {createFetch} from './fetch.mjs';
// Worker side of the network bridge. `host.request(json)` and `host.cancel(id)` post
// to the ArkTS side (see harmony/NativeFetchHost.ets); every host event is passed
// back to `receive(event)`: {id, type: 'headers'|'bytes'|'end'|'error', ...}.
// A request with no host event for idleTimeoutMs fails with TIMEOUT and is cancelled.
export function connectNetworkBridge(host, {idleTimeoutMs=120000}={}) {
 const pending=new Map();let sequence=0,disposed=false;const prefix=crypto.randomUUID();
 const receive=event=>{
  const entry=pending.get(event.id);if(!entry)return;
  if(event.type==='end'||event.type==='error'){pending.delete(event.id);clearTimeout(entry.timer)}
  if(event.type==='headers'||event.type==='bytes')entry.touch();
  if(event.type==='headers'){entry.phase='headers';entry.sink.headers(event.status,event.headers);}
  else if(event.type==='bytes'){entry.phase='stream';entry.sink.bytes(event.bytes);}
  else if(event.type==='end')entry.sink.end();
  else if(event.type==='error')entry.sink.error(networkError({...event,phase:event.phase||entry.phase}));
 };
 const fetch=createFetch((request,sink)=>{
  if(disposed)throw networkError('Network bridge disposed');
  const id=prefix+'-'+(++sequence);
  const cancel=()=>{const entry=pending.get(id);if(!entry)return;clearTimeout(entry.timer);pending.delete(id);host.cancel(id)};
  const entry={sink,timer:null,phase:'start',touch(){
   clearTimeout(entry.timer);
   entry.timer=setTimeout(()=>{sink.error(networkError({message:'Native request deadline exceeded',phase:entry.phase}));cancel()},idleTimeoutMs);
  }};
  pending.set(id,entry);entry.touch();
  try{host.request(JSON.stringify({id,...request}))}catch(error){cancel();throw error}
  return {cancel};
 });
 return {fetch,receive,dispose(){if(disposed)return;disposed=true;for(const [id,entry] of pending){entry.sink.error(networkError({message:'Network runtime disposed',phase:entry.phase}));clearTimeout(entry.timer);if(pending.has(id))host.cancel(id)}pending.clear()}};
}
