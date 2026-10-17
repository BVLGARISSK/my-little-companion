#include "ExtrasSettings.h"
#include "MediaFormat.h"
namespace extras {
bool Settings::read(JsonVariantConst d,String& why) {
  auto bad=[&](const char* s){why=s;return false;};
  if(!d.is<JsonObjectConst>()||d["version"]!=1)return bad("Unsupported interaction settings.");
  for(auto k:{"tilt_enabled","greeting_enabled","auto_rotate","lock_on_boot","calibrated","low_battery_enabled","interrupt_media"})if(!d[k].is<bool>())return bad("Invalid interaction switch.");
  for(auto k:{"axis_x","axis_y","brightness","dim_level","dim_s","off_s","deep_s","warn_mv","sleep_mv","resume_mv"})if(!d[k].is<uint32_t>())return bad("Invalid settings number.");
  if(!d["sign_x"].is<int>()||!d["sign_y"].is<int>()||!d["battery_offset_mv"].is<int>()||!d["sensitivity"].is<float>())return bad("Invalid sensor calibration.");
  auto x=d["axis_x"].as<unsigned>(),y=d["axis_y"].as<unsigned>();int sx=d["sign_x"],sy=d["sign_y"],offset=d["battery_offset_mv"];
  float sens=d["sensitivity"];if(x>2||y>2||x==y||(sx!=1&&sx!=-1)||(sy!=1&&sy!=-1)||!isfinite(sens)||sens<.1f||sens>1.f||offset<-300||offset>300)return bad("Sensor axes or sensitivity out of range.");
  auto bright=d["brightness"].as<unsigned>(),dim=d["dim_level"].as<unsigned>();
  uint32_t ds=d["dim_s"],os=d["off_s"],deep=d["deep_s"];
  if(bright<1||bright>255||dim<1||dim>255||ds>3600||os>3600||deep>86400||
     (os&&os<5)||(ds&&os&&ds>=os)||(deep&&(!os||deep<os+30)))return bad("Invalid brightness or sleep timings.");
  unsigned warn=d["warn_mv"],sl=d["sleep_mv"],res=d["resume_mv"];
  if(sl<2800||sl>3500||warn<sl+100||warn>3800||res<warn+50||res>4200)return bad("Invalid low-voltage thresholds.");
  auto n=d["neutral"].as<JsonArrayConst>();if(n.size()!=3)return bad("Calibration needs three axes.");
  float norm=0;for(auto v:n){if(!v.is<float>()||!isfinite(v.as<float>())||fabsf(v.as<float>())>1.5f)return bad("Invalid gravity vector.");norm+=v.as<float>()*v.as<float>();}
  if(d["calibrated"].as<bool>()&&(norm<.49f||norm>1.69f))return bad("Hold the pendant still to calibrate.");
  auto list=d["rules"].as<JsonArrayConst>();if(list.size()!=EVENT_COUNT)return bad("Eight interaction rules required.");
  Rule next[EVENT_COUNT];
  for(unsigned i=0;i<EVENT_COUNT;++i){auto r=list[i];String type=r["type"]|"",id=r["id"]|"";
    if(r["event"]!=events[i]||(type!="default"&&type!="none"&&type!="emotion"&&type!="media"&&type!="next"&&type!="previous"))return bad("Invalid interaction rule.");
    if((type=="emotion"&&!mood(id))||(type=="media"&&!media::hex(id.c_str(),32))||((type!="emotion"&&type!="media")&&id.length()))return bad("Invalid rule target.");
    next[i].type=type;next[i].id=id;
  }
  tilt=d["tilt_enabled"];greeting=d["greeting_enabled"];autoRotate=d["auto_rotate"];lockOnBoot=d["lock_on_boot"];calibrated=d["calibrated"];lowBattery=d["low_battery_enabled"];interruptMedia=d["interrupt_media"];
  axisX=x;axisY=y;signX=sx;signY=sy;sensitivity=sens;brightness=bright;dimLevel=dim;dimS=ds;offS=os;deepS=deep;
  warnMv=warn;sleepMv=sl;resumeMv=res;batteryOffset=offset;
  for(unsigned i=0;i<3;++i)neutral[i]=n[i].as<float>();for(unsigned i=0;i<EVENT_COUNT;++i)rules[i]=next[i];return true;
}
void Settings::write(JsonObject d) const {
  d["version"]=1;d["tilt_enabled"]=tilt;d["greeting_enabled"]=greeting;d["auto_rotate"]=autoRotate;d["lock_on_boot"]=lockOnBoot;d["calibrated"]=calibrated;d["low_battery_enabled"]=lowBattery;d["interrupt_media"]=interruptMedia;
  d["axis_x"]=axisX;d["axis_y"]=axisY;d["sign_x"]=signX;d["sign_y"]=signY;d["sensitivity"]=sensitivity;
  auto n=d["neutral"].to<JsonArray>();for(float v:neutral)n.add(v);
  d["brightness"]=brightness;d["dim_level"]=dimLevel;d["dim_s"]=dimS;d["off_s"]=offS;d["deep_s"]=deepS;
  d["warn_mv"]=warnMv;d["sleep_mv"]=sleepMv;d["resume_mv"]=resumeMv;d["battery_offset_mv"]=batteryOffset;
  auto a=d["rules"].to<JsonArray>();for(unsigned i=0;i<EVENT_COUNT;++i){auto r=a.add<JsonObject>();r["event"]=events[i];r["type"]=rules[i].type;r["id"]=rules[i].id;}
}
}
