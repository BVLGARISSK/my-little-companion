#include "Experience.h"
#include <sys/time.h>
#include <time.h>
#include <math.h>
int64_t Experience::clockMs(){timeval tv{};gettimeofday(&tv,nullptr);return int64_t(tv.tv_sec)*1000+tv.tv_usec/1000;}
bool Experience::timeValid(){auto now=clockMs();return now>=1577836800000LL&&now<4102444800000LL;}
void Experience::begin(Preferences& p){
  prefs=&p;settings.brightness=screen.level;String text=p.getString("extras","");
  if(text.length()){JsonDocument d;String why;if(deserializeJson(d,text)||!settings.read(d,why)){settings=extras::Settings{};settings.brightness=screen.level;settingsRecovered=true;}}
  for(auto& r:settings.rules)if(r.type=="media"&&store.find(r.id).isNull()){r.type="none";r.id="";settingsRecovered=true;}
  locked=settings.lockOnBoot||p.getBool("touch_lock",false);offsetMinutes=p.getShort("time_offset",480);if(offsetMinutes<-720||offsetMinutes>840)offsetMinutes=480;apply();
  if(p.getUChar("tool",0)==Display::CLOCK)screen.tool(Display::CLOCK);
}
void Experience::apply(){if(!settings.lowBattery)voltage=extras::VoltageState{};hardware.sleepDelay(offMs());screen.brightness(settings.brightness);screen.dimContrast(settings.dimLevel);if(!settings.autoRotate){upside=candidate=false;screen.rotate(false);}poseSeeded=false;}
bool Experience::references(const String& id) const {for(auto& r:settings.rules)if(r.type=="media"&&r.id==id)return true;return false;}
bool Experience::save(JsonVariantConst value,String& why){
  extras::Settings next;if(!next.read(value,why))return false;
  for(auto& r:next.rules)if(r.type=="media"&&store.find(r.id).isNull()){why="先傳送互動選用的作品，再套用設定。";return false;}
  JsonDocument d;next.write(d.to<JsonObject>());String text;serializeJson(d,text);
  if(text.length()>4096||prefs->putString("extras",text)!=text.length()){why="互動設定未能儲存，原設定保留。";return false;}
  settings=next;settingsRecovered=false;prefs->putUChar("brightness",settings.brightness);apply();return true;
}
bool Experience::calibrate(String& why){
  if(!hardware.poseReady()){why="MPU6050 尚未就緒。";return false;}
  float norm=0;for(unsigned i=0;i<3;++i)norm+=hardware.gravity(i)*hardware.gravity(i);
  if(norm<.64f||norm>1.44f){why="請保持吊飾正向、停止晃動後再校正。";return false;}
  auto next=settings;for(unsigned i=0;i<3;++i)next.neutral[i]=hardware.gravity(i)/sqrtf(norm);next.calibrated=true;
  JsonDocument d;next.write(d.to<JsonObject>());return save(d,why);
}
bool Experience::lock(bool value,String& why){if(prefs->putBool("touch_lock",value)!=1){why="觸摸鎖定未能儲存。";return false;}locked=value;screen.badges(locked,voltage.low);return true;}
bool Experience::setBrightness(uint8_t value,String& why){JsonDocument d;settings.write(d.to<JsonObject>());d["brightness"]=value;return save(d,why);}
void Experience::persistPlayback(){
  auto mode=screen.modeName();if(mode=="media"||mode=="subtitle"){prefs->putString("mode","media");prefs->putString("media",screen.currentId);}
  else if(mode=="playlist")prefs->putString("mode","playlist");else if(mode=="emotion"){prefs->putString("mode","manual");prefs->putString("emotion",screen.emotionName());}
}
void Experience::trigger(unsigned event,bool motion){
  if(event>=extras::EVENT_COUNT||(locked&&!motion)||voltage.critical||screen.currentTool()!=Display::NO_TOOL)return;
  if(screen.pinnedSubtitle()||(motion&&!screen.expressionContext()&&!settings.interruptMedia))return;
  auto& r=settings.rules[event];if(r.type=="none")return;++triggerCount;
  if(r.type=="emotion")screen.transientEmotion(r.id);
  else if(r.type=="media")screen.transientMedia(r.id);
  else if(r.type=="next"){screen.navigate(1);persistPlayback();}
  else if(r.type=="previous"){screen.navigate(-1);persistPlayback();}
  else if(r.type=="default"){
    if(event==0){if(screen.returnFromSubtitle()||screen.nextEmotion())persistPlayback();}
    else if(event==1){screen.navigate(1);persistPlayback();}
    else if(event==2){screen.navigate(-1);persistPlayback();}
    else if(event==3&&settings.greeting)screen.greet();
  }
}
void Experience::touch(Hardware::Action action,bool busy){
  if(action==Hardware::TOGGLE_LOCK){String why;lock(!locked,why);return;}
  if(locked||busy||voltage.critical||screen.pinnedSubtitle())return;
  auto tool=screen.currentTool();
  if(tool>=Display::DICE){if(action==Hardware::NEXT_EMOTION)screen.restartGame();else if(action==Hardware::NEXT_WORK||action==Hardware::PREVIOUS_WORK)screen.clearTool();return;}
  if(tool==Display::CLOCK||tool==Display::TIMER){
    if(action==Hardware::NEXT_EMOTION&&tool==Display::TIMER){if(timer.paused)timer.resume(clockMs());else timer.pause(clockMs());}
    else if(action==Hardware::NEXT_WORK||action==Hardware::PREVIOUS_WORK){screen.clearTool();forgetTool();}return;
  }
  if(action==Hardware::NEXT_EMOTION)trigger(0,false);else if(action==Hardware::NEXT_WORK)trigger(1,false);else if(action==Hardware::PREVIOUS_WORK)trigger(2,false);
}
bool Experience::command(const String& op,JsonVariantConst request,String& why){
  if(op=="SET_TIME"){
    if(!request["epoch_ms"].is<int64_t>()||!request["offset_min"].is<int>()||request["epoch_ms"].as<int64_t>()<1577836800000LL||request["epoch_ms"].as<int64_t>()>=4102444800000LL||request["offset_min"].as<int>()<-720||request["offset_min"].as<int>()>840){why="時間或時區無效。";return false;}
    int64_t value=request["epoch_ms"],delta=value-clockMs();timeval tv{time_t(value/1000),suseconds_t(value%1000*1000)};
    if(settimeofday(&tv,nullptr)!=0){why="時鐘設定失敗。";return false;}timer.shift(delta);offsetMinutes=request["offset_min"];prefs->putShort("time_offset",offsetMinutes);return true;
  }
  if(op=="CLOCK"){if(!request["enabled"].is<bool>()){why="時鐘開關無效。";return false;}if(request["enabled"].as<bool>())screen.tool(Display::CLOCK);else screen.clearTool();prefs->putUChar("tool",request["enabled"].as<bool>()?Display::CLOCK:0);return true;}
  if(op=="GAME"){
    String game=request["game"]|"";if(game=="none"){forgetTool();screen.clearTool();return true;}
    if(game!="dice"&&game!="maze"&&game!="dodge"){why="請選擇骰子、迷宮或躲障礙。";return false;}
    if(game!="dice"&&!hardware.poseReady()){why="傾斜遊戲需要 MPU6050。";return false;}
    forgetTool();screen.tool(game=="dice"?Display::DICE:game=="maze"?Display::MAZE:Display::DODGE);return true;
  }
  if(op=="TIMER"){
    String action=request["action"]|"";if(action=="pause"){timer.pause(clockMs());return true;}if(action=="resume"){timer.resume(clockMs());return true;}
    if(action=="cancel"){timer.cancel();if(screen.currentTool()==Display::TIMER)screen.clearTool();return true;}
    if(action!="start"){why="計時操作無效。";return false;}
    String mode=request["mode"]|"";if(mode!="countdown"&&mode!="pomodoro"){why="計時模式無效。";return false;}
    for(auto key:{"focus_s","break_s","long_break_s","rounds"})if(!request[key].isNull()&&!request[key].is<uint32_t>()){why="番茄鐘設定需為整數。";return false;}
    uint32_t seconds=request["duration_s"]|0u,focus=request["focus_s"]|1500u,rest=request["break_s"]|300u,longRest=request["long_break_s"]|900u;unsigned rounds=request["rounds"]|4u;
    if(!request["duration_s"].is<uint32_t>()||seconds<1||seconds>86400||focus<60||focus>7200||rest<60||rest>3600||longRest<60||longRest>7200||rounds<1||rounds>8){why="計時長度或番茄鐘輪數超出範圍。";return false;}
    forgetTool();timer.start(clockMs(),mode=="pomodoro",seconds,focus,rest,longRest,rounds);screen.tool(Display::TIMER);return true;
  }
  why="Unsupported experience command.";return false;
}
void Experience::update(bool busy){
  uint32_t now=millis();bool asleep=screen.sleeping();
  bool moved=motionSeen!=hardware.motionEvents();motionSeen=hardware.motionEvents();
  bool pickedUp=(previousSleep&&!asleep)||(moved&&previousStill>=5000);
  if(pickedUp&&!asleep&&!hardware.touchActive()&&!busy&&(!lastGreeting||now-lastGreeting>=3000)){trigger(3,true);lastGreeting=now;}
  previousSleep=asleep;previousStill=hardware.stillMs();
  if(hardware.poseReady()){
    if(!poseSeeded){for(unsigned i=0;i<3;++i){gravity[i]=hardware.gravity(i);neutral[i]=settings.calibrated?settings.neutral[i]:gravity[i];}poseSeeded=true;}
    for(unsigned i=0;i<3;++i)gravity[i]+=.18f*(hardware.gravity(i)-gravity[i]);
    tiltX=max(-1.f,min(1.f,(gravity[settings.axisX]-neutral[settings.axisX])*settings.signX/settings.sensitivity));
    tiltY=max(-1.f,min(1.f,(gravity[settings.axisY]-neutral[settings.axisY])*settings.signY/settings.sensitivity));
    screen.look(settings.tilt?(upside?-tiltX:tiltX):0,settings.tilt?(upside?-tiltY:tiltY):0);screen.gameInput(upside?-tiltX:tiltX,upside?-tiltY:tiltY);
    if(!busy&&!asleep){int side=tiltX<-.65f?-1:tiltX>.65f?1:0;
      if(side&&side!=tiltSide&&now-lastTrigger>=1500){trigger(side<0?4:5,true);lastTrigger=now;}if(fabsf(tiltX)<.35f||side)tiltSide=side;
      if(settings.autoRotate&&settings.calibrated){float dot=0,norm=0;for(unsigned i=0;i<3;++i){dot+=gravity[i]*settings.neutral[i];norm+=gravity[i]*gravity[i];}
        bool wanted=dot<-.65f?true:dot>.65f?false:upside;
        if(norm>.49f&&norm<1.69f){if(candidate!=wanted){candidate=wanted;rotationSince=now;}if(upside!=wanted&&now-rotationSince>=800){upside=wanted;screen.rotate(upside);trigger(6,true);}}}
    }
  }else{screen.look(0,0);screen.gameInput(0,0);}
  uint32_t shake=hardware.shakeEvents();if(shake!=shakeSeen){shakeSeen=shake;if(!busy&&!asleep){if(screen.currentTool()==Display::DICE)screen.restartGame();else trigger(7,true);}}
  bool wasCritical=voltage.critical;
  if(batterySeen!=hardware.batterySequence()){batterySeen=hardware.batterySequence();voltage.sample(int(hardware.batteryVoltageMv())+settings.batteryOffset,settings.lowBattery,hardware.usbHostIsConnected(),settings.warnMv,settings.sleepMv,settings.resumeMv);}
  if(hardware.usbHostIsConnected()){voltage=extras::VoltageState{};}
  screen.badges(locked,voltage.low);
  bool timerChanged=timer.advance(clockMs());
  if((timerChanged||(wasCritical&&!voltage.critical&&timer.finished))&&!voltage.critical&&!screen.pinnedSubtitle()){hardware.activity();screen.sleep(false);screen.dim(false);screen.tool(Display::TIMER);}
  static const char* phases[]={"FOCUS","BREAK","LONG BREAK"};
  screen.timerView((timer.remainingMs(clockMs())+999)/1000,timer.totalS,timer.pomodoro?phases[timer.phase]:"COUNTDOWN",timer.paused);
  screen.clockView(timeValid(),clockMs(),offsetMinutes);
}
uint64_t Experience::nextWakeUs() const {if(timer.active&&!timer.paused){auto ms=timer.remainingMs(clockMs());return uint64_t(max<uint32_t>(1,min<uint32_t>(1800000,ms)))*1000;}return 1800000000ULL;}
void Experience::restore(const Checkpoint& value){timer=value.timer;voltage.low=value.low;voltage.critical=value.critical;screen.restoreTool(value.tool);previousSleep=true;}
void Experience::snapshot(JsonDocument& d) const {
  auto config=d["settings"].to<JsonObject>();auto current=settings;current.brightness=screen.level;current.write(config);
  auto runtime=d["runtime"].to<JsonObject>();runtime["touch_locked"]=locked;runtime["calibration_needed"]=!settings.calibrated;runtime["settings_recovered"]=settingsRecovered;
  runtime["tilt_x"]=tiltX;runtime["tilt_y"]=tiltY;runtime["upside_down"]=upside;runtime["low_battery"]=voltage.low;runtime["critical_battery"]=voltage.critical;runtime["events_fired"]=triggerCount;
  runtime["clock_valid"]=timeValid();runtime["epoch_ms"]=clockMs();runtime["offset_min"]=offsetMinutes;runtime["tool"]=unsigned(screen.currentTool());
  auto t=runtime["timer"].to<JsonObject>();t["active"]=timer.active;t["paused"]=timer.paused;t["finished"]=timer.finished;t["pomodoro"]=timer.pomodoro;t["phase"]=timer.phase;t["round"]=timer.round;t["rounds"]=timer.rounds;t["remaining_s"]=(timer.remainingMs(clockMs())+999)/1000;
  d["storage_reserve"]=65536;d["max_works"]=32;
}
