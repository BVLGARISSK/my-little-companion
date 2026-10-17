#include "Companion.h"
#include "Config.h"
#include "BleWindow.h"
#include "Storage.h"
#include "Display.h"
#include "Hardware.h"
#include "PowerPolicy.h"
#include "Experience.h"
#include <esp_sleep.h>
#include <esp_timer.h>
#include <esp_system.h>
#include <esp_heap_caps.h>
#include <driver/rtc_io.h>
#include <driver/gpio.h>
#include <stddef.h>
#include <NimBLEDevice.h>
#include <Preferences.h>
#include <esp_random.h>
#include <esp_mac.h>
#include <mbedtls/md.h>
#include <mbedtls/gcm.h>
#include <atomic>
#include <deque>
#include <map>

namespace {
Storage storage;
Display screen(storage);
Hardware hardware;
uint32_t loopMaxUs=0,loopMaxSerialUs=0,loopMaxBleUs=0,loopMaxHardwareUs=0,loopMaxExperienceUs=0,loopMaxDisplayUs=0,loopMaxPowerUs=0,telemetryDropped=0;
Preferences preferences;
Preferences adminPreferences;
Experience experience(storage,screen,hardware);
NimBLEServer* server;
NimBLECharacteristic* events;
String deviceId;
uint8_t ownerKey[32];
uint8_t adminKey[32];
std::atomic<uint32_t> connectionEpoch{0}, storageFree{0}, storageTotal{0};
std::atomic<uint16_t> connectionHandle{BLE_HS_CONN_HANDLE_NONE}, mtu{23};
std::atomic<bool> connected{false}, subscribed{false};
uint32_t observedEpoch = 0, statusSince = 0;
BleWindow bleWindow(config::ADVERTISE_MS, config::UPLOAD_IDLE_MS);
bool wasConnected = false, advertising = false, windowClosed = false;
bool resetScheduled = false;
std::atomic<bool> powerEnabled{true};
bool radioReady=false;
std::atomic<bool> idleConnection{false};
std::atomic<uint32_t> lastBleTraffic{0};
uint32_t lightSleeps=0,deepWakes=0,bleShutdowns=0;
uint64_t lightSleepUs=0;
const char* lastSleep="none";
esp_sleep_wakeup_cause_t bootWake=ESP_SLEEP_WAKEUP_UNDEFINED;
struct RetainedPower {
  uint32_t magic=0; Display::Checkpoint playback;
  uint32_t lightCount=0,deepCount=0;uint64_t lightUs=0;
  bool irqVerified=false;Experience::Checkpoint extras;uint32_t crc=0;
};
RTC_DATA_ATTR RetainedPower retained;
constexpr uint32_t RETAINED_MAGIC=0x0710c5a1;
bool resumeFromDeep=false;
uint32_t powerWakeAt=0;
uint32_t resetScheduledAt = 0;
enum Source : uint8_t { BLE, USB };
struct Session {
  bool authorized = false;
  bool admin = false;
  String clientNonce, serverNonce;
  String resetToken;
  uint32_t challengedAt = 0;
  uint32_t resetPreparedAt = 0;
  void reset() { authorized = false; admin = false; clientNonce = ""; serverNonce = ""; resetToken = ""; }
} bleSession, usbSession;
struct Packet { uint32_t epoch; uint16_t handle, length; uint8_t kind; uint8_t bytes[244]; };
QueueHandle_t packets;
std::atomic<bool> overflowed{false};
struct Assembly { String text; uint16_t total = 0; uint32_t since = 0; };
std::map<uint16_t, Assembly> assemblies;
struct Outgoing { String text; uint16_t id, offset; uint32_t since; };
std::deque<Outgoing> outgoing;
struct Upload {
  bool active = false;
  uint16_t id = 0;
  uint32_t received = 0, durable = 0;
  uint8_t pendingPackets = 0;
  Source owner = BLE;
  JsonDocument meta;
  File file;
} upload;
constexpr char TEMP[] = "/temp/upload.part";

String hexBytes(const uint8_t* p, size_t n) {
  static const char digits[] = "0123456789abcdef"; String out; out.reserve(n * 2);
  for (size_t i = 0; i < n; ++i) { out += digits[p[i] >> 4]; out += digits[p[i] & 15]; }
  return out;
}
bool parseHex(const String& s, uint8_t* out, size_t n) {
  if (!media::hex(s.c_str(), n * 2, false)) return false;
  auto nibble = [](char c) -> uint8_t { return c <= '9' ? c - '0' : (c | 32) - 'a' + 10; };
  for (size_t i = 0; i < n; ++i) out[i] = (nibble(s[i * 2]) << 4) | nibble(s[i * 2 + 1]);
  return true;
}
uint16_t maxPacket() { return min(uint16_t(244), uint16_t(max(uint16_t(23), mtu.load()) - 3)); }
void updateStorageInfo() { storageFree = storage.freeBytes(); storageTotal = storage.ready ? LittleFS.totalBytes() : 0; }
void reply(Source source, uint16_t id, JsonVariantConst value) {
  String text; serializeJson(value, text);
  if (source == USB) { Serial.printf("@REPLY,%u,", id); Serial.println(text); return; }
  if (!connected || !subscribed || text.length() > config::MAX_JSON) return;
  // A newer unstarted ACK supersedes an older one; it confirms a larger durable prefix.
  if (id == 0) for (auto it = outgoing.rbegin(); it != outgoing.rend(); ++it) if (it->id == 0 && it->offset == 0) { it->text = text; return; }
  if (outgoing.size() < 8) outgoing.push_back({text, id, 0, millis()});
  else overflowed = true;
}
void fail(Source source, uint16_t id, const char* code, const String& message) {
  JsonDocument d; d["ok"] = false; d["error"] = code; d["message"] = message; reply(source, id, d.as<JsonVariantConst>());
}
void success(Source source, uint16_t id) { JsonDocument d; d["ok"] = true; reply(source, id, d.as<JsonVariantConst>()); }
void flushUpload() {
  if (upload.file) { upload.file.flush(); upload.durable = upload.received; upload.pendingPackets = 0; }
}
void ackUpload(Source source) {
  flushUpload();
  JsonDocument d; d["event"] = "upload_ack"; d["transfer_id"] = upload.id; d["offset"] = upload.durable;
  reply(source, 0, d.as<JsonVariantConst>());
}
void closeUpload() { flushUpload(); upload.file.close(); upload.active = false; }
bool clearUploadJournal() { JsonDocument d; d["active"] = false; return storage.saveJournal("upload", d.as<JsonVariantConst>()); }
void uploaded(Source source) { if (source == BLE) bleWindow.onUpload(millis()); }
void receiveData(Source source, uint16_t id, uint32_t offset, const uint8_t* bytes, size_t length) {
  Session& session = source == BLE ? bleSession : usbSession;
  if (resetScheduled || !session.authorized || !upload.active || source != upload.owner || id != upload.id || !length || length > 1024) return;
  uint32_t total = upload.meta["length"].as<uint32_t>();
  if (offset < upload.received && offset + length <= upload.received) { uploaded(source); ackUpload(source); return; }
  if (offset != upload.received || offset > total || length > total - offset) { ackUpload(source); return; }
  size_t written = upload.file.write(bytes, length); upload.received += written;
  if (written) uploaded(source);
  if (written != length) { ackUpload(source); closeUpload(); return; }
  if (++upload.pendingPackets >= config::UPLOAD_WINDOW || upload.received == total) ackUpload(source);
}
bool validEmotion(const String& s) { return s == "neutral" || s == "happy" || s == "sad" || s == "surprised" || s == "sleepy" || s == "angry"; }
void powerInfo(JsonDocument& d) {
  d["power_save_enabled"]=powerEnabled.load();d["whole_chip_sleep"]="awake";
  d["last_sleep"]=lastSleep;d["light_sleep_count"]=lightSleeps;d["deep_wake_count"]=deepWakes;
  d["light_sleep_ms"]=lightSleepUs/1000;d["cpu_mhz"]=getCpuFrequencyMhz();
  d["ble_stack_on"]=radioReady;d["ble_shutdowns"]=bleShutdowns;
  d["motion_interrupt_verified"]=hardware.interruptVerified();d["mpu_low_power"]=hardware.monitorActive();
  d["deep_sleep_ready"]=powerEnabled.load()&&experience.settings.deepS&&experience.settings.offS&&hardware.interruptVerified()&&hardware.sensorReady();
  d["dim_after_s"]=experience.settings.dimS;d["screen_off_after_s"]=experience.settings.offS;d["deep_after_s"]=experience.settings.deepS;
  d["display_dimmed"]=screen.dimmed();d["caption_keep_awake"]=screen.keepAwake();d["boot_wake_cause"]=unsigned(bootWake);
}
void memoryInfo(JsonDocument& d) {
  // Use the same capabilities for the pool size, free bytes and contiguous block.
  // This read stays on the main loop and does not reset motion or BLE idle timers.
  constexpr uint32_t caps=MALLOC_CAP_INTERNAL|MALLOC_CAP_8BIT;
  multi_heap_info_t info{};heap_caps_get_info(&info,caps);
  d["device_id"]=deviceId;d["ram_scope"]="internal_8bit_heap";
  d["ram_free"]=uint32_t(info.total_free_bytes);
  d["ram_total"]=uint32_t(heap_caps_get_total_size(caps));
  d["ram_largest_block"]=uint32_t(info.largest_free_block);
  d["ram_sampled_ms"]=millis();
}
void status(JsonDocument& d) {
  d["ok"] = true; d["protocol"] = "mlc/1"; d["device_id"] = deviceId; d["firmware"] = config::VERSION;
  d["oled_address"] = screen.address; d["sda"] = config::SDA_PIN; d["scl"] = config::SCL_PIN;
  d["storage_ready"] = storage.ready; d["storage_free"] = storageFree.load(); d["storage_total"] = storageTotal.load();
  d["mode"] = screen.modeName(); d["media_id"] = screen.currentId; d["frames_sent"] = screen.framesSent; d["frame_crc32"] = screen.frameCrc;
  screen.diagnostics(d);
  hardware.diagnostics(d);
  powerInfo(d);
  memoryInfo(d);
  experience.snapshot(d);
  d["brightness"] = screen.level; d["ble_connected"] = connected.load(); d["ble_authorized"] = bleSession.authorized;
  d["advertising"] = advertising; d["uptime_ms"] = millis();
  d["window_ms_left"] = windowClosed ? 0 : bleWindow.remaining(millis());
  d["ble_window_state"] = windowClosed ? "closed" : bleWindow.hasConnected() ? "upload_idle" : "discovery";
  d["loop_max_us"]=loopMaxUs;d["loop_max_serial_us"]=loopMaxSerialUs;d["loop_max_ble_us"]=loopMaxBleUs;
  d["loop_max_hardware_us"]=loopMaxHardwareUs;d["loop_max_experience_us"]=loopMaxExperienceUs;
  d["loop_max_display_us"]=loopMaxDisplayUs;d["loop_max_power_us"]=loopMaxPowerUs;
  d["telemetry_dropped"]=telemetryDropped;
  d["storage_error"] = storage.error;
  d["factory_reset_usb"] = true;
  d["factory_reset_ble"] = true;
  d["media_count"] = storage.ready ? storage.library["items"].size() : 0;
  d["playlist_count"] = storage.ready ? storage.playlist["items"].size() : 0;
  d["admin_key_retained_on_factory_reset"] = true;
}
uint32_t playlistRevision(){String text;serializeJson(storage.playlist,text);return media::crc32(reinterpret_cast<const uint8_t*>(text.c_str()),text.length());}
bool forgetPinnedSubtitle(){return !preferences.isKey("pin_caption")||preferences.remove("pin_caption");}
void handle(Source source, uint16_t requestId, JsonVariantConst request) {
  String op = request["op"] | ""; Session& session = source == BLE ? bleSession : usbSession;
  JsonDocument response; response["ok"] = true;
  if (source == USB && op == "STATUS") { status(response); reply(source, requestId, response.as<JsonVariantConst>()); return; }
  if (resetScheduled) { fail(source, requestId, "RESTARTING", "吊飾正在恢復出廠，請稍後重新連線。"); return; }
  if (op == "AUTH_CHALLENGE") {
    String nonce = request["client_nonce"] | "";
    if (!media::hex(nonce.c_str(), 32, false)) { fail(source, requestId, "AUTH", "Invalid client nonce."); return; }
    nonce.toLowerCase(); uint8_t random[32]; esp_fill_random(random, sizeof(random));
    session.clientNonce = nonce; session.serverNonce = hexBytes(random, sizeof(random)); session.challengedAt = millis();
    response["server_nonce"] = session.serverNonce; reply(source, requestId, response.as<JsonVariantConst>()); return;
  }
  if (op == "AUTH") {
    String client = request["client_nonce"] | "", proof = request["proof"] | ""; client.toLowerCase();
    String message = String("mlc/1:") + deviceId + ":" + session.clientNonce + ":" + session.serverNonce;
    uint8_t expected[32] = {}, adminExpected[32] = {}, supplied[32] = {};
    bool valid = session.serverNonce.length() == 64 && client == session.clientNonce && millis() - session.challengedAt <= 15000 && parseHex(proof, supplied, 32);
    if (mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), ownerKey, sizeof(ownerKey), reinterpret_cast<const uint8_t*>(message.c_str()), message.length(), expected) != 0) valid = false;
    if (mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), adminKey, sizeof(adminKey), reinterpret_cast<const uint8_t*>(message.c_str()), message.length(), adminExpected) != 0) valid = false;
    uint8_t difference = 0, adminDifference = 0;
    for (unsigned i = 0; i < 32; ++i) { difference |= expected[i] ^ supplied[i]; adminDifference |= adminExpected[i] ^ supplied[i]; }
    session.clientNonce = ""; session.serverNonce = "";
    session.resetToken = "";
    if (!valid || (difference && adminDifference)) { fail(source, requestId, "AUTH", "Incorrect key or expired challenge."); return; }
    session.authorized = true; session.admin = adminDifference == 0;
    response["role"] = session.admin ? "admin" : "owner";
    reply(source, requestId, response.as<JsonVariantConst>()); return;
  }
  if (!session.authorized) { fail(source, requestId, "UNAUTHORIZED", "Authorize this connection first."); return; }
  if(op=="PLAN_SYNC") {
    if(!storage.ready){fail(source,requestId,"STORAGE",storage.error);return;}
    auto works=request["works"].as<JsonArrayConst>();if(works.isNull()||works.size()>32){fail(source,requestId,"PLAN","最多一次規劃 32 個作品。");return;}
    JsonArray items=response["items"].to<JsonArray>();uint32_t needed=0,newWorks=0;String seen[32];unsigned n=0;
    for(auto meta:works){String id=meta["id"]|"",kind=meta["kind"]|"",digest=meta["sha256"]|"",name=meta["name"]|"";
      uint32_t length=meta["length"]|0u;
      subtitles::Settings subtitle;
      if(!media::hex(id.c_str(),32)||!media::hex(digest.c_str(),64)||!meta["length"].is<uint32_t>()||!meta["crc32"].is<uint32_t>()||length<1045||length>config::MAX_MEDIA||(length-21)%1024||name.length()>240||(kind!="image"&&kind!="animation"&&kind!="subtitle")||(kind=="image"&&length!=1045)||(kind=="animation"&&length==1045)||(kind=="subtitle"&&(!subtitle.read(meta["subtitle"])||length!=21u+uint32_t(subtitle.tiles())*1024))){fail(source,requestId,"PLAN","作品規劃資料無效。");return;}
      for(unsigned i=0;i<n;++i)if(seen[i]==id){fail(source,requestId,"PLAN","作品 ID 重複。");return;}seen[n++]=id;
      bool skip=storage.matches(meta);auto result=items.add<JsonObject>();result["id"]=id;result["skip"]=skip;
      if(!skip){needed+=length;if(storage.find(id).isNull())++newWorks;}
    }
    response["needed_bytes"]=needed;response["free_bytes"]=storage.freeBytes();response["reserve_bytes"]=config::RESERVE_BYTES;
    response["device_id"]=deviceId;response["new_works"]=newWorks;response["existing_works"]=storage.library["items"].size();response["max_works"]=config::MAX_ASSETS;
    response["fits"]=(!needed||storage.freeBytes()>=needed+config::RESERVE_BYTES)&&storage.library["items"].size()+newWorks<=config::MAX_ASSETS;
    reply(source,requestId,response.as<JsonVariantConst>());return;
  }
  if(op=="GET_PLAYLIST"||op=="GET_PLAYBACK"){
    if(!storage.ready){fail(source,requestId,"STORAGE",storage.error);return;}
    response["device_id"]=deviceId;
    if(op=="GET_PLAYLIST"){response["playlist"].set(storage.playlist);response["revision"]=playlistRevision();}
    else screen.playbackStatus(response);
    reply(source,requestId,response.as<JsonVariantConst>());return;
  }
  if(op=="GET_EXTRAS") {experience.snapshot(response);reply(source,requestId,response.as<JsonVariantConst>());return;}
  if(op=="SAVE_EXTRAS"||op=="CALIBRATE_POSE"||op=="TOUCH_LOCK"||op=="SET_TIME"||op=="CLOCK"||op=="TIMER"||op=="GAME") {
    if(upload.active){fail(source,requestId,"BUSY","請先完成作品傳送。");return;}
    String why;bool ok=false;
    if(op=="SAVE_EXTRAS")ok=experience.save(request["settings"],why);
    else if(op=="CALIBRATE_POSE")ok=experience.calibrate(why);
    else if(op=="TOUCH_LOCK") {if(request["locked"].is<bool>())ok=experience.lock(request["locked"],why);else why="鎖定開關無效。";}
    else ok=experience.command(op,request,why);
    if(!ok){fail(source,requestId,"EXTRAS",why);return;}
    hardware.activity();screen.sleep(false);experience.snapshot(response);reply(source,requestId,response.as<JsonVariantConst>());return;
  }
  if(op=="GET_MEMORY") { memoryInfo(response);reply(source,requestId,response.as<JsonVariantConst>());return; }
  if(op=="GET_POWER") { powerInfo(response);reply(source,requestId,response.as<JsonVariantConst>());return; }
  if(op=="SET_POWER") {
    if(!request["enabled"].is<bool>()) { fail(source,requestId,"POWER","enabled must be boolean.");return; }
    bool enabled=request["enabled"];
    if(!preferences.putBool("power_save",enabled)) { fail(source,requestId,"WRITE","Power setting was not saved.");return; }
    powerEnabled=enabled;hardware.activity();hardware.motionMonitor(false);screen.dim(false);screen.sleep(false);
    powerInfo(response);reply(source,requestId,response.as<JsonVariantConst>());return;
  }
  hardware.activity(); screen.sleep(false);
  if (op == "FACTORY_RESET_PREPARE" || op == "FACTORY_RESET" || op == "FACTORY_RESET_STATUS" || op == "GET_OWNER_PAIRING") {
    if (!session.admin) { fail(source, requestId, "ADMIN_REQUIRED", "請使用管理員 QR 卡授權後再操作。"); return; }
    if (op == "FACTORY_RESET_PREPARE") {
      if (upload.active) { fail(source, requestId, "BUSY", "請先完成或取消作品傳送。"); return; }
      uint8_t token[16]; esp_fill_random(token, sizeof(token));
      session.resetToken = hexBytes(token, sizeof(token)); session.resetPreparedAt = millis();
      response["reset_id"] = session.resetToken; response["device_id"] = deviceId;
      response["expires_ms"] = 60000;
    } else if (op == "FACTORY_RESET") {
      String token = request["reset_id"] | "", target = request["device_id"] | "";
      bool valid = token.length() == 32 && token == session.resetToken && target == deviceId && millis() - session.resetPreparedAt <= 60000;
      session.resetToken = ""; // A commit attempt consumes the single-use confirmation.
      if (!valid) { fail(source, requestId, "RESET_CONFIRMATION", "恢復出廠確認已過期或裝置不符，請重新操作。"); return; }
      if (upload.active) { fail(source, requestId, "BUSY", "請先完成或取消作品傳送。"); return; }
      if (!adminPreferences.putString("reset_request", token) || !preferences.putBool("factory_pending", true)) {
        fail(source, requestId, "RESET_INTENT", "無法儲存重設要求，請重試。"); return;
      }
      response["reset_id"] = token; response["stage"] = "restarting";
      resetScheduled = true; resetScheduledAt = millis();
    } else if (op == "FACTORY_RESET_STATUS") {
      response["completed_reset_id"] = adminPreferences.getString("reset_done", "");
      response["device_id"] = deviceId; response["storage_ready"] = storage.ready;
      response["media_count"] = storage.ready ? storage.library["items"].size() : 0;
      response["playlist_count"] = storage.ready ? storage.playlist["items"].size() : 0;
    } else {
      // Return the ordinary key sealed for the verified administrator. No raw
      // credential travels over the otherwise unencrypted BLE transport.
      const String aad = String("mlc/1:owner-pairing:") + deviceId;
      uint8_t nonce[12], ciphertext[32], tag[16]; esp_fill_random(nonce, sizeof(nonce));
      mbedtls_gcm_context ctx; mbedtls_gcm_init(&ctx);
      int result = mbedtls_gcm_setkey(&ctx, MBEDTLS_CIPHER_ID_AES, adminKey, 256);
      if (!result) result = mbedtls_gcm_crypt_and_tag(&ctx, MBEDTLS_GCM_ENCRYPT, sizeof(ownerKey), nonce, sizeof(nonce),
        reinterpret_cast<const uint8_t*>(aad.c_str()), aad.length(), ownerKey, ciphertext, sizeof(tag), tag);
      mbedtls_gcm_free(&ctx);
      if (result) { fail(source, requestId, "PAIRING_ENCRYPTION", "無法產生配對卡，請重試。"); return; }
      response["device_id"] = deviceId; response["nonce"] = hexBytes(nonce, sizeof(nonce));
      response["ciphertext"] = hexBytes(ciphertext, sizeof(ciphertext)); response["tag"] = hexBytes(tag, sizeof(tag));
    }
    reply(source, requestId, response.as<JsonVariantConst>()); return;
  }
  if (op == "SET_EMOTION") {
    String mood = request["emotion"] | "", mode = request["mode"] | "";
    if (!validEmotion(mood) || (mode != "manual" && mode != "auto")) { fail(source, requestId, "EMOTION", "Invalid emotion or mode."); return; }
    if(!forgetPinnedSubtitle()){fail(source,requestId,"WRITE","無法解除固定字幕，請重試。");return;}
    experience.forgetTool();screen.emotion(mood, mode == "auto"); preferences.putString("mode", mode); preferences.putString("emotion", mood);
  } else if (op == "SET_BRIGHTNESS") {
    if (!request["value"].is<unsigned>() || request["value"].as<unsigned>() < 1 || request["value"].as<unsigned>() > 255) { fail(source, requestId, "RANGE", "Brightness must be 1-255."); return; }
    String why;if(!experience.setBrightness(request["value"].as<unsigned>(),why)){fail(source,requestId,"WRITE",why);return;}
  } else if (!storage.ready) { fail(source, requestId, "STORAGE", storage.error); return;
  } else if(op=="PIN_SUBTITLE") {
    String id=request["id"]|"";auto previous=screen.checkpoint();
    if(!media::hex(id.c_str(),32)||!screen.pinSubtitle(id)){fail(source,requestId,"SUBTITLE","請先傳送有效的字幕作品。");return;}
    if(preferences.putString("pin_caption",id)!=id.length()){screen.restore(previous);fail(source,requestId,"WRITE","固定字幕未能儲存，原播放保留。");return;}
    experience.forgetTool();response["subtitle_pinned"]=true;response["media_id"]=id;
  } else if(op=="UNPIN_SUBTITLE") {
    if(!forgetPinnedSubtitle()){fail(source,requestId,"WRITE","無法解除固定字幕，請重試。");return;}
    experience.forgetTool();
    // playPlaylist handles the transition atomically when a playable item exists.
    if(screen.playPlaylist()){preferences.putString("mode","playlist");response["mode"]="playlist";}
    else{screen.emotion("neutral",true);preferences.putString("mode","auto");response["mode"]="auto";}
    response["subtitle_pinned"]=false;
  } else if (op == "PLAY_MEDIA") {
    String id = request["id"] | "";auto previous=screen.checkpoint();
    if (!media::hex(id.c_str(), 32) || !screen.playMedia(id)) { fail(source, requestId, "NOT_FOUND", "Work not found on this device."); return; }
    if(!forgetPinnedSubtitle()){screen.restore(previous);fail(source,requestId,"WRITE","無法解除固定字幕，原播放保留。");return;}
    experience.forgetTool();preferences.putString("mode", "media"); preferences.putString("media", id);
  } else if (op == "PLAY_PLAYLIST") {
    auto previous=screen.checkpoint();
    if (!screen.playPlaylist()) { fail(source, requestId, "PLAYLIST", "Sync a playlist with an enabled item first."); return; }
    if(!forgetPinnedSubtitle()){screen.restore(previous);fail(source,requestId,"WRITE","無法解除固定字幕，原播放保留。");return;}
    experience.forgetTool();preferences.putString("mode", "playlist");
  } else if (op == "LIST_MEDIA") {
    JsonArray a = response["items"].to<JsonArray>();
    for (JsonObject item : storage.library["items"].as<JsonArray>()) {
      JsonObject out = a.add<JsonObject>();
      for (const char* field : {"id", "kind", "name", "length"}) out[field].set(item[field]);
    }
  } else if (op == "DELETE_MEDIA") {
    String id = request["id"] | "";
    if (storage.referenced(id)) { fail(source, requestId, "REFERENCED", "Remove this work from the playlist before deleting it."); return; }
    if(experience.references(id)){fail(source,requestId,"REFERENCED","先解除互動規則中的作品綁定，再刪除。");return;}
    if(preferences.getString("pin_caption","")==id){fail(source,requestId,"REFERENCED","請先停止固定字幕播放，再刪除這件作品。");return;}
    if (!storage.deleteMedia(id)) { fail(source, requestId, "DELETE", "Could not delete this work."); return; }
    if (screen.currentId == id) { screen.emotion("neutral", true); preferences.putString("mode", "auto"); }
    updateStorageInfo();
  } else if (op == "SET_PLAYLIST") {
    String why; JsonVariantConst next = request["playlist"];
    if(!request["expected_revision"].isNull()&&(!request["expected_revision"].is<uint32_t>()||request["expected_revision"].as<uint32_t>()!=playlistRevision())){fail(source,requestId,"CONFLICT","吊飾清單已改變，請重新讀取並確認後同步。");return;}
    if (!storage.validatePlaylist(next, why)) { fail(source, requestId, "PLAYLIST", why); return; }
    if (!storage.saveJournal("playlist", next)) { fail(source, requestId, "WRITE", "Playlist commit failed; previous playlist preserved."); return; }
    storage.playlist.set(next);if(!screen.hasPinnedSubtitle())experience.forgetTool();
    if(screen.hasPinnedSubtitle()){response["started"]=false;response["subtitle_pinned"]=true;}
    else if(storage.playlist["items"].size()==0){screen.emotion("neutral",true);preferences.putString("mode","auto");response["started"]=true;}
    else{bool started=screen.playPlaylist();response["started"]=started;if(started)preferences.putString("mode","playlist");}
    response["revision"]=playlistRevision();updateStorageInfo();
    uploaded(source);
  } else if (op == "UPLOAD_BEGIN") {
    String id = request["id"] | "", kind = request["kind"] | "", name = request["name"] | "";
    if (!media::hex(id.c_str(), 32) || (kind != "image" && kind != "animation" && kind != "subtitle") || name.length() > 240 || !request["length"].is<uint32_t>() || !request["crc32"].is<uint32_t>()) { fail(source, requestId, "UPLOAD", "Invalid upload metadata."); return; }
    String digest=request["sha256"]|"";
    if((!request["sha256"].isNull()&&!media::hex(digest.c_str(),64))||(!request["skip_if_match"].isNull()&&!request["skip_if_match"].is<bool>())){fail(source,requestId,"UPLOAD","Invalid smart sync fingerprint.");return;}
    if(request["skip_if_match"]==true&&storage.matches(request)){response["skip"]=true;response["verified"]=true;uploaded(source);reply(source,requestId,response.as<JsonVariantConst>());return;}
    uint32_t length = request["length"].as<uint32_t>();
    subtitles::Settings settings;
    if (kind == "subtitle" && (!settings.read(request["subtitle"]) || length != 21u + uint32_t(settings.tiles()) * 1024)) { fail(source,requestId,"SUBTITLE","Invalid subtitle metadata or tile count."); return; }
    if (length < 1045 || length > config::MAX_MEDIA || (length - 21) % 1024 || (kind == "image" && length != 1045) || (kind == "animation" && length == 1045)) { fail(source, requestId, "SIZE", "Invalid media size."); return; }
    if (storage.find(id).isNull() && storage.library["items"].size() >= config::MAX_ASSETS) { fail(source, requestId, "FULL", "Device library is full (32 works maximum)."); return; }
    if (storage.referenced(id) && kind != storage.find(id)["kind"].as<String>()) { fail(source, requestId, "REFERENCED", "A referenced work cannot change its media kind."); return; }
    if (upload.active && upload.owner != source) { fail(source, requestId, "BUSY", "Another connection is uploading."); return; }
    closeUpload(); JsonDocument saved; bool found = false;
    if (!storage.loadJournal("upload", saved, found)) { fail(source, requestId, "JOURNAL", "Upload metadata is damaged; files preserved."); return; }
    bool resume = (digest.isEmpty()||saved["sha256"]==digest)&&saved["active"] == true && saved["id"] == id && saved["kind"] == kind && saved["length"] == length && saved["crc32"] == request["crc32"] && LittleFS.exists(TEMP);
    if (resume && kind == "subtitle") { subtitles::Settings previous; resume = previous.read(saved["subtitle"]) && previous.same(settings); }
    uint32_t existing = 0;
    if (resume) { File f = LittleFS.open(TEMP, "r"); existing = f.size(); if (existing > length) resume = false; }
    if (storage.freeBytes() < (resume ? length - existing : length) + config::RESERVE_BYTES) { fail(source, requestId, "FULL", "Not enough free storage; previous work preserved."); return; }
    if (!resume) { if (!clearUploadJournal()) { fail(source, requestId, "WRITE", "Could not start an upload."); return; } LittleFS.remove(TEMP); existing = 0; }
    upload.meta.clear(); upload.meta["active"] = true;
    for (const char* key : {"id", "kind", "name", "length", "crc32"}) upload.meta[key].set(request[key]);
    if(digest.length())upload.meta["sha256"]=digest;
    if (kind == "subtitle") settings.write(upload.meta["subtitle"].to<JsonObject>());
    if (!storage.saveJournal("upload", upload.meta.as<JsonVariantConst>())) { fail(source, requestId, "WRITE", "Could not store upload metadata."); return; }
    upload.file = LittleFS.open(TEMP, resume ? "a" : "w");
    if (!upload.file) { fail(source, requestId, "WRITE", "Could not open the temporary file."); return; }
    upload.active = true; upload.owner = source; upload.received = upload.durable = existing; upload.pendingPackets = 0;
    do { upload.id = esp_random() & 65535; } while (!upload.id);
    response["transfer_id"] = upload.id; response["offset"] = existing; response["window_packets"] = config::UPLOAD_WINDOW; updateStorageInfo();
    uploaded(source);
  } else if (op == "UPLOAD_STATUS" || op == "UPLOAD_END" || op == "UPLOAD_CANCEL") {
    if (!upload.active || upload.owner != source || !request["transfer_id"].is<uint16_t>() || request["transfer_id"].as<uint16_t>() != upload.id) { fail(source, requestId, "TRANSFER", "No matching active transfer."); return; }
    flushUpload();
    if (op == "UPLOAD_STATUS") response["offset"] = upload.durable;
    else if (op == "UPLOAD_CANCEL") {
      closeUpload(); if (!clearUploadJournal()) { fail(source, requestId, "WRITE", "Could not cancel upload metadata."); return; } LittleFS.remove(TEMP); updateStorageInfo();
    } else {
      if (upload.durable != upload.meta["length"].as<uint32_t>()) { fail(source, requestId, "INCOMPLETE", "Upload is incomplete."); return; }
      media::Header h; String why; upload.file.close();
      if (!storage.validateOLA(TEMP, upload.meta["crc32"].as<uint32_t>(), h, why)) { upload.file = LittleFS.open(TEMP, "a"); fail(source, requestId, "CRC", why); return; }
      if(!upload.meta["sha256"].isNull()&&storage.sha256(TEMP)!=upload.meta["sha256"].as<String>()){upload.file=LittleFS.open(TEMP,"a");fail(source,requestId,"SHA256","Content fingerprint does not match; previous work preserved.");return;}
      bool validKind;
      if (upload.meta["kind"] == "subtitle") { subtitles::Settings settings; validKind = settings.read(upload.meta["subtitle"]) && settings.tiles() == h.frames; }
      else validKind = (upload.meta["kind"] == "image") == (h.frames == 1);
      if (!validKind) { upload.file = LittleFS.open(TEMP, "a"); fail(source, requestId, "KIND", "Media kind does not match its frames."); return; }
      String current = screen.currentId;
      if (!storage.commitMedia(TEMP, upload.meta.as<JsonVariantConst>(), h)) { upload.active = false; fail(source, requestId, "COMMIT", "Media commit failed; previous work preserved."); return; }
      upload.active = false; clearUploadJournal();
      if (current == upload.meta["id"].as<String>()&&screen.currentTool()==Display::NO_TOOL&&!screen.temporaryPlayback()) screen.playMedia(current);
      updateStorageInfo();
      uploaded(source);
    }
  } else if (source == USB && op == "UPLOAD_DATA") {
    String data = request["hex"] | ""; uint8_t buffer[1024];
    if (!data.length() || data.length() > 2048 || data.length() % 2 || !parseHex(data, buffer, data.length() / 2) || !request["offset"].is<uint32_t>() || !request["transfer_id"].is<uint16_t>()) { fail(source, requestId, "DATA", "Invalid diagnostic data packet."); return; }
    receiveData(source, request["transfer_id"].as<uint16_t>(), request["offset"].as<uint32_t>(), buffer, data.length() / 2);
    response["offset"] = upload.durable;
  } else { fail(source, requestId, "OP", "Unsupported operation."); return; }
  reply(source, requestId, response.as<JsonVariantConst>());
}
void acceptControl(const uint8_t* p, size_t n) {
  if (n < 9 || p[0] != 1 || p[1] != 1) return;
  uint16_t id = media::le16(p + 2), total = media::le16(p + 4), offset = media::le16(p + 6);
  if (!id || !total || total > config::MAX_JSON || size_t(offset) + n - 8 > total) { fail(BLE, id, "PACKET", "Invalid control packet."); return; }
  if (!offset) {
    size_t reserved = total;
    for (auto& entry : assemblies) if (entry.first != id) reserved += entry.second.total;
    if ((assemblies.size() >= 8 && !assemblies.count(id)) || reserved > 32768) { fail(BLE, id, "BUSY", "Too many incomplete requests."); return; }
    Assembly& a = assemblies[id]; a.text = ""; a.text.reserve(total); a.total = total; a.since = millis();
  }
  auto it = assemblies.find(id);
  if (it == assemblies.end() || it->second.total != total || it->second.text.length() != offset || millis() - it->second.since > 15000) { assemblies.erase(id); fail(BLE, id, "ORDER", "Control fragments are missing or out of order."); return; }
  it->second.text.concat(reinterpret_cast<const char*>(p + 8), n - 8);
  it->second.since = millis();
  if (it->second.text.length() == total) {
    JsonDocument d; auto error = deserializeJson(d, it->second.text); assemblies.erase(id);
    if (error || !d.is<JsonObject>()) fail(BLE, id, "JSON", "Invalid JSON request.");
    else handle(BLE, id, d.as<JsonVariantConst>());
  }
}
void sendOneNotification() {
  if (!connected || !subscribed || outgoing.empty()) return;
  Outgoing& message = outgoing.front();
  if (millis() - message.since > 30000) { server->disconnect(connectionHandle.load()); return; }
  uint8_t buffer[244]; size_t n = min(size_t(maxPacket() - 8), message.text.length() - message.offset);
  buffer[0] = 1; buffer[1] = 2; media::put16(buffer + 2, message.id); media::put16(buffer + 4, message.text.length()); media::put16(buffer + 6, message.offset);
  memcpy(buffer + 8, message.text.c_str() + message.offset, n);
  if (events->notify(buffer, n + 8, connectionHandle.load())) {
    message.offset += n; if (message.offset == message.text.length()) outgoing.pop_front();
  }
}
class ServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer* s, NimBLEConnInfo& info) override {
    if (connected.exchange(true)) { s->disconnect(info.getConnHandle()); return; }
    connectionHandle = info.getConnHandle(); mtu = info.getMTU(); subscribed = false; ++connectionEpoch;
    s->updateConnParams(info.getConnHandle(), 12, 24, 0, 200);
    lastBleTraffic=millis();idleConnection=false;
  }
  void onDisconnect(NimBLEServer*, NimBLEConnInfo& info, int) override {
    if (info.getConnHandle() == connectionHandle.load()) { connected = false; subscribed = false; connectionHandle = BLE_HS_CONN_HANDLE_NONE; ++connectionEpoch; }
  }
  void onMTUChange(uint16_t value, NimBLEConnInfo& info) override { if (info.getConnHandle() == connectionHandle.load()) mtu = value; }
} serverCallbacks;
class WriteCallbacks : public NimBLECharacteristicCallbacks {
public:
  explicit WriteCallbacks(uint8_t kind) : kind(kind) {}
  void onWrite(NimBLECharacteristic* c, NimBLEConnInfo& info) override {
    if (info.getConnHandle() != connectionHandle.load()) return;
    const auto& value = c->getValue();
    lastBleTraffic=millis();
    if (value.size() < 9 || value.size() > 244) { overflowed = true; return; }
    Packet p; p.epoch = connectionEpoch.load(); p.handle = info.getConnHandle(); p.length = value.size(); p.kind = kind;
    memcpy(p.bytes, value.data(), p.length);
    if (xQueueSend(packets, &p, 0) != pdTRUE) overflowed = true;
  }
private: uint8_t kind;
} controlCallbacks(1), dataCallbacks(2);
class EventCallbacks : public NimBLECharacteristicCallbacks {
  void onSubscribe(NimBLECharacteristic*, NimBLEConnInfo& info, uint16_t value) override {
    if (info.getConnHandle() == connectionHandle.load()) subscribed = (value & 1) != 0;
  }
} eventCallbacks;
class InfoCallbacks : public NimBLECharacteristicCallbacks {
  void onRead(NimBLECharacteristic* c, NimBLEConnInfo& info) override {
    JsonDocument d; d["protocol"] = "mlc/1"; d["device_id"] = deviceId; d["name"] = config::DEVICE_NAME; d["firmware"] = config::VERSION;
    d["max_write_bytes"] = min(uint16_t(244), uint16_t(max(uint16_t(23), info.getMTU()) - 3));
    // Read the main-loop snapshot; this callback never samples ADC or wakes OLED.
    d["battery_mv"] = min<uint32_t>(65535,hardware.batteryVoltageMv()); d["battery_type"] = "lipo_1s";
    d["usb_host_connected"] = hardware.usbHostIsConnected(); d["charging_state"] = "unknown";
    JsonArray caps = d["capabilities"].to<JsonArray>(); caps.add("emotion"); caps.add("brightness");
    caps.add("admin_auth");
    caps.add("touch"); caps.add("extras"); caps.add("smart_sync");caps.add("subtitle_pin");
    caps.add("battery_voltage");
    caps.add("usb_host_status");
    caps.add("memory");
    caps.add("power_save");d["power_save_enabled"]=powerEnabled.load();
    caps.add("factory_reset"); caps.add("owner_pairing");
    if (storage.ready) { caps.add("media"); caps.add("playlist"); d["storage_total"] = storageTotal.load(); d["storage_free"] = storageFree.load(); }
    if (storage.ready) caps.add("subtitle");
    String text; serializeJson(d, text); c->setValue(text.c_str());
  }
} infoCallbacks;
void initializeBLE();
void startAdvertising() {
  if (connected) return;
  if(!radioReady) initializeBLE();
  if(!radioReady) return;
  advertising = NimBLEDevice::getAdvertising()->start();
}
void initializeBLE() {
  if(radioReady) return;
  if(!packets) packets=xQueueCreate(48,sizeof(Packet));
  if(!packets || !NimBLEDevice::init(config::DEVICE_NAME)) { Serial.println("BLE initialization failed.");return; }
  NimBLEDevice::setMTU(247);
  server = NimBLEDevice::createServer(); server->setCallbacks(&serverCallbacks,false); server->advertiseOnDisconnect(false);
  NimBLEService* s = server->createService(config::SERVICE);
  auto control = s->createCharacteristic(config::CONTROL, NIMBLE_PROPERTY::WRITE, 244); control->setCallbacks(&controlCallbacks);
  auto data = s->createCharacteristic(config::DATA, NIMBLE_PROPERTY::WRITE_NR, 244); data->setCallbacks(&dataCallbacks);
  events = s->createCharacteristic(config::EVENT, NIMBLE_PROPERTY::NOTIFY, 244); events->setCallbacks(&eventCallbacks);
  auto info = s->createCharacteristic(config::INFO, NIMBLE_PROPERTY::READ, 512); info->setCallbacks(&infoCallbacks);
  auto a = NimBLEDevice::getAdvertising(); a->addServiceUUID(config::SERVICE); a->enableScanResponse(true); a->setName(config::DEVICE_NAME);
  s->start();radioReady=true;bleWindow.open(millis());
}
bool shutdownBLE() {
  if(!radioReady) return true;
  if(connected || upload.active || !outgoing.empty() || !assemblies.empty()) return false;
  if(advertising) NimBLEDevice::getAdvertising()->stop();
  if(!NimBLEDevice::deinit(false)) return false;
  NimBLEDevice::deinit(true);radioReady=false;server=nullptr;events=nullptr;advertising=false;
  bleSession.reset();xQueueReset(packets);++bleShutdowns;return true;
}
void managePower() {
  bool enabled=powerEnabled.load(),usb=hardware.usbHostIsConnected();
  bool busy=upload.active||resetScheduled||hardware.batterySampling()||!assemblies.empty()||!outgoing.empty();
  unsigned frequency=power::cpuMHz(enabled,usb,connected.load(),busy);
  if(getCpuFrequencyMhz()!=frequency) setCpuFrequencyMhz(frequency);
  screen.dim((experience.lowBattery()&&!usb)||power::dim(enabled,screen.keepAwake(),usb,hardware.stillMs(),experience.settings.dimS*1000));
  if(!hardware.motionMonitor((enabled&&screen.sleeping()&&!usb)||(experience.critical()&&!usb))&&!experience.critical()) return;
  // Finish an ADC average before sleeping, so the divider cannot remain enabled
  // across sixteen separate light-sleep wakeups.
  power::Inputs state{enabled,screen.sleeping(),screen.keepAwake(),usb,radioReady,upload.active||hardware.batterySampling(),
    resetScheduled||millis()-powerWakeAt<3000,hardware.sensorReady(),hardware.interruptVerified(),hardware.stillMs()};
  bool critical=experience.critical()&&!usb;
  auto action=power::action(state,experience.settings.deepS*1000);
  if(critical&&!busy){
    if(connected){server->disconnect(connectionHandle.load());windowClosed=true;return;}
    windowClosed=true;if(radioReady&&!shutdownBLE())return;
    if(millis()-powerWakeAt<3000||digitalRead(config::TOUCH_PIN)==HIGH)return;
    screen.sleep(true);action=power::DEEP;
  }
  if(action==power::AWAKE)return;
  if(digitalRead(config::TOUCH_PIN)==HIGH || (!critical&&hardware.consumeInterrupt())) { hardware.activity();return; }
  if(!critical&&!hardware.sensorReady()) return;
  constexpr uint64_t mask=(1ULL<<config::TOUCH_PIN)|(1ULL<<config::MOTION_INT_PIN);
  esp_sleep_disable_wakeup_source(ESP_SLEEP_WAKEUP_ALL);
  if(action==power::DEEP) {
    if(esp_deep_sleep_enable_gpio_wakeup(critical?(1ULL<<config::TOUCH_PIN):mask,ESP_GPIO_WAKEUP_GPIO_HIGH)!=ESP_OK) return;
    // A periodic rescue wake checks USB and the sensor without showing the OLED.
    esp_sleep_enable_timer_wakeup(critical?60000000ULL:experience.nextWakeUs());
    memset(&retained,0,sizeof(retained));retained.magic=RETAINED_MAGIC;retained.playback=screen.checkpoint();
    retained.lightCount=lightSleeps;retained.lightUs=lightSleepUs;retained.deepCount=deepWakes;
    retained.irqVerified=hardware.interruptVerified();retained.extras=experience.checkpoint();
    retained.crc=media::crc32(reinterpret_cast<uint8_t*>(&retained),offsetof(RetainedPower,crc));
    digitalWrite(config::BATTERY_ENABLE_PIN,LOW);gpio_hold_en(gpio_num_t(config::BATTERY_ENABLE_PIN));
    gpio_hold_en(gpio_num_t(LED_BUILTIN));
#if !SOC_GPIO_SUPPORT_HOLD_SINGLE_IO_IN_DSLP
    gpio_deep_sleep_hold_en();
#endif
    esp_deep_sleep_start();
  } else {
    if(gpio_wakeup_enable(gpio_num_t(config::TOUCH_PIN),GPIO_INTR_HIGH_LEVEL)!=ESP_OK ||
       gpio_wakeup_enable(gpio_num_t(config::MOTION_INT_PIN),GPIO_INTR_HIGH_LEVEL)!=ESP_OK || esp_sleep_enable_gpio_wakeup()!=ESP_OK) return;
    // Unverified/broken INT falls back to 250 ms sampling. USB is checked at least once a second.
    esp_sleep_enable_timer_wakeup(min<uint64_t>(experience.nextWakeUs(),hardware.interruptVerified()?1000000:250000));
    int64_t started=esp_timer_get_time();auto result=esp_light_sleep_start();
    if(result==ESP_OK) { ++lightSleeps;lightSleepUs+=esp_timer_get_time()-started;lastSleep="light"; }
    gpio_wakeup_disable(gpio_num_t(config::TOUCH_PIN));gpio_wakeup_disable(gpio_num_t(config::MOTION_INT_PIN));
    if(esp_sleep_get_wakeup_cause()==ESP_SLEEP_WAKEUP_GPIO) {
      if(digitalRead(config::TOUCH_PIN)==HIGH) hardware.wakeTouch();
      hardware.consumeInterrupt();hardware.activity();
    }
  }
}
void printPair(bool admin = false) {
  const uint8_t* key = admin ? adminKey : ownerKey;
  JsonDocument d; d["device_id"] = deviceId; d["key"] = hexBytes(key, 32);
  d["url"] = String(config::CONTROL_URL) + "#device=" + deviceId + "&key=" + hexBytes(key, 32);
  Serial.print(admin ? "@ADMIN," : "@PAIR,"); serializeJson(d, Serial); Serial.println();
}
void requestFactoryReset() {
  // Physical USB recovery. Wireless requests use administrator authorization
  // and a fresh, connection-bound confirmation token above.
  // Persist intent before reboot so a power loss during formatting is retried.
  if (!preferences.putBool("factory_pending", true)) {
    Serial.println("@FACTORY_RESET,{\"ok\":false,\"stage\":\"save_intent\"}");
    return;
  }
  Serial.println("@FACTORY_RESET,{\"ok\":true,\"stage\":\"restarting\"}");
  Serial.flush(); delay(100); ESP.restart();
}
bool completeFactoryReset() {
  if (!preferences.getBool("factory_pending", false) && !adminPreferences.getBool("reset_active", false)) return false;
  // The durable guard lives outside the namespace about to be cleared, so
  // losing power between clear() and the next NVS write still retries safely.
  if (!adminPreferences.putBool("reset_active", true)) {
    Serial.println("@FACTORY_RESET,{\"ok\":false,\"stage\":\"save_guard\"}");
    while (true) { screen.update(); delay(10); }
  }
  // Bind the exact media partition without enabling automatic format-on-fail.
  LittleFS.begin(false, "/littlefs", 10, "spiffs"); LittleFS.end();
  if (!LittleFS.format() || !preferences.clear() || !preferences.putBool("factory_pending", true)) {
    preferences.putBool("factory_pending", true);
    Serial.println("@FACTORY_RESET,{\"ok\":false,\"stage\":\"erase\"}");
    // Leave BLE closed and the retry marker in place. Never report partial success.
    while (true) { screen.update(); delay(10); }
  }
  return true;
}
void readSerial() {
  static String line; static bool tooLong = false;
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\r') continue;
    if (c != '\n') { if (line.length() < config::MAX_JSON) line += c; else tooLong = true; continue; }
    if (tooLong) { line = ""; tooLong = false; Serial.println("Serial request too long."); continue; }
    if (line == "pair") printPair();
    else if (line == "admin") printPair(true);
    else if (line == String("factory-reset ") + deviceId) requestFactoryReset();
    else if (line == "factory-reset" || line.startsWith("factory-reset ")) {
      Serial.print("To erase all works/settings and replace the key, send: factory-reset "); Serial.println(deviceId);
    }
    else if (line == "ble") { hardware.activity(); screen.sleep(false); bleWindow.open(millis(), connected.load()); windowClosed = false; startAdvertising(); Serial.println("BLE window reopened: 5 minutes to connect, 10 minutes without an upload after connecting."); }
    else if (line == "wake") { hardware.activity(); screen.sleep(false); }
    else if (line == "reboot") { closeUpload(); Serial.flush(); ESP.restart(); }
    else if (line == "rotate") screen.rotate(true);
    else if (line == "normal") screen.rotate(false);
    else if (line == "display-safe") screen.safeClock(true);
    else if (line == "display-fast") screen.safeClock(false);
    else if (line == "status") { JsonDocument d; status(d); reply(USB, 0, d.as<JsonVariantConst>()); }
    else if (line.startsWith("{")) {
      JsonDocument d;
      if (deserializeJson(d, line) || !d.is<JsonObject>()) fail(USB, 0, "JSON", "Invalid diagnostic request.");
      else handle(USB, d["rid"] | uint16_t(1), d.as<JsonVariantConst>());
    } else if (line.length()) Serial.println("Commands: status / pair / admin / ble / rotate / normal / factory-reset <device_id>; JSON diagnostic requests also supported.");
    line = "";
  }
}
void processBLE() {
  if(!radioReady) return;
  uint32_t epoch = connectionEpoch.load(); bool live = connected.load();
  if (observedEpoch != epoch) {
    if (upload.active && upload.owner == BLE) closeUpload();
    assemblies.clear(); outgoing.clear(); bleSession.reset(); observedEpoch = epoch; overflowed = false;
    advertising = NimBLEDevice::getAdvertising()->isAdvertising();
    if (live) { bleWindow.onConnection(millis()); advertising = false; Serial.println("BLE connected; authorization required."); }
    else if (wasConnected) Serial.println("BLE disconnected; partial upload kept.");
    wasConnected = live;
  }
  if (live && overflowed.exchange(false)) server->disconnect(connectionHandle.load());
  Packet p;
  for (unsigned count = 0; count < 8 && xQueueReceive(packets, &p, 0) == pdTRUE; ++count) {
    if (!connected || p.epoch != observedEpoch || p.handle != connectionHandle.load()) continue;
    if (p.kind == 1) acceptControl(p.bytes, p.length);
    else if (p.bytes[0] == 1 && p.bytes[1] == 0) receiveData(BLE, media::le16(p.bytes + 2), media::le32(p.bytes + 4), p.bytes + 8, p.length - 8);
  }
  for (auto it = assemblies.begin(); it != assemblies.end();) { if (millis() - it->second.since > 15000) it = assemblies.erase(it); else ++it; }
  if (!windowClosed && !bleWindow.remaining(millis())) { windowClosed = true; Serial.println("BLE window closed: deadline reached."); }
  if (windowClosed) {
    if (advertising) NimBLEDevice::getAdvertising()->stop(); advertising = false;
    if (connected) server->disconnect(connectionHandle.load());
  } else if (!connected && !advertising) startAdvertising();
  sendOneNotification();
  if(connected) {
    bool idle=!upload.active&&outgoing.empty()&&assemblies.empty()&&millis()-lastBleTraffic>5000;
    if(idle!=idleConnection) {
      server->updateConnParams(connectionHandle.load(),idle?32:12,idle?64:24,idle?4:0,400);idleConnection=idle;
    }
  }
  if(windowClosed) shutdownBLE();
}
}

