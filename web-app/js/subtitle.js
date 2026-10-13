import {FRAME_BYTES} from './media.js';
import {emotionFrame} from './faces.js';
import {validateSubtitle,scrollOrigin,subtitlePixel} from './subtitle-format.js';
export const DEFAULT_SUBTITLE={text:'你好，小伴！',font_px:16,font_family:'sans',bold:true,
  writing:'horizontal',align:'center',face:false,keep_awake:false,motion:'fixed',direction:'forward',speed:30,emotion:'happy'};
const families={sans:'"PingFang TC","Microsoft JhengHei",sans-serif',
  serif:'"Songti TC","PMingLiU",serif',mono:'"SFMono-Regular",Consolas,"Microsoft JhengHei",monospace'};
const graphemes=text=>globalThis.Intl?.Segmenter
  ?Array.from(new Intl.Segmenter('zh-Hant',{granularity:'grapheme'}).segment(text),v=>v.segment):Array.from(text);
function font(c){return `${c.bold?'700':'400'} ${c.font_px}px ${families[c.font_family]}`;}
function wrap(text,measure,width){
  const lines=[];
  for(const paragraph of text.split('\n')){
    let line='';
    for(const char of graphemes(paragraph)){
      if(measure(line+char)>width&&line){lines.push(line);line=char;}else line+=char;
    }
    lines.push(line);
  }
  return lines;
}
export function rasterizeSubtitle(options,makeCanvas=()=>document.createElement('canvas')){
  const c={...DEFAULT_SUBTITLE,...options},text=String(c.text).replace(/\r\n?/g,'\n').replace(/\t/g,'　');
  if(!text.trim()||Array.from(text).length>160)throw new Error('請輸入 1～160 個文字或符號。');
  const viewport=c.face?c.font_px+4:64,lineHeight=c.font_px+4,pad=2;
  const canvas=makeCanvas(),ctx=canvas.getContext('2d',{willReadFrequently:true});
  ctx.font=font(c);const measure=t=>Math.ceil(ctx.measureText(t).width);
  let width=128,height=viewport,lines,chars,rows,columns;
  if(c.writing==='horizontal'){
    lines=c.motion==='horizontal'?[text.replaceAll('\n','　')]:wrap(text,measure,124);
    if(c.motion==='horizontal')width=Math.max(1,measure(lines[0])+pad*2);
    if(c.motion==='vertical')height=Math.max(1,lines.length*lineHeight+pad*2);
    if(c.motion==='fixed'&&lines.length*lineHeight>viewport)throw new Error('固定字幕放不下，請縮小字體、縮短文字或改用捲動。');
  }else{
    chars=graphemes(text.replaceAll('\n','　'));
    rows=c.motion==='vertical'?chars.length:Math.max(1,Math.floor((viewport-pad*2)/lineHeight));
    columns=Math.ceil(chars.length/rows);
    if(c.motion==='horizontal')width=columns*lineHeight+pad*2;
    if(c.motion==='vertical')height=rows*lineHeight+pad*2;
    if(c.motion==='fixed'&&columns*lineHeight>124)throw new Error('直排字幕放不下，請縮小字體或改用水平跑馬燈。');
  }
  const config={...c,version:1,text,width,height,viewport_h:viewport};
  if(width>4096||height>2048)throw new Error('字幕太長，請縮小字體或分成幾個字幕作品。');
  const count=Math.ceil(width/128)*Math.ceil(height/64);validateSubtitle(config,count);
  canvas.width=width;canvas.height=height;ctx.font=font(c);ctx.fillStyle='#fff';ctx.textBaseline='top';
  const aligned=space=>c.align==='left'?pad:c.align==='right'?Math.max(pad,space-pad):Math.max(pad,Math.floor(space/2));
  if(c.writing==='horizontal'){
    const top=c.motion==='vertical'?pad:Math.floor((height-lines.length*lineHeight)/2);
    lines.forEach((line,i)=>ctx.fillText(line,aligned(width-measure(line)),top+i*lineHeight));
  }else{
    const blockWidth=columns*lineHeight,start=aligned(width-blockWidth);
    chars.forEach((char,i)=>{
      const column=Math.floor(i/rows),row=i%rows;
      const glyph=char.replaceAll('\uFE0F','\uFE0E');
      ctx.fillText(glyph,start+(columns-1-column)*lineHeight+(lineHeight-measure(glyph))/2,pad+row*lineHeight);
    });
  }
  const rgba=ctx.getImageData(0,0,width,height).data;
  const frames=Array.from({length:count},()=>new Uint8Array(FRAME_BYTES));
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*4;
    // Low luminance threshold keeps coloured symbols while preserving dark details.
    if(rgba[i+3]<96||.2126*rgba[i]+.7152*rgba[i+1]+.0722*rgba[i+2]<24)continue;
    const tile=Math.floor(y/64)*Math.ceil(width/128)+Math.floor(x/128);
    frames[tile][(y%64)*16+Math.floor((x%128)/8)]|=1<<(x%8);
  }
  return {kind:'subtitle',frames,fps:count===1?1:5,subtitle:config};
}
export function subtitleFrame(asset,elapsed=0,faceTime=elapsed,repeat=true){
  const c=asset.subtitle,out=new Uint8Array(FRAME_BYTES),top=64-c.viewport_h;
  const set=(x,y)=>{out[y*16+(x>>3)]|=1<<(x&7);};
  if(c.face){
    const face=emotionFrame(c.emotion,faceTime),w=top*2,left=Math.floor((128-w)/2);
    for(let y=0;y<top;y++)for(let x=0;x<w;x++){
      const sx=Math.floor(x*128/w),sy=Math.floor(y*64/top);
      if((face[sy*16+(sx>>3)]>>(sx&7))&1)set(left+x,y);
    }
  }
  const dx=c.motion==='horizontal'?scrollOrigin(c.width,128,c.speed,elapsed,c.direction==='reverse',repeat):0;
  const dy=c.motion==='vertical'?scrollOrigin(c.height,c.viewport_h,c.speed,elapsed,c.direction==='reverse',repeat):0;
  for(let y=0;y<c.viewport_h;y++)for(let x=0;x<128;x++)
    if(subtitlePixel(asset.frames,c.width,c.height,x-dx,y-dy))set(x,top+y);
  return out;
}
export function subtitleThumbnail(asset){
  const c=asset.subtitle,viewport=c.motion==='vertical'?c.viewport_h:128;
  return subtitleFrame(asset,c.motion==='fixed'?0:viewport*1000/c.speed);
}
