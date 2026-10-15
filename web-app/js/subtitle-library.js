import {validateSubtitle} from './subtitle-format.js';

function sameSubtitle(a,b){
  if(a.kind!=='subtitle'||b.kind!=='subtitle'||a.name!==b.name||a.fps!==b.fps||a.frames.length!==b.frames.length)return false;
  if(JSON.stringify(validateSubtitle(a.subtitle,a.frames.length))!==JSON.stringify(validateSubtitle(b.subtitle,b.frames.length)))return false;
  return a.frames.every((frame,i)=>frame.length===b.frames[i].length&&frame.every((byte,j)=>byte===b.frames[i][j]));
}

// Match content, never just the default name: face captions and plain text are distinct.
export function saveSubtitleAsset(assets,candidate,{editingId=null,copy=false,newId,now=Date.now(),limit=500}={}){
  validateSubtitle(candidate.subtitle,candidate.frames.length);
  const index=copy?-1:assets.findIndex(asset=>asset.id===editingId&&asset.kind==='subtitle');
  if(index<0&&!copy){
    const existing=assets.find(asset=>sameSubtitle(asset,candidate));
    if(existing)return{asset:existing,action:'reused'};
  }
  if(index<0&&assets.length>=limit)throw new Error('作品集已滿，請先備份並整理。');
  let name=candidate.name;
  if(copy&&assets.some(asset=>asset.name===name)){
    const original=name;let number=2;
    do{const suffix=`（${number++}）`;name=original.slice(0,60-suffix.length)+suffix;}while(assets.some(asset=>asset.name===name));
  }
  const previous=index<0?null:assets[index];
  const asset={...candidate,id:previous?.id||newId(),name,created:previous?.created??now,
    frames:candidate.frames.map(frame=>frame.slice()),subtitle:{...candidate.subtitle},...(previous?{updated:now}:{})};
  if(previous)assets[index]=asset;else assets.push(asset);
  return{asset,action:previous?'updated':'created'};
}
