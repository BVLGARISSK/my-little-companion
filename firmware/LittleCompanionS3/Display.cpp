#include "Display.h"
#include "Config.h"
#include <Wire.h>
#include <math.h>
#include <esp_random.h>

static const char* emotions[] = {"neutral", "happy", "sad", "surprised", "sleepy", "angry"};
Display::Display(Storage& s) : store(s), oled(U8G2_R0, U8X8_PIN_NONE, config::SCL_PIN, config::SDA_PIN) {}
void Display::begin() { Wire.begin(config::SDA_PIN, config::SCL_PIN); Wire.setTimeOut(25); scan(); }
void Display::scan() {
  lastScan = millis(); address = 0;
  for (uint8_t a : {uint8_t(0x3c), uint8_t(0x3d)}) {
    Wire.beginTransmission(a); if (Wire.endTransmission() == 0) { address = a; break; }
  }
  if (!address) { Serial.println("OLED missing at 0x3C/0x3D."); return; }
  oled.setI2CAddress(address << 1); oled.setBusClock(config::I2C_HZ); oled.begin(); oled.setContrast(level); oled.setPowerSave(0);
  Serial.printf("OLED SH1106 SDA=%u SCL=%u address=0x%02x\n", config::SDA_PIN, config::SCL_PIN, address);
}
void Display::stopMedia() { file.close(); currentId = ""; }
void Display::emotion(const String& name, bool automatic) {
  stopMedia(); mood = name; mode = automatic ? AUTO : MANUAL; lastMood = millis();
}
bool Display::playMedia(const String& id, bool repeat) {
  JsonObject item = store.find(id); if (item.isNull()) return false;
  File next = LittleFS.open(item["path"].as<String>(), "r"); uint8_t head[21]; media::Header h;
  if (!next || next.read(head, 21) != 21 || !media::header(head, next.size(), h)) return false;
  stopMedia(); file = next; header = h; mediaSince = millis(); mediaRepeat = repeat; currentId = id; mode = MEDIA; return true;
}
bool Display::nextItem(bool first) {
  JsonArrayConst items = store.playlist["items"].as<JsonArrayConst>();
  int count = items.size(); if (!count) return false;
  String order = store.playlist["mode"] | "loop";
  int start = first ? -1 : playlistIndex;
  if (order == "shuffle") start = int(esp_random() % count) - 1;
  for (int step = 1; step <= count; ++step) {
    int index = (start + step) % count;
    if (!first && order == "once" && index <= playlistIndex) return false;
    JsonObjectConst item = items[index]; if (!item["enabled"].as<bool>()) continue;
    if (item["type"] == "emotion") { stopMedia(); mood = item["id"].as<String>(); }
    else if (!playMedia(item["id"].as<String>(), item["repeat"] | true)) continue;
    playlistIndex = index; itemSince = millis(); mode = PLAYLIST; return true;
  }
  return false;
}
bool Display::playPlaylist() { return nextItem(true); }
void Display::brightness(uint8_t value) { level = value; if (address) oled.setContrast(value); }
void Display::rotate(bool upsideDown) { oled.setDisplayRotation(upsideDown ? U8G2_R2 : U8G2_R0); }
String Display::modeName() const { return mode == AUTO ? "auto" : mode == MANUAL ? "emotion" : mode == MEDIA ? "media" : "playlist"; }
void Display::drawEmotion(uint32_t now) {
  memset(frame, 0, sizeof(frame));
  auto pixel = [&](int x, int y, bool lit = true) { if (x >= 0 && x < 128 && y >= 0 && y < 64) { if (lit) frame[y * 16 + x / 8] |= 1 << (x % 8); else frame[y * 16 + x / 8] &= ~(1 << (x % 8)); } };
  auto rect = [&](int x, int y, int w, int h, int r = 0) {
    for (int yy = y; yy < y + h; ++yy) for (int xx = x; xx < x + w; ++xx) {
      int dx = max(max(x + r - xx, 0), xx - (x + w - 1 - r)), dy = max(max(y + r - yy, 0), yy - (y + h - 1 - r));
      if (!r || dx * dx + dy * dy <= r * r) pixel(xx, yy);
    }
  };
  bool blink = now % 4200 > 3900; int look = lroundf(sinf(now / 2100.f) * 3);
  int h = 22, w = 17, y = 19;
  if (mood == "surprised") { h = 29; w = 20; y = 15; }
  if (mood == "sleepy") { h = 7; y = 28; }
  if (mood == "sad") { h = 17; y = 25; }
  if (blink) { h = 3; y = 31; }
  for (int x : {40 + look, 88 + look}) {
    if (mood == "happy" && !blink) for (int a = -11; a <= 11; ++a) rect(x + a, 23 + lroundf(a * a / 23.f), 4, 6, 1);
    else rect(x - w / 2, y, w, h, min(6, h / 2));
  }
  if (mood == "angry" && !blink) {
    for (int x = 29; x < 52; ++x) for (int yy = 17; yy < 22 + (x - 29) / 3.f; ++yy) pixel(x + look, yy, false);
    for (int x = 77; x < 100; ++x) for (int yy = 17; yy < 22 + (100 - x) / 3.f; ++yy) pixel(x + look, yy, false);
  }
  if (mood == "happy") for (int a = -8; a <= 8; ++a) rect(64 + a + look, 50 - lroundf(a * a / 24.f), 2, 3, 1);
  else if (mood == "sad") for (int a = -7; a <= 7; ++a) rect(64 + a + look, 48 + lroundf(a * a / 24.f), 2, 3, 1);
  else if (mood == "surprised") rect(59 + look, 47, 10, 10, 4);
  else rect(58 + look, 51, 12, mood == "sleepy" ? 2 : 3, 1);
}
void Display::update() {
  uint32_t now = millis();
  if (!address) { if (now - lastScan > 3000) scan(); return; }
  if (now - lastFrame < 100) return;
  lastFrame = now;
  if (mode == AUTO && now - lastMood >= 6000) { mood = emotions[esp_random() % 6]; lastMood = now; }
  if (mode == PLAYLIST && now - itemSince >= store.playlist["items"][playlistIndex]["duration_ms"].as<uint32_t>()) {
    if (!nextItem()) { if (file) mode = MEDIA; else mode = MANUAL; }
  }
  now = millis();
  if (file) {
    uint32_t i = (uint64_t(now - mediaSince) * header.fps) / 1000;
    i = mediaRepeat ? i % header.frames : min(i, uint32_t(header.frames - 1));
    if (!file.seek(21 + i * 1024) || file.read(frame, 1024) != 1024) { emotion("sad", false); drawEmotion(now); }
  } else drawEmotion(now);
  oled.clearBuffer(); oled.drawXBM(0, 0, 128, 64, frame); oled.sendBuffer();
  frameCrc = media::crc32(frame, sizeof(frame)); ++framesSent;
}
