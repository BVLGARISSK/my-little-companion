import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {setupExperience} from '../web-app/js/experience-ui.js';
import {DEFAULT_SETTINGS} from '../web-app/js/experience-format.js';
import {validatePlaylist} from '../web-app/js/protocol.js';
import * as playlist from '../web-app/js/playlist-device.js';

function dom(){
 const elements=new Map();class Element{
  constructor(tag='div'){this.tag=tag;this.children=[];this.options=[];this.dataset={};this.handlers={};this.value='';this.checked=false;this.textContent='';}
  set id(v){this._id=v;elements.set(v,this);}get id(){return this._id;}
  append(c){this.children.push(c);}replaceChildren(){this.children=[];this.options=[];}add(o){this.options.push(o);}
  querySelector(){return this.children.find(c=>c.tag==='select');}addEventListener(e,f){this.handlers[e]=f;}
 }
 const document={hidden:false,getElementById(id){if(!elements.has(id)){if(id.startsWith('extras-rule-')&&!id.startsWith('extras-rule-select-'))return null;const e=new Element();e.id=id;}return elements.get(id);},createElement:t=>new Element(t),querySelectorAll:()=>[]};
 return {document,Option:class{constructor(text,value){this.text=text;this.value=value;}}};
}
const runtime={touch_locked:false,calibration_needed:true,settings_recovered:false,upside_down:false,low_battery:false,critical_battery:false,clock_valid:false,epoch_ms:0,offset_min:480,tool:0,tilt_x:0,tilt_y:0,events_fired:0,timer:{active:false,paused:false,finished:false,pomodoro:false,phase:0,round:1,rounds:4,remaining_s:0}};
function experience(saved,meta,confirm=true){
 Object.assign(globalThis,dom());const calls=[];let last={saved,meta};
 const ble=new EventTarget();Object.assign(ble,{connected:true,authorized:true,busy:false,connectionEpoch:1,pending:new Map(),info:{device_id:'device-a',firmware:'0.7.7-c5',capabilities:['extras','media']},command:async(op,fields)=>{calls.push(op);return op==='LIST_MEDIA'?{items:[]}:{settings:structuredClone(op==='SAVE_EXTRAS'?fields.settings:DEFAULT_SETTINGS),runtime};}});
 const ui=setupExperience({ble,toast:()=>{},getAssets:()=>[],getDraft:()=>saved,getDraftMeta:()=>meta,onDraft:(d,m)=>{last={saved:structuredClone(d),meta:structuredClone(m)};},transferAsset:async()=>{},isBusy:()=>false,confirmAction:async()=>confirm});
 return {ui,ble,calls,last:()=>last};
}
test('unsent restored settings survive authorization and polling, including legacy drafts',async()=>{
 for(const meta of [undefined,{dirty:true,deviceId:'device-a'}]){
  const saved={...structuredClone(DEFAULT_SETTINGS),off_s:120};const e=experience(saved,meta);
  e.ui.restoreDraft(saved,meta);await e.ui.authorized();await e.ui.refresh();
  assert.equal(Number(document.getElementById('extras-off_s').value),120);assert.equal(e.last().saved.off_s,120);
 }
});
test('already-applied settings follow the device and explicit read may replace a pending draft',async()=>{
 const saved={...structuredClone(DEFAULT_SETTINGS),off_s:120};let e=experience(saved,{dirty:false,deviceId:'device-a'});await e.ui.authorized();assert.equal(e.last().saved.off_s,60);
 e=experience(saved,{dirty:true,deviceId:'device-a'});await document.getElementById('extras-read').onclick();assert.equal(e.last().saved.off_s,60);assert.equal(e.last().meta.dirty,false);
});
test('cancel reading settings preserves unsent draft and sends no device command',async()=>{
 const e=experience({...structuredClone(DEFAULT_SETTINGS),off_s:120},{dirty:true,deviceId:'device-a'},false);await document.getElementById('extras-read').onclick();assert.equal(e.last().saved.off_s,120);assert.deepEqual(e.calls,[]);
});
test('editing saves dirty provenance; successful application clears it',async()=>{
 const e=experience();document.getElementById('extras-off_s').value='120';document.getElementById('extras-off_s').handlers.input();assert.deepEqual(e.last().meta,{dirty:true,deviceId:'device-a'});
 await document.getElementById('extras-save').onclick();assert.equal(e.last().meta.dirty,false);assert.equal(e.last().saved.off_s,120);
});
test('cross-device draft cancellation prevents apply and calibration',async()=>{
 const e=experience(structuredClone(DEFAULT_SETTINGS),{dirty:true,deviceId:'other'},false);await document.getElementById('extras-calibrate').onclick();assert.deepEqual(e.calls,[]);
});
test('non-repeating animation preview holds the last frame',()=>{
 assert.equal(playlist.animationFrameIndex(4000,1,2,false),1);assert.equal(playlist.animationFrameIndex(4000,1,2,true),0);
});
test('firmware gating and playlist diff handle new versions, duplicates and reordering',()=>{
 for(const v of ['0.7.7-c5','0.7.10-c5','0.8.0-c5','1.0.0-c5'])assert.equal(playlist.supportsPlaylistRead({firmware:v}),true);
 for(const v of ['0.7.6-c5','0.7.7-s3','bad'])assert.equal(playlist.supportsPlaylistRead({firmware:v}),false);
 const a={mode:'loop',items:[{id:'happy',type:'emotion'},{id:'happy',type:'emotion'}]},b={mode:'once',items:[a.items[0]]};assert.deepEqual(playlist.playlistDifference(a,b),{added:0,removed:1,changed:true});
});

