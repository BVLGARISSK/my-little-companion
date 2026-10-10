import qrcode from '../vendor/qrcode.js';

const hex=(value,length)=>{
  if(typeof value!=='string'||value.length!==length*2||!/^[a-f0-9]+$/i.test(value))throw new Error('配對資料格式錯誤，請重新讀取。');
  return Uint8Array.from(value.match(/../g),b=>parseInt(b,16));
};
export async function decryptOwnerPairing(sealed,adminKey,deviceId){
  if(sealed.device_id!==deviceId)throw new Error('配對資料屬於另一台吊飾。');
  const nonce=hex(sealed.nonce,12),ciphertext=hex(sealed.ciphertext,32),tag=hex(sealed.tag,16);
  const key=await crypto.subtle.importKey('raw',hex(adminKey,32),'AES-GCM',false,['decrypt']);
  const bytes=new Uint8Array(48);bytes.set(ciphertext);bytes.set(tag,32);
  let clear;
  try{clear=await crypto.subtle.decrypt({name:'AES-GCM',iv:nonce,additionalData:new TextEncoder().encode('mlc/1:owner-pairing:'+deviceId),tagLength:128},key,bytes);}
  catch{throw new Error('配對資料驗證失敗，請重新連線並使用管理員卡授權。');}
  return{device:deviceId,key:Array.from(new Uint8Array(clear),b=>b.toString(16).padStart(2,'0')).join('')};
}
export function ownerPairingURL(pairing,href){
  hex(pairing.key,32);
  if(typeof pairing.device!=='string'||!/^[a-z0-9-]{1,64}$/i.test(pairing.device))throw new Error('裝置名稱格式錯誤。');
  const url=new URL(href);url.hash=new URLSearchParams({device:pairing.device,key:pairing.key}).toString();url.search='';
  return url.href;
}
export function pairingMatrix(url){
  const qr=qrcode(0,'M');qr.addData(url,'Byte');qr.make();
  const n=qr.getModuleCount();return Array.from({length:n},(_,y)=>Array.from({length:n},(_,x)=>qr.isDark(y,x)));
}
export function drawPairingQR(canvas,url){
  const matrix=pairingMatrix(url),quiet=4,cell=8,size=(matrix.length+quiet*2)*cell;
  canvas.width=size;canvas.height=size;const ctx=canvas.getContext('2d');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,size,size);ctx.fillStyle='#000';
  matrix.forEach((row,y)=>row.forEach((dark,x)=>{if(dark)ctx.fillRect((x+quiet)*cell,(y+quiet)*cell,cell,cell);}));
}
export function resetReceiptMatches(receipt,pending){
  return receipt.device_id===pending.device&&receipt.completed_reset_id===pending.id&&receipt.storage_ready===true;
}
