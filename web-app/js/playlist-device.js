import {validatePlaylist} from './protocol.js?v=1.4.4';
export function supportsPlaylistRead(info){const m=/^(\d+)\.(\d+)\.(\d+)-c5$/.exec(info?.firmware||'');return !!m&&(Number(m[1])>0||Number(m[2])>7||Number(m[2])===7&&Number(m[3])>=7);}
export function animationFrameIndex(elapsed,fps,count,repeat=true){const index=Math.max(0,Math.floor(elapsed/1000*fps));return repeat===false?Math.min(index,count-1):index%count;}
export function catalogItems(value,deviceId){
 if(!Array.isArray(value)||value.length>32)throw new Error('吊飾作品目錄無效。');
 const seen=new Set();return value.map(a=>{if(!/^[a-f0-9]{32}$/.test(a.id)||seen.has(a.id)||!['image','animation','subtitle'].includes(a.kind)||typeof a.name!=='string'||a.name.length>240)throw new Error('吊飾作品資料無效。');seen.add(a.id);return {id:a.id,kind:a.kind,name:a.name,deviceId};});
}
export function playlistResponse(value,catalog,deviceId){
 if(value?.device_id!==deviceId||!Number.isInteger(value.revision)||value.revision<0||value.revision>0xffffffff)throw new Error('吊飾清單回覆不符，請重新讀取。');
 validatePlaylist(value.playlist,catalog);return {playlist:structuredClone(value.playlist),revision:value.revision};
}
export function playlistKey(value){return JSON.stringify({mode:value.mode,items:value.items.map(i=>({type:i.type,id:i.id,enabled:i.enabled,repeat:i.repeat!==false,duration_ms:i.duration_ms}))});}
export function playlistDifference(before,after){
 const counts=p=>{const m=new Map();for(const i of p.items){const k=i.type+':'+i.id;m.set(k,(m.get(k)||0)+1);}return m;};
 const a=counts(before),b=counts(after);let added=0,removed=0;for(const k of new Set([...a.keys(),...b.keys()])){added+=Math.max(0,(b.get(k)||0)-(a.get(k)||0));removed+=Math.max(0,(a.get(k)||0)-(b.get(k)||0));}
 return {added,removed,changed:playlistKey(before)!==playlistKey(after)};
}
export function playbackLabel(value,assets){
 if(!value||!['auto','emotion','media','subtitle','playlist'].includes(value.mode)||!Number.isInteger(value.tool)||value.tool<0||value.tool>6||typeof value.sleeping!=='boolean'||typeof value.temporary!=='boolean')throw new Error('播放狀態無效。');
 const names={neutral:'平常',happy:'開心',sad:'難過',surprised:'驚訝',sleepy:'想睡',angry:'生氣'};
 let text=value.tool?['','時鐘','計時器','骰子','迷宮','躲障礙','小恐龍'][value.tool]:value.media_id?(assets.find(a=>a.id===value.media_id)?.name||'裝置作品 '+value.media_id.slice(0,8)):(names[value.emotion]||'表情');
 if(!value.tool&&value.mode==='playlist')text=`清單第 ${value.playlist_index+1}／${value.playlist_count} 項 · ${text}`;
 else if(!value.tool&&value.mode==='auto')text='自動表情 · '+text;
 if(value.subtitle_pinned===true&&!value.tool&&!value.temporary)text='固定字幕 · '+text;
 return `${value.sleeping?'休眠中 · ':''}${value.temporary?'插播中 · ':''}${text}`;
}
