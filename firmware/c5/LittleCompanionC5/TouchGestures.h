#pragma once
#include <stdint.h>
namespace gestures {
enum Event : uint8_t { NONE=0, SINGLE=1, DOUBLE=2, TRIPLE=3, RADIO=4, LOCK=5 };
struct Touch {
  uint32_t pressed=0,released=0;
  uint8_t taps=0;
  bool down=false,wakeOnly=false,radioSent=false,lockSent=false;
  constexpr void press(uint32_t now,bool wake=false) { down=true;pressed=now;wakeOnly=wake;radioSent=lockSent=false; }
  constexpr void release(uint32_t now) {
    down=false;released=now;
    if(!radioSent&&!wakeOnly) { if(taps<3)++taps; } else taps=0;
  }
  constexpr Event tick(uint32_t now) {
    if(down) {
      if(!radioSent&&uint32_t(now-pressed)>=2000) {radioSent=true;taps=0;return RADIO;}
      if(!lockSent&&uint32_t(now-pressed)>=4000) {lockSent=true;return LOCK;}
    } else if(taps&&uint32_t(now-released)>=380) {auto e=Event(taps);taps=0;return e;}
    return NONE;
  }
};
constexpr bool checkTap(unsigned count) {
  Touch t;for(unsigned i=0;i<count;++i){t.press(i*180);t.release(i*180+70);}
  return t.tick((count-1)*180+449)==NONE&&t.tick((count-1)*180+450)==Event(count);
}
constexpr bool checkHolds() {
  Touch t;t.press(0);return t.tick(1999)==NONE&&t.tick(2000)==RADIO&&t.tick(3999)==NONE&&t.tick(4000)==LOCK&&t.tick(5000)==NONE;
}
constexpr bool checkWake() {Touch t;t.press(0,true);t.release(100);return t.tick(1000)==NONE;}
static_assert(checkTap(1)&&checkTap(2)&&checkTap(3),"Tap aggregation and boundaries");
static_assert(checkHolds()&&checkWake(),"Universal holds and wake-only exclusion");
}
