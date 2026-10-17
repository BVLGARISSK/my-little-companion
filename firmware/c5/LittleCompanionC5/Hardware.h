#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include <atomic>
#include "MotionReaction.h"
#include "TouchGestures.h"

class Hardware {
public:
  enum Action { NONE, NEXT_EMOTION, NEXT_WORK, PREVIOUS_WORK, REOPEN_BLE, TOGGLE_LOCK };
  void begin();
  void update(bool uploading, bool displaySleeping);
  void activity();
  bool shouldSleep() const;
  void sleepDelay(uint32_t ms) { sleepAfter=ms; }
  float gravity(unsigned axis) const { return axis<3?acceleration[axis]:0; }
  bool poseReady() const { return ready&&seeded; }
  bool touchActive() const { return touching; }
  uint32_t batterySequence() const { return batterySamples; }
  bool batterySampling() const { return batteryPending; }
  uint32_t shakeEvents() const { return reaction.count(); }
  uint32_t motionEvents() const { return motions; }
  bool motionMonitor(bool enable);
  bool sensorReady() const { return ready; }
  bool interruptVerified() const { return irqVerified; }
  bool monitorActive() const { return lowPower; }
  uint32_t stillMs() const { return millis()-lastActivity; }
  void restoreStillness(uint32_t duration) { if(ready) sample();lastActivity=millis()-duration; }
  void restoreInterruptVerified(bool value) { irqVerified=value; }
  void wakeTouch(bool fromDeep=false);
  bool consumeInterrupt();
  Action action();
  void diagnostics(JsonDocument& d) const;
  uint32_t batteryVoltageMv() const { return batteryMv.load(std::memory_order_relaxed); }
  bool usbHostIsConnected() const { return usbHostConnected.load(std::memory_order_relaxed); }
  float shakeLevel() const { return reaction.level(millis()); }
  float shakeX() const { return reaction.x(); }
  float shakeY() const { return reaction.y(); }
private:
  bool ready = false, seeded = false, touchRaw = false, touching = false;
  bool longSent = false, wakeOnlyTouch = false;
  bool lowPower=false, irqVerified=false, wakeTouchPending=false;
  uint32_t irqEvents=0;
  uint8_t address = 0, who = 0;
  uint8_t powerRegister1=0,powerRegister2=0;
  uint32_t lastActivity = 0, lastSample = 0, lastProbe = 0, touchChanged = 0, pressedAt = 0;
  uint32_t lastBattery = 0, samples = 0, errors = 0, motions = 0, touches = 0;
  std::atomic<uint32_t> batteryMv{0};
  std::atomic<bool> usbHostConnected{false};
  bool usbCandidate = false;
  uint32_t lastUsbCheck = 0, usbChanged = 0;
  float acceleration[3] = {}, reference[3] = {};
  MotionReaction reaction;
  Action pending = NONE;
  uint32_t sleepAfter=60000,batterySamples=0;
  bool batteryPending=false;
  uint8_t batteryCount=0;
  uint32_t batterySum=0,batteryEnabledAt=0,batteryStepMaxUs=0;
  gestures::Touch gesture;
  bool write(uint8_t reg, uint8_t value);
  bool read(uint8_t reg, uint8_t* bytes, uint8_t length);
  void probe();
  void sample();
  void battery();
  void batteryStep();
  bool configureMotion(bool monitor);
};
