#pragma once
#include <Arduino.h>
#include <U8g2lib.h>
#include "Storage.h"
#include "SubtitleFormat.h"
#include <memory>

class Display {
public:
  explicit Display(Storage& store);
  void begin(bool initialSleep=false); void update();
  void emotion(const String& name, bool automatic);
  bool nextEmotion();
  bool returnFromSubtitle();
  bool pinSubtitle(const String& id);
  bool hasPinnedSubtitle() const {return subtitlePinned;}
  bool pinnedSubtitle() const {return subtitlePinned&&bool(subtitleBitmap)&&!toolState.type&&!overlay;}
  bool navigate(int direction);
  bool expressionContext() const { return mode==AUTO||mode==MANUAL||(subtitleBitmap&&subtitleSettings.face); }
  bool transientEmotion(const String& name,uint32_t duration=1800);
  bool transientMedia(const String& id);
  void greet();
  void look(float x,float y) { lookX=x;lookY=y; }
  void badges(bool locked,bool low) { if(locked!=lockedBadge||low!=lowBadge)forceFull=true;lockedBadge=locked;lowBadge=low; }
  void dimContrast(uint8_t value) { dimLevel=value;brightness(level); }
  enum Tool : uint8_t { NO_TOOL, CLOCK, TIMER, DICE, MAZE, DODGE };
  struct ToolState { uint8_t type=0;float x=12,y=12;float obstacleX[3]={20,64,108},obstacleY[3]={-8,-28,-48};uint32_t score=0;uint8_t dice=1;bool over=false; };
  void tool(Tool value);void clearTool();void restartGame();void gameInput(float x,float y);
  Tool currentTool() const {return Tool(toolState.type);}
  bool temporaryPlayback() const {return overlay;}
  ToolState toolCheckpoint() const {return toolState;}
  void restoreTool(const ToolState& value);
  void clockView(bool valid,int64_t epochMs,int offset) {clockValid=valid;clockEpoch=epochMs;clockOffset=offset;}
  void timerView(uint32_t seconds,uint32_t total,const char* phase,bool paused) {timerSeconds=seconds;timerTotal=total;timerPhase=phase;timerPaused=paused;}
  String emotionName() const { return mood; }
  void motion(float level, float x, float y);
  bool playMedia(const String& id, bool repeat = true);
  bool playPlaylist();
  void brightness(uint8_t value);
  void rotate(bool upsideDown);
  void safeClock(bool safe);
  void sleep(bool value);
  void dim(bool value);
  bool dimmed() const { return dimmedNow; }
  uint32_t updateInterval() const;
  struct Checkpoint {
    uint32_t mediaElapsed=0,itemElapsed=0,moodElapsed=0;
    int16_t playlistIndex=-1; uint8_t mode=0; bool repeat=true,pinned=false;
    char mediaId[33]={}, mood[16]={};
  };
  Checkpoint checkpoint() const;
  bool restore(const Checkpoint& value);
  bool sleeping() const { return asleep; }
  bool keepAwake() const { return !toolState.type && subtitleBitmap && subtitleSettings.keepAwake; }
  void diagnostics(JsonDocument& d) const;
  unsigned idleDelayMs() const;
  String modeName() const;
  void playbackStatus(JsonDocument& d) const;
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
  bool mediaRepeat = true,subtitlePinned=false;
  uint32_t itemSince = 0, mediaSince = 0, lastFrame = 0, lastMood = 0, lastScan = 0;
  int playlistIndex = -1;
  uint8_t frame[1024] = {};
  uint8_t displayed[1024] = {};
  uint32_t cachedFrame = UINT32_MAX, busHz = 400000;
  uint32_t fullUpdates = 0, partialUpdates = 0, skipped = 0, mediaReads = 0;
  uint32_t lastFlushUs = 0, maxFlushUs = 0, fallbacks = 0;
  uint64_t totalFlushUs = 0;
  uint8_t failedUpdates = 0;
  bool forceFull = true;
  bool asleep = false;
  bool wakePending=false;
  uint32_t wakeStartedUs=0,wakeLastUs=0,wakeMaxUs=0,wakeCount=0;
  bool dimmedNow=false;
  uint32_t sleepStartedAt = 0;
  float shakeLevel = 0.f, shakeX = 0.f, shakeY = 0.f;
  std::unique_ptr<uint8_t[]> subtitleBitmap;
  subtitles::Settings subtitleSettings;
  uint32_t subtitlePhase = UINT32_MAX;
  uint32_t subtitleTick = UINT32_MAX;
  uint32_t subtitleRenders=0,subtitleMissed=0,subtitleLastUs=0,subtitleMaxGapUs=0,subtitleMaxLateMs=0;
  uint32_t subtitleGapBins[6]={};
  uint8_t faceFrame[1024] = {};
  float lookX=0,lookY=0,inputX=0,inputY=0;
  uint8_t dimLevel=64;
  bool lockedBadge=false,lowBadge=false,overlay=false,greeting=false;
  uint32_t overlayUntil=0,greetingSince=0,gameSince=0,diceSince=0;
  Checkpoint overlayBase{},toolBase{};
  ToolState toolState;
  bool rotated=false;
  bool clockValid=false,timerPaused=false;
  int64_t clockEpoch=0;int clockOffset=480;
  uint32_t timerSeconds=0,timerTotal=0;const char* timerPhase="COUNTDOWN";
  void drawTool(uint32_t now);void canvasToFrame();
  void drawSubtitle(uint32_t now);
  void scan(); void drawEmotion(uint32_t now); bool nextItem(bool first = false);
  void stopMedia();
  void flush(); void recoverBus();
};
