#include "PlaylistNavigation.h"
namespace {
static_assert(playlistnav::population(0b1001)==2 && playlistnav::rank(0b1001,0)==0 && playlistnav::rank(0b1001,1)==3,"Disabled gaps must not weight shuffle probabilities.");
static_assert(playlistnav::population(UINT64_MAX)==64 && playlistnav::rank(UINT64_MAX,63)==63 && playlistnav::rank(0,0)==-1,"Shuffle handles empty and full masks.");
constexpr bool handlesAllPositionsAndDirections(){
  for(unsigned count=1;count<=64;++count){
    uint64_t enabled=count==64?UINT64_MAX:(uint64_t(1)<<count)-1;
    for(int current=-1;current<int(count);++current){
      if(playlistnav::next(current,count,1,enabled)!=(current+1)%int(count))return false;
      int previous=current<0?int(count)-1:(current+int(count)-1)%int(count);
      if(playlistnav::next(current,count,-1,enabled)!=previous)return false;
    }
  }return true;
}
static_assert(handlesAllPositionsAndDirections(),"Forward/backward navigation must use playlist positions, including wrap.");
static_assert(playlistnav::next(-1,0,1,0)==-1,"Empty playlist must not pick a library item.");
static_assert(playlistnav::next(0,4,1,0)==-1,"All-disabled playlist must leave playback unchanged.");
static_assert(playlistnav::next(-1,5,1,0b01010)==1&&playlistnav::next(-1,5,-1,0b01010)==3,"Off-list previews enter at first/last enabled item.");
static_assert(playlistnav::next(1,5,1,0b01010)==3&&playlistnav::next(1,5,-1,0b01010)==3,"Disabled items are skipped in either direction.");
static_assert(playlistnav::next(1,4,1,0b0010)==1,"A single enabled item stays the sole target.");
static_assert(playlistnav::next(62,64,1,uint64_t(1)<<63)==63,"Playlist slot 64 must not overflow the enabled mask.");
static_assert(playlistnav::next(3,5,1,0b00010)==1,"Unavailable media can be masked out without library fallback.");
static_assert(playlistnav::next(99,3,1,7)==0&&playlistnav::next(99,3,-1,7)==2,"Stale cursors enter at the edge.");
static_assert(playlistnav::next(0,3,0,7)==-1&&playlistnav::next(0,65,1,UINT64_MAX)==-1,"Reject invalid navigation inputs.");
}
