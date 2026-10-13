export const UUID = Object.freeze({
  service:'c07e0001-7d3b-4f2f-a86e-5c87b6ab1d10',
  control:'c07e0002-7d3b-4f2f-a86e-5c87b6ab1d10',
  data:'c07e0003-7d3b-4f2f-a86e-5c87b6ab1d10',
  event:'c07e0004-7d3b-4f2f-a86e-5c87b6ab1d10',
  info:'c07e0005-7d3b-4f2f-a86e-5c87b6ab1d10'
});
export const PROTOCOL='mlc/1', MAX_MESSAGE=16384;

export function fragmentMessage(value,id,maxBytes=20,kind=1) {
  if(!Number.isInteger(maxBytes)||maxBytes<20||maxBytes>244)throw new Error('BLE 封包長度錯誤');
  const json=new TextEncoder().encode(JSON.stringify(value));
  if(json.length>MAX_MESSAGE)throw new Error('指令太大');
  const packets=[];
  for(let offset=0;offset<json.length;offset+=maxBytes-8){
    const part=json.slice(offset,offset+maxBytes-8),packet=new Uint8Array(8+part.length),v=new DataView(packet.buffer);
    packet[0]=1;packet[1]=kind;v.setUint16(2,id,true);v.setUint16(4,json.length,true);v.setUint16(6,offset,true);packet.set(part,8);packets.push(packet);
  }
  return packets;
}

export class MessageAssembler {
  constructor(){this.messages=new Map();}
  clear(){this.messages.clear();}
  accept(bytes){
    if(bytes.length<9||bytes[0]!==1||![1,2].includes(bytes[1]))throw new Error('BLE 回覆格式錯誤');
    const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),id=v.getUint16(2,true),total=v.getUint16(4,true),offset=v.getUint16(6,true),kind=bytes[1];
    if(!total||total>MAX_MESSAGE||offset+bytes.length-8>total)throw new Error('BLE 回覆大小錯誤');
    const key=kind+':'+id;
    if(offset===0){if(this.messages.size>=8&&!this.messages.has(key))throw new Error('BLE 未完成回覆過多');this.messages.set(key,{bytes:new Uint8Array(total),offset:0,started:Date.now()});}
    const entry=this.messages.get(key);
    if(!entry||Date.now()-entry.started>15000||entry.bytes.length!==total||entry.offset!==offset){this.messages.delete(key);throw new Error('BLE 回覆遺漏或順序錯誤');}
    entry.bytes.set(bytes.subarray(8),offset);entry.offset+=bytes.length-8;
    if(entry.offset!==total)return null;
    this.messages.delete(key);return{id,kind,value:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(entry.bytes))};
  }
}

export function dataPacket(transferId,offset,bytes){
  const out=new Uint8Array(8+bytes.length),v=new DataView(out.buffer);
  out[0]=1;v.setUint16(2,transferId,true);v.setUint32(4,offset,true);out.set(bytes,8);return out;
}

export async function authProof(keyHex,deviceId,clientNonce,serverNonce){
  if(!/^[a-f0-9]{64}$/i.test(keyHex)||!/^[a-f0-9]{64}$/i.test(serverNonce)||!/^[a-f0-9]{32}$/i.test(clientNonce))throw new Error('授權碼或挑戰格式錯誤');
  const bytes=Uint8Array.from(keyHex.match(/../g),h=>parseInt(h,16));
  const key=await crypto.subtle.importKey('raw',bytes,{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${PROTOCOL}:${deviceId}:${clientNonce.toLowerCase()}:${serverNonce.toLowerCase()}`));
  return Array.from(new Uint8Array(signature),b=>b.toString(16).padStart(2,'0')).join('');
}

export function validatePlaylist(playlist,assets){
  if(!playlist||playlist.version!==1||!['loop','shuffle','once'].includes(playlist.mode)||!Array.isArray(playlist.items)||playlist.items.length>64)throw new Error('播放清單格式錯誤');
  const ids=new Set(assets.map(a=>a.id));
  for(const item of playlist.items){
    if(!['emotion','image','animation','subtitle'].includes(item.type)||!Number.isInteger(item.duration_ms)||item.duration_ms<1000||item.duration_ms>600000||typeof item.enabled!=='boolean')throw new Error('清單項目錯誤');
    if(item.type==='emotion'?!['neutral','happy','sad','surprised','sleepy','angry'].includes(item.id):!ids.has(item.id)||assets.find(a=>a.id===item.id)?.kind!==item.type)throw new Error('清單引用的作品不存在或類型不符');
  }
  return playlist;
}
