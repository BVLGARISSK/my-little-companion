#include "Hardware.h"
#include "Config.h"
#include <Wire.h>
#include <math.h>
#include <driver/usb_serial_jtag.h>

bool Hardware::write(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(address); Wire.write(reg); Wire.write(value);
  if (Wire.endTransmission() == 0) return true;
  ++errors; return false;
}
bool Hardware::read(uint8_t reg, uint8_t* bytes, uint8_t length) {
  Wire.beginTransmission(address); Wire.write(reg);
  if (Wire.endTransmission(false) != 0) { ++errors; return false; }
  if (Wire.requestFrom(address, length) != length) {
    while (Wire.available()) Wire.read();
    ++errors; return false;
  }
  for (uint8_t i = 0; i < length; ++i) bytes[i] = Wire.read();
  return true;
}
void Hardware::begin() {
  pinMode(config::MOTION_INT_PIN, INPUT_PULLDOWN);
  pinMode(config::TOUCH_PIN, INPUT_PULLDOWN);
  pinMode(config::BATTERY_ENABLE_PIN, OUTPUT);
  digitalWrite(config::BATTERY_ENABLE_PIN, LOW);
  analogReadResolution(12);
  analogSetPinAttenuation(config::BATTERY_PIN, ADC_11db);
  lastActivity = millis();
  probe(); battery();
  usbCandidate = usb_serial_jtag_is_connected();
  usbHostConnected.store(usbCandidate, std::memory_order_relaxed);
  lastUsbCheck = usbChanged = millis();
}
void Hardware::probe() {
  lastProbe = millis(); ready = false; seeded = false; reaction.reset();
  // Wire is shared with the OLED and is initialized by Display.
  for (uint8_t a : {uint8_t(0x68), uint8_t(0x69)}) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() != 0) continue;
    address = a;
    if (!read(0x75, &who, 1) || who != 0x68) continue;
    // Accelerometer only: the continuous gyroscope is unnecessary for stillness.
    if (!write(0x6b, 0x80)) continue;
    delay(100);
    lowPower=false; irqVerified=false;
    ready = configureMotion(false);
    if (ready) {
      Serial.printf("MPU6050 ready: address=0x%02x INT=GPIO%u, accelerometer-only.\n",
                    address, config::MOTION_INT_PIN);
      activity(); return;
    }
  }
  address = 0;
  Serial.println("MPU6050 not detected. Automatic display sleep disabled; touch remains available.");
}
bool Hardware::configureMotion(bool monitor) {
  // InvenSense LPA flow: reset HPF, accumulate baseline, hold HPF, then CYCLE.
  // INT is active-high, push-pull and latched until INT_STATUS is read.
  if (!write(0x38,0) || !write(0x6b,0x08) || !write(0x6c,0x07) ||
      !write(0x1c,0) || !write(0x1a,monitor?0:3) || !write(0x19,9) ||
      !write(0x37,0x20) || !write(0x1f,2) || !write(0x20,1)) return false;
  delay(5);
  if (!write(0x1c,7) || !write(0x6c,monitor?0x87:0x07) ||
      !write(0x6b,monitor?0x28:0x08)) return false; // 20 Hz cycle, gyro standby, temperature off.
  uint8_t status=0;
  uint8_t powerRegisters[2]={};
  if(!read(0x3a,&status,1) || !write(0x38,0x40) || !read(0x6b,powerRegisters,2)) return false;
  powerRegister1=powerRegisters[0];powerRegister2=powerRegisters[1];
  return powerRegister1==(monitor?0x28:0x08) && powerRegister2==(monitor?0x87:0x07);
}
bool Hardware::motionMonitor(bool enable) {
  if (!ready) return false;
  if (lowPower==enable) return true;
  if (!configureMotion(enable)) { ready=false; lowPower=false; seeded=false; activity(); return false; }
  lowPower=enable; reaction.reset(); lastSample=millis();
  return true;
}
bool Hardware::consumeInterrupt() {
  if (!ready) return false;
  bool high=digitalRead(config::MOTION_INT_PIN)==HIGH; uint8_t status=0;
  if (!read(0x3a,&status,1)) { ready=false; seeded=false; activity(); return false; }
  if (high && (status&0x40)) { if(lowPower) irqVerified=true; ++irqEvents; activity(); return true; }
  return false;
}
void Hardware::sample() {
  uint8_t bytes[6], interruptStatus = 0;
  bool high=digitalRead(config::MOTION_INT_PIN)==HIGH;
  if (!read(0x3b, bytes, 6) || !read(0x3a, &interruptStatus, 1)) {
    ready = false; seeded = false; reaction.reset(); activity(); return;
  }
  ++samples;
  if (high && (interruptStatus&0x40)) { ++irqEvents; if(lowPower) { irqVerified=true;activity(); } }
  float difference = 0;
  for (unsigned i = 0; i < 3; ++i) {
    int16_t raw = int16_t(uint16_t(bytes[i * 2]) << 8 | bytes[i * 2 + 1]);
    acceleration[i] = float(raw) / 16384.f;
    if (!seeded) reference[i] = acceleration[i];
    difference += fabsf(acceleration[i] - reference[i]);
  }
  // Compare to a slow moving reference, so gradual tilting also counts as movement.
  if (seeded && difference > 0.075f) { activity(); ++motions; }
  if (seeded && !lowPower) reaction.sample(acceleration[0] - reference[0], acceleration[1] - reference[1],
                              acceleration[2] - reference[2], millis());
  for (unsigned i = 0; i < 3; ++i)
    reference[i] += 0.08f * (acceleration[i] - reference[i]);
  seeded = true;
}
void Hardware::battery() {
  digitalWrite(config::BATTERY_ENABLE_PIN, HIGH); delay(2);
  uint32_t sum = 0;
  for (unsigned i = 0; i < 16; ++i) sum += analogReadMilliVolts(config::BATTERY_PIN);
  digitalWrite(config::BATTERY_ENABLE_PIN, LOW);
  batteryMv = sum * 2 / 16; // Seeed's on-board 100K / 100K divider.
  ++batterySamples;
  lastBattery = millis();
}
void Hardware::batteryStep() {
  uint32_t now=millis();
  if(!batteryPending){
    if(now-lastBattery<30000)return;
    digitalWrite(config::BATTERY_ENABLE_PIN,HIGH);
    batteryPending=true;batteryCount=0;batterySum=0;batteryEnabledAt=now;return;
  }
  if(now-batteryEnabledAt<2)return;
  uint32_t started=micros();batterySum+=analogReadMilliVolts(config::BATTERY_PIN);
  batteryStepMaxUs=max(batteryStepMaxUs,uint32_t(micros()-started));
  if(++batteryCount<16)return;
  digitalWrite(config::BATTERY_ENABLE_PIN,LOW);
  batteryMv=batterySum*2/16;++batterySamples;lastBattery=millis();batteryPending=false;
}
void Hardware::activity() { lastActivity = millis(); }
void Hardware::wakeTouch(bool fromDeep) {
  wakeTouchPending=true;
  if(fromDeep && digitalRead(config::TOUCH_PIN)==HIGH) {
    // Count startup time toward the wake gesture; do not require another full hold after boot.
    touchRaw=touching=true;pressedAt=0;touchChanged=millis();longSent=false;
    wakeOnlyTouch=true;wakeTouchPending=false;++touches;activity();
    gesture.press(0,true);
  }
}
bool Hardware::shouldSleep() const {
  return sleepAfter&&ready && seeded && !touching && millis() - lastActivity >= sleepAfter;
}
Hardware::Action Hardware::action() { Action result = pending; pending = NONE; return result; }
void Hardware::update(bool uploading, bool displaySleeping) {
  uint32_t now = millis();
  // SOF reports a USB data host, not VBUS power or battery charging.
  // Ignore brief link glitches; keep GPIO/ADC work out of the BLE callback.
  if (now - lastUsbCheck >= 250) {
    lastUsbCheck = now;
    bool host = usb_serial_jtag_is_connected();
    if (host != usbCandidate) { usbCandidate = host; usbChanged = now; }
    if (now - usbChanged >= 500) usbHostConnected.store(host, std::memory_order_relaxed);
  }
  if (uploading) activity();
  bool value = digitalRead(config::TOUCH_PIN) == HIGH;
  if (value != touchRaw) { touchRaw = value; touchChanged = now; }
  if (now - touchChanged >= 40 && touching != touchRaw) {
    touching = touchRaw;
    if (touching) {
      pressedAt = now; longSent = false; wakeOnlyTouch = displaySleeping || wakeTouchPending; wakeTouchPending=false;
      ++touches; activity();
      gesture.press(now,wakeOnlyTouch);
    } else {
      gesture.release(now);
      activity();
    }
  }
  if (touching) {
    activity();
  }
  switch(gesture.tick(now)) {
    case gestures::SINGLE:pending=NEXT_EMOTION;break;
    case gestures::DOUBLE:pending=NEXT_WORK;break;
    case gestures::TRIPLE:pending=PREVIOUS_WORK;break;
    case gestures::RADIO:pending=REOPEN_BLE;break;
    case gestures::LOCK:pending=TOGGLE_LOCK;break;
    default:break;
  }
  if (!ready && now - lastProbe >= 5000) probe();
  if (ready && (now-lastSample >= (lowPower?250u:50u) || (lowPower&&digitalRead(config::MOTION_INT_PIN)==HIGH))) { lastSample=now; sample(); }
  batteryStep();
}
void Hardware::diagnostics(JsonDocument& d) const {
  d["mpu_ready"] = ready; d["mpu_address"] = address; d["mpu_whoami"] = who;
  d["mpu_samples"] = samples; d["mpu_i2c_errors"] = errors;
  d["motion_events"] = motions; d["motion_int_pin"] = config::MOTION_INT_PIN;
  d["shake_events"] = reaction.count(); d["shake_level"] = shakeLevel();
  d["shake_threshold_g"] = MotionReaction::TRIGGER_G; d["shake_required_peaks"] = MotionReaction::REQUIRED_PEAKS;
  d["mpu_low_power"] = lowPower; d["motion_interrupt_verified"] = irqVerified; d["motion_interrupt_events"] = irqEvents;
  d["mpu_power_register1"]=powerRegister1;d["mpu_power_register2"]=powerRegister2;
  d["motion_int_level"] = digitalRead(config::MOTION_INT_PIN);
  d["stillness_ms"] = sleepAfter;
  d["still_ms"] = millis() - lastActivity;
  d["touch_pin"] = config::TOUCH_PIN; d["touch_active"] = touching;
  d["touch_raw"] = digitalRead(config::TOUCH_PIN); d["touch_events"] = touches;
  JsonArray a = d["acceleration_g"].to<JsonArray>();
  for (float value : acceleration) a.add(value);
  d["battery_voltage_mv"] = batteryVoltageMv();
  d["battery_samples"]=batterySamples;d["battery_pending"]=batteryPending;
  d["battery_step_max_us"]=batteryStepMaxUs;
  d["usb_host_connected"] = usbHostIsConnected();
  d["charging_state"] = "unknown";
  d["cpu_mhz"] = getCpuFrequencyMhz();
}
