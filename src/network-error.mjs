// A bounded, credential-free error envelope that survives SDKs which flatten
// Error.cause: the category is in the message as well as on `code`.
// Native codes are RCP (@kit.RemoteCommunicationKit) business codes, 1007900000 + n,
// where n follows the libcurl CURLcode numbering. A host built on @kit.NetworkKit
// http (codes 2300000 + n) should map them into the same range.
export const NETWORK_ERROR_PREFIX='[HARMONY_NET:';
export const RCP_CODE_BASE=1007900000;
export function networkError(input){
 const event=typeof input==='string'?{message:input}:input;
 const message=String(event.message||'native_network_failed');
 const nativeCode=Number(event.code||/\bcode=(\d+)\b/.exec(message)?.[1]||0);
 const n=nativeCode-RCP_CODE_BASE;
 let category='NATIVE_UNKNOWN';
 if([5,6,7,16,18,35,52,55,56,81,92,95,96,97].includes(n))category='TRANSPORT';
 if(n===28||/deadline exceeded/i.test(message))category='TIMEOUT';
 if([51,58,59,60,77,82,83,90,91,98].includes(n))category='TLS_CERTIFICATE';
 if([27,23,26,63,70,89,100].includes(n)||/buffer exceeded/i.test(message))category='RESOURCE_EXHAUSTED';
 if([1,2,3,4,43,48,49].includes(n)||/invalid_network_request|HTTPS required|Unsupported request method/i.test(message))category='INVALID_REQUEST';
 if([9,67,94].includes(n)||nativeCode===201)category='AUTH';
 if(nativeCode===401)category='INVALID_REQUEST';
 if(n===42)category='ABORTED';
 if(/disposed/i.test(message))category='RUNTIME_DISPOSED';
 if(/Response ended without headers/i.test(message))category='TRANSPORT';
 if(/Duplicate response headers|Body received before response status|response_status_/i.test(message))category='NATIVE_PROTOCOL';
 const phase=['start','headers','stream'].includes(event.phase)?event.phase:'start';
 const cancelReason=event.cancelReason==='user'?'user':category==='RUNTIME_DISPOSED'?'disposed':category==='ABORTED'?'native_abort':'none';
 if(cancelReason==='user')category='ABORTED';
 const detail=['Body received before response status','Duplicate response headers','Native stream buffer exceeded','Response ended without headers'].includes(message)?' '+message:'';
 const error=Error(`${NETWORK_ERROR_PREFIX}${category};code=${nativeCode};phase=${phase};cancel=${cancelReason}]${detail}`);
 Object.assign(error,{code:category,nativeCode,phase,cancelReason});
 return error;
}
