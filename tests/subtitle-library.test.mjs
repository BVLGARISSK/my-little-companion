import test from 'node:test';
import assert from 'node:assert/strict';
import {saveSubtitleAsset} from '../web-app/js/subtitle-library.js';

const draft=changes=>({kind:'subtitle',name:'我的字幕',fps:1,frames:[new Uint8Array(1024)],subtitle:{version:1,width:128,height:32,viewport_h:64,face:false,keep_awake:false,motion:'fixed',direction:'forward',speed:30,emotion:'happy',text:'你好',font_px:32,font_family:'mono',bold:true,writing:'horizontal',align:'center',offset_x:0,offset_y:0,position_version:2},...changes});
const id=()=>{let n=0;return()=>String(++n).padStart(32,'0');};
test('repeated save and send reuse one subtitle identity without deleting other works',()=>{
 const assets=[],newId=id();const first=saveSubtitleAsset(assets,draft(),{newId,now:1}).asset;
 const again=saveSubtitleAsset(assets,draft(),{newId,now:2});assert.equal(again.action,'reused');assert.equal(again.asset.id,first.id);assert.equal(assets.length,1);
 const send=saveSubtitleAsset(assets,draft(),{editingId:first.id,newId,now:3});assert.equal(send.asset.id,first.id);assert.equal(assets.length,1);assert.equal(send.asset.created,1);
});
test('editing updates only the selected ID and keeps playlist references valid',()=>{
 const assets=[],newId=id(),first=saveSubtitleAsset(assets,draft(),{newId}).asset;
 const other=saveSubtitleAsset(assets,draft({name:'其他字幕'}),{newId}).asset;
 const playlist=[{id:first.id},{id:other.id}];const changed=draft();changed.subtitle.text='改好的內容';changed.frames[0][3]=4;
 const updated=saveSubtitleAsset(assets,changed,{editingId:first.id,newId,now:10});
 assert.equal(updated.action,'updated');assert.equal(assets.length,2);assert.equal(updated.asset.id,playlist[0].id);assert.equal(assets[1],other);assert.equal(updated.asset.subtitle.text,'改好的內容');
 assert.equal(first.frames[0][3],0);changed.frames[0][3]=8;assert.equal(updated.asset.frames[0][3],4);
});
test('same default name never merges different text, face mode, speed, position or pixels',()=>{
 const assets=[],newId=id(),source=draft();saveSubtitleAsset(assets,source,{newId});
 for(const change of [{text:'不同字'},{face:true,viewport_h:32},{speed:31},{offset_x:1}]){
  const item=draft({subtitle:{...source.subtitle,...change}});assert.equal(saveSubtitleAsset(assets,item,{newId}).action,'created');
 }
 const image=draft();image.frames[0][22]=2;assert.equal(saveSubtitleAsset(assets,image,{newId}).action,'created');assert.equal(assets.length,6);
});
test('save as new is explicit, preserves the original and gives copies distinct names',()=>{
 const assets=[],newId=id(),original=saveSubtitleAsset(assets,draft(),{newId}).asset;
 const copy=saveSubtitleAsset(assets,draft(),{editingId:original.id,copy:true,newId}).asset;
 assert.equal(assets.length,2);assert.notEqual(copy.id,original.id);assert.equal(copy.name,'我的字幕（2）');assert.equal(assets[0],original);
 assert.equal(saveSubtitleAsset(assets,draft(),{copy:true,newId}).asset.name,'我的字幕（3）');
});
test('a full collection allows reuse and updates, while new copies are rejected',()=>{
 const assets=[],newId=id(),first=saveSubtitleAsset(assets,draft(),{newId,limit:1}).asset;
 assert.equal(saveSubtitleAsset(assets,draft(),{newId,limit:1}).action,'reused');
 assert.equal(saveSubtitleAsset(assets,draft({name:'改名'}),{editingId:first.id,newId,limit:1}).action,'updated');
 assert.throws(()=>saveSubtitleAsset(assets,draft(),{newId,copy:true,limit:1}),/作品集已滿/);assert.equal(assets.length,1);
});
test('a stale editing ID never overwrites a different work or silently deletes old duplicates',()=>{
 const assets=[],newId=id(),old=saveSubtitleAsset(assets,draft(),{newId}).asset;
 assets.push({...old,id:newId(),frames:old.frames.map(f=>f.slice())});
 assert.equal(saveSubtitleAsset(assets,draft(),{editingId:'missing',newId}).action,'reused');assert.equal(assets.length,2);
 const different=draft({name:'另一件'});assert.equal(saveSubtitleAsset(assets,different,{editingId:'missing',newId}).action,'created');assert.equal(assets.length,3);assert.equal(assets[0],old);
});
