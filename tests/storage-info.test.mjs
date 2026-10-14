import test from 'node:test';
import assert from 'node:assert/strict';
import {storageUsage} from '../web-app/js/storage-info.js';

test('device filesystem capacity separates used and remaining bytes',()=>{
  const value=storageUsage({storage_total:1572864,storage_free:1179648});
  assert.deepEqual(value,{total:1572864,free:1179648,used:393216,usedPercent:25});
  assert.equal(storageUsage({storage_total:1572864,storage_free:0}).usedPercent,100);
  assert.equal(storageUsage({storage_total:1572864,storage_free:1572864}).usedPercent,0);
});

test('missing or invalid capacity never becomes a fabricated empty or full device',()=>{
  for(const value of [null,{}, {storage_free:12}, {storage_total:1024},
    {storage_total:0,storage_free:0}, {storage_total:1024,storage_free:1025},
    {storage_total:1024,storage_free:-1}, {storage_total:1024,storage_free:'512'},
    {storage_total:1024,storage_free:NaN}, {storage_total:1024,storage_free:1.5},
    {storage_total:Infinity,storage_free:0}, {storage_total:2**53,storage_free:0}])assert.equal(storageUsage(value),null);
});
