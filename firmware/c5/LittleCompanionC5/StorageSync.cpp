#include "Storage.h"
#include "SubtitleFormat.h"
#include <mbedtls/md.h>
String Storage::sha256(const String& path){
  File file=LittleFS.open(path,"r");if(!file)return "";
  mbedtls_md_context_t context;mbedtls_md_init(&context);
  if(mbedtls_md_setup(&context,mbedtls_md_info_from_type(MBEDTLS_MD_SHA256),0)||mbedtls_md_starts(&context)){mbedtls_md_free(&context);return "";}
  uint8_t block[1024],hash[32];bool ok=true;size_t readBytes=0,total=file.size();
  while(file.available()){size_t n=file.read(block,sizeof(block));if(!n||mbedtls_md_update(&context,block,n)){ok=false;break;}readBytes+=n;}
  if(mbedtls_md_finish(&context,hash))ok=false;mbedtls_md_free(&context);if(!ok||readBytes!=total)return "";
  static const char hex[]="0123456789abcdef";String result;result.reserve(64);for(uint8_t v:hash){result+=hex[v>>4];result+=hex[v&15];}return result;
}
bool Storage::matches(JsonVariantConst meta){
  auto item=find(meta["id"].as<String>());if(item.isNull()||item["kind"]!=meta["kind"]||item["name"]!=meta["name"]||item["length"]!=meta["length"])return false;
  String digest=meta["sha256"]|"";if(!media::hex(digest.c_str(),64))return false;
  if(item["kind"]=="subtitle"){subtitles::Settings old,next;if(!old.read(item["subtitle"])||!next.read(meta["subtitle"])||!old.same(next))return false;}
  return sha256(item["path"].as<String>())==digest;
}
