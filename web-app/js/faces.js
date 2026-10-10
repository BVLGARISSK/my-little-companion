import {packPixels} from './media.js';
export const EMOTIONS=[
  {id:'neutral',name:'平常',caption:'小伴靜靜地陪著你',shape:'<path d="M6 7v11M26 7v11m-13 1h6"/>'},
  {id:'happy',name:'開心',caption:'小伴現在很開心',shape:'<path d="M4 15q5-12 10 0m5 0q5-12 10 0M14 19q3 3 6 0"/>'},
  {id:'sad',name:'難過',caption:'小伴想要一個抱抱',shape:'<path d="m4 9 9 3m7 0 9-3M7 15v3m18-3v3m-11 4q3-4 6 0"/>'},
  {id:'surprised',name:'驚訝',caption:'小伴發現了一點驚喜',shape:'<ellipse cx="7" cy="12" rx="3" ry="6"/><ellipse cx="25" cy="12" rx="3" ry="6"/><circle cx="16" cy="21" r="2"/>'},
  {id:'sleepy',name:'想睡',caption:'小伴正在慢慢放鬆',shape:'<path d="M4 14h9m7 0h9M14 21h5"/>'},
  {id:'angry',name:'生氣',caption:'小伴有一點小脾氣',shape:'<path d="m4 8 9 4m7 0 9-4M7 15v3m18-3v3m-11 4h5"/>'}
];
export function emotionFrame(id,time=0,still=false){
  const p=new Uint8Array(8192);const blink=!still&&(time%4200>3900),look=still?0:Math.round(Math.sin(time/2100)*3);
  const rect=(x,y,w,h,r=0)=>{for(let yy=Math.max(0,Math.floor(y));yy<Math.min(64,y+h);yy++)for(let xx=Math.max(0,Math.floor(x));xx<Math.min(128,x+w);xx++){
    const dx=Math.max(x+r-xx,0,xx-(x+w-1-r)),dy=Math.max(y+r-yy,0,yy-(y+h-1-r));if(!r||dx*dx+dy*dy<=r*r)p[yy*128+xx]=1;
  }};
  let h=22,w=17,y=19;if(id==='surprised'){h=29;w=20;y=15;}if(id==='sleepy'){h=7;y=28;}if(id==='sad'){h=17;y=25;}
  if(blink){h=3;y=31;}
  const eye=(x)=>{
    if(id==='happy'&&!blink){for(let a=-11;a<=11;a++)rect(x+a,23+Math.round(a*a/23),4,6,1);}
    else rect(x-w/2,y,w,h,Math.min(6,h/2));
  };eye(40+look);eye(88+look);
  if(id==='angry'&&!blink){for(let x=29;x<52;x++)for(let yy=17;yy<22+(x-29)/3;yy++)p[yy*128+x+look]=0;for(let x=77;x<100;x++)for(let yy=17;yy<22+(100-x)/3;yy++)p[yy*128+x+look]=0;}
  if(id==='happy'){for(let a=-8;a<=8;a++)rect(64+a+look,50-Math.round(a*a/24),2,3,1);}
  else if(id==='sad'){for(let a=-7;a<=7;a++)rect(64+a+look,48+Math.round(a*a/24),2,3,1);}
  else if(id==='surprised')rect(59+look,47,10,10,4);
  else rect(58+look,51,12,id==='sleepy'?2:3,1);
  return packPixels(p);
}
