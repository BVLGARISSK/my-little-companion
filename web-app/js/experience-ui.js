import {DEFAULT_SETTINGS,EVENTS,PRESETS,validateSettings,validateRuntime,timerFields,runtimeLabel} from './experience-format.js?v=1.3.3';
export function setupExperience({ble,toast,getAssets,getDraft,onDraft,transferAsset,isBusy}){
 const $=id=>document.getElementById(id);
 let current=structuredClone(DEFAULT_SETTINGS),runtime=null,remote=[],dirty=false,busy=false,reading=null,device=null;
 try{if(getDraft())current=validateSettings(getDraft());}catch{}
 const checkbox=['tilt_enabled','greeting_enabled','auto_rotate','lock_on_boot','interrupt_media','low_battery_enabled'];
 const numeric=['axis_x','axis_y','sign_x','sign_y','sensitivity','brightness','dim_level','dim_s','off_s','deep_s','battery_offset_mv'];
 function controls(){
  const supported=ble.info?.capabilities?.includes('extras'),ready=ble.connected&&ble.authorized&&supported;
  document.querySelectorAll('[data-extra-action]').forEach(b=>b.disabled=!ready||busy||!!reading||isBusy()||ble.busy);
  $('extras-connection').textContent=!ble.connected?'手機先設定，連線後套用':!ble.authorized?'等待授權':!supported?'需要 C5 0.7.0 以上':'已連線，可使用玩法';
  $('extras-runtime').textContent=runtimeLabel(runtime);
  $('extras-lock-label').textContent=runtime?.touch_locked?'短按已鎖定，長按仍可操作':'短按可操作';
  $('extras-clock-state').textContent=runtime?.clock_valid?`吊飾已校時 · 時區 UTC${runtime.offset_min>=0?'+':''}${(runtime.offset_min/60).toFixed(1)}`:'吊飾尚未校時';
  $('extras-calibration-state').textContent=current.calibrated?'已記錄正向姿勢':'尚未校正：正向拿穩吊飾後按「正向校正」';
  $('extras-draft-state').textContent=dirty?'設定已修改，尚未套用到吊飾。':'目前顯示已讀取的設定，或手機預設值。';
 }
 function targets(preferCurrent=false){
  const assets=new Map(remote.map(a=>[a.id,a]));for(const asset of getAssets())assets.set(asset.id,asset);
  for(const [i,[event,label]] of EVENTS.entries()){
   let row=$('extras-rule-'+event);if(!row){row=document.createElement('label');row.id='extras-rule-'+event;row.textContent=label;const select=document.createElement('select');select.id='extras-rule-select-'+event;select.dataset.ruleIndex=i;select.onchange=changed;row.append(select);$('extras-rules').append(row);}
   const select=row.querySelector('select'),previous=preferCurrent?ruleValue(current.rules[i]):select.value||ruleValue(current.rules[i]);select.replaceChildren();
   for(const [value,text] of [['default',event==='single'?'預設：切表情':event==='double'?'預設：下一個作品':event==='triple'?'預設：上一個作品':event==='pickup'?'預設：打招呼':event==='shake'?'預設：暈眩表情':'保留預設動作'],['none','不觸發動作'],['next','下一個作品'],['previous','上一個作品'],...['neutral','happy','sad','surprised','sleepy','angry'].map((m,i)=>['emotion:'+m,'表情 · '+['平靜','開心','難過','驚訝','想睡','生氣'][i]]),...Array.from(assets.values(),a=>['media:'+a.id,'作品 · '+a.name])])select.add(new Option(text,value));
   if(previous.startsWith('media:')&&!Array.from(select.options).some(o=>o.value===previous))select.add(new Option('已綁定的裝置作品 '+previous.slice(6,14),previous));select.value=previous;
  }
 }
 const ruleValue=r=>['media','emotion'].includes(r.type)?r.type+':'+r.id:r.type;
 function fill(d){
  current=structuredClone(d);for(const k of checkbox)$('extras-'+k).checked=d[k];for(const k of numeric)$('extras-'+k).value=d[k];
  for(const k of ['warn_mv','sleep_mv','resume_mv'])$('extras-'+k).value=(d[k]/1000).toFixed(2);
  targets(true);for(const [i,[event]] of EVENTS.entries())$('extras-rule-'+event).querySelector('select').value=ruleValue(d.rules[i]);controls();
 }
 function form(){
  const d=structuredClone(current);for(const k of checkbox)d[k]=$('extras-'+k).checked;for(const k of numeric)d[k]=Number($('extras-'+k).value);
  for(const k of ['warn_mv','sleep_mv','resume_mv'])d[k]=Math.round(Number($('extras-'+k).value)*1000);
  d.rules=EVENTS.map(([event])=>{const value=$('extras-rule-'+event).querySelector('select').value,[type,id='']=value.split(':');return {event,type,id};});return validateSettings(d);
 }
 function changed(){dirty=true;try{const d=form();current=d;onDraft(d);$('extras-error').hidden=true;}catch(e){$('extras-error').textContent=e.message;$('extras-error').hidden=false;}controls();}
 function accept(value,replace=false){
  if(!value?.settings)throw new Error('吊飾玩法狀態無效，請重新讀取。');
  const settings=validateSettings(value.settings);runtime=validateRuntime(value.runtime);
  if(replace||!dirty){dirty=false;fill(settings);onDraft(settings);}controls();
 }
 async function run(op,fields={},replace=false){
  if(busy||isBusy()||ble.busy)throw new Error('請等目前的傳送或裝置操作完成。');
  const epoch=ble.connectionEpoch,id=ble.info?.device_id;busy=true;controls();
  try{const value=await ble.command(op,fields,'extras');if(!ble.connected||ble.connectionEpoch!==epoch||ble.info?.device_id!==id)return null;accept(value,replace);return value;}
  finally{if(ble.connectionEpoch===epoch)busy=false;controls();}
 }
 function bind(id,fn){$(id).onclick=()=>Promise.resolve().then(fn).catch(e=>toast(e.message,true));}
 async function refresh(){
  if(!ble.connected||!ble.authorized||!ble.info?.capabilities?.includes('extras')||busy||reading||isBusy()||ble.busy||ble.pending?.size)return false;
  const epoch=ble.connectionEpoch,id=ble.info.device_id;
  const request=ble.command('GET_EXTRAS',{},'extras');reading=request;controls();
  try{const value=await request;if(ble.connected&&ble.connectionEpoch===epoch&&ble.info?.device_id===id){accept(value);return true;}return false;}
  finally{if(reading===request)reading=null;controls();}
 }
 async function apply(){
  const epoch=ble.connectionEpoch,id=ble.info?.device_id;
  const d=form(),ids=new Set(d.rules.filter(r=>r.type==='media').map(r=>r.id));
  for(const id of ids){const asset=getAssets().find(a=>a.id===id);if(asset)await transferAsset(asset);}
  if(!ble.connected||ble.connectionEpoch!==epoch||ble.info?.device_id!==id)throw new Error('連線已改變，請重新讀取裝置再套用。');
  await run('SAVE_EXTRAS',{settings:d},true);toast('互動與省電設定已存進吊飾。');
 }
 async function remoteTargets(){const epoch=ble.connectionEpoch,id=ble.info?.device_id;const value=await ble.command('LIST_MEDIA',{},'media');if(!ble.connected||ble.connectionEpoch!==epoch||ble.info?.device_id!==id)return false;remote=value.items||[];targets();return true;}
 bind('extras-read',async()=>{dirty=false;if(await refresh())await remoteTargets();});
 bind('extras-save',apply);
 bind('extras-calibrate',async()=>{if(dirty)await apply();await run('CALIBRATE_POSE',{},true);toast('已記住正向姿勢。可以試著傾斜吊飾。');});
 bind('extras-lock',()=>run('TOUCH_LOCK',{locked:true}));bind('extras-unlock',()=>run('TOUCH_LOCK',{locked:false}));
 bind('extras-sync-time',async()=>{await run('SET_TIME',{epoch_ms:Date.now(),offset_min:-new Date().getTimezoneOffset()});toast('手機時間已同步到吊飾。');});
 bind('extras-show-clock',()=>run('CLOCK',{enabled:true}));bind('extras-return',()=>run('CLOCK',{enabled:false}));
 for(const game of ['dice','maze','dodge'])bind('extras-game-'+game,()=>run('GAME',{game}));bind('extras-game-stop',()=>run('GAME',{game:'none'}));
 bind('extras-timer-start',()=>run('TIMER',timerFields({mode:$('extras-timer-mode').value,minutes:$('extras-timer-minutes').value,focus:$('extras-focus-minutes').value,rest:$('extras-break-minutes').value,longRest:$('extras-long-minutes').value,rounds:$('extras-rounds').value})));
 for(const action of ['pause','resume','cancel'])bind('extras-timer-'+action,()=>run('TIMER',{action}));
 $('extras-preset').onchange=()=>{const preset=PRESETS[$('extras-preset').value];if(preset){let d;try{d=form();}catch{d=structuredClone(current);}Object.assign(d,preset);fill(d);changed();}};
 $('extras-timer-mode').onchange=()=>{$('extras-pomodoro-fields').hidden=$('extras-timer-mode').value!=='pomodoro';$('extras-timer-minutes').disabled=$('extras-timer-mode').value==='pomodoro';};
 for(const k of [...checkbox,...numeric,'warn_mv','sleep_mv','resume_mv'])$('extras-'+k).addEventListener('input',changed);
 ble.addEventListener('state',()=>{
  if(!ble.connected){runtime=null;remote=[];device=null;reading=null;busy=false;}
  else if(device!==ble.info?.device_id){device=ble.info?.device_id;runtime=null;}
  controls();
 });
 fill(current);
 return {refresh,targets,controls,restoreDraft(value){if(value){try{fill(validateSettings(value));}catch{}}},async authorized(){const epoch=ble.connectionEpoch;if(await refresh()&&ble.connectionEpoch===epoch&&await remoteTargets()&&ble.connectionEpoch===epoch&&$('extras-auto-time').checked)await run('SET_TIME',{epoch_ms:Date.now(),offset_min:-new Date().getTimezoneOffset()});}};
}
