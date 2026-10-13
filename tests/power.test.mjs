import test from 'node:test';
import assert from 'node:assert/strict';
import {usbHostLabel,chargingLabel} from '../web-app/js/power.js';
test('USB labels distinguish data hosts from missing telemetry',()=>{
  assert.equal(usbHostLabel(null),'—');
  assert.equal(usbHostLabel({}),'需要更新韌體');
  assert.equal(usbHostLabel({usb_host_connected:true}),'USB 資料連線中');
  assert.equal(usbHostLabel({usb_host_connected:false}),'未連接 USB 主機');
  assert.equal(usbHostLabel({usb_host_connected:'false'}),'需要更新韌體');
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
