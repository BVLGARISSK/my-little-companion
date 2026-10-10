import test from 'node:test';
import assert from 'node:assert/strict';
import {readPairing,pairingKeyForDevice} from '../web-app/js/pairing.js';

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
