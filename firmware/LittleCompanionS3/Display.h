#pragma once
#include <Arduino.h>
#include <U8g2lib.h>
#include "Storage.h"

class Display {
public:
  explicit Display(Storage& store);
  void begin(); void update();
  void emotion(const String& name, bool automatic);
  bool playMedia(const String& id, bool repeat = true);
  bool playPlaylist();
  void brightness(uint8_t value);
  void rotate(bool upsideDown);
  String modeName() const;
  String currentId;
  uint32_t framesSent = 0, frameCrc = 0;
  uint8_t address = 0;
  uint8_t level = 160;
private:
  Storage& store;
  U8G2_SH1106_128X64_NONAME_F_HW_I2C oled;
  enum Mode { AUTO, MANUAL, MEDIA, PLAYLIST } mode = AUTO;
  String mood = "neutral";
  File file;
  media::Header header = {};
  bool mediaRepeat = true;
  uint32_t itemSince = 0, mediaSince = 0, lastFrame = 0, lastMood = 0, lastScan = 0;
  int playlistIndex = -1;
  uint8_t frame[1024] = {};
  void scan(); void drawEmotion(uint32_t now); bool nextItem(bool first = false);
  void stopMedia();
};
