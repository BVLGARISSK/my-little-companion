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

for(const [reportedRole,expectedRole] of [['admin','admin'],['owner','owner'],[undefined,'owner'],['unrecognized','owner']]){
  test(`authorization uses device-reported role ${reportedRole ?? 'legacy firmware'}`,async()=>{
    const ble=new CompanionBLE();ble.device={gatt:{connected:true}};ble.info={device_id:'test-device'};
    const calls=[];let state;
    ble.addEventListener('state',event=>{state=event.detail;});
    ble.request=async(op,fields)=>{
      calls.push({op,fields});
      return op==='AUTH_CHALLENGE'?{ok:true,server_nonce:'b'.repeat(64)}:{ok:true,role:reportedRole};
    };
    await ble.authorize('a'.repeat(64));
    assert.equal(ble.authorized,true);assert.equal(ble.role,expectedRole);
    assert.equal(state.role,expectedRole);
    assert.equal(calls[1].op,'AUTH');assert.match(calls[1].fields.proof,/^[a-f0-9]{64}$/);
    ble.onDisconnect();assert.equal(ble.authorized,false);assert.equal(ble.role,null);
  });
}

test('rejected authorization cannot create administrator state',async()=>{
  const ble=new CompanionBLE();ble.device={gatt:{connected:true}};ble.info={device_id:'test-device'};
  ble.request=async op=>{if(op==='AUTH_CHALLENGE')return {server_nonce:'b'.repeat(64)};throw new Error('AUTH');};
  await assert.rejects(ble.authorize('a'.repeat(64)),/AUTH/);
  assert.equal(ble.authorized,false);assert.equal(ble.role,null);
});