const source=fs.readFileSync(new URL('../web-app/app.js',import.meta.url),'utf8');
const flow=source.slice(source.indexOf('// Device playlist references'),source.indexOf("bind('refresh-remote'"));
const asset={id:'a'.repeat(32),name:'Remote caption',kind:'subtitle'};
const item={id:asset.id,type:asset.kind,duration_ms:5000,repeat:true,enabled:true};
const empty=()=>({version:1,mode:'loop',items:[]});
function flowContext(){
 const d=dom(),handlers={},calls=[];const ctx={...d,...playlist,validatePlaylist,structuredClone,Set,Map,Error,Number,JSON,Math,
  state:{assets:[],playlist:empty()},syncing:false,resetBusy:false,playlistReturning:false,playlistReading:false,playbackReading:false,
  bind:(id,f)=>{handlers[id]=f;},setInterval:()=>{},$:id=>d.document.getElementById(id),
  persist:()=>{},renderPlaylist:()=>{},updateAdminTools:()=>{},toast:()=>{},progressPanel:()=>{},refreshStorageAfterChange:async()=>{},requireSyncCapacity:()=>{},
  confirmAction:async()=>true,playlistAssets:()=>[asset]};
 const ble={connected:true,authorized:true,connectionEpoch:1,pending:new Map(),info:{device_id:'device-a',firmware:'0.7.7-c5',capabilities:['playlist','media']},capability:()=>{},cancelRequested:false,busy:false,
  command:async(op)=>{calls.push(op);if(op==='LIST_MEDIA')return {items:[asset]};if(op==='GET_PLAYLIST')return {device_id:'device-a',revision:42,playlist:{version:1,mode:'loop',items:[item]}};return {device_id:'device-a',mode:'playlist',tool:0,temporary:false,sleeping:false,media_id:asset.id,playlist_index:0,playlist_count:1};},
  request:async(op,fields)=>{calls.push({op,fields});return {started:true};},upload:async()=>{throw new Error('Remote-only work must not upload');}};
 ctx.ble=ble;vm.createContext(ctx);vm.runInContext(flow,ctx);return {ctx,handlers,calls,ble};
}
test('second phone reads and edits remote-only references without downloading or uploading files',async()=>{
 const {ctx,handlers,calls}=flowContext();await handlers['playlist-read']();assert.equal(ctx.state.assets.length,0);assert.equal(ctx.state.playlistRefs[0].id,asset.id);assert.equal(ctx.state.playlistDevice,'device-a');
 ctx.state.playlist.items[0].duration_ms=8000;await handlers['sync-playlist']();const set=calls.find(c=>c.op==='SET_PLAYLIST');assert.equal(set.fields.expected_revision,42);assert.equal(set.fields.playlist.items[0].duration_ms,8000);
 await handlers['playlist-undo-read']();assert.equal(ctx.state.playlist.items.length,0);
});
test('cancel read leaves both phone draft and works intact',async()=>{
 const {ctx,handlers,calls}=flowContext();ctx.confirmAction=async()=>false;await handlers['playlist-read']();assert.equal(ctx.state.playlist.items.length,0);assert.equal(calls.some(c=>c.op==='SET_PLAYLIST'),false);
});
test('sync empty playlist requires explicit confirmation and keeps works intact',async()=>{
 const {ctx,handlers,calls}=flowContext();await handlers['sync-playlist']();assert.equal(calls.find(c=>c.op==='SET_PLAYLIST').fields.playlist.items.length,0);assert.equal(calls.includes('DELETE_MEDIA'),false);
 const other=flowContext();other.ctx.confirmAction=async()=>false;await other.handlers['sync-playlist']();assert.equal(other.calls.some(c=>c.op==='SET_PLAYLIST'),false);
});
test('missing remote reference and cross-device reference cannot be synced',async()=>{
 const f=flowContext();f.ctx.state.playlist={version:1,mode:'loop',items:[item]};f.ctx.state.playlistRefs=[asset];f.ctx.state.playlistDevice='other';await assert.rejects(f.handlers['sync-playlist'](),/另一台/);assert.equal(f.calls.some(c=>c.op==='SET_PLAYLIST'),false);
 f.ctx.state.playlistDevice='device-a';f.ble.command=async op=>op==='LIST_MEDIA'?{items:[]}:{device_id:'device-a',revision:42,playlist:empty()};await assert.rejects(f.handlers['sync-playlist'](),/刪除或變更/);
});
test('disconnect during confirmation aborts commit; failed commit does not claim synced',async()=>{
 const f=flowContext();f.ctx.confirmAction=async()=>{f.ble.connectionEpoch++;return true;};await assert.rejects(f.handlers['sync-playlist'](),/連線已改變/);assert.equal(f.calls.some(c=>c.op==='SET_PLAYLIST'),false);
 const g=flowContext();g.ble.request=async()=>{throw new Error('CONFLICT');};await assert.rejects(g.handlers['sync-playlist'](),/CONFLICT/);assert.equal(g.ctx.state.playlistSynced,undefined);
});
test('legacy firmware cannot clear playlist or claim to read remote playlist',async()=>{
 const f=flowContext();f.ble.info.firmware='0.7.6-c5';await assert.rejects(f.handlers['sync-playlist'](),/0.7.7/);await assert.rejects(f.handlers['playlist-read'](),/0.7.7/);
});


