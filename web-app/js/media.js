import {validateSubtitle} from './subtitle-format.js?v=1.4.3';
export const WIDTH = 128, HEIGHT = 64, FRAME_BYTES = 1024, HEADER_BYTES = 21;

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function packPixels(pixels) {
  if (pixels.length !== WIDTH * HEIGHT) throw new Error('畫面必須是 128 × 64');
  const bytes = new Uint8Array(FRAME_BYTES);
  for (let i = 0; i < pixels.length; i++) if (pixels[i]) bytes[i >> 3] |= 1 << (i & 7);
  return bytes;
}

export function unpackPixels(bytes) {
  if (bytes.length !== FRAME_BYTES) throw new Error('影格資料長度錯誤');
  return Uint8Array.from({length: WIDTH * HEIGHT}, (_, i) => (bytes[i >> 3] >> (i & 7)) & 1);
}

export function encodeOLA(frames, fps = 8) {
  if (!frames.length || frames.length > 100 || (frames.length > 1 && ![5,8,10].includes(fps))) throw new Error('動畫需為 1～100 格，FPS 為 5、8 或 10');
  if (frames.some(f => f.length !== FRAME_BYTES)) throw new Error('影格大小錯誤');
  const payload = new Uint8Array(frames.length * FRAME_BYTES);
  frames.forEach((frame, i) => payload.set(frame, i * FRAME_BYTES));
  const out = new Uint8Array(HEADER_BYTES + payload.length), view = new DataView(out.buffer);
  out.set([79,76,65,49,1]);
  view.setUint16(5, WIDTH, true); view.setUint16(7, HEIGHT, true);
  view.setUint16(9, frames.length, true); out[11] = frames.length === 1 ? 1 : fps; out[12] = 0;
  view.setUint32(13, payload.length, true); view.setUint32(17, crc32(payload), true);
  out.set(payload, HEADER_BYTES); return out;
}

export function decodeOLA(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < HEADER_BYTES || String.fromCharCode(...bytes.slice(0,4)) !== 'OLA1' || bytes[4] !== 1) throw new Error('不支援的 OLA 格式');
  const count = view.getUint16(9,true), fps = bytes[11], length = view.getUint32(13,true);
  if (view.getUint16(5,true) !== WIDTH || view.getUint16(7,true) !== HEIGHT || bytes[12] !== 0 || count < 1 || count > 100 || (count > 1 && ![5,8,10].includes(fps)) || (count === 1 && fps !== 1) || length !== count * FRAME_BYTES || bytes.length !== HEADER_BYTES + length) throw new Error('OLA 標頭或大小錯誤');
  if (crc32(bytes.subarray(HEADER_BYTES)) !== view.getUint32(17,true)) throw new Error('OLA 資料損壞，校驗失敗');
  return {fps, frames: Array.from({length:count},(_,i) => bytes.slice(HEADER_BYTES+i*FRAME_BYTES,HEADER_BYTES+(i+1)*FRAME_BYTES))};
}

export function monochrome(rgba, {threshold=128, contrast=1, brightness=0, dither=false, invert=false} = {}) {
  if (rgba.length !== WIDTH * HEIGHT * 4) throw new Error('圖片大小錯誤');
  const gray = new Float32Array(WIDTH*HEIGHT), pixels = new Uint8Array(gray.length);
  for (let i=0;i<gray.length;i++) {
    const j=i*4, alpha=rgba[j+3]/255;
    const luminance=(.2126*rgba[j]+.7152*rgba[j+1]+.0722*rgba[j+2])*alpha;
    gray[i]=Math.max(0,Math.min(255,(luminance-128)*contrast+128+brightness));
  }
  for (let y=0;y<HEIGHT;y++) for (let x=0;x<WIDTH;x++) {
    const i=y*WIDTH+x, v=gray[i]>=threshold?255:0;
    pixels[i]=invert ? +(v===0) : +(v===255);
    if (dither) {
      const error=gray[i]-v;
      if(x+1<WIDTH)gray[i+1]+=error*7/16;
      if(y+1<HEIGHT){
        if(x>0)gray[i+WIDTH-1]+=error*3/16;
        gray[i+WIDTH]+=error*5/16;
        if(x+1<WIDTH)gray[i+WIDTH+1]+=error/16;
      }
    }
  }
  return pixels;
}

