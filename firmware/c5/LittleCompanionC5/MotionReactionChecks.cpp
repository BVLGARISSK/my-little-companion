#include "MotionReaction.h"

namespace {
constexpr bool pickupIsNotShaking() {
  MotionReaction r;
  for (uint32_t t=0;t<2000;t+=50) r.sample(.9f,0.f,0.f,t);
  return !r.active(2000) && r.count()==0;
}
constexpr bool lightReversalsAreIgnored() {
  MotionReaction axis,diagonal;
  for(uint32_t t=100;t<2500;t+=150){
    float sign=((t-100)/150)%2?-1.f:1.f;
    axis.sample(sign*.30f,0.f,0.f,t);
    diagonal.sample(sign*.2f,sign*.2f,sign*.2f,t);
  }
  return axis.count()==0 && diagonal.count()==0;
}
constexpr bool repeatedShakeAndRecovery() {
  MotionReaction r;
  for(unsigned i=0;i<3;++i)r.sample(i%2?-.45f:.45f,0.f,0.f,100+i*150);
  if(r.active(400))return false;
  r.sample(-.45f,0.f,0.f,550);
  if(!r.active(550)||r.count()!=1)return false;
  r.sample(.45f,0.f,0.f,700);
  return r.count()==1 && r.level(1800)>0.f && !r.active(2500);
}
constexpr bool anyAxisAndWrap() {
  for(unsigned axis=0;axis<4;++axis){
    MotionReaction r;uint32_t start=UINT32_MAX-350;
    for(unsigned i=0;i<4;++i){
      float sign=i%2?-1.f:1.f,a[3]={};
      if(axis<3)a[axis]=sign*.8f;else for(unsigned j=0;j<3;++j)a[j]=sign*.46f;
      r.sample(a[0],a[1],a[2],start+i*150);
    }
    if(!r.active(start+450)||r.count()!=1||r.active(start+2250))return false;
  }
  return true;
}
constexpr bool separatedPeaksDoNotAccumulate() {
  MotionReaction r;
  for(unsigned i=0;i<10;++i)r.sample(i%2?-.8f:.8f,0.f,0.f,i*800);
  return r.count()==0;
}
constexpr bool burstsAndRapidVibrationAreIgnored() {
  MotionReaction burst,fast;
  burst.sample(.8f,0.f,0.f,0);burst.sample(-.8f,0.f,0.f,150);
  for(unsigned i=0;i<50;++i)fast.sample(i%2?-.8f:.8f,0.f,0.f,i*50);
  return burst.count()==0 && fast.count()==0;
}
constexpr bool ChangingDirectionIsNotNecessarilyReversing() {
  MotionReaction r;
  for(unsigned i=0;i<20;++i){
    if(i%2)r.sample(-.1f,.8f,0.f,i*150);else r.sample(.8f,0.f,0.f,i*150);
  }
  return r.count()==0;
}
constexpr bool slowSequenceExpires() {
  MotionReaction r;
  for(unsigned i=0;i<15;++i)r.sample(i%2?-.8f:.8f,0.f,0.f,i*620);
  return r.count()==0;
}
constexpr bool resetClearsAnEpisode() {
  MotionReaction r;
  for(unsigned i=0;i<4;++i)r.sample(i%2?-.8f:.8f,0.f,0.f,i*150);
  if(!r.active(600))return false;
  r.reset();return !r.active(600)&&r.count()==0;
}
static_assert(pickupIsNotShaking(), "One-direction movement must not trigger nausea.");
static_assert(lightReversalsAreIgnored(),"Low amplitude and diagonal L1 sums must not trigger.");
static_assert(repeatedShakeAndRecovery(), "Repeated reversals trigger a temporary reaction and recover.");
static_assert(anyAxisAndWrap(), "Shaking works on every axis and across millis() wrap.");
static_assert(separatedPeaksDoNotAccumulate(), "Isolated movements must not accumulate into a shake.");
static_assert(burstsAndRapidVibrationAreIgnored(),"Brief bursts and rapid vibration do not qualify.");
static_assert(ChangingDirectionIsNotNecessarilyReversing(),"Small negative dots are not deliberate reversals.");
static_assert(slowSequenceExpires(),"Slow alternating peaks cannot accumulate forever.");
static_assert(resetClearsAnEpisode(),"Sleep/probe reset clears an existing episode.");
}
