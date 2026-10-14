const moods=['neutral','happy','sad','surprised','sleepy','angry'];
export function subtitleRuntime(value,frameCount){
  const c=value||{};
  const integer=(v,lo,hi)=>Number.isInteger(v)&&v>=lo&&v<=hi;
  if(c.version!==1||!integer(c.width,1,4096)||!integer(c.height,1,2048)||typeof c.face!=='boolean'||typeof (c.keep_awake??false)!=='boolean'||
    !integer(c.viewport_h,8,64)||(c.face?c.viewport_h>36:c.viewport_h!==64)||
    !['fixed','horizontal','vertical'].includes(c.motion)||!['forward','reverse'].includes(c.direction)||
    !integer(c.speed,1,120)||!moods.includes(c.emotion))throw new Error('字幕設定格式錯誤');
  if(c.motion==='fixed'&&(c.width>128||c.height>c.viewport_h)||
    c.motion==='horizontal'&&c.height>c.viewport_h||c.motion==='vertical'&&c.width>128)
    throw new Error('字幕尺寸與播放方式不符');
  const count=Math.ceil(c.width/128)*Math.ceil(c.height/64);
  if(count>32||frameCount!==undefined&&count!==frameCount)throw new Error('字幕圖塊數量不符');
  return {version:1,width:c.width,height:c.height,viewport_h:c.viewport_h,face:c.face,keep_awake:c.keep_awake??false,
    motion:c.motion,direction:c.direction,speed:c.speed,emotion:c.emotion};
}
export function validateSubtitle(value,count){
  const runtime=subtitleRuntime(value,count);
  if(typeof value.text!=='string'||!value.text.trim()||Array.from(value.text).length>160||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value.text)||
    !Number.isInteger(value.font_px)||value.font_px<8||value.font_px>32||
    !['sans','serif','mono'].includes(value.font_family)||typeof value.bold!=='boolean'||
    !['horizontal','vertical'].includes(value.writing)||!['left','center','right'].includes(value.align)||
    !Number.isInteger(value.offset_x??0)||Math.abs(value.offset_x??0)>127||
    !Number.isInteger(value.offset_y??0)||Math.abs(value.offset_y??0)>63||
    ![1,2].includes(value.position_version??1))
    throw new Error('字幕文字或字型設定錯誤');
  return {...runtime,text:value.text,font_px:value.font_px,font_family:value.font_family,
    bold:value.bold,writing:value.writing,align:value.align,offset_x:value.offset_x??0,offset_y:value.offset_y??0,position_version:value.position_version??1};
}
export function scrollOrigin(size,viewport,speed,elapsed,reverse=false,repeat=true){
  const travel=Math.floor(Math.max(0,elapsed)*speed/1000),span=size+viewport+16;
  const offset=repeat?travel%span:Math.min(travel,span-1);
  return reverse?-size+offset:viewport-offset;
}
export function subtitlePixel(frames,width,height,x,y){
  if(x<0||y<0||x>=width||y>=height)return 0;
  const tile=Math.floor(y/64)*Math.ceil(width/128)+Math.floor(x/128);
  const byte=frames[tile][(y%64)*16+Math.floor((x%128)/8)];
  return (byte>>(x%8))&1;
}
