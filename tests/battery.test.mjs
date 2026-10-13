import test from 'node:test';
import assert from 'node:assert/strict';
import {batteryLabel,estimateBatteryPercent} from '../web-app/js/battery.js';

test('single-cell voltage display clearly labels a coarse estimate',()=>{
  assert.equal(batteryLabel({battery_mv:3900,battery_type:'lipo_1s'}),'3.90 V · 約 70%');
  assert.equal(batteryLabel({battery_mv:4200,battery_type:'lipo_1s'}),'4.20 V · 約 100%');
  assert.equal(batteryLabel({battery_mv:3100,battery_type:'lipo_1s'}),'3.10 V · 約 0%');
  for(let mv=2000,previous=-1;mv<=4500;mv++){
    const percent=estimateBatteryPercent(mv);
    assert.ok(percent>=previous&&percent<=100&&percent%5===0);previous=percent;
  }
});
test('unknown chemistry and older firmware never invent battery percentages',()=>{
  assert.equal(batteryLabel({battery_mv:3800}),'3.80 V');
  assert.equal(batteryLabel({battery_mv:3800,battery_type:'unknown'}),'3.80 V');
  for(const mv of [undefined,null,'3900',NaN,Infinity,0,-1,1000,5000]){
    assert.equal(batteryLabel({battery_mv:mv,battery_type:'lipo_1s'}),'—');
    assert.equal(estimateBatteryPercent(mv),null);
  }
  assert.equal(batteryLabel(null),'—');assert.equal(batteryLabel({firmware:'0.3.5-s3'}),'—');
});
test('valid device-reported percentages take precedence; invalid ones fall back safely',()=>{
  assert.equal(batteryLabel({battery_mv:3800,battery_percent:73.2}),'3.80 V · 約 73%');
  assert.equal(batteryLabel({battery_mv:3800,battery_percent:110}),'3.80 V');
  assert.equal(batteryLabel({battery_mv:3800,battery_type:'lipo_1s',battery_percent:-1}),'3.80 V · 約 50%');
});
