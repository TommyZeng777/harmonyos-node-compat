// node:path (posix) for code bundled into the HarmonyOS ThreadWorker, following
// Node's lib/path.js posix algorithms (MIT, see NOTICE) so the results match Node:
// test/node-parity.test.mjs fuzzes every function against node:path/posix.
// The Worker has no process cwd: resolve() treats '/' as the working directory.
const SLASH=47,DOT=46;
function normalizeString(path,allowAboveRoot){
 let res='',lastSegmentLength=0,lastSlash=-1,dots=0,code=0;
 for(let i=0;i<=path.length;++i){
  if(i<path.length)code=path.charCodeAt(i);else if(code===SLASH)break;else code=SLASH;
  if(code===SLASH){
   if(lastSlash===i-1||dots===1){/* empty or '.' segment */}
   else if(dots===2){
    if(res.length<2||lastSegmentLength!==2||res.charCodeAt(res.length-1)!==DOT||res.charCodeAt(res.length-2)!==DOT){
     if(res.length>2){
      const lastSlashIndex=res.lastIndexOf('/');
      if(lastSlashIndex===-1){res='';lastSegmentLength=0}
      else{res=res.slice(0,lastSlashIndex);lastSegmentLength=res.length-1-res.lastIndexOf('/')}
      lastSlash=i;dots=0;continue;
     }else if(res.length!==0){res='';lastSegmentLength=0;lastSlash=i;dots=0;continue}
    }
    if(allowAboveRoot){res+=res.length>0?'/..':'..';lastSegmentLength=2}
   }else{
    if(res.length>0)res+='/'+path.slice(lastSlash+1,i);else res=path.slice(lastSlash+1,i);
    lastSegmentLength=i-lastSlash-1;
   }
   lastSlash=i;dots=0;
  }else if(code===DOT&&dots!==-1)++dots;
  else dots=-1;
 }
 return res;
}
export const sep='/';
export const delimiter=':';
export function normalize(path){
 if(path.length===0)return '.';
 const absolute=path.charCodeAt(0)===SLASH,trailing=path.charCodeAt(path.length-1)===SLASH;
 path=normalizeString(path,!absolute);
 if(path.length===0)return absolute?'/':trailing?'./':'.';
 if(trailing)path+='/';
 return absolute?'/'+path:path;
}
export function join(...paths){
 let joined;
 for(const path of paths)if(path.length>0)joined=joined===undefined?path:joined+'/'+path;
 return joined===undefined?'.':normalize(joined);
}
export function resolve(...paths){
 let resolved='',absolute=false;
 for(let i=paths.length-1;i>=-1&&!absolute;i--){
  const path=i>=0?paths[i]:'/';
  if(path.length===0)continue;
  resolved=path+'/'+resolved;absolute=path.charCodeAt(0)===SLASH;
 }
 resolved=normalizeString(resolved,!absolute);
 return absolute?'/'+resolved:resolved.length>0?resolved:'.';
}
export const isAbsolute=path=>path.length>0&&path.charCodeAt(0)===SLASH;
export function relative(from,to){
 if(from===to)return '';
 from=resolve(from);to=resolve(to);
 if(from===to)return '';
 const fromStart=1,fromEnd=from.length,fromLen=fromEnd-fromStart,toStart=1,toLen=to.length-toStart;
 const length=fromLen<toLen?fromLen:toLen;
 let lastCommonSep=-1,i=0;
 for(;i<length;i++){
  const code=from.charCodeAt(fromStart+i);
  if(code!==to.charCodeAt(toStart+i))break;
  else if(code===SLASH)lastCommonSep=i;
 }
 if(i===length){
  if(toLen>length){
   if(to.charCodeAt(toStart+i)===SLASH)return to.slice(toStart+i+1);
   if(i===0)return to.slice(toStart+i);
  }else if(fromLen>length){
   if(from.charCodeAt(fromStart+i)===SLASH)lastCommonSep=i;
   else if(i===0)lastCommonSep=0;
  }
 }
 let out='';
 for(i=fromStart+lastCommonSep+1;i<=fromEnd;++i)if(i===fromEnd||from.charCodeAt(i)===SLASH)out+=out.length===0?'..':'/..';
 return out+to.slice(toStart+lastCommonSep);
}
export function dirname(path){
 if(path.length===0)return '.';
 const hasRoot=path.charCodeAt(0)===SLASH;
 let end=-1,matchedSlash=true;
 for(let i=path.length-1;i>=1;--i){
  if(path.charCodeAt(i)===SLASH){if(!matchedSlash){end=i;break}}
  else matchedSlash=false;
 }
 if(end===-1)return hasRoot?'/':'.';
 if(hasRoot&&end===1)return '//';
 return path.slice(0,end);
}
export function basename(path,suffix){
 let start=0,end=-1,matchedSlash=true;
 if(suffix!==undefined&&suffix.length>0&&suffix.length<=path.length){
  if(suffix===path)return '';
  let extIdx=suffix.length-1,firstNonSlashEnd=-1;
  for(let i=path.length-1;i>=0;--i){
   const code=path.charCodeAt(i);
   if(code===SLASH){if(!matchedSlash){start=i+1;break}}
   else{
    if(firstNonSlashEnd===-1){matchedSlash=false;firstNonSlashEnd=i+1}
    if(extIdx>=0){
     if(code===suffix.charCodeAt(extIdx)){if(--extIdx===-1)end=i}
     else{extIdx=-1;end=firstNonSlashEnd}
    }
   }
  }
  if(start===end)end=firstNonSlashEnd;else if(end===-1)end=path.length;
  return path.slice(start,end);
 }
 for(let i=path.length-1;i>=0;--i){
  if(path.charCodeAt(i)===SLASH){if(!matchedSlash){start=i+1;break}}
  else if(end===-1){matchedSlash=false;end=i+1}
 }
 return end===-1?'':path.slice(start,end);
}
export function extname(path){
 let startDot=-1,startPart=0,end=-1,matchedSlash=true,preDotState=0;
 for(let i=path.length-1;i>=0;--i){
  const code=path.charCodeAt(i);
  if(code===SLASH){if(!matchedSlash){startPart=i+1;break}continue}
  if(end===-1){matchedSlash=false;end=i+1}
  if(code===DOT){if(startDot===-1)startDot=i;else if(preDotState!==1)preDotState=1}
  else if(startDot!==-1)preDotState=-1;
 }
 if(startDot===-1||end===-1||preDotState===0||(preDotState===1&&startDot===end-1&&startDot===startPart+1))return '';
 return path.slice(startDot,end);
}
