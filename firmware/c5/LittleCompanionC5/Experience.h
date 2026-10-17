#pragma once
#include "ExtrasSettings.h"
#include "ExtrasPolicy.h"
#include "Display.h"
#include "Hardware.h"
#include <Preferences.h>
class Experience {
public:
  Experience(Storage& data,Display& display,Hardware& sensors):store(data),screen(display),hardware(sensors){}
  extras::Settings settings;
  void begin(Preferences& preferences);
  bool save(JsonVariantConst value,String& why);
  bool calibrate(String& why);
  bool lock(bool value,String& why);
  bool setBrightness(uint8_t value,String& why);
  void forgetTool() {prefs->putUChar("tool",0);}
  bool references(const String& id) const;
  bool command(const String& op,JsonVariantConst request,String& why);
  void snapshot(JsonDocument& d) const;
  void update(bool busy);
  void touch(Hardware::Action action,bool busy);
  bool critical() const {return voltage.critical;}
  bool lowBattery() const {return voltage.low;}
  uint64_t nextWakeUs() const;
  uint32_t offMs() const {return settings.offS*1000;}
  bool touchLocked() const {return locked;}
  struct Checkpoint {extras::TimerState timer;Display::ToolState tool;bool low=false,critical=false;};
  Checkpoint checkpoint() const {return {timer,screen.toolCheckpoint(),voltage.low,voltage.critical};}
  void restore(const Checkpoint& value);
private:
  Storage& store;Display& screen;Hardware& hardware;Preferences* prefs=nullptr;
  extras::TimerState timer;extras::VoltageState voltage;
  bool locked=false,poseSeeded=false,previousSleep=false,upside=false,candidate=false;
  bool settingsRecovered=false;float gravity[3]={},neutral[3]={};float tiltX=0,tiltY=0;
  int16_t offsetMinutes=480;uint32_t batterySeen=0,shakeSeen=0,rotationSince=0,lastTrigger=0,triggerCount=0;
  int tiltSide=0;
  uint32_t motionSeen=0,previousStill=0,lastGreeting=0;
  static int64_t clockMs();static bool timeValid();
  void apply();void trigger(unsigned event,bool motion);
  void persistPlayback();
};
