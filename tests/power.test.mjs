import test from 'node:test';
import assert from 'node:assert/strict';
import {usbHostLabel,chargingLabel,powerSaveLabel,powerDetails} from '../web-app/js/power.js';
test('USB labels distinguish data hosts from missing telemetry',()=>{
  assert.equal(usbHostLabel(null),'—');
  assert.equal(usbHostLabel({}),'需要更新韌體');
  assert.equal(usbHostLabel({usb_host_connected:true}),'USB 資料連線中');
  assert.equal(usbHostLabel({usb_host_connected:false}),'未連接 USB 主機');
  assert.equal(usbHostLabel({usb_host_connected:'false'}),'需要更新韌體');
});
test('power controls use explicit telemetry and keep old firmware distinguishable',()=>{
  assert.equal(powerSaveLabel(null),'—');assert.match(powerSaveLabel({}),/需要 C5/);
  for(const power_save_enabled of [null,1,'false'])assert.match(powerSaveLabel({power_save_enabled}),/需要 C5/);
  assert.equal(powerSaveLabel({power_save_enabled:false}),'進階省電已停用');
  assert.equal(powerSaveLabel({power_save_enabled:true}),'自動省電已啟用');
});
test('power details report observed sleep counters without inventing measurements',()=>{
  assert.match(powerDetails(null),/授權/);
  const value={power_save_enabled:true,cpu_mhz:80,light_sleep_count:12,deep_wake_count:1,motion_interrupt_verified:false};
  assert.match(powerDetails(value),/CPU 80 MHz/);assert.match(powerDetails(value),/淺眠 12 次/);
  assert.match(powerDetails(value),/深眠喚醒 1 次/);assert.match(powerDetails(value),/定時淺眠/);
  assert.match(powerDetails({...value,motion_interrupt_verified:true}),/移動中斷已確認/);
  assert.doesNotMatch(powerDetails({...value,cpu_mhz:NaN,light_sleep_count:-1,deep_wake_count:'99'}),/NaN|99|淺眠 -1/);
});
test('charge state is never guessed from USB, full voltage or percent',()=>{
  assert.equal(chargingLabel(null),'—');
  for(const host of [true,false])for(const mv of [3300,4200])
    assert.equal(chargingLabel({usb_host_connected:host,battery_mv:mv,battery_percent:100}),'目前無法讀取');
  for(const charging_state of ['unknown','unsupported',undefined,true,false,'constructor','__proto__','toString'])
    assert.equal(chargingLabel({charging_state}),'目前無法讀取');
  assert.equal(chargingLabel({charging_state:'charging',usb_host_connected:true}),'正在充電');
  assert.equal(chargingLabel({charging_state:'not_charging',usb_host_connected:true}),'未在充電');
});
