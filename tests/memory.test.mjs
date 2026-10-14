import test from 'node:test';
import assert from 'node:assert/strict';
import {memoryUsage} from '../web-app/js/storage-info.js';
import {CompanionBLE} from '../web-app/js/ble.js';

const sample={ok:true,device_id:'test-device',ram_scope:'internal_8bit_heap',ram_total:262144,ram_free:196608,ram_largest_block:98304,ram_sampled_ms:12345};
const makeClient=()=>{const c=new CompanionBLE();c.device={gatt:{connected:true}};c.authorized=true;c.role='owner';c.info={device_id:'test-device',capabilities:['memory']};return c;};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {resolve,promise};};

test('RAM uses a verified internal heap and rejects inconsistent contiguous capacity',()=>{
  assert.deepEqual(memoryUsage(sample),{total:262144,free:196608,used:65536,usedPercent:25,largest:98304});
  for(const value of [null,{}, {...sample,ram_scope:'total_chip_sram'}, {...sample,ram_free:'196608'},
    {...sample,ram_largest_block:196609},{...sample,ram_largest_block:-1},{...sample,ram_free:262145}])assert.equal(memoryUsage(value),null);
});

test('RAM reads require capability and authorization and skip uploads or active controls',async()=>{
  const c=makeClient();let requests=0;c.request=async op=>{assert.equal(op,'GET_MEMORY');requests++;return sample;};
  c.authorized=false;assert.equal(await c.refreshMemory(),false);c.authorized=true;
  c.info.capabilities=[];assert.equal(await c.refreshMemory(),false);c.info.capabilities=['memory'];
  c.busy=true;assert.equal(await c.refreshMemory(),false);c.busy=false;
  c.authorization={};assert.equal(await c.refreshMemory(),false);c.authorization=null;
  c.pending.set(1,{});assert.equal(await c.refreshMemory(),false);c.pending.clear();
  c.device.gatt.connected=false;assert.equal(await c.refreshMemory(),false);c.device.gatt.connected=true;
  assert.equal(requests,0);assert.equal(await c.refreshMemory(),true);assert.equal(c.memory,sample);assert.equal(requests,1);
});

test('overlapping RAM reads share one request and release the UI lock after completion',async()=>{
  const c=makeClient(),gate=deferred();let requests=0;const states=[];
  c.addEventListener('state',()=>states.push({locked:!!c.memoryRefresh,value:c.memory}));
  c.request=async()=>{requests++;return gate.promise;};
  const first=c.refreshMemory(),second=c.refreshMemory();assert.equal(first,second);
  await Promise.resolve();assert.equal(requests,1);assert.equal(states[0].locked,true);
  gate.resolve(sample);assert.equal(await first,true);assert.equal(c.memoryRefresh,null);assert.equal(states.at(-1).locked,false);
});

test('late RAM replies cannot populate a new connection and disconnect clears the reading',async()=>{
  const c=makeClient(),gate=deferred();c.request=()=>gate.promise;
  const first=c.refreshMemory();await Promise.resolve();c.onDisconnect();
  c.device={gatt:{connected:true}};c.authorized=true;c.info={device_id:'new-device',capabilities:['memory']};
  gate.resolve(sample);assert.equal(await first,false);assert.equal(c.memory,null);
});

test('wrong-device or malformed RAM data retains the last valid sample and permits retry',async()=>{
  for(const value of [{...sample,device_id:'other-device'},{...sample,ram_free:-1}]){
    const c=makeClient();c.memory=sample;c.request=async()=>value;
    await assert.rejects(c.refreshMemory(),/RAM 資料無效/);assert.equal(c.memory,sample);assert.equal(c.memoryRefresh,null);
    c.request=async()=>sample;assert.equal(await c.refreshMemory(),true);
  }
});
