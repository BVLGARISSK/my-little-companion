import test from 'node:test';
import assert from 'node:assert/strict';
import {subtitleRuntime,validateSubtitle,subtitlePixel,scrollOrigin} from '../web-app/js/subtitle-format.js';
import {subtitleFrame} from '../web-app/js/subtitle.js';
import {validateAsset,encodeOLA,decodeOLA} from '../web-app/js/media.js';
import {validatePlaylist} from '../web-app/js/protocol.js';
import {CompanionBLE} from '../web-app/js/ble.js';
const config=overrides=>({version:1,width:128,height:64,viewport_h:64,face:false,keep_awake:false,
  motion:'fixed',direction:'forward',speed:30,emotion:'happy',text:'歡迎小伴 ★',font_px:16,
  font_family:'sans',bold:true,writing:'horizontal',align:'center',...overrides});
const asset=(subtitle=config(),frames=[new Uint8Array(1024)])=>({id:'a'.repeat(32),name:'繁體字幕',kind:'subtitle',
  fps:frames.length===1?1:5,subtitle,frames,created:0});
test('subtitle format bounds match tile storage and motion axis',()=>{
  assert.equal(subtitleRuntime(config(),1).viewport_h,64);
  assert.equal(subtitleRuntime(config({width:4096,motion:'horizontal'}),32).width,4096);
  assert.equal(subtitleRuntime(config({height:2048,motion:'vertical'}),32).height,2048);
  for(const change of [{width:0},{width:4097},{height:2049},{speed:0},{speed:121},{speed:2.5},
    {face:'true'},{keep_awake:'true'},{face:true,viewport_h:64},{motion:'other'},{direction:'up'},
    {emotion:'other'},{motion:'fixed',width:129},{motion:'horizontal',height:65},{motion:'vertical',width:129}])
    assert.throws(()=>subtitleRuntime(config(change)));
  assert.throws(()=>subtitleRuntime(config(),2));
});
test('full subtitle backup preserves Chinese and styles without inventing glyphs',()=>{
  const original=asset();original.frames[0][20]=16;
  const backup={...original,frames:original.frames.map(f=>Array.from(f))};
  const restored=validateAsset(JSON.parse(JSON.stringify(backup)));
  assert.deepEqual(restored.frames,original.frames);assert.equal(restored.subtitle.text,'歡迎小伴 ★');
  const decoded=decodeOLA(encodeOLA(restored.frames,restored.fps));assert.deepEqual(decoded.frames,original.frames);
  for(const change of [{text:''},{text:'字'.repeat(161)},{font_px:33},{font_family:'bad'},{writing:'bad'},{bold:1}])
    assert.throws(()=>validateSubtitle(config(change),1));
});
test('atlas pixel extraction crosses both 128-column and 64-row tile boundaries',()=>{
  const frames=Array.from({length:4},()=>new Uint8Array(1024));
  frames[0][63*16+15]=128;frames[1][63*16]=1;frames[2][15]=128;frames[3][0]=1;
  for(const [x,y] of [[127,63],[128,63],[127,64],[128,64]])assert.equal(subtitlePixel(frames,129,65,x,y),1);
  for(const [x,y] of [[-1,0],[0,-1],[129,0],[0,65],[1,1]])assert.equal(subtitlePixel(frames,129,65,x,y),0);
});
test('marquee travel follows speed, direction, loop gap and a single pass',()=>{
  assert.equal(scrollOrigin(200,128,30,0),128);assert.equal(scrollOrigin(200,128,30,1000),98);
  assert.equal(scrollOrigin(200,128,30,1000,true),-170);
  assert.equal(scrollOrigin(200,128,20,17200),128);
  assert.equal(scrollOrigin(200,128,30,20000,false,false),-215);
  assert.equal(scrollOrigin(200,128,120,4294967295),128-(Math.floor(4294967295*120/1000)%344));
});
test('horizontal and vertical renderers clip to their viewport',()=>{
  const frames=[new Uint8Array(1024),new Uint8Array(1024)];frames[0][0]=1;frames[1][0]=1;
  const horizontal=asset(config({width:129,motion:'horizontal',speed:32}),frames);
  assert.equal(subtitleFrame(horizontal,4000)[0]&1,1);
  assert.equal(subtitleFrame(horizontal,0).some(v=>v!==0),false);
  const vertical=asset(config({height:65,motion:'vertical',speed:16}),frames);
  assert.equal(subtitleFrame(vertical,4000)[0]&1,1);
  assert.equal(subtitleFrame(vertical,0).some(v=>v!==0),false);
});
test('face composition keeps caption pixels in the lower band',()=>{
  const a=asset(config({face:true,viewport_h:20,height:20}));a.frames[0][0]=1;
  const frame=subtitleFrame(a,0,0);
  assert.equal(frame[44*16]&1,1);assert.ok(frame.slice(0,44*16).some(v=>v));
  assert.equal(frame[63*16],0);
});
test('subtitle works can enter a playlist and retain media kind checks',()=>{
  const a=asset(),p={version:1,mode:'loop',items:[{id:a.id,type:'subtitle',duration_ms:5000,enabled:true,repeat:true}]};
  assert.equal(validatePlaylist(p,[a]),p);assert.throws(()=>validatePlaylist(p,[{...a,kind:'image'}]));
});
test('subtitle upload sends only runtime settings and uses verified tiled OLA data',async()=>{
  const ble=new CompanionBLE();ble.device={gatt:{connected:true}};ble.authorized=true;
  ble.info={device_id:'test',capabilities:['media','subtitle']};const calls=[];
  ble.request=async(op,fields)=>{calls.push({op,fields});return op==='UPLOAD_BEGIN'?{transfer_id:123,offset:0,window_packets:8}:{ok:true};};
  const received=[];ble.data={writeValueWithoutResponse:async packet=>{
    const view=new DataView(packet.buffer,packet.byteOffset,packet.byteLength),offset=view.getUint32(4,true);
    received.push(...packet.slice(8));const ack={transfer_id:123,offset:offset+packet.length-8};ble.latestAck=ack;
    if(ble.ackWaiter&&ack.offset>=ble.ackWaiter.target)ble.ackWaiter.resolve(ack.offset);
  }};
  const a=asset();a.frames[0][0]=3;await ble.upload(a);
  assert.equal(calls[0].fields.kind,'subtitle');assert.equal(calls[0].fields.subtitle.text,undefined);
  assert.equal(calls[0].fields.subtitle.font_px,undefined);assert.equal(calls[0].fields.subtitle.keep_awake,false);
  assert.deepEqual(decodeOLA(Uint8Array.from(received)).frames,a.frames);assert.equal(calls.at(-1).op,'UPLOAD_END');
  assert.equal(ble.busy,false);
});
test('older firmware refuses subtitle uploads before starting a transfer',async()=>{
  const ble=new CompanionBLE();ble.device={gatt:{connected:true}};ble.authorized=true;ble.info={capabilities:['media']};
  await assert.rejects(ble.upload(asset()),/還沒開放/);assert.equal(ble.busy,false);
});
