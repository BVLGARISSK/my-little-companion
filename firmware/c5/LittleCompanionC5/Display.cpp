#include "Display.h"
#include "Config.h"
#include <Wire.h>
#include <math.h>
#include <esp_random.h>
#include "DisplayDiff.h"
#include "SubtitleTiming.h"
#include "PlaylistNavigation.h"

namespace {
// The stock U8g2 Wire callback discards ACK errors. Keep its SH1106
// command driver, but count actual transactions and detect failed writes.
struct BusStats { uint32_t errors = 0; uint64_t bytes = 0; uint16_t pending = 0; bool failed = false; } bus;
uint8_t checkedWire(u8x8_t* u8x8, uint8_t msg, uint8_t length, void* data) {
  switch (msg) {
    case U8X8_MSG_BYTE_START_TRANSFER:
      bus.pending = 1; // device address, including its ACK clock
      return u8x8_byte_arduino_hw_i2c(u8x8, msg, length, data);
    case U8X8_MSG_BYTE_SEND:
      if (Wire.write(static_cast<uint8_t*>(data), length) != length) {
        bus.failed = true; ++bus.errors;
      }
      bus.pending += length;
      return 1;
    case U8X8_MSG_BYTE_END_TRANSFER:
      if (Wire.endTransmission() != 0) { bus.failed = true; ++bus.errors; return 0; }
      bus.bytes += bus.pending;
      return 1;
    default: return u8x8_byte_arduino_hw_i2c(u8x8, msg, length, data);
  }
}
}

static const char* emotions[] = {"neutral", "happy", "sad", "surprised", "sleepy", "angry"};
Display::Display(Storage& s) : store(s), oled(U8G2_R0, U8X8_PIN_NONE, config::SCL_PIN, config::SDA_PIN) {}
void Display::begin(bool initialSleep) {
  asleep=initialSleep; sleepStartedAt=millis();
  busHz = config::I2C_HZ;
  oled.getU8x8()->byte_cb = checkedWire;
  Wire.begin(config::SDA_PIN, config::SCL_PIN); Wire.setTimeOut(25); scan();
}
void Display::scan() {
  lastScan = millis(); address = 0;
  Wire.setClock(config::I2C_SAFE_HZ);
  for (uint8_t a : {uint8_t(0x3c), uint8_t(0x3d)}) {
    Wire.beginTransmission(a); if (Wire.endTransmission() == 0) { address = a; break; }
  }
  if (!address) { Serial.println("OLED missing at 0x3C/0x3D."); return; }
  // Initialize conservatively. Only frame transfers use the selected faster clock.
  bus.failed = false;
  oled.setI2CAddress(address << 1); oled.setBusClock(config::I2C_SAFE_HZ); oled.begin(); oled.setContrast(dimmedNow?min(level,dimLevel):level); oled.setPowerSave(asleep||wakePending?1:0);
  forceFull = true;
  if (bus.failed) { address = 0; return; }
  oled.setBusClock(busHz);
  Serial.printf("OLED SH1106 SDA=%u SCL=%u address=0x%02x clock=%lu\n", config::SDA_PIN, config::SCL_PIN, address, (unsigned long)busHz);
}
void Display::stopMedia() {
  subtitleRenders=subtitleMissed=subtitleLastUs=subtitleMaxGapUs=subtitleMaxLateMs=0;
  memset(subtitleGapBins,0,sizeof(subtitleGapBins));
  subtitlePinned=false;file.close(); subtitleBitmap.reset(); subtitlePhase = subtitleTick = UINT32_MAX; currentId = ""; cachedFrame = UINT32_MAX; lastFrame = 0; }
