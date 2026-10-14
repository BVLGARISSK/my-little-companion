// USB data-host detection is independent of VBUS and battery charging.
export function usbHostLabel(info){
  if(!info)return '—';
  if(typeof info.usb_host_connected!=='boolean')return '需要更新韌體';
  return info.usb_host_connected?'USB 資料連線中':'未連接 USB 主機';
}
export function chargingLabel(info){
  if(!info)return '—';
  // Use only explicit charger telemetry. Never infer it from voltage or USB.
  if(info.charging_state==='charging')return '正在充電';
  if(info.charging_state==='not_charging')return '未在充電';
  return '目前無法讀取';
}
export function powerSaveLabel(info){
  if(!info)return '—';
  if(typeof info.power_save_enabled!=='boolean')return '需要 C5 0.6.0 以上韌體';
  return info.power_save_enabled?'自動省電已啟用':'進階省電已停用';
}
export function powerDetails(value){
  if(!value||typeof value.power_save_enabled!=='boolean')return '連線並授權後可讀取省電狀態。';
  const pieces=[];
  if(Number.isFinite(value.cpu_mhz))pieces.push(`回報時 CPU ${value.cpu_mhz} MHz`);
  if(Number.isInteger(value.light_sleep_count)&&value.light_sleep_count>=0)pieces.push(`淺眠 ${value.light_sleep_count} 次`);
  if(Number.isInteger(value.deep_wake_count)&&value.deep_wake_count>=0)pieces.push(`深眠喚醒 ${value.deep_wake_count} 次`);
  if(value.motion_interrupt_verified===true)pieces.push('移動中斷已確認');
  else if(value.motion_interrupt_verified===false)pieces.push('移動中斷尚未確認，先使用定時淺眠');
  return pieces.length?pieces.join(' · '):'裝置尚未提供詳細省電資訊。';
}
