#include "PowerPolicy.h"
namespace {
constexpr bool blockedStatesNeverSleep() {
  for(unsigned mask=0;mask<256;++mask) {
    power::Inputs v{bool(mask&1),bool(mask&2),bool(mask&4),bool(mask&8),bool(mask&16),bool(mask&32),bool(mask&64),bool(mask&128),true,power::DEEP_MS};
    bool blocked=!(mask&1)||!(mask&2)||(mask&4)||(mask&8)||(mask&16)||(mask&32)||(mask&64)||!(mask&128);
    if(blocked && power::action(v)!=power::AWAKE) return false;
  }
  return true;
}
static_assert(blockedStatesNeverSleep(),"All USB/radio/upload/reset/sensor/display guard combinations must stay awake");
static_assert(power::action({true,true,false,false,false,false,false,true,true,power::DEEP_MS-1})==power::LIGHT,"No early deep sleep");
static_assert(!power::dim(true,true,false,60000),"Always-on subtitle is not dimmed");
static_assert(!power::dim(true,false,true,60000),"USB debug screen is not dimmed");
static_assert(!power::dim(true,false,false,power::DIM_MS-1)&&power::dim(true,false,false,power::DIM_MS),"Dim timeout boundary");
}
