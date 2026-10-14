import test from 'node:test';
import assert from 'node:assert/strict';
import {subtitleRuntime,validateSubtitle,subtitlePixel,scrollOrigin} from '../web-app/js/subtitle-format.js';
import {subtitleFrame,rasterizeSubtitle} from '../web-app/js/subtitle.js';
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

function pixelCanvas(){
  const canvas={width:0,height:0};
  const context={measureText:text=>({width:text.length*8}),fillText(){},getImageData(){
    const data=new Uint8ClampedArray(canvas.width*canvas.height*4);
    for(const [x,y] of [[5,10],[6,11]])data.fill(255,(y*canvas.width+x)*4,(y*canvas.width+x)*4+4);
    return {data};
  }};
  canvas.getContext=()=>context;return canvas;
}
test('position is baked into pixels, clamped without loss, and preserved by backup',()=>{
  const original=rasterizeSubtitle({text:'Hi'},pixelCanvas);
  const shifted=rasterizeSubtitle({text:'Hi',offset_x:127,offset_y:63},pixelCanvas);
  assert.equal(shifted.subtitle.offset_x,121);assert.equal(shifted.subtitle.offset_y,31);
  assert.equal(subtitlePixel(shifted.frames,128,64,126,62),1);
  assert.equal(subtitlePixel(shifted.frames,128,64,127,63),1);
  const restored=validateAsset({...asset(shifted.subtitle,shifted.frames),frames:shifted.frames.map(f=>Array.from(f))});
  assert.equal(restored.subtitle.offset_x,121);assert.equal(restored.subtitle.offset_y,31);
  assert.deepEqual(restored.frames,shifted.frames);
  assert.equal(validateSubtitle(config(),1).offset_x,0);
  assert.deepEqual(rasterizeSubtitle({text:'Hi',offset_x:0,offset_y:0},pixelCanvas).frames,original.frames);
  for(const change of [{offset_x:128},{offset_y:-64},{offset_x:.5},{offset_y:'1'},{position_version:3},{position_version:'2'}])assert.throws(()=>validateSubtitle(config(change),1));
});
test('marquee offsets move only perpendicular to travel without changing its span',()=>{
  const horizontal=rasterizeSubtitle({text:'Hi',motion:'horizontal',offset_x:10,offset_y:20},pixelCanvas);
  assert.equal(horizontal.subtitle.offset_x,0);assert.equal(horizontal.subtitle.offset_y,20);
  assert.equal(horizontal.subtitle.width,20);assert.equal(horizontal.positionBounds.x.max,0);
  assert.equal(subtitlePixel(horizontal.frames,20,64,5,51),1);
  const vertical=rasterizeSubtitle({text:'Hi',motion:'vertical',offset_x:20,offset_y:10},pixelCanvas);
  assert.equal(vertical.subtitle.offset_x,20);assert.equal(vertical.subtitle.offset_y,0);
  assert.equal(vertical.subtitle.height,24);assert.equal(vertical.positionBounds.y.min,0);
  assert.equal(subtitlePixel(vertical.frames,128,24,25,10),1);
  const runtime=subtitleRuntime(horizontal.subtitle,horizontal.frames.length);
  assert.equal(runtime.offset_y,undefined); // Existing firmware receives the shifted atlas.
});
test('face captions stay within their band after maximum vertical shift',()=>{
  const caption=rasterizeSubtitle({text:'Hi',face:true,offset_y:63},pixelCanvas);
  assert.equal(caption.subtitle.offset_y,9);
  const frame=subtitleFrame(caption,0,0);
  assert.equal(frame[62*16]&(1<<5),1<<5);assert.equal(frame[63*16]&(1<<6),1<<6);
});

test('zero vertical offset balances visible ink instead of font line boxes',()=>{
  const centered=rasterizeSubtitle({text:'Hi'},pixelCanvas);
  assert.equal(subtitlePixel(centered.frames,128,64,5,31),1);
  assert.equal(subtitlePixel(centered.frames,128,64,6,32),1);
  assert.equal(centered.subtitle.offset_y,0);assert.equal(centered.subtitle.position_version,2);
});
test('legacy offsets migrate once and preserve their exact atlas on reediting',()=>{
  for(const offset_y of [-10,-5,0,10,20]){
    const migrated=rasterizeSubtitle({text:'Hi',position_version:1,offset_y},pixelCanvas);
    assert.equal(migrated.subtitle.offset_y,offset_y-21);
    assert.equal(subtitlePixel(migrated.frames,128,64,5,10+offset_y),1);
    const reopened=rasterizeSubtitle(migrated.subtitle,pixelCanvas);
    assert.deepEqual(reopened.frames,migrated.frames);assert.equal(reopened.subtitle.offset_y,migrated.subtitle.offset_y);
    const restored=validateSubtitle(migrated.subtitle,migrated.frames.length);
    assert.equal(restored.position_version,2);assert.equal(subtitleRuntime(restored).position_version,undefined);
  }
  assert.equal(validateSubtitle(config()).position_version,1);
});
