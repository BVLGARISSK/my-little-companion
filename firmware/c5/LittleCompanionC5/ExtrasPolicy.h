#pragma once
#include <stdint.h>
namespace extras {
struct TimerState {
  bool active=false,paused=false,pomodoro=false,finished=false;
  uint8_t phase=0,round=1,rounds=4;
  uint32_t focusS=1500,breakS=300,longS=900,totalS=0,heldMs=0;
  int64_t deadline=0;
  constexpr void start(int64_t now,bool pomo,uint32_t seconds,uint32_t focus=1500,uint32_t rest=300,uint32_t longRest=900,uint8_t cycles=4){
    active=true;paused=false;finished=false;pomodoro=pomo;phase=0;round=1;rounds=cycles;focusS=focus;breakS=rest;longS=longRest;totalS=pomo?focus:seconds;deadline=now+int64_t(totalS)*1000;
  }
  constexpr uint32_t remainingMs(int64_t now) const {return !active?0:paused?heldMs:deadline<=now?0:uint32_t(deadline-now);}
  constexpr void pause(int64_t now){if(active&&!paused){heldMs=remainingMs(now);paused=true;}}
  constexpr void resume(int64_t now){if(active&&paused){deadline=now+heldMs;paused=false;}}
  constexpr void cancel(){active=false;paused=false;finished=false;heldMs=0;}
  constexpr void shift(int64_t delta){if(active&&!paused)deadline+=delta;}
  constexpr bool advance(int64_t now){
    bool changed=false;
    for(unsigned n=0;n<32&&active&&!paused&&now>=deadline;++n){changed=true;
      if(!pomodoro||phase==2){active=false;finished=true;break;}
      if(phase==0){phase=round>=rounds?2:1;totalS=phase==2?longS:breakS;}else{phase=0;++round;totalS=focusS;}
      deadline+=int64_t(totalS)*1000;
    }return changed;
  }
};
struct VoltageState {
  bool low=false,critical=false;uint8_t warnCount=0,sleepCount=0;
  constexpr void sample(int mv,bool enabled,bool usb,int warn,int sleep,int resume){
    if(!enabled||usb||mv>=resume){low=critical=false;warnCount=sleepCount=0;return;}
    if(mv<1000||mv>4500)return;
    if(mv<=warn){if(warnCount<2)++warnCount;if(warnCount>=2)low=true;}else warnCount=0;
    if(mv<=sleep){if(sleepCount<2)++sleepCount;if(sleepCount>=2||mv<=sleep-200){low=critical=true;}}else sleepCount=0;
  }
};
constexpr bool checkTimer(){
  TimerState t;t.start(0,false,10);if(t.remainingMs(9999)!=1||t.advance(9999))return false;
  t.pause(3000);t.resume(20000);if(t.remainingMs(20000)!=7000)return false;
  t.shift(100000);if(t.remainingMs(120000)!=7000)return false;
  if(!t.advance(127000)||t.active||!t.finished)return false;
  t.start(0,true,1,60,30,90,2);t.advance(60000);if(t.phase!=1||t.round!=1)return false;
  t.advance(90000);if(t.phase!=0||t.round!=2)return false;
  t.advance(150000);if(t.phase!=2)return false;t.advance(240000);return !t.active&&t.finished;
}
constexpr bool checkVoltage(){VoltageState v;v.sample(3390,true,false,3400,3200,3550);if(v.low)return false;v.sample(3390,true,false,3400,3200,3550);if(!v.low)return false;
  v.sample(3190,true,false,3400,3200,3550);if(v.critical)return false;v.sample(3190,true,false,3400,3200,3550);if(!v.critical)return false;
  v.sample(3450,true,false,3400,3200,3550);if(!v.critical)return false;v.sample(3550,true,false,3400,3200,3550);return !v.critical&&!v.low;}
static_assert(checkTimer(),"Countdown, pause, clock resync and all focus/break transitions");
static_assert(checkVoltage(),"Independent battery samples and voltage recovery hysteresis");
}
