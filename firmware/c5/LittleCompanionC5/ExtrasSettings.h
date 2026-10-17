#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include <math.h>
namespace extras {
constexpr const char* events[]={"single","double","triple","pickup","tilt_left","tilt_right","flip","shake"};
constexpr unsigned EVENT_COUNT=8;
struct Rule { String type="default",id; };
struct Settings {
  bool tilt=true,greeting=true,autoRotate=true,lockOnBoot=false,calibrated=false,lowBattery=true,interruptMedia=false;
  uint8_t axisX=0,axisY=2;int8_t signX=1,signY=1;
  float sensitivity=.45f,neutral[3]={0,1,0};
  uint8_t brightness=160,dimLevel=64;
  uint32_t dimS=15,offS=60,deepS=600;
  uint16_t warnMv=3400,sleepMv=3200,resumeMv=3550;int16_t batteryOffset=0;
  Rule rules[EVENT_COUNT];
  bool read(JsonVariantConst value,String& why);
  void write(JsonObject value) const;
};
inline bool mood(const String& s){return s=="neutral"||s=="happy"||s=="sad"||s=="surprised"||s=="sleepy"||s=="angry";}
}
