import {drawFrame,encodeOLA,decodeOLA,sampleImage,scalePixels,unpackPixels,validateAsset,FRAME_BYTES} from './js/media.js';
import {EMOTIONS,emotionFrame} from './js/faces.js';
import {validatePlaylist} from './js/protocol.js';
import {DraftStore} from './js/storage.js';
import {CompanionBLE} from './js/ble.js';
import {MediaConverter} from './js/converter.js';
import {readPairing,pairingKeyForDevice} from './js/pairing.js';

const $=id=>document.getElementById(id),ble=new CompanionBLE(),store=new DraftStore();
let storeReady=false,saveTimer,toastTimer,saveQueue=Promise.resolve(),filter='all',activeTab='emotion',mood='happy',auto=false,photo=null,photoBytes=null,animation=null,assetSelected=null,pixelPlaying=false,pixelStart=0,assetStart=0,previewRunning=false,playlistIndex=0,playlistStarted=0,playlistFrameStarted=0;
const blank=()=>new Uint8Array(32*16),newId=()=>crypto.randomUUID().replaceAll('-','');
let state={version:1,assets:[],playlist:{version:1,name:'My little day',mode:'loop',items:[]},pixel:{width:32,height:16,frames:[blank()],index:0,name:'我的小塗鴉',fps:8}};
let undo=[],redo=[],tool='pen',drawing=false,lastPoint=null,dragIndex=null;
const converter=new MediaConverter($('source-video'));
const nameOf=item=>item.type==='emotion'?EMOTIONS.find(e=>e.id===item.id)?.name:state.assets.find(a=>a.id===item.id)?.name;
const formatBytes=n=>Number.isFinite(n)?n>=1048576?(n/1048576).toFixed(2)+' MiB':(n/1024).toFixed(1)+' KiB':'—';
function toast(message,error=false){$('toast').textContent=message;$('toast').classList.toggle('error',error);$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,error?7000:3500);}
function bind(id,fn,event='click'){$(id).addEventListener(event,async e=>{try{await fn(e);}catch(error){toast(error.name==='NotFoundError'?'已取消尋找小伴，可以稍後再連線。':error.name==='SecurityError'?'瀏覽器沒有允許藍牙連線，請用 Bluefy 開啟 HTTPS 網址。':error.message||'這次沒有完成，再試一次。',error.name!=='NotFoundError');}});}
function button(text,fn,className='button tiny'){const b=document.createElement('button');b.textContent=text;b.className=className;b.addEventListener('click',async()=>{try{await fn();}catch(error){toast(error.message,true);}});return b;}
function confirmAction(title,text,yes='確定刪除'){
  $('confirm-title').textContent=title;$('confirm-text').textContent=text;$('confirm-yes').textContent=yes;
  return new Promise(resolve=>{const d=$('confirm-dialog'),finish=value=>{d.close();$('confirm-yes').onclick=null;$('confirm-no').onclick=null;d.oncancel=null;resolve(value);};$('confirm-yes').onclick=()=>finish(true);$('confirm-no').onclick=()=>finish(false);d.oncancel=e=>{e.preventDefault();finish(false);};d.showModal();});
}
function showTab(tab){activeTab=tab;document.querySelectorAll('.view').forEach(v=>v.hidden=v.id!==`view-${tab}`);document.querySelectorAll('[data-tab]').forEach(b=>{b.classList.toggle('active',b.dataset.tab===tab);b.dataset.tab===tab?b.setAttribute('aria-current','page'):b.removeAttribute('aria-current');});if(tab!=='playlist')previewRunning=false;if(tab!=='pixel')pixelPlaying=false;window.scrollTo({top:0,behavior:'instant'});}
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>showTab(b.dataset.tab));document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>showTab(b.dataset.go));document.querySelector('.brand').onclick=e=>{e.preventDefault();showTab('emotion');};
function persist(immediate=false){
  clearTimeout(saveTimer);$('pixel-save-state').textContent='草稿儲存中…';
  const save=()=>{
    if(!storeReady){$('pixel-save-state').textContent='草稿目前只在記憶體，請匯出備份再離開。';return;}
    const snapshot=structuredClone(state);
    saveQueue=saveQueue.catch(()=>{}).then(()=>store.put('workspace',snapshot)).then(()=>{$('pixel-save-state').textContent='草稿已儲存在這台手機。';$('storage-state').textContent=`草稿箱已就緒 · ${state.assets.length} 個作品 · 僅保存在目前瀏覽器`;} ).catch(error=>{$('pixel-save-state').textContent='這次未能儲存，請先匯出備份。';$('storage-state').textContent='草稿儲存失敗，請先匯出備份。';toast('儲存空間不足或無法寫入，請先匯出備份。',true);throw error;});
    saveQueue.catch(()=>{});
  };
  immediate?save():saveTimer=setTimeout(save,450);
}
document.addEventListener('visibilitychange',()=>{if(document.hidden)persist(true);});
function addAsset(name,frames,fps){
  const asset={id:newId(),name:name.trim().slice(0,60)||'我的小作品',kind:frames.length>1?'animation':'image',frames:frames.map(f=>f.slice()),fps:frames.length>1?fps:1,created:Date.now()};
  state.assets.push(asset);persist(true);renderLibrary();renderPlaylist();toast('作品已加入作品集。');return asset;
}

