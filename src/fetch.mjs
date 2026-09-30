import {networkError, NETWORK_ERROR_PREFIX} from './network-error.mjs';
// A fetch() for the ThreadWorker whose bytes come from a host on the ArkTS side
// (RCP or @kit.NetworkKit). JSON and SSE requests only. The host must emit headers
// (with the real status), bytes, then end or error, in that order. The host owns
// TLS, proxy and credential policy.
//
// init.pinnedAddresses ([{address, family}]) connects to exactly those IPs instead of
// resolving the hostname, e.g. after an SSRF check on the resolved addresses. Only a
// pinned request may use plain http.
//
// start(request, sink) receives {url, method, headers: [name, value][], body,
// pinnedAddresses?} and a
// sink {headers(status, headers), bytes(chunk), end(), error(error)}; it returns
// {cancel()}, which is called at most once when the caller aborts or stops reading.
export function createFetch(start, {maxBufferedBytes=4*1024*1024}={}) {
  return async function fetch(input, init={}) {
    const request=new Request(input,init);
    const pinned=Array.isArray(init.pinnedAddresses)&&init.pinnedAddresses.length?init.pinnedAddresses.map(({address,family})=>({address:String(address),family:Number(family)})):undefined;
    const protocol=new URL(request.url).protocol;
    if(protocol!=='https:'&&!(pinned&&protocol==='http:'))throw new TypeError('HTTPS required');
    if(!['GET','POST'].includes(request.method))throw new TypeError('Unsupported request method');
    request.signal.throwIfAborted();
    const body=request.method==='POST'?(typeof request.body==='string'?request.body:await request.text()):undefined;
    request.signal.throwIfAborted();
    return new Promise((resolve,reject)=>{
      let controller,handle,finished=false,headersSeen=false,cancelPending=false;
      const cleanup=()=>request.signal.removeEventListener('abort',abort);
      const cancelHost=()=>{if(handle)handle.cancel();else cancelPending=true};
      const fail=error=>{
        if(finished)return;
        if(!request.signal.aborted && !String(error?.message).startsWith(NETWORK_ERROR_PREFIX))error=networkError({message:error?.message,code:error?.code,phase:headersSeen?'stream':'start'});
        finished=true;cleanup();
        if(headersSeen)controller.error(error);else reject(error);
        cancelHost();
      };
      const abort=()=>fail(request.signal.reason??new DOMException('Aborted','AbortError'));
      const stream=new ReadableStream({start(c){controller=c},cancel(){
        if(finished)return;finished=true;cleanup();cancelHost();
      }},{highWaterMark:maxBufferedBytes,size:bytes=>bytes.byteLength});
      request.signal.addEventListener('abort',abort,{once:true});
      try {
        handle=start({url:request.url,method:request.method,headers:[...request.headers],body,...(pinned?{pinnedAddresses:pinned}:{})},{
          headers(status,headers){
            if(finished)return;
            if(headersSeen)return fail(Error('Duplicate response headers'));
            try {
              // Like Node's HTTP client, drop names Headers rejects (e.g. HTTP/2 pseudo-headers)
              // instead of failing the whole response.
              const received=Object.entries(headers||{}).filter(([name])=>/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)).map(([name,value])=>[name,String(value).replace(/[\0\r\n]/g,' ')]);
              const response=new Response([204,205,304].includes(status)?null:stream,{status,headers:received});
              headersSeen=true;resolve(response);
            }catch(error){fail(error)}
          },
          bytes(value){
            if(finished)return;
            if(!headersSeen)return fail(Error('Body received before response status'));
            const bytes=value instanceof ArrayBuffer?new Uint8Array(value.slice(0)):new Uint8Array(value);
            // No backpressure reaches the host: a consumer that falls this far behind fails
            // the request rather than growing the Worker heap without bound.
            if(bytes.byteLength>(controller.desiredSize??0))return fail(Error('Native stream buffer exceeded'));
            controller.enqueue(bytes);
          },
          end(){if(finished)return;if(!headersSeen)return fail(Error('Response ended without headers'));finished=true;cleanup();controller.close()},
          error:fail,
        });
        if(cancelPending)handle.cancel();
      }catch(error){fail(error)}
    });
  };
}
