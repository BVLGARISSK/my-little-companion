import test from 'node:test';
import assert from 'node:assert/strict';
import {CompanionBLE} from '../web-app/js/ble.js';
import {fragmentMessage} from '../web-app/js/protocol.js';

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('BLE response deadline starts after slow control fragments finish',async()=>{
  const ble=new CompanionBLE();ble.device={gatt:{connected:true}};
  ble.control={writeValueWithResponse:async packet=>{
    await delay(25);
    const view=new DataView(packet.buffer,packet.byteOffset,packet.byteLength);
    if(view.getUint16(6,true)+packet.length-8===view.getUint16(4,true)){
      setTimeout(()=>{for(const reply of fragmentMessage({ok:true},view.getUint16(2,true),20,2))ble.onEvent(new DataView(reply.buffer));},2);
    }
  }};
  assert.deepEqual(await ble.request('SET_PLAYLIST',{playlist:{version:1,items:[]}},10),{ok:true});
});
test('BLE unanswered requests still expire after sending',async()=>{
  const ble=new CompanionBLE();ble.device={gatt:{connected:true}};
  ble.control={writeValueWithResponse:async()=>{await delay(2);}};
  await assert.rejects(ble.request('LIST_MEDIA',{},10),/沒有回覆/);
  assert.equal(ble.pending.size,0);
});