function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
function authClient(){const ble=new CompanionBLE();ble.device={gatt:{connected:true}};ble.info={device_id:'test-device'};return ble;}
function infoValue(fields={}){return new DataView(new TextEncoder().encode(JSON.stringify({protocol:'mlc/1',device_id:'test-device',battery_mv:3900,...fields})).buffer);}
test('INFO refresh keeps authorization and identity without a control write',async()=>{
  const ble=authClient(),info=ble.info;ble.authorized=true;ble.role='admin';
  ble.infoChar={readValue:async()=>infoValue()};let state;
  ble.control={writeValueWithResponse:()=>{throw new Error('Unexpected control write');}};
  ble.addEventListener('state',event=>{state=event.detail;});
  assert.equal(await ble.refreshInfo(),true);assert.equal(ble.info,info);
  assert.equal(info.battery_mv,3900);assert.equal(state.role,'admin');assert.equal(state.authorized,true);
});
test('INFO polling skips disconnected, upload, authorization, control and overlapping reads',async()=>{
  const ble=authClient(),gate=deferred();let reads=0;
  ble.infoChar={readValue:async()=>{reads++;await gate.promise;return infoValue();}};
  ble.busy=true;assert.equal(await ble.refreshInfo(),false);ble.busy=false;
  ble.authorization={};assert.equal(await ble.refreshInfo(),false);ble.authorization=null;
  ble.pending.set(1,{});assert.equal(await ble.refreshInfo(),false);ble.pending.clear();
  ble.device.gatt.connected=false;assert.equal(await ble.refreshInfo(),false);ble.device.gatt.connected=true;
  const first=ble.refreshInfo();assert.equal(await ble.refreshInfo(),false);assert.equal(reads,1);
  gate.resolve();assert.equal(await first,true);
});
test('late INFO read cannot repopulate a disconnected or reconnected device',async()=>{
  const ble=authClient(),gate=deferred();ble.infoChar={readValue:async()=>{await gate.promise;return infoValue();}};
  const first=ble.refreshInfo();await delay(0);ble.onDisconnect();
  const newer={device_id:'new-device'};ble.info=newer;ble.device={gatt:{connected:true}};
  gate.resolve();assert.equal(await first,false);assert.equal(ble.info,newer);assert.equal(newer.battery_mv,undefined);
});
test('INFO protocol or device mismatch cannot corrupt the known device',async()=>{
  for(const fields of [{protocol:'other'},{device_id:'wrong-device'}]){
    const ble=authClient();ble.infoChar={readValue:async()=>infoValue(fields)};
    await assert.rejects(ble.refreshInfo(),/資訊不符/);assert.equal(ble.info.battery_mv,undefined);
  }
});
test('control waits for an in-flight INFO read and refuses a changed connection',async()=>{
  const ble=authClient(),gate=deferred();let writes=0;
  ble.infoChar={readValue:async()=>{await gate.promise;return infoValue();}};
  ble.control={writeValueWithResponse:async()=>{writes++;}};
  const read=ble.refreshInfo(),command=ble.request('SET_EMOTION',{emotion:'happy'},10);
  await delay(0);assert.equal(writes,0);ble.onDisconnect();ble.device={gatt:{connected:true}};
  gate.resolve();await read;await assert.rejects(command,/連線已改變/);assert.equal(writes,0);
});
test('control continues normally when the same connection finishes INFO',async()=>{
  const ble=authClient(),gate=deferred();let writes=0;
  ble.infoChar={readValue:async()=>{await gate.promise;return infoValue();}};
  ble.control={writeValueWithResponse:async packet=>{
    writes++;const view=new DataView(packet.buffer,packet.byteOffset,packet.byteLength);
    if(view.getUint16(6,true)+packet.length-8===view.getUint16(4,true))
      for(const reply of fragmentMessage({ok:true},view.getUint16(2,true),20,2))ble.onEvent(new DataView(reply.buffer));
  }};
  const read=ble.refreshInfo(),command=ble.request('SET_EMOTION',{emotion:'happy'});
  await delay(0);assert.equal(writes,0);gate.resolve();await read;
  assert.deepEqual(await command,{ok:true});assert.ok(writes>0);
});
test('a failed INFO read releases the polling lock for the next update',async()=>{
  const ble=authClient();ble.infoChar={readValue:async()=>{throw new Error('radio');}};
  await assert.rejects(ble.refreshInfo(),/radio/);assert.equal(ble.info.battery_mv,undefined);
  ble.infoChar={readValue:async()=>infoValue()};assert.equal(await ble.refreshInfo(),true);
});
test('repeated authorize clicks share one challenge and proof',async()=>{
  const ble=authClient(),gate=deferred();let challenges=0,proofs=0;
  ble.request=async op=>{
    if(op==='AUTH_CHALLENGE'){challenges++;await gate.promise;return {server_nonce:'b'.repeat(64)};}
    proofs++;return {ok:true,role:'owner'};
  };
  const first=ble.authorize('a'.repeat(64)),second=ble.authorize('a'.repeat(64));
  assert.equal(first,second);assert.equal(challenges,1);
  gate.resolve();await Promise.all([first,second]);assert.equal(proofs,1);assert.equal(ble.role,'owner');
});
test('a new card waits for the pending authorization before requesting its challenge',async()=>{
  const ble=authClient(),authSent=deferred(),firstReply=deferred();let challenges=0,proofs=0;
  ble.request=async op=>{
    if(op==='AUTH_CHALLENGE'){challenges++;return {server_nonce:'b'.repeat(64)};}
    proofs++;
    if(proofs===1){authSent.resolve();await firstReply.promise;return {ok:true,role:'owner'};}
    return {ok:true,role:'admin'};
  };
  const first=ble.authorize('a'.repeat(64));await authSent.promise;
  const newer=ble.authorize('c'.repeat(64));assert.equal(challenges,1);
  firstReply.resolve();await Promise.all([first,newer]);
  assert.equal(challenges,2);assert.equal(proofs,2);assert.equal(ble.role,'admin');
});
test('a late reply and queued authorization cannot grant access after disconnect',async()=>{
  const ble=authClient(),authSent=deferred(),reply=deferred();let challenges=0;
  ble.request=async op=>{
    if(op==='AUTH_CHALLENGE'){challenges++;return {server_nonce:'b'.repeat(64)};}
    authSent.resolve();await reply.promise;return {ok:true,role:'admin'};
  };
  const first=ble.authorize('a'.repeat(64));await authSent.promise;
  const queued=ble.authorize('c'.repeat(64));ble.onDisconnect();reply.resolve();
  await Promise.all([assert.rejects(first,/連線中斷/),assert.rejects(queued,/連線中斷/)]);
  assert.equal(challenges,1);assert.equal(ble.authorized,false);assert.equal(ble.role,null);
});
test('device AUTH rejection carries an error code and actionable Chinese message',async()=>{
  const ble=authClient();
  ble.control={writeValueWithResponse:async packet=>{
    const view=new DataView(packet.buffer,packet.byteOffset,packet.byteLength);
    if(view.getUint16(6,true)+packet.length-8===view.getUint16(4,true)){
      for(const response of fragmentMessage({ok:false,error:'AUTH',message:'Incorrect key or expired challenge.'},view.getUint16(2,true),20,2))ble.onEvent(new DataView(response.buffer));
    }
  }};
  await assert.rejects(ble.request('AUTH',{proof:'a'.repeat(64)}),error=>error.code==='AUTH'&&/重新掃描配對卡/.test(error.message));
});
