import {parseGIF,decompressFrame} from '../vendor/gifuct.js';
import {sampleImage,decodeOLA} from './media.js';
const pause=()=>new Promise(resolve=>setTimeout(resolve,0));
function seek(video,time){return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{clean();reject(new Error('手機無法解碼這一格影片，試試 H.264 MP4。'));},12000);
  const done=()=>{clean();resolve();},bad=()=>{clean();reject(new Error('影片解碼失敗'));},clean=()=>{clearTimeout(timer);video.removeEventListener('seeked',done);video.removeEventListener('error',bad);};
  if(Math.abs(video.currentTime-time)<.001&&video.readyState>=2){clean();return resolve();}
  video.addEventListener('seeked',done,{once:true});video.addEventListener('error',bad,{once:true});video.currentTime=time;
});}
export class MediaConverter{
  constructor(video){this.video=video;this.generation=0;}
  clear(){this.generation++;if(this.url)URL.revokeObjectURL(this.url);this.url=null;this.gif=null;this.ola=null;this.file=null;this.video.pause();this.video.removeAttribute('src');this.video.load();}
  async load(file){
    this.clear();this.file=file;
    if(file.size>40*1024*1024)throw new Error('請選 40MB 以下的短影片或 GIF。');
    if(file.name.toLowerCase().endsWith('.ola')){this.ola=decodeOLA(new Uint8Array(await file.arrayBuffer()));return{duration:this.ola.frames.length/this.ola.fps,kind:'ola'};}
    if(file.type==='image/gif'||file.name.toLowerCase().endsWith('.gif')){
      this.gif=parseGIF(await file.arrayBuffer());
      const width=this.gif.lsd.width,height=this.gif.lsd.height;
      if(width*height>4*1024*1024||!width||!height)throw new Error('GIF 畫面太大，請先縮小到 2048 × 2048 以下。');
      this.gifFrames=this.gif.frames.filter(f=>f.image);
      if(!this.gifFrames.length)throw new Error('GIF 沒有可讀取的影格');
      if(this.gifFrames.length>2000)throw new Error('GIF 影格太多，請先裁成短片。');
      this.delays=this.gifFrames.map(f=>Math.max(20,(f.gce?.delay||10)*10));
      this.duration=this.delays.reduce((a,b)=>a+b,0)/1000;return{duration:this.duration,kind:'gif'};
    }
    this.url=URL.createObjectURL(file);this.video.src=this.url;
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{clean();reject(new Error('影片載入逾時，請試試 H.264 MP4。'));},15000);
      const clean=()=>{clearTimeout(timer);this.video.removeEventListener('loadeddata',done);this.video.removeEventListener('error',bad);};
      const done=()=>{clean();resolve();},bad=()=>{clean();reject(new Error('手機不支援這段影片，請改用 H.264 MP4。'));};
      this.video.addEventListener('loadeddata',done,{once:true});this.video.addEventListener('error',bad,{once:true});this.video.load();
    });
    if(!Number.isFinite(this.video.duration)||this.video.duration<=0)throw new Error('無法讀取影片長度');
    this.duration=this.video.duration;return{duration:this.duration,kind:'video'};
  }
  async convert({start=0,duration=5,fps=8,...options},progress=()=>{}){
    const generation=this.generation;
    if(this.ola)return this.ola;
    if(![5,8,10].includes(fps)||!Number.isFinite(start)||!Number.isFinite(duration)||start<0||start>=this.duration||duration<=0)throw new Error('請確認開始秒數與長度。');
    duration=Math.min(duration,10,this.duration-start);const count=Math.min(100,Math.max(1,Math.ceil(duration*fps))),frames=[];
    if(this.gif){
      const canvas=document.createElement('canvas');canvas.width=this.gif.lsd.width;canvas.height=this.gif.lsd.height;
      const ctx=canvas.getContext('2d',{willReadFrequently:true}),patchCanvas=document.createElement('canvas');
      let clock=0,sample=0,previous=null,restore=null;
      for(let i=0;i<this.gifFrames.length&&sample<count;i++){
        if(generation!==this.generation)throw new Error('已選擇另一個檔案');
        if(previous?.disposalType===2){const d=previous.dims;ctx.clearRect(d.left,d.top,d.width,d.height);}else if(previous?.disposalType===3&&restore)ctx.putImageData(restore,0,0);
        const frame=decompressFrame(this.gifFrames[i],this.gif.gct,true);
        restore=frame.disposalType===3?ctx.getImageData(0,0,canvas.width,canvas.height):null;
        patchCanvas.width=frame.dims.width;patchCanvas.height=frame.dims.height;
        patchCanvas.getContext('2d').putImageData(new ImageData(frame.patch,frame.dims.width,frame.dims.height),0,0);
        ctx.drawImage(patchCanvas,frame.dims.left,frame.dims.top);
        const end=clock+this.delays[i]/1000;
        while(sample<count&&start+sample/fps<end){frames.push(sampleImage(canvas,options));sample++;progress(sample/count);}
        clock=end;previous=frame;await pause();
      }
    }else{
      this.video.pause();
      for(let i=0;i<count;i++){
        if(generation!==this.generation)throw new Error('已選擇另一個檔案');
        await seek(this.video,Math.min(this.duration-.001,start+i/fps));frames.push(sampleImage(this.video,options));progress((i+1)/count);await pause();
      }
    }
    if(!frames.length)throw new Error('沒有可轉換的影格');return{frames,fps};
  }
}
