// A fixed subtitle is a device playback mode, independent of text layout.
export function createSubtitlePlayback({ble,transferAsset,onBusy=()=>{}}){
 let busy=false;
 async function run(action){
  if(busy||ble.busy)throw new Error('字幕操作進行中，請稍候。');
  ble.capability('subtitle_pin');
  const epoch=ble.connectionEpoch,id=ble.info.device_id;
  const check=()=>{if(!ble.connected||!ble.authorized||ble.connectionEpoch!==epoch||ble.info?.device_id!==id)throw new Error('連線已改變，請重新操作字幕。');};
  busy=true;onBusy(true);
  try{return await action(check);}finally{busy=false;onBusy(false);}
 }
 return {get busy(){return busy;},
  pin(asset){if(asset?.kind!=='subtitle')throw new Error('請選擇字幕作品。');return run(async check=>{
   await transferAsset(asset);check();const result=await ble.command('PIN_SUBTITLE',{id:asset.id},'subtitle_pin');check();
   if(result.subtitle_pinned!==true||result.media_id!==asset.id)throw new Error('固定播放結果未確認，請更新裝置狀態。');return result;
  });},
  stop(){return run(async check=>{const result=await ble.command('UNPIN_SUBTITLE',{},'subtitle_pin');check();if(result.subtitle_pinned!==false)throw new Error('停止固定播放的結果未確認。');return result;});}
 };
}

export function addSubtitleToPlaylistDraft(playlist,asset){
 if(asset?.kind!=='subtitle'||!/^[a-f0-9]{32}$/.test(asset.id)||!Array.isArray(playlist?.items))throw new Error('字幕或清單資料無效。');
 const index=playlist.items.findIndex(i=>i.type==='subtitle'&&i.id===asset.id);
 if(index>=0)return {added:false,index};
 if(playlist.items.length>=64)throw new Error('播放清單最多 64 個項目。');
 const c=asset.subtitle;let duration=5000;
 if(c.motion!=='fixed'){
  const size=c.motion==='horizontal'?c.width+128:c.height+c.viewport_h;
  duration=Math.min(600000,Math.max(1000,Math.ceil((size+16)*1000/c.speed)));
 }
 playlist.items.push({type:'subtitle',id:asset.id,duration_ms:duration,repeat:true,enabled:true});
 return {added:true,index:playlist.items.length-1};
}
