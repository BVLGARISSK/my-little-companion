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
