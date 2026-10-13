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