void Display::emotion(const String& name, bool automatic) {
  overlay=false;greeting=false;toolState.type=NO_TOOL;stopMedia(); mood = name; mode = automatic ? AUTO : MANUAL; lastMood = millis();
}
bool Display::nextEmotion() {
  // A short touch must not close a media file or interrupt a playlist.
  if (overlay || toolState.type || (mode != AUTO && mode != MANUAL)) return false;
  unsigned index = 0;
  for (unsigned i = 0; i < 6; ++i) if (mood == emotions[i]) { index = i; break; }
  emotion(emotions[(index + 1) % 6], false); return true;
}
void Display::motion(float level, float x, float y) {
  shakeLevel = level; shakeX = x; shakeY = y;
}
bool Display::playMedia(const String& id, bool repeat) {
  JsonObject item = store.find(id); if (item.isNull()) return false;
  File next = LittleFS.open(item["path"].as<String>(), "r"); uint8_t head[21]; media::Header h;
  if (!next || next.read(head, 21) != 21 || !media::header(head, next.size(), h)) return false;
  if (item["kind"] == "subtitle") {
    subtitles::Settings settings;
    if (!settings.read(item["subtitle"]) || settings.tiles() != h.frames) return false;
    const size_t bytes = size_t(h.frames) * 1024;
    std::unique_ptr<uint8_t[]> bitmap(new (std::nothrow) uint8_t[bytes]);
    if (!bitmap || next.read(bitmap.get(), bytes) != bytes || media::crc32(bitmap.get(), bytes) != h.payloadCrc) return false;
    next.close(); overlay=false;greeting=false;toolState.type=NO_TOOL;stopMedia(); subtitleBitmap = std::move(bitmap); subtitleSettings = settings;
    mood = subtitles::moods[settings.emotion]; mediaSince = millis(); mediaRepeat = repeat;
    currentId = id; mode = MEDIA; return true;
  }
  overlay=false;greeting=false;toolState.type=NO_TOOL;stopMedia(); file = next; header = h; mediaSince = millis(); mediaRepeat = repeat; currentId = id; mode = MEDIA; return true;
}
bool Display::nextItem(bool first) {
  JsonArrayConst items = store.playlist["items"].as<JsonArrayConst>();
  int count = items.size(); if (!count) return false;
  String order = store.playlist["mode"] | "loop";
  int start = first ? -1 : playlistIndex;
  // Shuffle enabled candidates, not positions followed by a forward scan.
  // A failed media candidate is removed and another remaining candidate drawn.
  uint64_t candidates=0;
  if(order=="shuffle")for(int i=0;i<count;++i)if(items[i]["enabled"].as<bool>())candidates|=uint64_t(1)<<i;
  for (int step = 1; step <= count; ++step) {
    int index = (start + step) % count;
    if(order=="shuffle"){
      unsigned remaining=playlistnav::population(candidates);if(!remaining)return false;
      uint32_t random,limit=UINT32_MAX-(UINT32_MAX%remaining);
      do{random=esp_random();}while(random>=limit);
      index=playlistnav::rank(candidates,random%remaining);candidates&=~(uint64_t(1)<<index);
    }
    if (!first && order == "once" && index <= playlistIndex) return false;
    JsonObjectConst item = items[index]; if (!item["enabled"].as<bool>()) continue;
    if (item["type"] == "emotion") { stopMedia(); mood = item["id"].as<String>(); }
    else if (!playMedia(item["id"].as<String>(), item["repeat"] | true)) continue;
    playlistIndex = index; itemSince = millis(); mode = PLAYLIST; return true;
  }
  return false;
}
bool Display::playPlaylist() {
  if(!nextItem(true))return false;
  overlay=false;greeting=false;toolState.type=NO_TOOL;forceFull=true;return true;
}
void Display::brightness(uint8_t value) {
  level = value;
  if (address) {
    bus.failed = false; oled.setContrast(dimmedNow?min(level,dimLevel):level);
    if (bus.failed) { recoverBus(); address = 0; lastScan = millis(); }
  }
}
void Display::dim(bool value) {
  if(dimmedNow==value) return;
  dimmedNow=value; brightness(level);
}
uint32_t Display::updateInterval() const {
  if(toolState.type==MAZE||toolState.type==DODGE) return 50;
  if(toolState.type==DICE) return millis()-diceSince<600?33:1000;
  if(toolState.type) return 1000;
  if(greeting) return 33;
  if(subtitleBitmap) {
    if(subtitleSettings.face) return shakeLevel>0.f?33:50;
    if(!subtitleSettings.motion) return 1000;
    unsigned rate=subtitletiming::rate(subtitleSettings.speed);
    return (1000u+rate-1)/rate;
  }
  if(file) return header.frames==1?1000:max(33u,1000u/header.fps);
  return shakeLevel>0.f?33:50;
}
Display::Checkpoint Display::checkpoint() const {
  if(toolState.type)return toolBase;
  if(overlay)return overlayBase;
  Checkpoint c; uint32_t now=asleep?sleepStartedAt:millis();
  c.mode=mode;c.repeat=mediaRepeat;c.pinned=subtitlePinned;c.playlistIndex=playlistIndex;
  c.mediaElapsed=now-mediaSince;c.itemElapsed=now-itemSince;c.moodElapsed=now-lastMood;
  currentId.toCharArray(c.mediaId,sizeof(c.mediaId));mood.toCharArray(c.mood,sizeof(c.mood));
  return c;
}
bool Display::restore(const Checkpoint& c) {
  if(c.mode>PLAYLIST || !memchr(c.mediaId,0,sizeof(c.mediaId)) || !memchr(c.mood,0,sizeof(c.mood))) return false;
  overlay=false;greeting=false;toolState.type=NO_TOOL;
  if(c.mode==PLAYLIST) {
    JsonArrayConst items=store.playlist["items"].as<JsonArrayConst>();
    if(c.playlistIndex<0 || size_t(c.playlistIndex)>=items.size()) return false;
    JsonObjectConst item=items[c.playlistIndex];
    if(!item["enabled"].as<bool>()) return false;
    if(item["type"]=="emotion") { stopMedia();mood=item["id"].as<String>(); }
    else if(item["id"]!=c.mediaId || !playMedia(c.mediaId,c.repeat)) return false;
    playlistIndex=c.playlistIndex;mode=PLAYLIST;
  } else if(c.mode==MEDIA) { if(!playMedia(c.mediaId,c.repeat)) return false; }
  else {
    bool valid=false;for(const char* name:emotions) if(!strcmp(name,c.mood)) valid=true;
    if(!valid) return false;emotion(c.mood,c.mode==AUTO);
  }
  if(c.pinned){if(c.mode!=MEDIA||!subtitleBitmap)return false;subtitlePinned=true;}
  uint32_t now=millis();mediaSince=now-c.mediaElapsed;itemSince=now-c.itemElapsed;lastMood=now-c.moodElapsed;
  sleepStartedAt=now;forceFull=true;lastFrame=0;return true;
}
void Display::rotate(bool upsideDown) { if(rotated==upsideDown)return;rotated=upsideDown;oled.setDisplayRotation(upsideDown ? U8G2_R2 : U8G2_R0); forceFull = true; lastFrame = 0; }
void Display::safeClock(bool safe) {
  busHz = safe ? config::I2C_SAFE_HZ : config::I2C_HZ;
  oled.setBusClock(busHz); forceFull = true; lastFrame = 0;
}
void Display::sleep(bool value) {
  if (asleep == value) return;
  uint32_t now = millis();
  if (value) { sleepStartedAt = now;wakePending=false; }
  else {
    // Pause media and playlist time during display sleep, including long animations.
    uint32_t paused = now - sleepStartedAt;
    if(overlay)overlayUntil+=paused;if(greeting)greetingSince+=paused;gameSince=now;
    if (file || subtitleBitmap) mediaSince += paused;
    itemSince += paused; lastMood += paused;
    forceFull = true; lastFrame = 0;
    // Keep the panel dark until the first resumed frame has reached OLED RAM.
    // In particular, never display old RAM while a USB debug print is waiting.
    wakePending=true;wakeStartedUs=micros();
  }
  subtitleLastUs=0; // Display sleep is an intentional pause, not a missed frame.
  asleep = value;
  if (address && value) {
    bus.failed = false; oled.setPowerSave(1);
    if (bus.failed) recoverBus();
  }
  // Sleep/wake diagnostics are available through STATUS; do not block this
  // time-sensitive path on an unopened or stalled USB console.
}
void Display::diagnostics(JsonDocument& d) const {
  d["display_sleeping"] = asleep;
  d["display_waking"]=wakePending;d["display_wake_count"]=wakeCount;
  d["display_wake_last_us"]=wakeLastUs;d["display_wake_max_us"]=wakeMaxUs;
  d["display_dimmed"] = dimmedNow; d["display_interval_ms"] = updateInterval();
  d["emotion"] = mood;
  d["motion_reaction"] = (mode == AUTO || mode == MANUAL || (subtitleBitmap && subtitleSettings.face)) && shakeLevel > 0.f ? "dizzy" : "none";
  d["subtitle_active"] = bool(subtitleBitmap);d["subtitle_pinned"]=subtitlePinned;
  d["navigation_scope"] = "playlist";
  if(subtitleBitmap){
    d["subtitle_speed"]=subtitleSettings.speed;d["subtitle_motion"]=subtitles::motions[subtitleSettings.motion];
    d["subtitle_face"]=subtitleSettings.face;d["subtitle_tick"]=subtitleTick;
    d["subtitle_timing"]=subtitleSettings.motion&&!subtitleSettings.face?"absolute":"interval";
    d["subtitle_render_count"]=subtitleRenders;d["subtitle_missed_ticks"]=subtitleMissed;
    d["subtitle_max_gap_us"]=subtitleMaxGapUs;d["subtitle_max_late_ms"]=subtitleMaxLateMs;
    auto gaps=d["subtitle_gap_bins"].to<JsonArray>();for(auto count:subtitleGapBins)gaps.add(count);
  }
  d["display_i2c_hz"] = busHz; d["display_i2c_errors"] = bus.errors;
  d["display_wire_bytes"] = bus.bytes; d["display_full_updates"] = fullUpdates;
  d["display_partial_updates"] = partialUpdates; d["display_skipped"] = skipped;
  d["display_media_reads"] = mediaReads; d["display_last_flush_us"] = lastFlushUs;
  d["display_max_flush_us"] = maxFlushUs; d["display_total_flush_us"] = totalFlushUs;
  d["display_fallbacks"] = fallbacks;
}
void Display::recoverBus() {
  forceFull = true;
  if (busHz != config::I2C_SAFE_HZ) {
    busHz = config::I2C_SAFE_HZ; oled.setBusClock(busHz); ++fallbacks;
    Serial.println("OLED transfer error; falling back to 100 kHz and full resync.");
  }
  if (++failedUpdates >= 3) { address = 0; lastScan = millis(); }
}
void Display::flush() {
  memcpy(faceFrame,frame,sizeof(frame));
  struct RestoreFrame {uint8_t* to;const uint8_t* from;~RestoreFrame(){memcpy(to,from,1024);}} restoreFrame{frame,faceFrame};
  auto dot=[&](int x,int y){if(x>=0&&x<128&&y>=0&&y<64)frame[y*16+x/8]|=1<<(x%8);};
  if(lowBadge){for(int x=116;x<125;++x){dot(x,1);dot(x,7);}for(int y=1;y<8;++y){dot(116,y);dot(124,y);}dot(125,3);dot(125,4);for(int y=3;y<6;++y)dot(118,y);}
  if(lockedBadge){for(int x=105;x<112;++x){dot(x,4);dot(x,9);}for(int y=4;y<10;++y){dot(105,y);dot(111,y);}dot(107,2);dot(108,1);dot(109,2);dot(107,3);dot(109,3);}
  oled.clearBuffer(); oled.drawXBM(0, 0, 128, 64, frame);
  const uint8_t* current = oled.getBufferPtr();
  displaydiff::Span spans[8]; uint16_t changedBytes = 0;
  if (!forceFull) {
    for (uint8_t page = 0; page < 8; ++page) {
      spans[page] = displaydiff::page(displayed + page * 128, current + page * 128);
      if (spans[page].first < spans[page].end) changedBytes += (spans[page].end - spans[page].first) * 8;
    }
    if (!changedBytes) { ++skipped; return; }
  }
  const bool full = forceFull || changedBytes >= 768;
  bus.failed = false; const uint32_t started = micros();
  if (full) oled.sendBuffer();
  else for (uint8_t page = 0; page < 8 && !bus.failed; ++page) {
    const auto span = spans[page];
    if (span.first < span.end) oled.updateDisplayArea(span.first, page, span.end - span.first, 1);
  }
  lastFlushUs = micros() - started; maxFlushUs = max(maxFlushUs, lastFlushUs); totalFlushUs += lastFlushUs;
  if (bus.failed) { recoverBus(); return; }
  if(wakePending&&!asleep){
    oled.setPowerSave(0);
    if(bus.failed){recoverBus();return;}
    wakePending=false;wakeLastUs=micros()-wakeStartedUs;wakeMaxUs=max(wakeMaxUs,wakeLastUs);++wakeCount;
  }
  memcpy(displayed, current, sizeof(displayed)); forceFull = false; failedUpdates = 0;
  full ? ++fullUpdates : ++partialUpdates;
  frameCrc = media::crc32(frame, sizeof(frame)); ++framesSent;
}
String Display::modeName() const { return mode == AUTO ? "auto" : mode == MANUAL ? "emotion" : mode == MEDIA ? (subtitleBitmap ? "subtitle" : "media") : "playlist"; }
void Display::drawEmotion(uint32_t now) {
  memset(frame, 0, sizeof(frame));
  auto pixel = [&](int x, int y, bool lit = true) { if (x >= 0 && x < 128 && y >= 0 && y < 64) { if (lit) frame[y * 16 + x / 8] |= 1 << (x % 8); else frame[y * 16 + x / 8] &= ~(1 << (x % 8)); } };
  auto rect = [&](int x, int y, int w, int h, int r = 0) {
    for (int yy = y; yy < y + h; ++yy) for (int xx = x; xx < x + w; ++xx) {
      int dx = max(max(x + r - xx, 0), xx - (x + w - 1 - r)), dy = max(max(y + r - yy, 0), yy - (y + h - 1 - r));
      if (!r || dx * dx + dy * dy <= r * r) pixel(xx, yy);
    }
  };
  if ((mode == AUTO || mode == MANUAL || (subtitleBitmap && subtitleSettings.face)) && shakeLevel > 0.f) {
    // Spiral eyes and a queasy mouth wobble with the measured shake and settle.
    int dx = lroundf(shakeLevel * (shakeX + 3.f * sinf(now / 55.f)));
    int dy = lroundf(shakeLevel * (shakeY + 2.f * cosf(now / 70.f)));
    for (int eye : {40, 88}) {
      for (unsigned i = 0; i < 130; ++i) {
        float a = i * 0.10f + sinf(now / 110.f) * shakeLevel * 0.55f;
        float radius = 1.f + i * 0.072f;
        int x = eye + dx + lroundf(cosf(a) * radius);
        int y = 28 + dy + lroundf(sinf(a) * radius);
        rect(x, y, 2, 2);
      }
    }
    for (int x = -13; x <= 13; ++x)
      rect(64 + dx + x, 51 + dy + lroundf(sinf(x / 3.f + now / 120.f) * 2.f), 2, 2);
    // A small sweat drop accompanies the temporary nausea expression.
    rect(107 + dx, 15 + dy, 3, 6, 1); rect(106 + dx, 19 + dy, 5, 5, 2);
    return;
  }
  bool blink = now % 4200 > 3900; int look = lroundf(sinf(now / 2100.f) * 2+lookX*10),lookDown=lroundf(lookY*7);
  int h = 22, w = 17, y = 19;
  if (mood == "surprised") { h = 29; w = 20; y = 15; }
  if (mood == "sleepy") { h = 7; y = 28; }
  if (mood == "sad") { h = 17; y = 25; }
  if (blink) { h = 3; y = 31; }
  if(greeting){float phase=min(1.f,float(now-greetingSince)/1500.f);h=max(3,int(h*(1.f+.35f*sinf(phase*3.14159f))));y-=int(5*sinf(phase*3.14159f));}
  y+=lookDown;
  for (int x : {40 + look, 88 + look}) {
    if (mood == "happy" && !blink) for (int a = -11; a <= 11; ++a) rect(x + a, 23 + lookDown + lroundf(a * a / 23.f), 4, 6, 1);
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
void Display::drawSubtitle(uint32_t now) {
  const auto& c = subtitleSettings;
  const uint32_t elapsed = now - mediaSince;
  int dx = c.motion == 1 ? subtitles::origin(c.width,128,c.speed,elapsed,c.reverse,mediaRepeat) : 0;
  int dy = c.motion == 2 ? subtitles::origin(c.height,c.viewport,c.speed,elapsed,c.reverse,mediaRepeat) : 0;
  uint32_t phase = (uint32_t(dx + 4096) << 16) | uint32_t(dy + 4096);
  if (!c.face && phase == subtitlePhase && !forceFull) { ++skipped; return; }
  subtitlePhase = phase;
  unsigned top = 64 - c.viewport;
  if (c.face) { drawEmotion(now); memcpy(faceFrame,frame,sizeof(frame)); }
  memset(frame,0,sizeof(frame));
  auto put = [&](unsigned x,unsigned y) { frame[y*16+x/8] |= 1 << (x%8); };
  if (c.face) {
    unsigned width = top * 2,left = (128 - width)/2;
    for (unsigned y=0;y<top;++y) for (unsigned x=0;x<width;++x) {
      unsigned sx=x*128/width,sy=y*64/top;
      if (faceFrame[sy*16+sx/8] & (1 << (sx%8))) put(left+x,y);
    }
  }
  for (unsigned y=0;y<c.viewport;++y) for (unsigned x=0;x<128;++x)
    if (subtitles::pixel(subtitleBitmap.get(),c.width,c.height,int(x)-dx,int(y)-dy)) put(x,top+y);
  flush();
}
unsigned Display::idleDelayMs() const {
  if(subtitleBitmap&&subtitleSettings.motion&&!subtitleSettings.face&&!asleep)
    return subtitletiming::waitMs(millis()-mediaSince,subtitleSettings.speed);
  return 5;
}
void Display::update() {
  if (asleep) return;
  uint32_t now = millis();
  if(greeting&&now-greetingSince>=1500)greeting=false;
  if(overlay&&int32_t(now-overlayUntil)>=0){auto base=overlayBase;overlay=false;restore(base);}
  if (!address) { if (now - lastScan > 3000) scan(); return; }
  if(toolState.type){if(now-lastFrame>=updateInterval()||forceFull){lastFrame=now;drawTool(now);flush();}return;}
  if (mode == AUTO && shakeLevel > 0.f) lastMood = now;
  if (mode == AUTO && now - lastMood >= 6000) { mood = emotions[esp_random() % 6]; lastMood = now; }
  if (mode == PLAYLIST && now - itemSince >= store.playlist["items"][playlistIndex]["duration_ms"].as<uint32_t>()) {
    if (!nextItem()) { if (file || subtitleBitmap) mode = MEDIA; else mode = MANUAL; }
  }
  now = millis();
  if(subtitleBitmap&&subtitleSettings.motion&&!subtitleSettings.face){
    uint32_t elapsed=now-mediaSince;
    if(!subtitletiming::due(elapsed,subtitleSettings.speed,subtitleTick,forceFull))return;
    uint32_t current=subtitletiming::tick(elapsed,subtitleSettings.speed);
    uint32_t stamp=micros();
    if(subtitleTick!=UINT32_MAX&&!forceFull){
      if(current>subtitleTick+1)subtitleMissed+=current-subtitleTick-1;
      if(subtitleLastUs){
        uint32_t gap=stamp-subtitleLastUs;subtitleMaxGapUs=max(subtitleMaxGapUs,gap);
        unsigned bin=gap<=40000?0:gap<=60000?1:gap<=100000?2:gap<=250000?3:gap<=1000000?4:5;
        ++subtitleGapBins[bin];
      }
      unsigned rate=subtitletiming::rate(subtitleSettings.speed);
      uint32_t deadline=(uint64_t(current)*1000+rate-1)/rate;
      subtitleMaxLateMs=max(subtitleMaxLateMs,elapsed-deadline);
    }
    subtitleTick=current;subtitleLastUs=stamp;++subtitleRenders;
    lastFrame=now;drawSubtitle(now);return;
  }
  if(now-lastFrame<updateInterval() && !forceFull) return;
  lastFrame=now;
  if (subtitleBitmap) { drawSubtitle(now); return; }
  if (file) {
    uint32_t i = (uint64_t(now - mediaSince) * header.fps) / 1000;
    i = mediaRepeat ? i % header.frames : min(i, uint32_t(header.frames - 1));
    if (i == cachedFrame && !forceFull) { if(lockedBadge||lowBadge)flush();else ++skipped; return; }
    if (i != cachedFrame) {
      ++mediaReads;
      if (!file.seek(21 + i * 1024) || file.read(frame, 1024) != 1024) { emotion("sad", false); drawEmotion(now); }
      else cachedFrame = i;
    }
  } else drawEmotion(now);
  flush();
}
