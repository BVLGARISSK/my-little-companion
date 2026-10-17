#include "SubtitleTiming.h"

namespace {
constexpr bool noDriftWithPollingAndVariableTransfers() {
  uint32_t now=0,last=UINT32_MAX,lastPixel=UINT32_MAX,frames=0;
  while(now<8000){
    if(subtitletiming::due(now,30,last,false)){
      uint32_t pixel=uint64_t(now)*30/1000;
      if(lastPixel!=UINT32_MAX&&pixel!=lastPixel+1)return false;
      last=subtitletiming::tick(now,30);lastPixel=pixel;++frames;
      const unsigned transfer[]={8,12,17,12};now+=transfer[frames%4];
    }
    now+=5;
  }
  return frames==240;
}
constexpr bool capAndLowSpeed() {
  for(unsigned speed=1;speed<=120;++speed){
    if(subtitletiming::tick(1000,speed)!=(speed<30?speed:30))return false;
    if(subtitletiming::rate(speed)>30)return false;
  }
  return !subtitletiming::due(999,1,0,false)&&subtitletiming::due(1000,1,0,false);
}
constexpr bool missingFramesDoNotMoveTheNextDeadline() {
  auto last=subtitletiming::tick(55,30);
  return last==1 && !subtitletiming::due(66,30,last,false) && subtitletiming::due(67,30,last,false);
}
constexpr bool elapsedHandlesClockWrapAndPausedPlayback() {
  uint32_t start=UINT32_MAX-350,now=start+450,elapsed=now-start;
  uint32_t pause=123456;
  return elapsed==450&&subtitletiming::tick(elapsed,30)==13&&
    subtitletiming::tick((now+pause)-(start+pause),30)==13;
}
static_assert(noDriftWithPollingAndVariableTransfers(),"Variable display work must not accumulate timeline drift.");
static_assert(capAndLowSpeed(),"1-120 px/s stays at at most 30 FPS, with low-speed pixel deadlines.");
static_assert(missingFramesDoNotMoveTheNextDeadline(),"Late rendering must retain the original timeline.");
static_assert(elapsedHandlesClockWrapAndPausedPlayback(),"Wrap and sleep time must preserve the media timeline.");
static_assert(subtitletiming::waitMs(32,61)==2,"Sleep must wake for the 34 ms frame deadline.");
static_assert(subtitletiming::waitMs(999,1)==1,"Slow scroll must not sleep across its next pixel.");
static_assert(subtitletiming::waitMs(0,120)==5,"Keep the original low-power idle cap.");
static_assert(subtitletiming::due(0,30,UINT32_MAX,false),"First frame must render.");
static_assert(subtitletiming::due(0,30,0,true),"Resync or badges must render even within the same tick.");
}
