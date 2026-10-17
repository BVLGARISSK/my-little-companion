#pragma once
#include <stdint.h>
namespace power {
constexpr uint32_t DIM_MS=15000, DEEP_MS=600000;
enum Action { AWAKE, LIGHT, DEEP };
struct Inputs {
  bool enabled, displayOff, keepAwake, usb, radioOn, uploading, resetting, sensorReady, interruptVerified;
  uint32_t stillMs;
};
constexpr Action action(const Inputs& v,uint32_t deepMs=DEEP_MS) {
  return !v.enabled || !v.displayOff || v.keepAwake || v.usb || v.radioOn || v.uploading || v.resetting || !v.sensorReady
    ? AWAKE : deepMs && v.stillMs>=deepMs && v.interruptVerified ? DEEP : LIGHT;
}
constexpr unsigned cpuMHz(bool enabled,bool usb,bool connected,bool busy) { return !enabled||usb||connected||busy?160:80; }
constexpr bool dim(bool enabled,bool keepAwake,bool usb,uint32_t stillMs,uint32_t dimMs=DIM_MS) { return dimMs&&enabled&&!keepAwake&&!usb&&stillMs>=dimMs; }
static_assert(action({true,true,false,false,false,false,false,true,false,DEEP_MS})==LIGHT,"Unverified INT must keep timer polling");
static_assert(action({true,true,false,false,false,false,false,true,true,DEEP_MS})==DEEP,"Verified motion input permits deep sleep");
static_assert(action({true,true,false,true,false,false,false,true,true,DEEP_MS})==AWAKE,"USB debugging remains awake");
static_assert(action({true,true,true,false,false,false,false,true,true,DEEP_MS})==AWAKE,"Always-on captions remain awake");
static_assert(action({true,true,false,false,true,false,false,true,true,DEEP_MS})==AWAKE,"Radio window cannot be interrupted");
static_assert(cpuMHz(true,false,false,false)==80&&cpuMHz(true,false,true,false)==160,"Transfer and idle CPU clocks");
}
