import test from 'node:test';
import assert from 'node:assert/strict';
import {fillBackground,imagePlacement,monochrome} from '../web-app/js/media.js';

test('black padding stays dark around an inverted square video',()=>{
  const rgba=new Uint8ClampedArray(128*64*4);
  for(let i=3;i<rgba.length;i+=4)rgba[i]=255;
  const pixels=fillBackground(monochrome(rgba,{invert:true}),imagePlacement(320,320,{zoom:.5}),'black');
  assert.equal(pixels[0],0);assert.equal(pixels[31],0);assert.equal(pixels[32],1);
  assert.equal(pixels[95],1);assert.equal(pixels[96],0);
  assert.equal(pixels.reduce((sum,v)=>sum+v,0),64*64);
});
test('white padding is independent of the image threshold and inversion',()=>{
  const pixels=fillBackground(new Uint8Array(128*64),imagePlacement(320,160,{zoom:.5}),'white');
  assert.equal(pixels[0],1);assert.equal(pixels[16*128+32],0);
  assert.equal(pixels.reduce((sum,v)=>sum+v,0),128*64-64*32);
});
test('shifted or magnified images only fill pixels outside their actual bounds',()=>{
  const shifted=fillBackground(new Uint8Array(8192).fill(1),imagePlacement(320,320,{zoom:.5,cropX:1}),'black');
  assert.equal(shifted[63],0);assert.equal(shifted[64],1);assert.equal(shifted[127],1);
  const magnified=new Uint8Array(8192).fill(1);
  assert.deepEqual(fillBackground(magnified,imagePlacement(320,320,{zoom:2}),'black'),new Uint8Array(8192).fill(1));
  assert.throws(()=>fillBackground(new Uint8Array(8192),imagePlacement(320,320),'invalid'),/背景設定/);
});