// Expressions are local previews until the user explicitly sends a command.
for(const emotion of EMOTIONS){const b=document.createElement('button');b.className='emotion-button';b.dataset.emotion=emotion.id;b.setAttribute('aria-pressed',emotion.id===mood?'true':'false');b.innerHTML=`<svg viewBox="0 0 32 26" aria-hidden="true">${emotion.shape}</svg><span>${emotion.name}</span>`;b.onclick=()=>{mood=emotion.id;auto=false;$('emotion-auto').checked=false;renderMood();};$('emotion-grid').append(b);}
function renderMood(){document.querySelectorAll('[data-emotion]').forEach(b=>{b.classList.toggle('active',b.dataset.emotion===mood);b.setAttribute('aria-pressed',String(b.dataset.emotion===mood));});$('mood-caption').textContent=EMOTIONS.find(e=>e.id===mood).caption;}
renderMood();bind('emotion-auto',e=>{auto=e.target.checked;},'change');
bind('emotion-apply',async()=>{await ble.command('SET_EMOTION',{emotion:mood,mode:auto?'auto':'manual'},'emotion');toast('表情已套用，眨眼動畫會持續播放。');});

// Image editor: all decoding and conversion stay on the current device.
bind('import-photo',()=>$('photo-file').click());bind('close-photo',()=>{$('photo-editor').hidden=true;photo=null;});
function photoOptions(){return{threshold:Number($('photo-threshold').value),contrast:Number($('photo-contrast').value),brightness:Number($('photo-brightness').value),cropX:Number($('photo-x').value),cropY:Number($('photo-y').value),zoom:Number($('photo-zoom').value),dither:$('photo-dither').checked,invert:$('photo-invert').checked,background:$('photo-background').value};}
function updatePhoto(){if(!photo)return;photoBytes=sampleImage(photo,photoOptions());drawFrame($('photo-canvas'),photoBytes);$('threshold-output').textContent=$('photo-threshold').value;}
['threshold','contrast','brightness','x','y','zoom','dither','invert','background'].forEach(key=>bind('photo-'+key,updatePhoto,'input'));
bind('photo-file',async e=>{
  const file=e.target.files[0];e.target.value='';if(!file)return;
  if(file.name.toLowerCase().endsWith('.ola')){const data=decodeOLA(new Uint8Array(await file.arrayBuffer()));addAsset(file.name.replace(/\.ola$/i,''),data.frames,data.fps);return;}
  if(file.type==='image/gif'){showTab('animation');await loadAnimation(file);return;}
  if(file.size>30*1024*1024)throw new Error('請選 30MB 以下的照片。');
  const url=URL.createObjectURL(file),img=new Image();
  try{await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error('這張照片無法開啟，請改用 JPG 或 PNG。'));img.src=url;});photo=img;$('photo-name').value=file.name.replace(/\.[^.]+$/,'').slice(0,60);$('photo-editor').hidden=false;updatePhoto();}finally{URL.revokeObjectURL(url);}
},'change');bind('save-photo',()=>{if(!photoBytes)throw new Error('先選一張照片吧。');addAsset($('photo-name').value,[photoBytes],1);$('photo-editor').hidden=true;photo=null;});

