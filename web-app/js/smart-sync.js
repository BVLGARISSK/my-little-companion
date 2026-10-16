import {encodeOLA,crc32} from './media.js?v=1.4.2';
import {subtitleRuntime} from './subtitle-format.js?v=1.4.2';
export async function syncMetadata(asset,bytes=encodeOLA(asset.frames,asset.fps)){
 const hash=await crypto.subtle.digest('SHA-256',bytes);
 return {id:asset.id,kind:asset.kind,name:asset.name,length:bytes.length,crc32:crc32(bytes),sha256:Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,'0')).join(''),...(asset.kind==='subtitle'?{subtitle:subtitleRuntime(asset.subtitle,asset.frames.length)}:{})};
}
export function validateSyncPlan(plan,works,device){
 const number=n=>Number.isSafeInteger(n)&&n>=0;
 if(!plan||plan.device_id!==device||typeof plan.fits!=='boolean'||!Array.isArray(plan.items)||plan.items.length!==works.length||!['needed_bytes','free_bytes','reserve_bytes','new_works','existing_works','max_works'].every(k=>number(plan[k]))||plan.max_works!==32||plan.new_works>works.length||plan.existing_works>32)throw new Error('吊飾回報的同步規劃無效。');
 const seen=new Set();let needed=0;
 for(const item of plan.items){const work=works.find(w=>w.id===item?.id);if(!work||seen.has(item.id)||typeof item.skip!=='boolean')throw new Error('同步規劃的作品清單不符。');seen.add(item.id);if(!item.skip)needed+=work.length;}
 if(plan.new_works>plan.items.filter(item=>!item.skip).length||needed!==plan.needed_bytes||plan.fits!==((!needed||plan.free_bytes>=needed+plan.reserve_bytes)&&plan.existing_works+plan.new_works<=32))throw new Error('同步規劃的容量不符。');return plan;
}
export function requireSyncCapacity(plan){if(!plan.fits)throw new Error(plan.existing_works+plan.new_works>32?'吊飾最多保存 32 個作品，請先整理作品。':`作品空間不足：這次需 ${(plan.needed_bytes/1024).toFixed(1)} KiB，可用 ${(plan.free_bytes/1024).toFixed(1)} KiB，另保留 ${(plan.reserve_bytes/1024).toFixed(0)} KiB。`);}
