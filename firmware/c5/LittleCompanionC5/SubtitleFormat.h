#pragma once
#include <ArduinoJson.h>
#include <stdint.h>
#include <string.h>
namespace subtitles {
constexpr const char* moods[]={"neutral","happy","sad","surprised","sleepy","angry"};
constexpr const char* motions[]={"fixed","horizontal","vertical"};
inline int option(const char* s,const char* const* names,unsigned count){
  if(!s)return -1;for(unsigned i=0;i<count;++i)if(!strcmp(s,names[i]))return i;return -1;
}
struct Settings {
  uint16_t width=0,height=0;uint8_t viewport=64,motion=0,emotion=0;
  uint8_t speed=30;bool face=false,reverse=false,keepAwake=false;
  uint16_t tiles() const {return ((width+127)/128)*((height+63)/64);}
  bool read(JsonVariantConst v){
    if(v["version"]!=1||!v["width"].is<unsigned>()||!v["height"].is<unsigned>()||
      !v["viewport_h"].is<unsigned>()||!v["speed"].is<unsigned>()||!v["face"].is<bool>()||(!v["keep_awake"].isNull()&&!v["keep_awake"].is<bool>()))return false;
    unsigned w=v["width"],h=v["height"],view=v["viewport_h"],s=v["speed"];
    int m=option(v["motion"]|static_cast<const char*>(nullptr),motions,3);
    int e=option(v["emotion"]|static_cast<const char*>(nullptr),moods,6);
    const char* dir=v["direction"]|"";
    if(w<1||w>4096||h<1||h>2048||view<8||view>64||s<1||s>120||m<0||e<0||
      (strcmp(dir,"forward")&&strcmp(dir,"reverse")))return false;
    face=v["face"];keepAwake=v["keep_awake"]|false;if(face?view>36:view!=64)return false;
    if((m==0&&(w>128||h>view))||(m==1&&h>view)||(m==2&&w>128))return false;
    width=w;height=h;viewport=view;speed=s;motion=m;emotion=e;reverse=!strcmp(dir,"reverse");
    return tiles()<=32;
  }
  void write(JsonObject v) const {
    v["version"]=1;v["width"]=width;v["height"]=height;v["viewport_h"]=viewport;
    v["face"]=face;v["keep_awake"]=keepAwake;v["motion"]=motions[motion];v["direction"]=reverse?"reverse":"forward";
    v["speed"]=speed;v["emotion"]=moods[emotion];
  }
  bool same(const Settings& v) const {
    return width==v.width&&height==v.height&&viewport==v.viewport&&motion==v.motion&&
      emotion==v.emotion&&speed==v.speed&&face==v.face&&reverse==v.reverse&&keepAwake==v.keepAwake;
  }
};
constexpr int origin(unsigned size,unsigned viewport,unsigned speed,uint32_t elapsed,bool reverse,bool repeat){
  uint64_t travel=uint64_t(elapsed)*speed/1000;unsigned span=size+viewport+16;
  unsigned distance=repeat?travel%span:(travel>=span?span-1:travel);
  return reverse?-int(size)+int(distance):int(viewport)-int(distance);
}
inline bool pixel(const uint8_t* tiles,unsigned width,unsigned height,int x,int y){
  if(x<0||y<0||unsigned(x)>=width||unsigned(y)>=height)return false;
  unsigned tile=(unsigned(y)/64)*((width+127)/128)+unsigned(x)/128;
  return tiles[tile*1024+(unsigned(y)%64)*16+(unsigned(x)%128)/8]&(1<<(x%8));
}
static_assert(origin(200,128,30,0,false,true)==128,"Marquee starts at the right edge");
static_assert(origin(200,128,30,1000,false,true)==98,"Speed uses pixels per second");
static_assert(origin(200,128,30,1000,true,true)==-170,"Reverse direction");
static_assert(origin(200,128,30,20000,false,false)==-215,"One pass stops at the end");
}
