// Coarse reference for a conventional 3.7 V, 4.2 V-full single LiPo cell.
// This is a UI estimate, not a calibrated fuel gauge or a discharge cutoff.
// Load, charging, temperature and cell chemistry can change the result.
const REFERENCE=[[3300,0],[3500,5],[3600,10],[3700,20],[3750,35],
  [3800,50],[3850,60],[3900,70],[3950,80],[4000,85],[4100,95],[4200,100]];
export function estimateBatteryPercent(mv){
  if(!Number.isFinite(mv)||mv<2000||mv>4500)return null;
  if(mv<=REFERENCE[0][0])return 0;
  for(let i=1;i<REFERENCE.length;i++){
    const [upper,percent]=REFERENCE[i],[lower,previous]=REFERENCE[i-1];
    if(mv<=upper)return Math.round((previous+(percent-previous)*(mv-lower)/(upper-lower))/5)*5;
  }
  return 100;
}
export function batteryLabel(info){
  const mv=info?.battery_mv;
  if(!Number.isFinite(mv)||mv<2000||mv>4500)return '—';
  const reported=info.battery_percent;
  const percent=Number.isFinite(reported)&&reported>=0&&reported<=100
    ? Math.round(reported) : info.battery_type==='lipo_1s'?estimateBatteryPercent(mv):null;
  return `${(mv/1000).toFixed(2)} V${percent===null?'':` · 約 ${percent}%`}`;
}
