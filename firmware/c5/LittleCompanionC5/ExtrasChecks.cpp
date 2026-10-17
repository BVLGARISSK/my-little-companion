#include "TouchGestures.h"
#include "ExtrasPolicy.h"
#include "PowerPolicy.h"
namespace {
constexpr bool allCyclesFinish(){for(unsigned cycles=1;cycles<=8;++cycles){extras::TimerState t;t.start(0,true,60,60,60,60,cycles);if(!t.advance(10000000)||t.active||!t.finished||t.round!=cycles)return false;}return true;}
constexpr bool wrapGesture(){gestures::Touch t;t.press(UINT32_MAX-1000);return t.tick(998)==gestures::NONE&&t.tick(999)==gestures::RADIO;}
constexpr bool USBGuard(){extras::VoltageState v;v.sample(2800,true,false,3400,3200,3550);if(!v.critical)return false;v.sample(2800,true,true,3400,3200,3550);return !v.critical&&!v.low;}
static_assert(allCyclesFinish()&&wrapGesture()&&USBGuard(),"Late timer wake, tick rollover and USB critical-voltage recovery");
static_assert(power::action({true,true,false,false,false,false,false,true,true,900000},0)==power::LIGHT,"Custom deep sleep disabled");
static_assert(!power::dim(true,false,false,900000,0),"Custom display dim disabled");
}