function renderLibrary(){
  $('asset-count').textContent=state.assets.length;const assets=state.assets.filter(a=>filter==='all'||a.kind===filter),grid=$('library-grid');grid.replaceChildren();$('library-empty').hidden=assets.length>0;
  for(const asset of assets){
    const card=document.createElement('article');card.className='asset-card';const open=document.createElement('button');open.className='asset-open';open.setAttribute('aria-label','預覽 '+asset.name);
    const canvas=document.createElement('canvas');canvas.width=256;canvas.height=128;drawFrame(canvas,asset.frames[0]);open.append(canvas);open.onclick=()=>openAsset(asset);
    const meta=document.createElement('div');meta.className='asset-meta';const name=document.createElement('div'),strong=document.createElement('div'),small=document.createElement('small');strong.className='asset-name';strong.textContent=asset.name;small.textContent=asset.kind==='animation'?`${asset.frames.length} 格 · ${asset.fps} FPS · ${formatBytes(asset.frames.length*FRAME_BYTES+21)}`:`圖片 · ${formatBytes(1045)}`;name.append(strong,small);meta.append(name);
    const actions=document.createElement('div');actions.className='asset-actions';actions.append(button('＋ 播放清單',()=>addPlaylistItem(asset.kind,asset.id)),button('刪除',()=>deleteAsset(asset)));
    card.append(open,meta,actions);grid.append(card);
  }
}
document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));renderLibrary();});
async function deleteAsset(asset){
  if(state.playlist.items.some(i=>i.id===asset.id))throw new Error('這個作品在播放清單裡，先移除清單中的項目再刪除。');
  if(!await confirmAction('要收起這個作品嗎？',`會刪除這台手機裡的「${asset.name}」。吊飾上的作品需要另外管理。`))return;
  state.assets=state.assets.filter(a=>a.id!==asset.id);persist(true);renderLibrary();renderPlaylist();toast('已從手機作品集移除。');
}
function openAsset(asset){assetSelected=asset;assetStart=performance.now();$('asset-dialog-name').textContent=asset.name;$('asset-dialog-info').textContent=asset.kind==='image'?'128 × 64 · 單色圖片':`${asset.frames.length} 格 · ${(asset.frames.length/asset.fps).toFixed(1)} 秒 · ${asset.fps} FPS`;$('asset-dialog').showModal();drawFrame($('asset-dialog-canvas'),asset.frames[0]);}
bind('asset-dialog-close',()=>$('asset-dialog').close());
function download(bytes,name,type='application/octet-stream'){
  const url=URL.createObjectURL(new Blob([bytes],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
bind('asset-export',()=>{if(assetSelected)download(encodeOLA(assetSelected.frames,assetSelected.fps),assetSelected.name.replace(/[<>:"/\\|?*]/g,'_')+'.ola');});
bind('asset-send',async()=>{if(!assetSelected)return;$('asset-dialog').close();await transferAsset(assetSelected);});
bind('asset-play-device',async()=>{if(!assetSelected)return;await ble.command('PLAY_MEDIA',{id:assetSelected.id},'media');toast('小伴開始播放這個作品。');});
bind('asset-to-pixel',async()=>{
  if(!assetSelected||!await confirmAction('接著畫這個作品？','目前的畫板草稿會被取代。已存進作品集的作品會保留。','開始畫畫'))return;
  state.pixel={width:128,height:64,frames:assetSelected.frames.map(unpackPixels),index:0,name:assetSelected.name,fps:assetSelected.fps===1?8:assetSelected.fps};undo=[];redo=[];renderPixel();persist();$('asset-dialog').close();showTab('pixel');
});

// Pixel editor supports interpolation, flood fill, history and per-frame ordering.
const pixel=()=>state.pixel;
function pixelBytes(index=pixel().index){return scalePixels(pixel().frames[index],pixel().width,pixel().height);}
function saveHistory(){undo.push(structuredClone(pixel()));if(undo.length>40)undo.shift();redo=[];}
function restorePixel(snapshot){state.pixel=snapshot;pixelPlaying=false;renderPixel();persist();}
function renderPixel(){
  $('pixel-size').value=pixel().width;$('pixel-name').value=pixel().name;$('pixel-fps').value=pixel().fps;$('frame-count').textContent=`${pixel().frames.length} / 100 格`;
  $('pixel-undo').disabled=!undo.length;$('pixel-redo').disabled=!redo.length;
  const strip=$('frame-strip');strip.replaceChildren();
  pixel().frames.forEach((frame,i)=>{const b=document.createElement('button');b.className='frame-button'+(i===pixel().index?' active':'');b.setAttribute('aria-label',`第 ${i+1} 格`);b.setAttribute('aria-pressed',String(i===pixel().index));const c=document.createElement('canvas');c.width=144;c.height=72;drawFrame(c,pixelBytes(i));const s=document.createElement('span');s.textContent=i+1;b.append(c,s);b.onclick=()=>{pixel().index=i;pixelPlaying=false;renderPixel();persist();};strip.append(b);});
  drawPixel();
}
function drawPixel(){drawFrame($('pixel-canvas'),pixelBytes(),{grid:pixel().width<=64,onion:$('pixel-onion').checked&&pixel().index>0?pixelBytes(pixel().index-1):null});}
document.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>{tool=b.dataset.tool;document.querySelectorAll('[data-tool]').forEach(x=>x.classList.toggle('active',x===b));});
function point(event){const r=$('pixel-canvas').getBoundingClientRect();return{x:Math.max(0,Math.min(pixel().width-1,Math.floor((event.clientX-r.left)/r.width*pixel().width))),y:Math.max(0,Math.min(pixel().height-1,Math.floor((event.clientY-r.top)/r.height*pixel().height)))};}
function mark(x,y){const size=Number($('pixel-brush').value),p=pixel();for(let dy=0;dy<size;dy++)for(let dx=0;dx<size;dx++)if(x+dx<p.width&&y+dy<p.height)p.frames[p.index][(y+dy)*p.width+x+dx]=tool==='eraser'?0:1;}
function line(a,b){const steps=Math.max(Math.abs(b.x-a.x),Math.abs(b.y-a.y),1);for(let i=0;i<=steps;i++)mark(Math.round(a.x+(b.x-a.x)*i/steps),Math.round(a.y+(b.y-a.y)*i/steps));}
function fill(pt){const p=pixel(),f=p.frames[p.index],start=pt.y*p.width+pt.x,old=f[start],next=old?0:1,queue=[start];f[start]=next;for(let i=0;i<queue.length;i++){const n=queue[i],x=n%p.width,y=Math.floor(n/p.width);for(const m of [x>0?n-1:-1,x<p.width-1?n+1:-1,y>0?n-p.width:-1,y<p.height-1?n+p.width:-1])if(m>=0&&f[m]===old){f[m]=next;queue.push(m);}}}
$('pixel-canvas').addEventListener('pointerdown',e=>{if(e.button!==0&&e.pointerType==='mouse')return;e.preventDefault();pixelPlaying=false;saveHistory();lastPoint=point(e);drawing=true;$('pixel-canvas').setPointerCapture(e.pointerId);tool==='fill'?fill(lastPoint):mark(lastPoint.x,lastPoint.y);drawPixel();});
$('pixel-canvas').addEventListener('pointermove',e=>{if(!drawing||tool==='fill')return;const next=point(e);line(lastPoint,next);lastPoint=next;drawPixel();});
for(const event of ['pointerup','pointercancel','lostpointercapture'])$('pixel-canvas').addEventListener(event,()=>{if(!drawing)return;drawing=false;renderPixel();persist();});
bind('pixel-undo',()=>{if(!undo.length)return;redo.push(structuredClone(pixel()));restorePixel(undo.pop());});bind('pixel-redo',()=>{if(!redo.length)return;undo.push(structuredClone(pixel()));restorePixel(redo.pop());});
bind('pixel-clear',async()=>{if(!await confirmAction('清空這一格？','其他影格與作品集會保留，也可以按復原找回這一格。','清空這格'))return;saveHistory();pixel().frames[pixel().index].fill(0);renderPixel();persist();});
bind('pixel-size',async e=>{const width=Number(e.target.value);if(width===pixel().width)return;if(!await confirmAction('換一張新畫布？','目前畫板的影格會重設。可以先存進作品集，或之後按復原找回。','換畫布')){$('pixel-size').value=pixel().width;return;}saveHistory();state.pixel={...pixel(),width,height:width/2,frames:[new Uint8Array(width*width/2)],index:0};renderPixel();persist();},'change');
bind('pixel-onion',drawPixel,'change');
function appendFrame(copy){if(pixel().frames.length>=100)throw new Error('小動畫最多 100 格。');saveHistory();pixel().frames.splice(pixel().index+1,0,copy?pixel().frames[pixel().index].slice():new Uint8Array(pixel().width*pixel().height));pixel().index++;pixelPlaying=false;renderPixel();persist();}
bind('frame-add',()=>appendFrame(false));bind('frame-copy',()=>appendFrame(true));
bind('frame-delete',()=>{if(pixel().frames.length===1)throw new Error('動畫至少需要保留一格。');saveHistory();pixel().frames.splice(pixel().index,1);pixel().index=Math.min(pixel().index,pixel().frames.length-1);renderPixel();persist();});
function moveFrame(direction){const i=pixel().index,j=i+direction;if(j<0||j>=pixel().frames.length)return;saveHistory();[pixel().frames[i],pixel().frames[j]]=[pixel().frames[j],pixel().frames[i]];pixel().index=j;renderPixel();persist();}
bind('frame-left',()=>moveFrame(-1));bind('frame-right',()=>moveFrame(1));bind('pixel-play',()=>{pixelPlaying=!pixelPlaying;pixelStart=performance.now();$('pixel-play').textContent=pixelPlaying?'■ 停止預覽':'▶ 預覽';if(!pixelPlaying)drawPixel();});
bind('pixel-name',e=>{pixel().name=e.target.value;persist();},'input');bind('pixel-fps',e=>{pixel().fps=Number(e.target.value);persist();},'change');
bind('pixel-save',()=>{addAsset($('pixel-name').value,pixel().frames.map((_,i)=>pixelBytes(i)),Number($('pixel-fps').value));});

// GIF and video conversion.
bind('import-animation',()=>$('animation-file').click());bind('animation-file',async e=>{const file=e.target.files[0];e.target.value='';if(file)await loadAnimation(file);},'change');
let animationPlaying=false,animationStart=0,animationConverting=false,animationLoading=false,animationPreviewRunning=false,animationPreviewPending=false,animationPreviewRequest=0,animationPreviewPromise=Promise.resolve();
function animationOptions(){return{zoom:Number($('animation-zoom').value),cropX:Number($('animation-x').value),cropY:Number($('animation-y').value),threshold:Number($('animation-threshold').value),dither:$('animation-dither').checked,invert:$('animation-invert').checked,background:$('animation-background').value};}
function setAnimationCrop(zoom=1){$('animation-zoom').value=zoom;$('animation-x').value=.5;$('animation-y').value=.5;$('animation-zoom-output').textContent=Number($('animation-zoom').value).toFixed(2)+'×';}
function requestAnimationPreview(){
  if(!converter.file||converter.ola||animationConverting||animationLoading)return animationPreviewPromise;
  animationPreviewPending=true;++animationPreviewRequest;
  if(animationPreviewRunning)return animationPreviewPromise;
  animationPreviewRunning=true;
  animationPreviewPromise=(async()=>{
    while(animationPreviewPending&&!animationConverting&&!animationLoading){
      animationPreviewPending=false;const request=animationPreviewRequest,generation=converter.generation;
      try{
        const frame=await converter.preview({time:Number($('animation-start').value),...animationOptions()});
        if(request===animationPreviewRequest&&generation===converter.generation&&!animationConverting&&!animationLoading)drawFrame($('animation-canvas'),frame);
      }catch(error){if(request===animationPreviewRequest&&generation===converter.generation&&!animationConverting&&!animationLoading)toast(error.message,true);}
    }
  })().finally(()=>{animationPreviewRunning=false;});
  return animationPreviewPromise;
}
function animationSettingsChanged(){
  $('animation-zoom-output').textContent=Number($('animation-zoom').value).toFixed(2)+'×';
  if(!converter.file||converter.ola||animationConverting||animationLoading)return;
  animation=null;animationPlaying=false;$('animation-play').textContent='▶ 預覽動畫';$('save-animation').disabled=true;$('animation-info').textContent='裁切預覽 · 調整後請重新轉換動畫';
  return requestAnimationPreview();
}
['start','duration','fps','zoom','x','y','threshold','dither','invert','background'].forEach(key=>bind('animation-'+key,animationSettingsChanged,'input'));
bind('animation-reset',()=>{setAnimationCrop();return animationSettingsChanged();});
bind('animation-fit',()=>{
  const {width,height}=converter.dimensions;if(!width||!height)return;
  const fit=Math.min(128/width,64/height)/Math.max(128/width,64/height);
  setAnimationCrop(Math.max(.1,Math.floor(fit*100)/100));return animationSettingsChanged();
});
bind('source-video',()=>{
  const video=$('source-video');if(!converter.file||converter.gif||converter.ola||animation||animationConverting||animationLoading||animationPreviewRunning||video.readyState<2)return;
  drawFrame($('animation-canvas'),sampleImage(video,animationOptions()));
},'timeupdate');
async function loadAnimation(file){
  if(animationConverting||animationLoading)throw new Error('正在處理影片，完成後再選擇其他檔案。');
  animationLoading=true;animationPreviewPending=false;++animationPreviewRequest;$('import-animation').disabled=true;
  $('animation-editor').hidden=true;animation=null;animationPlaying=false;$('animation-play').textContent='▶ 預覽動畫';$('save-animation').disabled=true;
  try{
    await animationPreviewPromise;const info=await converter.load(file);setAnimationCrop();$('animation-editor').hidden=false;$('source-video').hidden=info.kind!=='video';$('animation-name').value=file.name.replace(/\.[^.]+$/,'').slice(0,60);$('animation-start').value=0;$('animation-start').max=info.duration.toFixed(2);$('animation-duration').value=Math.min(5,info.duration).toFixed(1);$('animation-info').textContent=`原始長度 ${info.duration.toFixed(1)} 秒 · ${info.kind==='gif'?'GIF':info.kind==='ola'?'OLA 作品':'影片'}`;
    ['start','duration','fps','zoom','x','y','threshold','dither','invert','background','fit','reset'].forEach(key=>$('animation-'+key).disabled=info.kind==='ola');$('convert-animation').disabled=info.kind==='ola';
    if(info.kind==='ola'){animation=converter.ola;$('save-animation').disabled=false;drawFrame($('animation-canvas'),animation.frames[0]);}
  }finally{animationLoading=false;$('import-animation').disabled=false;}
  await requestAnimationPreview();
}
bind('convert-animation',async()=>{
  if(!converter.file)throw new Error('先選一個 GIF 或影片吧。');
  const b=$('convert-animation');animationConverting=true;animationPreviewPending=false;++animationPreviewRequest;b.disabled=true;$('animation-settings').disabled=true;$('import-animation').disabled=true;$('save-animation').disabled=true;animationPlaying=false;$('animation-play').textContent='▶ 預覽動畫';animation=null;$('convert-progress').value=0;$('convert-progress').hidden=false;
  try{await animationPreviewPromise;animation=await converter.convert({start:Number($('animation-start').value),duration:Number($('animation-duration').value),fps:Number($('animation-fps').value),...animationOptions()},p=>$('convert-progress').value=p);
    drawFrame($('animation-canvas'),animation.frames[0]);$('animation-info').textContent=`${animation.frames.length} 格 · ${(animation.frames.length/animation.fps).toFixed(1)} 秒 · ${formatBytes(animation.frames.length*FRAME_BYTES+21)}`;$('save-animation').disabled=false;toast('小動畫轉好了，看看預覽吧。');
  }finally{animationConverting=false;$('animation-settings').disabled=false;$('import-animation').disabled=false;b.disabled=!!converter.ola;$('convert-progress').hidden=true;}
});
bind('animation-play',()=>{if(!animation)throw new Error('先把影片轉成小動畫吧。');animationPlaying=!animationPlaying;animationStart=performance.now();$('animation-play').textContent=animationPlaying?'■ 停止預覽':'▶ 預覽動畫';});
bind('save-animation',()=>{if(!animation)throw new Error('先轉換動畫吧。');addAsset($('animation-name').value,animation.frames,animation.fps);});

// Playlist editing and local preview.
function addPlaylistItem(type,id){if(state.playlist.items.length>=64)throw new Error('播放清單最多 64 個項目。');state.playlist.items.push({type,id,duration_ms:type==='animation'?8000:5000,repeat:true,enabled:true});persist();renderPlaylist();toast('已加入小伴的播放清單。');}
function renderPlaylist(){
  $('playlist-mode').value=state.playlist.mode;const select=$('playlist-add-select');select.replaceChildren();
  for(const emotion of EMOTIONS){const o=new Option('表情 · '+emotion.name,'emotion:'+emotion.id);select.add(o);}for(const asset of state.assets)select.add(new Option(asset.name,asset.kind+':'+asset.id));
  const list=$('playlist-items');list.replaceChildren();$('playlist-empty').hidden=state.playlist.items.length>0;
  state.playlist.items.forEach((item,i)=>{
    const row=document.createElement('div');row.className='playlist-item'+(!item.enabled?' disabled':'');row.draggable=true;
    const handle=document.createElement('span');handle.className='drag-handle';handle.textContent='⠿';handle.setAttribute('aria-hidden','true');
    const c=document.createElement('canvas');c.width=136;c.height=68;c.className='playlist-thumb';drawFrame(c,item.type==='emotion'?emotionFrame(item.id,0,true):state.assets.find(a=>a.id===item.id)?.frames[0]||new Uint8Array(FRAME_BYTES));
    const title=document.createElement('span');title.className='playlist-title';title.textContent=nameOf(item)||'找不到的作品';
    const duration=document.createElement('label');duration.className='duration-label';const input=document.createElement('input');input.type='number';input.min='1';input.max='600';input.step='1';input.value=item.duration_ms/1000;input.setAttribute('aria-label',(nameOf(item)||'內容')+'播放秒數');input.onchange=()=>{item.duration_ms=Math.max(1,Math.min(600,Math.round(Number(input.value)||5)))*1000;input.value=item.duration_ms/1000;persist();};duration.append(input,document.createTextNode('秒'));
    const actions=document.createElement('div');actions.className='button-row';const enable=document.createElement('input');enable.type='checkbox';enable.checked=item.enabled;enable.setAttribute('aria-label',(nameOf(item)||'內容')+'啟用');enable.onchange=()=>{item.enabled=enable.checked;persist();renderPlaylist();};
    const move=d=>{const j=i+d;if(j<0||j>=state.playlist.items.length)return;[state.playlist.items[i],state.playlist.items[j]]=[state.playlist.items[j],state.playlist.items[i]];persist();renderPlaylist();};
    actions.append(enable,button('↑',()=>move(-1)),button('↓',()=>move(1)),button('移除',()=>{state.playlist.items.splice(i,1);persist();renderPlaylist();}));
    row.append(handle,c,title,duration,actions);row.addEventListener('dragstart',e=>{dragIndex=i;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',String(i));row.classList.add('dragging');});row.addEventListener('dragend',()=>{dragIndex=null;row.classList.remove('dragging');});row.addEventListener('dragover',e=>e.preventDefault());row.addEventListener('drop',e=>{e.preventDefault();if(dragIndex===null||dragIndex===i)return;const [moving]=state.playlist.items.splice(dragIndex,1);state.playlist.items.splice(i,0,moving);dragIndex=null;persist();renderPlaylist();});list.append(row);
  });
}
bind('playlist-add',()=>{const[type,id]=$('playlist-add-select').value.split(':');addPlaylistItem(type,id);});bind('playlist-mode',e=>{state.playlist.mode=e.target.value;persist();},'change');
bind('playlist-preview',()=>{if(!state.playlist.items.some(i=>i.enabled))throw new Error('先啟用至少一個清單項目吧。');previewRunning=true;playlistIndex=0;playlistStarted=performance.now();playlistFrameStarted=playlistStarted;$('playlist-preview-card').hidden=false;$('playlist-preview-card').scrollIntoView({behavior:'smooth',block:'center'});});bind('playlist-preview-stop',()=>{previewRunning=false;$('playlist-preview-card').hidden=true;});

// BLE controls use real GATT. No simulated success, battery or storage figures.
const browserSupported=!!navigator.bluetooth&&isSecureContext;
$('browser-help').innerHTML=browserSupported?'這個瀏覽器可以使用藍牙。開啟吊飾後，按下方按鈕選擇小夥伴。':'iPhone 請用 <a href="https://apps.apple.com/tw/app/bluefy-web-ble-browser/id1492822055" target="_blank" rel="noopener">Bluefy</a> 開啟這個網址。現在也可以先畫畫、做作品，再連線同步。';
let scannedPairing=readPairing(location.href);
let pairingKey=scannedPairing?.key||null,pairingDevice=scannedPairing?.device||null,pairingURL=scannedPairing?.url||null;
if(scannedPairing){
  history.replaceState(null,'',location.pathname+location.search);
  $('pairing-setup').hidden=false;
  $('pairing-message').textContent=browserSupported?'配對資訊已讀取。開啟吊飾，按「尋找小夥伴」即可自動授權，不用輸入授權碼。':'配對資訊已讀取，不用輸入授權碼。iPhone 請按下方按鈕，將完整配對網址貼進 Bluefy 的網址列。Android 可改用 Chrome。';
  $('pairing-handoff').hidden=browserSupported;
  showTab('device');
}
scannedPairing=null;
bind('copy-pairing-link',async()=>{
  if(!pairingURL)throw new Error('請重新掃描小卡上的 QR Code。');
  try{
    await navigator.clipboard.writeText(pairingURL);
    $('pairing-link-fallback').hidden=true;
    toast('配對網址已複製。開啟 Bluefy，在網址列貼上即可。');
  }catch{
    $('pairing-link-fallback').hidden=false;
    $('pairing-link').value=pairingURL;
    $('pairing-link').focus();$('pairing-link').select();
    toast('瀏覽器未允許複製，請長按下方配對網址，選擇複製。');
  }
});
async function connect(){
  showTab('device');if(!browserSupported){toast('iPhone 請先使用 Bluefy 開啟這個網址，作品仍可以先編輯。');return;}
  $('connect-device').disabled=true;$('connect-device').textContent='正在尋找…';
  try{const info=await ble.connect();const saved=storeReady?await store.get('key:'+info.device_id):null;$('auth-key').value=pairingKeyForDevice(pairingKey,pairingDevice,info.device_id,saved);$('remember-key').checked=!!saved;if($('auth-key').value)await authorize();else toast('找到了！請輸入小卡上的授權碼。');}
  finally{$('connect-device').disabled=false;$('connect-device').textContent='尋找小夥伴';}
}
async function authorize(){const key=$('auth-key').value.trim();await ble.authorize(key);if($('remember-key').checked&&storeReady)await store.put('key:'+ble.info.device_id,key);else if(storeReady)await store.put('key:'+ble.info.device_id,null);pairingKey=null;pairingDevice=null;pairingURL=null;$('pairing-link').value='';$('pairing-handoff').hidden=true;$('pairing-message').textContent='已連線並授權，可以傳送作品。下次使用時，重新掃描小卡即可。';$('auth-key').value='';toast('已連線並授權，可以傳送作品。');}
bind('connect-top',()=>ble.connected?showTab('device'):connect());bind('connect-device',connect);bind('authorize-device',authorize);bind('disconnect-device',()=>ble.disconnect());
ble.addEventListener('state',e=>{
  const {connected,authorized,info}=e.detail;$('connect-label').textContent=connected?'小伴已連線':'連接小夥伴';$('connection-dot').classList.toggle('connected',connected);$('device-state').textContent=authorized?'已授權':connected?'等待授權':'尚未連線';$('auth-area').hidden=!connected||authorized;$('disconnect-device').disabled=!connected;$('info-name').textContent=info?.name||ble.device?.name||(connected?'小伴':'等待連線');
  $('info-battery').textContent=Number.isFinite(info?.battery_mv)?`${(info.battery_mv/1000).toFixed(2)} V${Number.isFinite(info.battery_percent)?' · 約 '+info.battery_percent+'%':''}`:'—';$('info-storage').textContent=Number.isFinite(info?.storage_free)?`${formatBytes(info.storage_free)} 可用 / ${formatBytes(info.storage_total)}`:'—';$('info-firmware').textContent=info?.firmware||'—';
  $('emotion-hint').textContent=authorized?'選好表情後，按上方按鈕套用到吊飾。':'先預覽，連線後再套用到吊飾。';if(!connected)$('remote-library').replaceChildren();
});ble.addEventListener('error',e=>toast(e.detail.message,true));
bind('brightness-apply',async()=>{await ble.command('SET_BRIGHTNESS',{value:Number($('device-brightness').value)},'brightness');toast('亮度已調整。');});bind('resume-playlist',async()=>{await ble.command('PLAY_PLAYLIST',{},'playlist');toast('已恢復播放清單。');});
let syncing=false;
function progressPanel(label,p,detail){$('transfer-panel').hidden=false;$('transfer-label').textContent=label;$('transfer-progress').value=p;$('transfer-detail').textContent=detail;}
async function transferAsset(asset){
  if(syncing)throw new Error('正在同步，請等這次傳送完成。');
  syncing=true;progressPanel(`傳送「${asset.name}」`,0,'正在準備…');
  try{await ble.upload(asset,(p,sent,total)=>progressPanel(`傳送「${asset.name}」`,p,`${formatBytes(sent)} / ${formatBytes(total)}`));toast('作品已存進吊飾，手機可以斷線了。');}finally{syncing=false;$('transfer-panel').hidden=true;}
}
bind('cancel-transfer',()=>ble.cancel());
bind('sync-playlist',async()=>{
  ble.capability('playlist');if(syncing)throw new Error('正在同步，請等這次完成。');
  validatePlaylist(state.playlist,state.assets);if(!state.playlist.items.some(i=>i.enabled))throw new Error('先啟用至少一個清單項目吧。');
  const snapshot=structuredClone(state),assets=snapshot.assets.filter(a=>snapshot.playlist.items.some(i=>i.type!=='emotion'&&i.id===a.id));if(assets.length)ble.capability('media');syncing=true;$('sync-playlist').disabled=true;ble.cancelRequested=false;
  try{for(let i=0;i<assets.length;i++){if(ble.cancelRequested)throw new Error('已取消同步');await ble.upload(assets[i],(p,sent,total)=>progressPanel(`同步作品 ${i+1} / ${assets.length}`,(i+p)/(assets.length+1),`${assets[i].name} · ${formatBytes(sent)} / ${formatBytes(total)}`));}
    if(ble.cancelRequested)throw new Error('已取消同步');progressPanel('儲存播放清單',.95,'作品傳送完成，正在確認清單…');await ble.request('SET_PLAYLIST',{playlist:snapshot.playlist},30000);toast('清單和作品都同步好了。');
  }finally{syncing=false;$('sync-playlist').disabled=false;$('transfer-panel').hidden=true;}
});
bind('refresh-remote',async()=>{
  const result=await ble.command('LIST_MEDIA',{},'media');const list=$('remote-library');list.replaceChildren();
  if(!Array.isArray(result.items))throw new Error('吊飾的作品清單格式錯誤');
  for(const item of result.items){if(!/^[a-f0-9]{32}$/.test(item.id))continue;const row=document.createElement('div');row.className='remote-item';const name=document.createElement('span');name.textContent=item.name||item.id;const actions=document.createElement('div');actions.className='button-row';actions.append(button('播放',async()=>{await ble.command('PLAY_MEDIA',{id:item.id},'media');toast('小伴開始播放這個作品。');}),button('刪除',async()=>{if(!await confirmAction('刪除吊飾上的作品？',`會永久刪除吊飾上的「${item.name||item.id}」。如果被播放清單使用，吊飾應拒絕刪除。`))return;await ble.command('DELETE_MEDIA',{id:item.id},'media');row.remove();toast('已從吊飾移除。');}));row.append(name,actions);list.append(row);}
  if(!result.items.length)list.textContent='吊飾裡還沒有作品。';
});

// Backups exclude device authorization keys and preserve existing local assets on import.
bind('export-backup',()=>{
  const backup={...structuredClone(state),exported_at:new Date().toISOString()};backup.assets=state.assets.map(a=>({...a,frames:a.frames.map(f=>Array.from(f))}));backup.pixel={...state.pixel,frames:state.pixel.frames.map(f=>Array.from(f))};
  download(JSON.stringify(backup),`小伴備份-${new Date().toISOString().slice(0,10)}.json`,'application/json');toast('備份已匯出，不包含吊飾授權碼。');
});bind('import-backup',()=>$('backup-file').click());
bind('backup-file',async e=>{
  const file=e.target.files[0];e.target.value='';if(!file)return;if(file.size>30*1024*1024)throw new Error('備份檔太大，請選 30MB 以下的檔案。');
  const data=JSON.parse(await file.text());if(data.version!==1||!Array.isArray(data.assets)||data.assets.length>500)throw new Error('這不是支援的小伴備份。');
  const incoming=data.assets.map(validateAsset);if(new Set(incoming.map(a=>a.id)).size!==incoming.length)throw new Error('備份裡有重複作品 ID');if(state.assets.length+incoming.length>500)throw new Error('匯入後會超過 500 個作品，請先備份並整理作品集。');validatePlaylist(data.playlist,incoming);
  if(!await confirmAction('匯入這份小伴備份？','現有作品會保留，播放清單會換成備份裡的清單。畫板草稿會保留。','匯入備份'))return;
  const remap=new Map();for(const asset of incoming){const exists=state.assets.find(a=>a.id===asset.id);if(exists){const oldId=asset.id;asset.id=newId();remap.set(oldId,asset.id);}state.assets.push(asset);}
  state.playlist={...data.playlist,items:data.playlist.items.map(i=>({...i,id:remap.get(i.id)||i.id}))};persist(true);renderLibrary();renderPlaylist();toast('備份已匯入，原本的作品也保留了。');
},'change');

// One render scheduler owns the previews, and pauses hidden-page animation work.
let lastDraw=0,lastAuto=0;
function tick(time){
  if(!document.hidden&&time-lastDraw>=70){
    lastDraw=time;
    if(activeTab==='emotion'){if(auto&&time-lastAuto>3500){lastAuto=time;mood=EMOTIONS[Math.floor(Math.random()*6)].id;renderMood();}drawFrame($('face-canvas'),emotionFrame(mood,time));}
    if(activeTab==='pixel'&&pixelPlaying){const index=Math.floor((time-pixelStart)/1000*pixel().fps)%pixel().frames.length;drawFrame($('pixel-canvas'),pixelBytes(index));}
    if(activeTab==='animation'&&animationPlaying&&animation){const i=Math.floor((time-animationStart)/1000*animation.fps)%animation.frames.length;drawFrame($('animation-canvas'),animation.frames[i]);}
    if($('asset-dialog').open&&assetSelected){const i=Math.floor((time-assetStart)/1000*assetSelected.fps)%assetSelected.frames.length;drawFrame($('asset-dialog-canvas'),assetSelected.frames[i]);}
    if(activeTab==='playlist'&&previewRunning){
      const items=state.playlist.items.filter(i=>i.enabled);if(!items.length)previewRunning=false;
      else{if(playlistIndex>=items.length)playlistIndex=0;let item=items[playlistIndex];if(time-playlistStarted>=item.duration_ms){if(state.playlist.mode==='once'&&playlistIndex===items.length-1)previewRunning=false;else{playlistIndex=state.playlist.mode==='shuffle'?Math.floor(Math.random()*items.length):(playlistIndex+1)%items.length;playlistStarted=time;playlistFrameStarted=time;item=items[playlistIndex];}}
        $('playlist-preview-name').textContent=`手機預覽 · ${nameOf(item)||'內容'}`;const asset=state.assets.find(a=>a.id===item.id);drawFrame($('playlist-canvas'),item.type==='emotion'?emotionFrame(item.id,time):asset?asset.frames[Math.floor((time-playlistFrameStarted)/1000*asset.fps)%asset.frames.length]:new Uint8Array(FRAME_BYTES));}
    }
  }
  requestAnimationFrame(tick);
}
renderLibrary();renderPlaylist();renderPixel();drawFrame($('face-canvas'),emotionFrame(mood,0));requestAnimationFrame(tick);
try{
  await store.init();const saved=await store.get('workspace');
  if(saved?.version===1){
    const assets=saved.assets.map(a=>validateAsset({...a,frames:a.frames.map(f=>Array.from(f))}));validatePlaylist(saved.playlist,assets);
    const p=saved.pixel;if(![32,64,128].includes(p?.width)||p.height!==p.width/2||!Array.isArray(p.frames)||!p.frames.length||p.frames.length>100||p.frames.some(f=>f.length!==p.width*p.height||Array.from(f).some(v=>v!==0&&v!==1))||!Number.isInteger(p.index)||p.index<0||p.index>=p.frames.length||![5,8,10].includes(p.fps))throw new Error('畫板草稿格式錯誤');
    state={...saved,assets,pixel:{...p,frames:p.frames.map(f=>Uint8Array.from(f))}};renderLibrary();renderPlaylist();renderPixel();
  }
  storeReady=true;
  $('storage-state').textContent=`草稿箱已就緒 · ${state.assets.length} 個作品 · 僅保存在目前瀏覽器`;$('pixel-save-state').textContent='草稿已儲存在這台手機。';
}catch(error){storeReady=false;$('storage-state').textContent='草稿箱暫時無法使用，離開前請匯出備份。';$('pixel-save-state').textContent='請匯出備份再離開，目前編輯只在記憶體。';toast('草稿箱無法開啟，請先匯出備份；現有資料沒有被清除。',true);}
if('serviceWorker'in navigator&&location.hostname!=='127.0.0.1'&&location.hostname!=='localhost')navigator.serviceWorker.register('./sw.js').catch(()=>{$('storage-state').textContent+=' · 此瀏覽器未啟用離線網頁快取';});
