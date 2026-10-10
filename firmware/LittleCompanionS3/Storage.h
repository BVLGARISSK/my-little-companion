#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include <LittleFS.h>
#include "MediaFormat.h"

class Storage {
public:
  bool ready = false;
  String error;
  JsonDocument library, playlist;
  bool begin();
  bool loadJournal(const char* name, JsonDocument& result, bool& found);
  bool saveJournal(const char* name, JsonVariantConst payload);
  JsonObject find(const String& id);
  bool referenced(const String& id);
  bool validatePlaylist(JsonVariantConst data, String& why);
  bool validateOLA(const String& path, uint32_t wholeCrc, media::Header& h, String& why);
  bool commitMedia(const String& temp, JsonVariantConst meta, const media::Header& h);
  bool deleteMedia(const String& id);
  uint32_t freeBytes() const;
  void collectOrphans();
private:
  uint32_t sequence(const char* name, JsonDocument* result = nullptr);
};
