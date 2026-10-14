import test from 'node:test';
import assert from 'node:assert/strict';
import {syncMetadata,validateSyncPlan,requireSyncCapacity} from '../web-app/js/smart-sync.js';
import {CompanionBLE} from '../web-app/js/ble.js';
const asset={id:'a'.repeat(32),name:'同步測試',kind:'image',frames:[new Uint8Array(1024)],fps:1};
const plan=(works,skip=false,fields={})=>({ok:true,device_id:'test',fits:true,items:works.map(w=>({id:w.id,skip})),needed_bytes:skip?0:works.reduce((s,w)=>s+w.length,0),free_bytes:1572864,reserve_bytes:65536,new_works:skip?0:works.length,existing_works:3,max_works:32,...fields});
function client(){const b=new CompanionBLE();b.device={gatt:{connected:true}};b.authorized=true;b.info={device_id:'test',capabilities:['media','smart_sync']};return b;}
test('fingerprints bind the complete encoded OLA bytes and change with a single pixel',async()=>{
 const first=await syncMetadata(asset),second=await syncMetadata({...asset,frames:[Uint8Array.from(asset.frames[0],(_,i)=>i===0?1:0)]});
 assert.match(first.sha256,/^[a-f0-9]{64}$/);assert.notEqual(first.sha256,second.sha256);assert.equal(first.length,1045);
});
test('sync plans reject wrong devices, missing works and fabricated capacity',async()=>{
 const works=[await syncMetadata(asset)],valid=plan(works);assert.equal(validateSyncPlan(valid,works,'test'),valid);
 for(const invalid of [{...valid,device_id:'other'},{...valid,items:[]},{...valid,needed_bytes:0},{...valid,free_bytes:0}])assert.throws(()=>validateSyncPlan(invalid,works,'test'));
 assert.throws(()=>requireSyncCapacity({...valid,fits:false}),/空間不足/);
});
test('verified same content skips all data packets and upload commit',async()=>{
 const b=client(),calls=[];b.request=async(op,fields)=>{calls.push(op);if(op==='PLAN_SYNC')return plan(fields.works,true);if(op==='UPLOAD_BEGIN')return {ok:true,skip:true,verified:true};throw new Error('Unexpected '+op);};
 const progress=[];assert.deepEqual(await b.upload(asset,(...args)=>progress.push(args)),{skipped:true});
 assert.deepEqual(calls,['PLAN_SYNC','UPLOAD_BEGIN']);assert.equal(progress[0][0],1);assert.equal(b.busy,false);
});
test('insufficient capacity refuses an upload before it can begin or modify a file',async()=>{
 const b=client();b.request=async(op,fields)=>{assert.equal(op,'PLAN_SYNC');return plan(fields.works,false,{fits:false,free_bytes:100});};
 await assert.rejects(b.upload(asset),/空間不足/);assert.equal(b.busy,false);
});
test('planning batches bounded UTF8 requests and totals capacity across all batches',async()=>{
 const b=client(),calls=[];const assets=Array.from({length:32},(_,i)=>({...asset,id:(i+1).toString(16).padStart(32,'0'),name:'😀'.repeat(60)}));
 b.request=async(op,fields)=>{assert.equal(op,'PLAN_SYNC');const bytes=new TextEncoder().encode(JSON.stringify({op,works:fields.works})).length;assert.ok(bytes<=12000);calls.push(fields.works.length);return plan(fields.works,false,{new_works:0});};
 const value=await b.planSync(assets);assert.ok(calls.length>1);assert.equal(value.items.length,32);assert.equal(value.needed_bytes,32*1045);
});