test('device actions disable while disconnected and undo requires a saved draft',()=>{
 const f=flowContext();f.ble.connected=false;f.ctx.renderPlaylistStatus();
 for(const id of ['sync-playlist','resume-playlist','playlist-read','playlist-undo-read'])assert.equal(f.ctx.$(id).disabled,true);
 f.ble.connected=true;f.ctx.state.playlistUndo={};f.ctx.renderPlaylistStatus();assert.equal(f.ctx.$('sync-playlist').disabled,false);assert.equal(f.ctx.$('playlist-undo-read').disabled,false);
 f.ctx.playlistReturning=true;f.ctx.renderPlaylistStatus();assert.equal(f.ctx.$('resume-playlist').disabled,true);
});


test('edits made while settings are being saved remain as an unsent draft',async()=>{
 const e=experience();let finish;const original=e.ble.command;e.ble.command=(op,fields)=>op==='SAVE_EXTRAS'?new Promise(resolve=>{finish=()=>original(op,fields).then(resolve);}):original(op,fields);
 const saving=document.getElementById('extras-save').onclick();await Promise.resolve();
 document.getElementById('extras-off_s').value='150';document.getElementById('extras-off_s').handlers.input();await finish();await saving;
 assert.equal(e.last().saved.off_s,150);assert.equal(e.last().meta.dirty,true);assert.equal(document.getElementById('extras-off_s').value,'150');
});

test('dinosaur blocks old firmware and sends GAME dino only on compatible devices',async()=>{
 const e=experience();await document.getElementById('extras-game-dino').onclick();assert.equal(e.calls.length,0);assert.equal(document.getElementById('extras-game-dino').disabled,true);
 e.ble.info.firmware='0.7.8-c5';e.ui.controls();assert.equal(document.getElementById('extras-game-dino').disabled,false);
 const original=e.ble.command;let command;e.ble.command=async(op,fields)=>{command={op,fields};return original(op,fields);};
 await document.getElementById('extras-game-dino').onclick();assert.deepEqual(command,{op:'GAME',fields:{game:'dino'}});
 e.ble.connected=false;e.ui.controls();assert.equal(document.getElementById('extras-game-dino').disabled,true);
});

test('currently playing recognizes dinosaur and rejects unknown tools',()=>{
 const value={mode:'emotion',tool:6,sleeping:false,temporary:false};assert.equal(playlist.playbackLabel(value,[]),'小恐龍');
 assert.throws(()=>playlist.playbackLabel({...value,tool:7},[]));
});
