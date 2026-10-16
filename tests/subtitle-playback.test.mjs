import test from 'node:test';
import assert from 'node:assert/strict';
import {createSubtitlePlayback,addSubtitleToPlaylistDraft} from '../web-app/js/subtitle-playback.js';
import {playbackLabel} from '../web-app/js/playlist-device.js';

const asset={kind:'subtitle',id:'a'.repeat(32),subtitle:{motion:'horizontal',width:200,height:64,viewport_h:64,speed:61}};
function setup(){
 const calls=[],ble={connected:true,authorized:true,busy:false,connectionEpoch:1,info:{device_id:'c5',capabilities:['subtitle_pin']},
  capability(name){assert.ok(this.authorized);if(!this.info.capabilities.includes(name))throw new Error('unsupported');},
  async command(op,fields){calls.push(op);return op==='PIN_SUBTITLE'?{subtitle_pinned:true,media_id:fields.id}:{subtitle_pinned:false,mode:'playlist'};}};
 const controller=createSubtitlePlayback({ble,transferAsset:async()=>calls.push('UPLOAD')});return {ble,calls,controller};
}
test('fixed playback uploads first and uses the explicit pin command',async()=>{
 const {controller,calls}=setup();await controller.pin(asset);assert.deepEqual(calls,['UPLOAD','PIN_SUBTITLE']);assert.equal(controller.busy,false);
 await controller.stop();assert.equal(calls.at(-1),'UNPIN_SUBTITLE');
});
test('old firmware is rejected before uploading or claiming to pin',async()=>{
 const {ble,calls,controller}=setup();ble.info.capabilities=[];await assert.rejects(controller.pin(asset),/unsupported/);assert.deepEqual(calls,[]);
});
test('changing the connection during upload cannot pin on another device',async()=>{
 const {ble,calls}=setup();const controller=createSubtitlePlayback({ble,transferAsset:async()=>{calls.push('UPLOAD');ble.connectionEpoch++;}});
 await assert.rejects(controller.pin(asset),/連線已改變/);assert.deepEqual(calls,['UPLOAD']);assert.equal(controller.busy,false);
});
test('duplicate operations stay blocked until the original one completes',async()=>{
 const {ble}=setup();let finish;const controller=createSubtitlePlayback({ble,transferAsset:()=>new Promise(resolve=>finish=resolve)});
 const first=controller.pin(asset);assert.equal(controller.busy,true);await assert.rejects(controller.stop(),/進行中/);finish();await first;
});
test('adding a caption modifies only the phone draft and avoids duplicates',()=>{
 const playlist={version:1,mode:'loop',items:[]};assert.deepEqual(addSubtitleToPlaylistDraft(playlist,asset),{added:true,index:0});
 assert.equal(playlist.items[0].duration_ms,Math.ceil(344000/61));assert.deepEqual(addSubtitleToPlaylistDraft(playlist,asset),{added:false,index:0});assert.equal(playlist.items.length,1);
 const disabled={...playlist.items[0],enabled:false};playlist.items[0]=disabled;addSubtitleToPlaylistDraft(playlist,asset);assert.equal(playlist.items[0],disabled);
});
test('fixed layout has a normal playlist duration and a full list rejects additions',()=>{
 const playlist={items:[]};addSubtitleToPlaylistDraft(playlist,{...asset,subtitle:{...asset.subtitle,motion:'fixed'}});assert.equal(playlist.items[0].duration_ms,5000);
 playlist.items=Array.from({length:64},()=>({id:'b'.repeat(32),type:'subtitle'}));assert.throws(()=>addSubtitleToPlaylistDraft(playlist,asset),/64/);
});
test('status distinguishes fixed playback while remaining compatible with old firmware',()=>{
 const v={mode:'subtitle',media_id:asset.id,tool:0,temporary:false,sleeping:false};
 assert.match(playbackLabel({...v,subtitle_pinned:true},[{...asset,name:'字幕'}]),/固定字幕/);
 assert.doesNotMatch(playbackLabel(v,[{...asset,name:'字幕'}]),/固定字幕/);
});
