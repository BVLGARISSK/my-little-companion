#pragma once
#include <stdint.h>
namespace playlistnav {
constexpr unsigned population(uint64_t bits){unsigned n=0;while(bits){bits&=bits-1;++n;}return n;}
constexpr int rank(uint64_t bits,unsigned n){for(int i=0;i<64;++i)if(bits&(uint64_t(1)<<i)){if(!n--)return i;}return -1;}
constexpr int next(int current,unsigned count,int direction,uint64_t enabled) {
  if(!count||count>64||(direction!=1&&direction!=-1))return -1;
  if(current<0||unsigned(current)>=count)current=direction>0?-1:0;
  for(unsigned step=1;step<=count;++step){
    int index=(current+direction*int(step)+int(count)*2)%int(count);
    if(enabled&(uint64_t(1)<<index))return index;
  }
  return -1;
}
}
