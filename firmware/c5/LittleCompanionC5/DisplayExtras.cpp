#include "Display.h"
#include <esp_random.h>
#include <time.h>
#include <math.h>
#include "PlaylistNavigation.h"

void Display::playbackStatus(JsonDocument& d) const {
  d["mode"]=modeName();d["media_id"]=currentId;d["emotion"]=mood;
  d["playlist_index"]=mode==PLAYLIST?playlistIndex:-1;d["playlist_count"]=store.playlist["items"].size();
  d["subtitle_pinned"]=subtitlePinned;
  d["tool"]=unsigned(toolState.type);d["temporary"]=overlay;d["sleeping"]=asleep;
}

bool Display::pinSubtitle(const String& id){
  JsonObject item=store.find(id);
  if(item.isNull()||item["kind"]!="subtitle")return false;
  if(!playMedia(id,true))return false;
  subtitlePinned=true;return true;
}
bool Display::returnFromSubtitle() {
  if(mode!=MEDIA||!subtitleBitmap||subtitlePinned||overlay||toolState.type)return false;
  return playPlaylist();
}

bool Display::navigate(int direction) {
  if(pinnedSubtitle())return false;
  auto items=store.playlist["items"].as<JsonArrayConst>();unsigned count=items.size();
  if(!count||count>64||(direction!=1&&direction!=-1))return false;
  uint64_t enabled=0;for(unsigned i=0;i<count;++i)if(items[i]["enabled"].as<bool>())enabled|=uint64_t(1)<<i;
  if(!enabled)return false;
  if(toolState.type)clearTool();
  if(overlay){auto base=overlayBase;overlay=false;restore(base);}
  int start=mode==PLAYLIST?playlistIndex:-1;
  if(start<0||unsigned(start)>=count){
    for(unsigned i=0;i<count;++i){
      auto item=items[i];if(!(enabled&(uint64_t(1)<<i)))continue;
      bool expression=item["type"]=="emotion";
      if((expression&&(mode==AUTO||mode==MANUAL)&&item["id"]==mood)||
         (!expression&&currentId.length()&&item["id"]==currentId)){start=int(i);break;}
    }
  }
  for(unsigned n=0;n<count;++n){
    int index=playlistnav::next(start,count,direction,enabled);if(index<0)return false;
    enabled&=~(uint64_t(1)<<index);start=index;auto item=items[index];
    if(item["type"]=="emotion"){stopMedia();mood=item["id"].as<String>();}
    else if(!playMedia(item["id"].as<String>(),item["repeat"]|true))continue;
    playlistIndex=index;itemSince=millis();mode=PLAYLIST;forceFull=true;return true;
  }return false;
}
bool Display::transientEmotion(const String& name,uint32_t duration){
  if(toolState.type)return false;auto base=checkpoint();emotion(name,false);overlayBase=base;overlayUntil=millis()+duration;overlay=true;return true;
}
bool Display::transientMedia(const String& id){
  if(toolState.type)return false;auto base=checkpoint();if(!playMedia(id,false))return false;
  overlayBase=base;uint32_t duration=file?uint32_t(header.frames)*1000/header.fps:1800;
  if(subtitleBitmap&&subtitleSettings.motion){auto& c=subtitleSettings;duration=(uint32_t(c.motion==1?c.width+128:c.height+c.viewport)+16)*1000/c.speed;}
  overlayUntil=millis()+max<uint32_t>(600,min<uint32_t>(30000,duration));overlay=true;return true;
}
void Display::greet(){
  if(toolState.type)return;
  if(!expressionContext())transientEmotion("happy",1500);
  greeting=true;greetingSince=millis();forceFull=true;
}
void Display::tool(Tool value){
  if(value==NO_TOOL){clearTool();return;}
  if(!toolState.type){if(overlay){auto base=overlayBase;overlay=false;restore(base);}toolBase=checkpoint();}
  toolState.type=value;forceFull=true;lastFrame=0;gameSince=millis();
  if(value>=DICE)restartGame();
}
void Display::clearTool(){if(!toolState.type)return;auto base=toolBase;toolState.type=NO_TOOL;restore(base);}
void Display::restartGame(){
  uint8_t type=toolState.type;toolState=ToolState{};toolState.type=type;toolState.dice=1+esp_random()%6;
  if(type==DODGE)toolState.x=64;gameSince=diceSince=millis();forceFull=true;
}
void Display::restoreTool(const ToolState& value){if(value.type>DODGE||!isfinite(value.x)||!isfinite(value.y))return;if(!value.type)return;tool(Tool(value.type));toolState=value;gameSince=diceSince=millis();}
void Display::gameInput(float x,float y){inputX=x;inputY=y;}
void Display::canvasToFrame(){
  auto buffer=oled.getBufferPtr();memset(frame,0,sizeof(frame));
  for(unsigned y=0;y<64;++y)for(unsigned x=0;x<128;++x)if(buffer[(y/8)*128+x]&(1<<(y%8)))frame[y*16+x/8]|=1<<(x%8);
}
void Display::drawTool(uint32_t now){
  oled.setDisplayRotation(U8G2_R0);oled.clearBuffer();oled.setDrawColor(1);oled.setFont(u8g2_font_5x7_tf);
  auto title=[&](const char* name){oled.drawStr(3,8,name);};
  if(toolState.type==CLOCK){
    if(!clockValid){title("CLOCK");oled.setFont(u8g2_font_6x12_tf);oled.drawStr(24,32,"SYNC CLOCK");oled.setFont(u8g2_font_5x7_tf);oled.drawStr(13,49,"CONNECT PHONE TO SET");}
    else{time_t value=clockEpoch/1000+clockOffset*60;tm local{};gmtime_r(&value,&local);char text[24];strftime(text,sizeof(text),"%Y-%m-%d",&local);title(text);
      strftime(text,sizeof(text),"%H:%M",&local);oled.setFont(u8g2_font_logisoso24_tn);oled.drawStr(21,43,text);oled.setFont(u8g2_font_5x7_tf);strftime(text,sizeof(text),"%a",&local);oled.drawStr(55,58,text);}
  }else if(toolState.type==TIMER){
    title(timerPhase);char text[20];if(timerSeconds>=3600)snprintf(text,sizeof(text),"%lu:%02lu:%02lu",(unsigned long)(timerSeconds/3600),(unsigned long)(timerSeconds/60%60),(unsigned long)(timerSeconds%60));else snprintf(text,sizeof(text),"%02lu:%02lu",(unsigned long)(timerSeconds/60),(unsigned long)(timerSeconds%60));
    oled.setFont(timerSeconds>=3600?u8g2_font_logisoso16_tn:u8g2_font_logisoso24_tn);oled.drawStr(timerSeconds>=3600?4:20,40,text);oled.setFont(u8g2_font_5x7_tf);
    if(timerPaused)oled.drawStr(48,50,"PAUSED");else if(!timerSeconds)oled.drawStr(44,50,"TIME UP");
    oled.drawFrame(12,55,104,6);if(timerTotal){uint32_t done=min(timerTotal,timerTotal-min(timerTotal,timerSeconds));oled.drawBox(14,57,done*100/timerTotal,2);}
    if(!timerSeconds&&now%1000<500)oled.drawFrame(0,0,128,64);
  }else if(toolState.type==DICE){
    title("DICE - TAP TO ROLL");if(now-diceSince<600)toolState.dice=1+esp_random()%6;
    oled.drawRFrame(42,14,44,44,6);auto dot=[&](int x,int y){oled.drawDisc(x,y,3);};unsigned v=toolState.dice;
    if(v%2)dot(64,36);if(v>=2){dot(52,24);dot(76,48);}if(v>=4){dot(76,24);dot(52,48);}if(v==6){dot(52,36);dot(76,36);}
  }else{
    float dt=min<uint32_t>(100,now-gameSince)/1000.f;gameSince=now;
    if(toolState.type==MAZE){
      auto blocked=[](float x,float y){return x<4||x>124||y<12||y>60||(x>37&&x<47&&y<47)||(x>77&&x<87&&y>21);};
      if(!toolState.over){float x=toolState.x+inputX*42*dt,y=toolState.y+inputY*42*dt;if(!blocked(x,toolState.y))toolState.x=x;if(!blocked(toolState.x,y))toolState.y=y;if(hypotf(toolState.x-116,toolState.y-52)<5)toolState.over=true;}
      title(toolState.over?"GOAL! TAP TO RESTART":"TILT MAZE");oled.drawFrame(1,9,126,54);oled.drawBox(40,10,4,34);oled.drawBox(80,24,4,38);oled.drawCircle(116,52,4);oled.drawDisc(lroundf(toolState.x),lroundf(toolState.y),2);
    }else{
      if(!toolState.over){toolState.x=max(5.f,min(123.f,toolState.x+inputX*70*dt));
        for(unsigned i=0;i<3;++i){toolState.obstacleY[i]+=(18+min<uint32_t>(30,toolState.score))*dt;if(toolState.obstacleY[i]>65){toolState.obstacleY[i]=-6;toolState.obstacleX[i]=6+esp_random()%116;++toolState.score;}
          if(toolState.obstacleY[i]>49&&toolState.obstacleY[i]<61&&fabsf(toolState.obstacleX[i]-toolState.x)<7)toolState.over=true;}}
      char text[32];snprintf(text,sizeof(text),"DODGE SCORE %lu",(unsigned long)toolState.score);title(text);oled.drawBox(lroundf(toolState.x)-4,56,8,4);
      for(unsigned i=0;i<3;++i)if(toolState.obstacleY[i]>=10)oled.drawBox(lroundf(toolState.obstacleX[i])-3,lroundf(toolState.obstacleY[i]),6,5);
      if(toolState.over){oled.drawBox(24,25,82,18);oled.setDrawColor(0);oled.drawStr(35,37,"GAME OVER");oled.setDrawColor(1);}
    }
  }
  canvasToFrame();oled.setDisplayRotation(rotated?U8G2_R2:U8G2_R0);
}
