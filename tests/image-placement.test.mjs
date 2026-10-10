import test from 'node:test';
import assert from 'node:assert/strict';
import {imagePlacement} from '../web-app/js/media.js';

test('default crop fills the OLED and centers a square source',()=>{
  assert.deepEqual(imagePlacement(320,320),{x:0,y:-32,width:128,height:128});
});
test('zooming out can fit a full portrait source with black margins',()=>{
  assert.deepEqual(imagePlacement(640,1280,{zoom:.25}),{x:48,y:0,width:32,height:64});
});
test('position controls reach either edge of a magnified crop',()=>{
  const left=imagePlacement(320,320,{zoom:2,cropX:0,cropY:0});
  const right=imagePlacement(320,320,{zoom:2,cropX:1,cropY:1});
  assert.deepEqual(left,{x:-0,y:-0,width:256,height:256});
  assert.deepEqual(right,{x:-128,y:-192,width:256,height:256});
});
test('invalid source dimensions or crop settings are refused',()=>{
  for(const [w,h,o] of [[0,100,{}],[100,NaN,{}],[100,100,{zoom:0}],[100,100,{cropX:2}],[100,100,{cropY:-1}]])assert.throws(()=>imagePlacement(w,h,o),/設定無效/);
});