export function imagePlacement(width,height,{zoom=1,cropX=.5,cropY=.5}={}) {
  if(![width,height,zoom,cropX,cropY].every(Number.isFinite)||width<=0||height<=0||zoom<.1||zoom>3||cropX<0||cropX>1||cropY<0||cropY>1)throw new Error('縮放或位置設定無效');
  const scale=Math.max(WIDTH/width,HEIGHT/height)*zoom,w=width*scale,h=height*scale;
  return{x:(WIDTH-w)*cropX,y:(HEIGHT-h)*cropY,width:w,height:h};
}

export function fillBackground(pixels,placement,background='black') {
  if(pixels.length!==WIDTH*HEIGHT||!['black','white'].includes(background))throw new Error('背景設定無效');
  const value=background==='white'?1:0;
  for(let y=0;y<HEIGHT;y++)for(let x=0;x<WIDTH;x++){
    if(x+.5<placement.x||x+.5>=placement.x+placement.width||y+.5<placement.y||y+.5>=placement.y+placement.height)pixels[y*WIDTH+x]=value;
  }
  return pixels;
}

export function sampleImage(source, options = {}) {
  const canvas=document.createElement('canvas'); canvas.width=WIDTH; canvas.height=HEIGHT;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  const w=source.videoWidth||source.naturalWidth||source.width, h=source.videoHeight||source.naturalHeight||source.height;
  const placement=imagePlacement(w,h,options);
  ctx.fillStyle='#000';ctx.fillRect(0,0,WIDTH,HEIGHT);ctx.drawImage(source,placement.x,placement.y,placement.width,placement.height);
  const pixels=monochrome(ctx.getImageData(0,0,WIDTH,HEIGHT).data,options);
  return packPixels(fillBackground(pixels,placement,options.background));
}

export function drawFrame(canvas, bytes, {grid=false,onion=null} = {}) {
  const ctx=canvas.getContext('2d'), pixels=unpackPixels(bytes), scaleX=canvas.width/WIDTH,scaleY=canvas.height/HEIGHT;
  ctx.fillStyle='#242a27';ctx.fillRect(0,0,canvas.width,canvas.height);
  if(onion){ctx.fillStyle='#56685c';unpackPixels(onion).forEach((p,i)=>{if(p)ctx.fillRect((i%WIDTH)*scaleX,Math.floor(i/WIDTH)*scaleY,scaleX,scaleY);});}
  ctx.fillStyle='#e4f1d8';pixels.forEach((p,i)=>{if(p)ctx.fillRect((i%WIDTH)*scaleX,Math.floor(i/WIDTH)*scaleY,scaleX,scaleY);});
  if(grid){ctx.strokeStyle='rgba(255,255,255,.07)';ctx.lineWidth=.5;for(let x=0;x<=WIDTH;x+=4){ctx.beginPath();ctx.moveTo(x*scaleX,0);ctx.lineTo(x*scaleX,canvas.height);ctx.stroke();}for(let y=0;y<=HEIGHT;y+=4){ctx.beginPath();ctx.moveTo(0,y*scaleY);ctx.lineTo(canvas.width,y*scaleY);ctx.stroke();}}
}

export function scalePixels(pixels,width,height){
  const out=new Uint8Array(WIDTH*HEIGHT);
  for(let y=0;y<HEIGHT;y++)for(let x=0;x<WIDTH;x++)out[y*WIDTH+x]=pixels[Math.floor(y*height/HEIGHT)*width+Math.floor(x*width/WIDTH)];
  return packPixels(out);
}

export function validateAsset(asset) {
  if (!asset || !/^[a-f0-9]{32}$/.test(asset.id) || !['image','animation','subtitle'].includes(asset.kind) || typeof asset.name !== 'string' || asset.name.length>60 || !Array.isArray(asset.frames) || !asset.frames.length || asset.frames.length>100) throw new Error('作品資料格式錯誤');
  const frames=asset.frames.map(f=>{
    if(!Array.isArray(f)||f.length!==FRAME_BYTES||f.some(b=>!Number.isInteger(b)||b<0||b>255))throw new Error('影格資料格式錯誤');
    return Uint8Array.from(f);
  });
  if(asset.kind==='image' && frames.length!==1)throw new Error('圖片只能包含一格');
  if(asset.kind==='animation' && ![5,8,10].includes(asset.fps))throw new Error('動畫速度錯誤');
  if(asset.kind==='subtitle'){
    const subtitle=validateSubtitle(asset.subtitle,frames.length);
    if(asset.fps!==(frames.length===1?1:5))throw new Error('字幕圖塊格式錯誤');
    return {...asset,frames,subtitle};
  }
  return {...asset,frames,fps:asset.kind==='image'?1:asset.fps};
}
