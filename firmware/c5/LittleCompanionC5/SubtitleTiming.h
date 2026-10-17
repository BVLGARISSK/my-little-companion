#pragma once
#include <stdint.h>

namespace subtitletiming {
constexpr unsigned rate(unsigned speed) { return speed<30?speed:30; }
constexpr uint32_t tick(uint32_t elapsed,unsigned speed) { return uint64_t(elapsed)*rate(speed)/1000; }
// Keep sleeps within the existing idle cap, but do not oversleep a nearby
// absolute frame deadline. Rendering still uses the original elapsed timeline.
constexpr unsigned waitMs(uint32_t elapsed,unsigned speed,unsigned cap=5) {
  unsigned fps=rate(speed);
  uint64_t next=(uint64_t(tick(elapsed,speed)+1)*1000+fps-1)/fps;
  uint64_t remaining=next-elapsed;
  return remaining<1?1:remaining>cap?cap:unsigned(remaining);
}
constexpr bool due(uint32_t elapsed,unsigned speed,uint32_t previous,bool force) {
  return force || previous==UINT32_MAX || tick(elapsed,speed)!=previous;
}
}
