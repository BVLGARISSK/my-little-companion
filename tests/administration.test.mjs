import test from 'node:test';
import assert from 'node:assert/strict';
import {createCipheriv} from 'node:crypto';
import {decryptOwnerPairing,ownerPairingURL,pairingMatrix,resetReceiptMatches} from '../web-app/js/administration.js';
import {CompanionBLE} from '../web-app/js/ble.js';

const admin='a'.repeat(64),owner='b'.repeat(64),device='mlc-test-123';
function sealed(){
  const nonce=Buffer.from('123456789abcdef012345678','hex');
  const cipher=createCipheriv('aes-256-gcm',Buffer.from(admin,'hex'),nonce);
  cipher.setAAD(Buffer.from('mlc/1:owner-pairing:'+device));
  return{device_id:device,nonce:nonce.toString('hex'),ciphertext:Buffer.concat([cipher.update(Buffer.from(owner,'hex')),cipher.final()]).toString('hex'),tag:cipher.getAuthTag().toString('hex')};
}
test('administrator decrypts an ordinary key sealed with independent AES-GCM implementation',async()=>{
  assert.deepEqual(await decryptOwnerPairing(sealed(),admin,device),{device,key:owner});
});
test('sealed pairing rejects wrong admin, tampering, another device and malformed lengths',async()=>{
  await assert.rejects(decryptOwnerPairing(sealed(),'c'.repeat(64),device),/驗證失敗/);
  await assert.rejects(decryptOwnerPairing({...sealed(),tag:'0'.repeat(32)},admin,device),/驗證失敗/);
  await assert.rejects(decryptOwnerPairing(sealed(),admin,'other'),/另一台/);
  await assert.rejects(decryptOwnerPairing({...sealed(),nonce:'0'},admin,device),/格式/);
});
test('friend link uses a fragment, replaces old credentials and excludes query parameters',()=>{
  const url=new URL(ownerPairingURL({device,key:owner},'https://example.test/my-little-companion/?old=1#key=old'));
  assert.equal(url.search,'');assert.equal(new URLSearchParams(url.hash.slice(1)).get('key'),owner);
  assert.equal(new URLSearchParams(url.hash.slice(1)).get('device'),device);
  assert.throws(()=>ownerPairingURL({device,key:'bad'},url.href),/格式/);
  const matrix=pairingMatrix(url.href);assert.ok(matrix.length>=21);assert.ok(matrix.every(row=>row.length===matrix.length));
});
test('only a matching device and completed reset receipt proves success',()=>{
  const pending={device,id:'d'.repeat(32)},receipt={device_id:device,completed_reset_id:pending.id,storage_ready:true};
  assert.equal(resetReceiptMatches(receipt,pending),true);
  for(const altered of [{device_id:'other'},{completed_reset_id:'e'.repeat(32)},{storage_ready:false}])assert.equal(resetReceiptMatches({...receipt,...altered},pending),false);
});
function client(role='admin',caps=['factory_reset','owner_pairing']){
  const ble=new CompanionBLE();ble.device={gatt:{connected:true}};ble.info={device_id:device,capabilities:caps};ble.authorized=true;ble.role=role;ble.adminKey=role==='admin'?admin:null;return ble;
}
test('ordinary role and older firmware cannot request reset or read credentials',async()=>{
  for(const ble of [client('owner'),client('admin',[])]){
    let writes=0;ble.request=async()=>{writes++;};
    await assert.rejects(ble.factoryReset());await assert.rejects(ble.ownerPairing());assert.equal(writes,0);
  }
});
test('reset saves its receipt before committing the exact device and fresh token',async()=>{
  const ble=client(),calls=[];const id='d'.repeat(32);
  ble.request=async(op,fields)=>{calls.push({op,fields});return op==='FACTORY_RESET_PREPARE'?{device_id:device,reset_id:id}:{reset_id:id,stage:'restarting'};};
  const result=await ble.factoryReset(pending=>{assert.equal(calls.length,1);assert.equal(ble.busy,true);calls.push({saved:pending});});
  assert.deepEqual(result,{device,id});assert.deepEqual(calls[2],{op:'FACTORY_RESET',fields:{device_id:device,reset_id:id}});assert.equal(ble.busy,false);
});
test('reset does not commit after preparation mismatches, disconnect or failed receipt storage',async()=>{
  for(const scenario of ['wrong-device','bad-token','disconnect','storage']){
    const ble=client();let commits=0;
    ble.request=async op=>{if(op==='FACTORY_RESET')commits++;return{device_id:scenario==='wrong-device'?'other':device,reset_id:scenario==='bad-token'?'bad':'d'.repeat(32)};};
    await assert.rejects(ble.factoryReset(()=>{if(scenario==='disconnect')ble.onDisconnect();if(scenario==='storage')throw new Error('storage failed');}));
    assert.equal(commits,0);assert.equal(ble.busy,false);
  }
});
test('reset rejects a lost or malformed acknowledgement without repeating the destructive command',async()=>{
  for(const scenario of ['lost','wrong-receipt']){
    const ble=client();let commits=0;
    ble.request=async op=>{if(op==='FACTORY_RESET_PREPARE')return{device_id:device,reset_id:'d'.repeat(32)};commits++;if(scenario==='lost')throw new Error('disconnected');return{reset_id:'e'.repeat(32),stage:'restarting'};};
    await assert.rejects(ble.factoryReset());assert.equal(commits,1);assert.equal(ble.busy,false);
  }
});
test('reset is blocked during media transfer',async()=>{
  const ble=client();ble.busy=true;let writes=0;ble.request=async()=>{writes++;};await assert.rejects(ble.factoryReset(),/作品同步/);assert.equal(writes,0);
});
test('ordinary pairing is returned only while the administrator connection remains active',async()=>{
  const ble=client();ble.request=async()=>sealed();assert.deepEqual(await ble.ownerPairing(),{device,key:owner});
  ble.request=async()=>{ble.onDisconnect();return sealed();};await assert.rejects(ble.ownerPairing(),/中斷/);assert.equal(ble.adminKey,null);
});
