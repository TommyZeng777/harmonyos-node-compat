// A Node Buffer subset for code bundled into the HarmonyOS ThreadWorker. Every
// supported operation returns what Node returns: test/node-parity.test.mjs compares
// each one against Node. An encoding outside this subset throws instead of silently
// decoding the wrong bytes (a lenient Buffer.from(text, 'hex') that returns UTF-8
// bytes breaks libraries such as cosmokit without any error).
function encodingOf(encoding){
 const name=encoding===undefined?'utf8':String(encoding).toLowerCase();
 if(name==='utf8'||name==='utf-8')return 'utf8';
 if(name==='binary')return 'latin1';
 if(name==='ucs2'||name==='ucs-2'||name==='utf-16le')return 'utf16le';
 if(['hex','base64','base64url','latin1','ascii','utf16le'].includes(name))return name;
 throw new TypeError('Unknown encoding: '+encoding);
}
const BASE64='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_VALUES=new Int16Array(128).fill(-1);
for(let i=0;i<64;i++)BASE64_VALUES[BASE64.charCodeAt(i)]=i;
BASE64_VALUES[45]=62;BASE64_VALUES[95]=63; // base64url '-' and '_'; Node accepts both alphabets.
const HEX_VALUES=new Int8Array(128).fill(-1);
for(let i=0;i<16;i++){HEX_VALUES['0123456789abcdef'.charCodeAt(i)]=i;HEX_VALUES['0123456789ABCDEF'.charCodeAt(i)]=i}
class Bytes extends Uint8Array {
 toString(encoding,start=0,end=this.length){
  const kind=encodingOf(encoding);
  if(start!==0||end!==this.length)return this.subarray(Math.max(0,start),Math.min(this.length,end)).toString(kind);
  if(kind==='utf8')return this.length?(new TextDecoder().decode(this)??''):'';
  if(kind==='ascii')return byteString(this,127);
  if(kind==='latin1')return byteString(this,255);
  if(kind==='hex')return Array.from(this,b=>b.toString(16).padStart(2,'0')).join('');
  if(kind==='base64')return base64Text(this);
  if(kind==='base64url')return base64Text(this).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  let text='';for(let i=0;i+1<this.length;i+=2)text+=String.fromCharCode(this[i]|(this[i+1]<<8));return text; // utf16le
 }
 readUIntLE(offset,size){if(!Number.isInteger(offset)||offset<0||offset+size>this.length)throw RangeError('byte_offset');let n=0;for(let i=size-1;i>=0;i--)n=n*256+this[offset+i];return n}
 readUInt16LE(offset){return this.readUIntLE(offset,2)}
 readUInt32LE(offset){return this.readUIntLE(offset,4)}
 readUIntBE(offset,size){if(!Number.isInteger(offset)||offset<0||offset+size>this.length)throw RangeError('byte_offset');let n=0;for(let i=0;i<size;i++)n=n*256+this[offset+i];return n}
 readUInt16BE(offset){return this.readUIntBE(offset,2)}
 readUInt32BE(offset){return this.readUIntBE(offset,4)}
 equals(other){return this.length===other.length&&this.every((b,i)=>b===other[i])}
}
function hexBytes(text){
 // Node stops at the first pair that is not two hex digits and drops an odd last digit.
 const out=new Bytes(text.length>>1);let n=0;
 for(;n<out.length;n++){
  const high=text.charCodeAt(2*n),low=text.charCodeAt(2*n+1);
  const a=high<128?HEX_VALUES[high]:-1,b=low<128?HEX_VALUES[low]:-1;
  if(a<0||b<0)break;
  out[n]=a*16+b;
 }
 return n===out.length?out:out.slice(0,n);
}
function base64Bytes(text){
 // Allocate once; native TypedArray.from(string, mapper) materializes a large
 // intermediate iterable for multi-megabyte input and stalls the Worker.
 const out=new Bytes(Math.floor(text.length*3/4)+3);let n=0,bits=0,count=0;
 for(let i=0;i<text.length;i++){
  const code=text.charCodeAt(i);
  if(code===61)break; // '=' ends the data, as in Node.
  const value=code<128?BASE64_VALUES[code]:-1;
  if(value<0)continue; // Node skips whitespace and other characters outside both alphabets.
  bits=((bits<<6)|value)&0xffffff;count+=6;
  if(count>=8){count-=8;out[n++]=(bits>>count)&255}
 }
 return out.slice(0,n);
}
function byteString(bytes,mask){let text='';for(let i=0;i<bytes.length;i+=16384){const part=bytes.subarray(i,i+16384);text+=String.fromCharCode(...(mask===255?part:Array.from(part,b=>b&mask)))}return text}
function base64Text(bytes){
 let out='';const parts=[];
 for(let i=0;i<bytes.length;i+=3){
  const a=bytes[i],b=i+1<bytes.length?bytes[i+1]:0,c=i+2<bytes.length?bytes[i+2]:0;
  out+=BASE64[a>>2]+BASE64[((a&3)<<4)|(b>>4)]+(i+1<bytes.length?BASE64[((b&15)<<2)|(c>>6)]:'=')+(i+2<bytes.length?BASE64[c&63]:'=');
  if(out.length>=8192){parts.push(out);out=''}
 }
 parts.push(out);return parts.join('');
}
// UTF-8 length without an encoder: a device encoder that returns undefined for ''
// must not break byteLength of an empty string.
function utf8Length(text){let n=0;for(let i=0;i<text.length;i++){const c=text.charCodeAt(i);if(c<0x80)n+=1;else if(c<0x800)n+=2;else if(c>=0xD800&&c<=0xDBFF&&i+1<text.length&&(text.charCodeAt(i+1)&0xFC00)===0xDC00){n+=4;i++}else n+=3}return n}
function stringBytes(value,kind){
 if(kind==='utf8')return new Bytes(value?(new TextEncoder().encode(value)??new Uint8Array(0)):new Uint8Array(0));
 if(kind==='hex')return hexBytes(value);
 if(kind==='base64'||kind==='base64url')return base64Bytes(value);
 if(kind==='utf16le'){const out=new Bytes(value.length*2);for(let i=0;i<value.length;i++){const c=value.charCodeAt(i);out[2*i]=c&255;out[2*i+1]=c>>8}return out}
 const out=new Bytes(value.length);for(let i=0;i<value.length;i++)out[i]=value.charCodeAt(i)&255;return out; // latin1, ascii
}
export const Buffer={
 byteLength(value,encoding){
  if(ArrayBuffer.isView(value)||value instanceof ArrayBuffer)return value.byteLength;
  const kind=encodingOf(encoding),text=String(value);
  return kind==='utf8'?utf8Length(text):stringBytes(text,kind).length;
 },
 from(value,encodingOrOffset,length){
  if(typeof value==='string')return stringBytes(value,encodingOf(encodingOrOffset));
  if(value instanceof ArrayBuffer){const offset=encodingOrOffset??0;return new Bytes(value,offset,length??value.byteLength-offset)}
  return new Bytes(value);
 },
 alloc:size=>new Bytes(size),isBuffer:value=>value instanceof Bytes,
 concat(parts){const out=new Bytes(parts.reduce((n,p)=>n+p.length,0));let offset=0;for(const part of parts){out.set(part,offset);offset+=part.length}return out},
};
