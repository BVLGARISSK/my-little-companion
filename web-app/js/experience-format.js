export const EVENTS=[['single','單擊'],['double','雙擊'],['triple','三擊'],['pickup','拿起'],['tilt_left','向左傾斜'],['tilt_right','向右傾斜'],['flip','倒拿翻轉'],['shake','來回搖晃']];
export function supportsDino(info){const m=/^(\d+)\.(\d+)\.(\d+)-c5$/.exec(info?.firmware||'');return !!m&&(Number(m[1])>0||Number(m[2])>7||Number(m[2])===7&&Number(m[3])>=8);}
export const DEFAULT_SETTINGS={version:1,tilt_enabled:true,greeting_enabled:true,auto_rotate:true,lock_on_boot:false,calibrated:false,low_battery_enabled:true,interrupt_media:false,
 axis_x:0,axis_y:2,sign_x:1,sign_y:1,sensitivity:.45,neutral:[0,1,0],brightness:160,dim_level:64,dim_s:15,off_s:60,deep_s:600,
 warn_mv:3400,sleep_mv:3200,resume_mv:3550,battery_offset_mv:0,rules:EVENTS.map(([event])=>({event,type:'default',id:''}))};
export const PRESETS={daily:{brightness:160,dim_level:64,dim_s:15,off_s:60,deep_s:600},display:{brightness:160,dim_level:64,dim_s:0,off_s:0,deep_s:0},longlife:{brightness:90,dim_level:24,dim_s:5,off_s:20,deep_s:180}};
const moods=['neutral','happy','sad','surprised','sleepy','angry'];
export function validateSettings(value){
 const d=structuredClone(value),bad=s=>{throw new Error(s);},integer=(k,lo,hi)=>{if(!Number.isInteger(d[k])||d[k]<lo||d[k]>hi)bad('設定超出範圍：'+k);};
 if(d?.version!==1)bad('互動設定版本無效。');
 for(const k of ['tilt_enabled','greeting_enabled','auto_rotate','lock_on_boot','calibrated','low_battery_enabled','interrupt_media'])if(typeof d[k]!=='boolean')bad('互動開關無效。');
 integer('axis_x',0,2);integer('axis_y',0,2);if(d.axis_x===d.axis_y)bad('左右與上下要使用不同感測軸。');
 for(const k of ['sign_x','sign_y'])if(![1,-1].includes(d[k]))bad('方向設定無效。');
 if(!Number.isFinite(d.sensitivity)||d.sensitivity<.1||d.sensitivity>1)bad('傾斜靈敏度需為 0.1～1。');
 if(!Array.isArray(d.neutral)||d.neutral.length!==3||d.neutral.some(n=>!Number.isFinite(n)||Math.abs(n)>1.5))bad('姿勢校正資料無效。');
 const norm=d.neutral.reduce((s,n)=>s+n*n,0);if(d.calibrated&&(norm<.49||norm>1.69))bad('請保持吊飾不動，再做正向校正。');
 integer('brightness',1,255);integer('dim_level',1,255);integer('dim_s',0,3600);integer('off_s',0,3600);integer('deep_s',0,86400);
 if(d.off_s&&d.off_s<5||d.dim_s&&d.off_s&&d.dim_s>=d.off_s||d.deep_s&&(!d.off_s||d.deep_s<d.off_s+30))bad('調暗需早於關屏；深眠至少在關屏 30 秒後。填 0 可停用該項。');
 integer('sleep_mv',2800,3500);integer('warn_mv',d.sleep_mv+100,3800);integer('resume_mv',d.warn_mv+50,4200);integer('battery_offset_mv',-300,300);
 if(!Array.isArray(d.rules)||d.rules.length!==EVENTS.length)bad('需要八種互動規則。');
 d.rules.forEach((r,i)=>{
  if(r?.event!==EVENTS[i][0]||!['default','none','emotion','media','next','previous'].includes(r.type)||typeof r.id!=='string')bad('互動規則無效。');
  if(r.type==='emotion'&&!moods.includes(r.id)||r.type==='media'&&!/^[a-f0-9]{32}$/.test(r.id)||!['emotion','media'].includes(r.type)&&r.id!=='')bad('互動作品或表情無效。');
 });return d;
}
export function timerFields({mode='countdown',minutes=5,focus=25,rest=5,longRest=15,rounds=4}={}){
 const d={action:'start',mode,duration_s:Math.round(Number(minutes)*60),focus_s:Math.round(Number(focus)*60),break_s:Math.round(Number(rest)*60),long_break_s:Math.round(Number(longRest)*60),rounds:Number(rounds)};
 if(mode==='pomodoro')d.duration_s=d.focus_s;
 if(!['duration_s','focus_s','break_s','long_break_s','rounds'].every(k=>Number.isInteger(d[k]))||!['countdown','pomodoro'].includes(mode)||!Number.isInteger(d.duration_s)||d.duration_s<1||d.duration_s>86400||d.focus_s<60||d.focus_s>7200||d.break_s<60||d.break_s>3600||d.long_break_s<60||d.long_break_s>7200||!Number.isInteger(d.rounds)||d.rounds<1||d.rounds>8)throw new Error('請檢查計時長度與番茄鐘輪數。');return d;
}
export function runtimeLabel(value){
 if(!value)return '連線並授權後，讀取吊飾目前狀態。';
 const t=value.timer,tools=['原播放','時鐘','計時器','骰子','迷宮','躲障礙','小恐龍'];
 return `${value.touch_locked?'觸摸已鎖定':'觸摸可操作'} · ${tools[value.tool]||'未知模式'}${t?.active?` · ${t.paused?'暫停':'剩餘'} ${t.remaining_s} 秒`:t?.finished?' · 計時完成':''}${value.critical_battery?' · 低電壓休眠':value.low_battery?' · 低電量提醒':''}`;
}
export function validateRuntime(value){
 const bool=['touch_locked','calibration_needed','settings_recovered','upside_down','low_battery','critical_battery','clock_valid'];
 const t=value?.timer,integer=(v,lo,hi)=>Number.isSafeInteger(v)&&v>=lo&&v<=hi;
 if(!value||bool.some(k=>typeof value[k]!=='boolean')||!integer(value.tool,0,6)||!integer(value.events_fired,0,4294967295)||!integer(value.epoch_ms,0,4102444800000)||!integer(value.offset_min,-720,840)||['tilt_x','tilt_y'].some(k=>!Number.isFinite(value[k])||Math.abs(value[k])>1)||!t||['active','paused','finished','pomodoro'].some(k=>typeof t[k]!=='boolean')||!integer(t.phase,0,2)||!integer(t.round,1,8)||!integer(t.rounds,1,8)||t.round>t.rounds||!integer(t.remaining_s,0,86400)||t.paused&&!t.active||t.finished&&t.active)throw new Error('吊飾玩法狀態無效，請重新讀取。');
 return structuredClone(value);
}
