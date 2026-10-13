import test from 'node:test';
import assert from 'node:assert/strict';
import {readPairing,pairingKeyForDevice,pairingAuthorizationForDevice,rememberVerifiedPairing,watchPairingLinks} from '../web-app/js/pairing.js';

const key='0123456789abcdef'.repeat(4),base='https://example.test/companion/';
test('QR credentials survive a sanitized address for browser handoff',()=>{
  const pairing=readPairing(base+'#device=mlc-s3-test&key='+key);
  const visible=new URL(base); // history.replaceState uses only pathname/search.
  assert.equal(readPairing(visible.href),null);
  assert.deepEqual(readPairing(pairing.url),pairing);
  assert.equal(new URL(pairing.url).hash,'#device=mlc-s3-test&key='+key);
});
test('plain control links and query keys do not authorize a device',()=>{
  for(const url of [base,base+'?key='+key,base+'#key=abc',base+'#key='+key+'0',base+'#key='+'g'.repeat(64)])assert.equal(readPairing(url),null);
});
test('legacy key-only cards remain usable and extra fragment fields are removed',()=>{
  const pairing=readPairing(base+'#key='+key.toUpperCase()+'&other=discard');
  assert.equal(pairing.device,null);assert.equal(pairing.key,key.toUpperCase());
  assert.equal(pairing.url,base+'#key='+key.toUpperCase());
});
test('a new QR replaces the remembered pre-reset key for the same device',()=>{
  const oldKey='f'.repeat(64),device='mlc-s3-test';
  assert.equal(pairingKeyForDevice(key,device,device,oldKey),key);
  assert.equal(pairingKeyForDevice(null,null,device,oldKey),oldKey);
});
test('a QR for another companion cannot replace this device authorization',()=>{
  const saved='f'.repeat(64);
  assert.equal(pairingKeyForDevice(key,'mlc-s3-other','mlc-s3-test',saved),saved);
  assert.equal(pairingKeyForDevice(key,'mlc-s3-other','mlc-s3-test',null),'');
});

function fakeWindow(href){
  const win=new EventTarget();win.location=new URL(href);
  win.history={replaceState:(_state,_title,url)=>{win.location=new URL(url,win.location);}};
  win.navigate=href=>{win.location=new URL(href,win.location);win.dispatchEvent(new Event('hashchange'));};
  return win;
}
test('a QR pasted into an existing tab is read without a page reload',()=>{
  const win=fakeWindow(base),cards=[];watchPairingLinks(win,card=>cards.push(card));
  assert.equal(cards.length,0);
  win.navigate(base+'#device=mlc-s3-test&key='+key);
  assert.equal(cards.length,1);assert.equal(cards[0].key,key);assert.equal(win.location.hash,'');
  assert.equal(pairingKeyForDevice(cards[0].key,cards[0].device,'mlc-s3-test','f'.repeat(64)),key);
});
test('new card replaces an earlier card on the same tab and each URL is sanitized',()=>{
  const win=fakeWindow(base+'#device=mlc-s3-test&key='+key),cards=[];
  watchPairingLinks(win,card=>cards.push(card));assert.equal(cards.length,1);assert.equal(win.location.hash,'');
  const newer='a'.repeat(64);win.navigate(base+'#device=mlc-s3-test&key='+newer);
  assert.deepEqual(cards.map(card=>card.key),[key,newer]);assert.equal(win.location.hash,'');
  assert.equal(readPairing(cards[1].url).key,newer);
});
test('ordinary anchors do not discard a pending QR and listeners can be removed',()=>{
  const win=fakeWindow(base+'#key='+key),cards=[];
  const stop=watchPairingLinks(win,card=>cards.push(card));
  win.navigate(base+'#device');assert.equal(cards.length,1);
  stop();win.navigate(base+'#key='+'b'.repeat(64));assert.equal(cards.length,1);
});

test('a first C5 scan automatically enables remembering without a previously saved key',()=>{
  assert.deepEqual(pairingAuthorizationForDevice(key,'mlc-c5-test','mlc-c5-test',null),{key,remember:true});
  assert.deepEqual(pairingAuthorizationForDevice(null,null,'mlc-c5-test',key),{key,remember:true});
});
test('a new card replaces an old remembered key and another device card stays isolated',()=>{
  const old='f'.repeat(64);
  assert.deepEqual(pairingAuthorizationForDevice(key,'mlc-c5-test','mlc-c5-test',old),{key,remember:true});
  assert.deepEqual(pairingAuthorizationForDevice(key,'mlc-c5-other','mlc-c5-test',old),{key:old,remember:true});
  assert.deepEqual(pairingAuthorizationForDevice(key,'mlc-c5-other','mlc-c5-test',null),{key:'',remember:false});
});
function memory(){const values=new Map();return{values,async put(k,v){values.set(k,v);}};}
function connection(device='mlc-c5-test'){return{connected:true,authorized:true,info:{device_id:device},connectionEpoch:3};}
test('a verified QR is remembered under the actual device and can be reused on a plain control URL',async()=>{
  const store=memory(),session=connection();
  assert.equal(await rememberVerifiedPairing(store,session,key),true);
  assert.equal(readPairing(base),null);
  assert.equal(pairingAuthorizationForDevice(null,null,session.info.device_id,store.values.get('key:'+session.info.device_id)).key,key);
});
test('failed or missing authorization cannot replace an existing remembered key',async()=>{
  const store=memory(),session=connection(),old='f'.repeat(64);store.values.set('key:mlc-c5-test',old);
  session.authorized=false;await assert.rejects(rememberVerifiedPairing(store,session,key));
  session.authorized=true;session.connected=false;await assert.rejects(rememberVerifiedPairing(store,session,key));
  session.connected=true;await assert.rejects(rememberVerifiedPairing(store,session,'bad'));
  assert.equal(store.values.get('key:mlc-c5-test'),old);
});
test('remembering multiple companions keeps their credentials separate and opt-out clears only the current one',async()=>{
  const store=memory(),other='b'.repeat(64);
  await rememberVerifiedPairing(store,connection(),key);
  await rememberVerifiedPairing(store,connection('mlc-c5-other'),other);
  assert.equal(await rememberVerifiedPairing(store,connection(),key,false),false);
  assert.equal(store.values.get('key:mlc-c5-test'),null);
  assert.equal(store.values.get('key:mlc-c5-other'),other);
});
test('storage failure is propagated without claiming the code was remembered',async()=>{
  await assert.rejects(rememberVerifiedPairing({async put(){throw new Error('quota');}},connection(),key),/quota/);
});