void companionSetup() {
  bootWake=esp_sleep_get_wakeup_cause();
  resumeFromDeep=esp_reset_reason()==ESP_RST_DEEPSLEEP&&bootWake!=ESP_SLEEP_WAKEUP_UNDEFINED&&retained.magic==RETAINED_MAGIC&&
    retained.crc==media::crc32(reinterpret_cast<uint8_t*>(&retained),offsetof(RetainedPower,crc));
  if(resumeFromDeep) { lightSleeps=retained.lightCount;lightSleepUs=retained.lightUs;deepWakes=retained.deepCount+1;lastSleep="deep"; }
  else retained.magic=0;
#if !SOC_GPIO_SUPPORT_HOLD_SINGLE_IO_IN_DSLP
  gpio_deep_sleep_hold_dis();
#endif
  gpio_hold_dis(gpio_num_t(config::BATTERY_ENABLE_PIN));gpio_hold_dis(gpio_num_t(LED_BUILTIN));
  rtc_gpio_deinit(gpio_num_t(config::TOUCH_PIN));rtc_gpio_deinit(gpio_num_t(config::MOTION_INT_PIN));
  pinMode(LED_BUILTIN,OUTPUT);digitalWrite(LED_BUILTIN,HIGH);
  Serial.setRxBufferSize(8192);
  Serial.begin(115200); delay(300);
  Serial.printf("\nLittle Companion ESP32-C5 %s\n", config::VERSION);
  uint8_t mac[6]; esp_read_mac(mac, ESP_MAC_BT); deviceId = String(config::DEVICE_PREFIX) + hexBytes(mac + 3, 3);
  screen.begin(resumeFromDeep);
  hardware.begin();
  if (!preferences.begin(config::SETTINGS_NAMESPACE, false)) { Serial.println("Cannot open settings; BLE remains closed."); while (true) { screen.update(); delay(10); } }
  powerEnabled=preferences.getBool("power_save",true);
  // Initialize the retained namespace before touching the user-data namespace.
  if (!adminPreferences.begin("mlc-admin", false)) { Serial.println("Cannot open admin settings; BLE remains closed."); while (true) { screen.update(); delay(10); } }
  if (adminPreferences.getBytesLength("admin_key") == sizeof(adminKey)) adminPreferences.getBytes("admin_key", adminKey, sizeof(adminKey));
  else { esp_fill_random(adminKey, sizeof(adminKey)); if (adminPreferences.putBytes("admin_key", adminKey, sizeof(adminKey)) != sizeof(adminKey)) { Serial.println("Cannot persist admin key; BLE remains closed."); while (true) { screen.update(); delay(10); } } }
  bool factoryReset = completeFactoryReset();
  storage.begin(); updateStorageInfo();
  if (factoryReset && !storage.ready) {
    Serial.println("@FACTORY_RESET,{\"ok\":false,\"stage\":\"initialize_storage\"}");
    while (true) { screen.update(); delay(10); }
  }
  if (preferences.getBytesLength("owner_key") == sizeof(ownerKey)) preferences.getBytes("owner_key", ownerKey, sizeof(ownerKey));
  else { esp_fill_random(ownerKey, sizeof(ownerKey)); if (preferences.putBytes("owner_key", ownerKey, sizeof(ownerKey)) != sizeof(ownerKey)) { Serial.println("Cannot persist owner key. Restart before pairing."); while (true) { screen.update(); delay(10); } } }
  // A separate namespace survives the explicit user-data reset. This is a
  // per-device generated credential, never a universal hard-coded master key.
  if (factoryReset) {
    const String receipt = adminPreferences.getString("reset_request", "");
    if (receipt.length() && !adminPreferences.putString("reset_done", receipt)) {
      Serial.println("Cannot save reset completion; BLE remains closed."); while (true) { screen.update(); delay(10); }
    }
  }
  bleSession.reset(); usbSession.reset();
  screen.brightness(preferences.getUChar("brightness", 160));
  String savedMode = preferences.getString("mode", "auto");
  String pinned=preferences.getString("pin_caption","");
  if(pinned.length()&&screen.pinSubtitle(pinned)){}
  else if (savedMode == "playlist" && storage.ready && screen.playPlaylist()) {}
  else if (savedMode == "media" && storage.ready && screen.playMedia(preferences.getString("media", ""))) {}
  else screen.emotion(preferences.getString("emotion", "neutral"), savedMode != "manual");
  if (factoryReset && (!preferences.remove("factory_pending") || !adminPreferences.putBool("reset_active", false))) {
    Serial.println("Cannot finish reset; BLE remains closed."); while (true) { screen.update(); delay(10); }
  }
  if(pinned.length()&&!screen.pinnedSubtitle())forgetPinnedSubtitle();
  experience.begin(preferences);
  if(resumeFromDeep && !factoryReset && screen.restore(retained.playback)) {
    hardware.restoreInterruptVerified(retained.irqVerified);experience.restore(retained.extras);
    if(bootWake==ESP_SLEEP_WAKEUP_TIMER) hardware.restoreStillness(experience.settings.deepS*1000);
    else { hardware.activity();screen.sleep(false);if(digitalRead(config::TOUCH_PIN)==HIGH) hardware.wakeTouch(true); }
    windowClosed=true;
  } else { resumeFromDeep=false;retained.magic=0;screen.sleep(false);initializeBLE();startAdvertising(); }
  powerWakeAt=millis();
  Serial.printf("Device: %s. Enter 'pair' locally to obtain your private key.\n", deviceId.c_str());
  Serial.printf("Storage: %s; %lu free bytes.\n", storage.ready ? "ready" : storage.error.c_str(), (unsigned long)storageFree.load());
  if (factoryReset) Serial.println("@FACTORY_RESET,{\"ok\":true,\"stage\":\"complete\"}");
}
void companionLoop() {
  uint32_t loopStarted=micros(),phase=loopStarted;
  readSerial();loopMaxSerialUs=max(loopMaxSerialUs,uint32_t(micros()-phase));
  phase=micros();processBLE();loopMaxBleUs=max(loopMaxBleUs,uint32_t(micros()-phase));
  phase=micros();hardware.update(upload.active, screen.sleeping());loopMaxHardwareUs=max(loopMaxHardwareUs,uint32_t(micros()-phase));
  phase=micros();
  screen.sleep(hardware.shouldSleep() && !screen.keepAwake());
  auto action = hardware.action();
  if(action==Hardware::REOPEN_BLE) {
    if(!experience.critical()||hardware.usbHostIsConnected()){bleWindow.open(millis(),connected.load());windowClosed=false;startAdvertising();}
  }else experience.touch(action,upload.active||resetScheduled);
  experience.update(upload.active||resetScheduled);
  screen.motion(experience.settings.rules[7].type=="default"?hardware.shakeLevel():0, hardware.shakeX(), hardware.shakeY());
  loopMaxExperienceUs=max(loopMaxExperienceUs,uint32_t(micros()-phase));
  phase=micros();screen.update();loopMaxDisplayUs=max(loopMaxDisplayUs,uint32_t(micros()-phase));
  // Give the accepted reply time to drain. A disconnect cannot cancel a
  // durably committed reset; completion is checked after the next boot.
  if (resetScheduled && ((outgoing.empty() && millis() - resetScheduledAt >= 500) || millis() - resetScheduledAt >= 2500)) {
    closeUpload(); Serial.flush(); ESP.restart();
  }
  if (hardware.usbHostIsConnected() && millis() - statusSince > 10000) {
    statusSince=millis();char line[128];
    int n=snprintf(line,sizeof(line),"@MLC,frames=%lu,oled=0x%02x,mode=%s,ble=%d,storage=%d\n",(unsigned long)screen.framesSent,screen.address,screen.modeName().c_str(),connected.load(),storage.ready);
    // Periodic logging is expendable. Never wait for an unopened or stalled
    // host to consume debug output while the OLED is playing.
    if(n>0&&n<int(sizeof(line))&&Serial.availableForWrite()>=n)Serial.write(reinterpret_cast<const uint8_t*>(line),n);
    else ++telemetryDropped;
  }
  phase=micros();managePower();loopMaxPowerUs=max(loopMaxPowerUs,uint32_t(micros()-phase));
  loopMaxUs=max(loopMaxUs,uint32_t(micros()-loopStarted));
  delay(screen.sleeping()?10:connected.load()||upload.active?1:screen.idleDelayMs());
}
