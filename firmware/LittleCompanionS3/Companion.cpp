#include "Companion.h"
#include "Config.h"
#include "BleWindow.h"
#include "Storage.h"
#include "Display.h"
#include <NimBLEDevice.h>
#include <Preferences.h>
#include <esp_random.h>
#include <esp_mac.h>
#include <mbedtls/md.h>
#include <atomic>
#include <deque>
#include <map>

namespace {
Storage storage;
Display screen(storage);
Preferences preferences;
NimBLEServer* server;
NimBLECharacteristic* events;
String deviceId;
uint8_t ownerKey[32];
std::atomic<uint32_t> connectionEpoch{0}, storageFree{0}, storageTotal{0};
std::atomic<uint16_t> connectionHandle{BLE_HS_CONN_HANDLE_NONE}, mtu{23};
std::atomic<bool> connected{false}, subscribed{false};
uint32_t observedEpoch = 0, statusSince = 0;
BleWindow bleWindow(config::ADVERTISE_MS, config::UPLOAD_IDLE_MS);
bool wasConnected = false, advertising = false, windowClosed = false;
enum Source : uint8_t { BLE, USB };
struct Session {
  bool authorized = false;
  String clientNonce, serverNonce;
  uint32_t challengedAt = 0;
  void reset() { authorized = false; clientNonce = ""; serverNonce = ""; }
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
  if (!session.authorized || !upload.active || source != upload.owner || id != upload.id || !length || length > 1024) return;
  uint32_t total = upload.meta["length"].as<uint32_t>();
  if (offset < upload.received && offset + length <= upload.received) { uploaded(source); ackUpload(source); return; }
  if (offset != upload.received || offset > total || length > total - offset) { ackUpload(source); return; }
  size_t written = upload.file.write(bytes, length); upload.received += written;
  if (written) uploaded(source);
  if (written != length) { ackUpload(source); closeUpload(); return; }
  if (++upload.pendingPackets >= config::UPLOAD_WINDOW || upload.received == total) ackUpload(source);
}
bool validEmotion(const String& s) { return s == "neutral" || s == "happy" || s == "sad" || s == "surprised" || s == "sleepy" || s == "angry"; }
void status(JsonDocument& d) {
  d["ok"] = true; d["protocol"] = "mlc/1"; d["device_id"] = deviceId; d["firmware"] = config::VERSION;
  d["oled_address"] = screen.address; d["sda"] = config::SDA_PIN; d["scl"] = config::SCL_PIN;
  d["storage_ready"] = storage.ready; d["storage_free"] = storageFree.load(); d["storage_total"] = storageTotal.load();
  d["mode"] = screen.modeName(); d["media_id"] = screen.currentId; d["frames_sent"] = screen.framesSent; d["frame_crc32"] = screen.frameCrc;
  d["brightness"] = screen.level; d["ble_connected"] = connected.load(); d["ble_authorized"] = bleSession.authorized;
  d["advertising"] = advertising; d["uptime_ms"] = millis();
  d["window_ms_left"] = windowClosed ? 0 : bleWindow.remaining(millis());
  d["ble_window_state"] = windowClosed ? "closed" : bleWindow.hasConnected() ? "upload_idle" : "discovery";
  d["storage_error"] = storage.error;
}
void handle(Source source, uint16_t requestId, JsonVariantConst request) {
  String op = request["op"] | ""; Session& session = source == BLE ? bleSession : usbSession;
  JsonDocument response; response["ok"] = true;
  if (source == USB && op == "STATUS") { status(response); reply(source, requestId, response.as<JsonVariantConst>()); return; }
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
    uint8_t expected[32] = {}, supplied[32] = {};
    bool valid = session.serverNonce.length() == 64 && client == session.clientNonce && millis() - session.challengedAt <= 15000 && parseHex(proof, supplied, 32);
    if (mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), ownerKey, sizeof(ownerKey), reinterpret_cast<const uint8_t*>(message.c_str()), message.length(), expected) != 0) valid = false;
    uint8_t difference = 0; for (unsigned i = 0; i < 32; ++i) difference |= expected[i] ^ supplied[i];
    session.clientNonce = ""; session.serverNonce = "";
    if (!valid || difference) { fail(source, requestId, "AUTH", "Incorrect key or expired challenge."); return; }
    session.authorized = true; success(source, requestId); return;
  }
  if (!session.authorized) { fail(source, requestId, "UNAUTHORIZED", "Authorize this connection first."); return; }
  if (op == "SET_EMOTION") {
    String mood = request["emotion"] | "", mode = request["mode"] | "";
    if (!validEmotion(mood) || (mode != "manual" && mode != "auto")) { fail(source, requestId, "EMOTION", "Invalid emotion or mode."); return; }
    screen.emotion(mood, mode == "auto"); preferences.putString("mode", mode); preferences.putString("emotion", mood);
  } else if (op == "SET_BRIGHTNESS") {
    if (!request["value"].is<unsigned>() || request["value"].as<unsigned>() < 1 || request["value"].as<unsigned>() > 255) { fail(source, requestId, "RANGE", "Brightness must be 1-255."); return; }
    screen.brightness(request["value"].as<unsigned>()); preferences.putUChar("brightness", screen.level);
  } else if (!storage.ready) { fail(source, requestId, "STORAGE", storage.error); return;
  } else if (op == "PLAY_MEDIA") {
    String id = request["id"] | "";
    if (!media::hex(id.c_str(), 32) || !screen.playMedia(id)) { fail(source, requestId, "NOT_FOUND", "Work not found on this device."); return; }
    preferences.putString("mode", "media"); preferences.putString("media", id);
  } else if (op == "PLAY_PLAYLIST") {
    if (!screen.playPlaylist()) { fail(source, requestId, "PLAYLIST", "Sync a playlist with an enabled item first."); return; }
    preferences.putString("mode", "playlist");
  } else if (op == "LIST_MEDIA") {
    JsonArray a = response["items"].to<JsonArray>();
    for (JsonObject item : storage.library["items"].as<JsonArray>()) {
      JsonObject out = a.add<JsonObject>();
      for (const char* field : {"id", "kind", "name", "length"}) out[field].set(item[field]);
    }
  } else if (op == "DELETE_MEDIA") {
    String id = request["id"] | "";
    if (storage.referenced(id)) { fail(source, requestId, "REFERENCED", "Remove this work from the playlist before deleting it."); return; }
    if (!storage.deleteMedia(id)) { fail(source, requestId, "DELETE", "Could not delete this work."); return; }
    if (screen.currentId == id) { screen.emotion("neutral", true); preferences.putString("mode", "auto"); }
    updateStorageInfo();
  } else if (op == "SET_PLAYLIST") {
    String why; JsonVariantConst next = request["playlist"];
    if (!storage.validatePlaylist(next, why)) { fail(source, requestId, "PLAYLIST", why); return; }
    if (!storage.saveJournal("playlist", next)) { fail(source, requestId, "WRITE", "Playlist commit failed; previous playlist preserved."); return; }
    storage.playlist.set(next); screen.playPlaylist(); preferences.putString("mode", "playlist"); updateStorageInfo();
    uploaded(source);
  } else if (op == "UPLOAD_BEGIN") {
    String id = request["id"] | "", kind = request["kind"] | "", name = request["name"] | "";
    if (!media::hex(id.c_str(), 32) || (kind != "image" && kind != "animation") || name.length() > 240 || !request["length"].is<uint32_t>() || !request["crc32"].is<uint32_t>()) { fail(source, requestId, "UPLOAD", "Invalid upload metadata."); return; }
    uint32_t length = request["length"].as<uint32_t>();
    if (length < 1045 || length > config::MAX_MEDIA || (length - 21) % 1024 || (kind == "image" && length != 1045) || (kind == "animation" && length == 1045)) { fail(source, requestId, "SIZE", "Invalid media size."); return; }
    if (storage.find(id).isNull() && storage.library["items"].size() >= config::MAX_ASSETS) { fail(source, requestId, "FULL", "Device library is full (32 works maximum)."); return; }
    if (storage.referenced(id) && kind != storage.find(id)["kind"].as<String>()) { fail(source, requestId, "REFERENCED", "A referenced work cannot change its media kind."); return; }
    if (upload.active && upload.owner != source) { fail(source, requestId, "BUSY", "Another connection is uploading."); return; }
    closeUpload(); JsonDocument saved; bool found = false;
    if (!storage.loadJournal("upload", saved, found)) { fail(source, requestId, "JOURNAL", "Upload metadata is damaged; files preserved."); return; }
    bool resume = saved["active"] == true && saved["id"] == id && saved["kind"] == kind && saved["length"] == length && saved["crc32"] == request["crc32"] && LittleFS.exists(TEMP);
    uint32_t existing = 0;
    if (resume) { File f = LittleFS.open(TEMP, "r"); existing = f.size(); if (existing > length) resume = false; }
    if (storage.freeBytes() < (resume ? length - existing : length) + config::RESERVE_BYTES) { fail(source, requestId, "FULL", "Not enough free storage; previous work preserved."); return; }
    if (!resume) { if (!clearUploadJournal()) { fail(source, requestId, "WRITE", "Could not start an upload."); return; } LittleFS.remove(TEMP); existing = 0; }
    upload.meta.clear(); upload.meta["active"] = true;
    for (const char* key : {"id", "kind", "name", "length", "crc32"}) upload.meta[key].set(request[key]);
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
      if ((upload.meta["kind"] == "image") != (h.frames == 1)) { upload.file = LittleFS.open(TEMP, "a"); fail(source, requestId, "KIND", "Media kind does not match its frames."); return; }
      String current = screen.currentId;
      if (!storage.commitMedia(TEMP, upload.meta.as<JsonVariantConst>(), h)) { upload.active = false; fail(source, requestId, "COMMIT", "Media commit failed; previous work preserved."); return; }
      upload.active = false; clearUploadJournal();
      if (current == upload.meta["id"].as<String>()) screen.playMedia(current);
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
    JsonDocument d; d["protocol"] = "mlc/1"; d["device_id"] = deviceId; d["name"] = "Little Companion S3"; d["firmware"] = config::VERSION;
    d["max_write_bytes"] = min(uint16_t(244), uint16_t(max(uint16_t(23), info.getMTU()) - 3));
    JsonArray caps = d["capabilities"].to<JsonArray>(); caps.add("emotion"); caps.add("brightness");
    if (storage.ready) { caps.add("media"); caps.add("playlist"); d["storage_total"] = storageTotal.load(); d["storage_free"] = storageFree.load(); }
    String text; serializeJson(d, text); c->setValue(text.c_str());
  }
} infoCallbacks;
void startAdvertising() {
  if (connected) return;
  advertising = NimBLEDevice::getAdvertising()->start();
}
void initializeBLE() {
  packets = xQueueCreate(48, sizeof(Packet));
  NimBLEDevice::init("Little Companion S3"); NimBLEDevice::setMTU(247);
  server = NimBLEDevice::createServer(); server->setCallbacks(&serverCallbacks); server->advertiseOnDisconnect(false);
  NimBLEService* s = server->createService(config::SERVICE);
  auto control = s->createCharacteristic(config::CONTROL, NIMBLE_PROPERTY::WRITE, 244); control->setCallbacks(&controlCallbacks);
  auto data = s->createCharacteristic(config::DATA, NIMBLE_PROPERTY::WRITE_NR, 244); data->setCallbacks(&dataCallbacks);
  events = s->createCharacteristic(config::EVENT, NIMBLE_PROPERTY::NOTIFY, 244); events->setCallbacks(&eventCallbacks);
  auto info = s->createCharacteristic(config::INFO, NIMBLE_PROPERTY::READ, 512); info->setCallbacks(&infoCallbacks);
  auto a = NimBLEDevice::getAdvertising(); a->addServiceUUID(config::SERVICE); a->enableScanResponse(true); a->setName("Little Companion S3");
  s->start(); bleWindow.open(millis());
}
void printPair() {
  JsonDocument d; d["device_id"] = deviceId; d["key"] = hexBytes(ownerKey, sizeof(ownerKey));
  d["url"] = String("https://bvlgarissk.github.io/my-little-companion/#device=") + deviceId + "&key=" + hexBytes(ownerKey, sizeof(ownerKey));
  Serial.print("@PAIR,"); serializeJson(d, Serial); Serial.println();
}
void readSerial() {
  static String line; static bool tooLong = false;
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\r') continue;
    if (c != '\n') { if (line.length() < config::MAX_JSON) line += c; else tooLong = true; continue; }
    if (tooLong) { line = ""; tooLong = false; Serial.println("Serial request too long."); continue; }
    if (line == "pair") printPair();
    else if (line == "ble") { bleWindow.open(millis(), connected.load()); windowClosed = false; startAdvertising(); Serial.println("BLE window reopened: 5 minutes to connect, 10 minutes without an upload after connecting."); }
    else if (line == "rotate") screen.rotate(true);
    else if (line == "normal") screen.rotate(false);
    else if (line == "status") { JsonDocument d; status(d); reply(USB, 0, d.as<JsonVariantConst>()); }
    else if (line.startsWith("{")) {
      JsonDocument d;
      if (deserializeJson(d, line) || !d.is<JsonObject>()) fail(USB, 0, "JSON", "Invalid diagnostic request.");
      else handle(USB, d["rid"] | uint16_t(1), d.as<JsonVariantConst>());
    } else if (line.length()) Serial.println("Commands: status / pair / ble / rotate / normal; JSON diagnostic requests also supported.");
    line = "";
  }
}
void processBLE() {
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
}
}

void companionSetup() {
  Serial.setRxBufferSize(8192);
  Serial.begin(115200); delay(300);
  Serial.printf("\nLittle Companion ESP32-S3 %s\n", config::VERSION);
  screen.begin(); storage.begin(); updateStorageInfo();
  initializeBLE();
  uint8_t mac[6]; esp_read_mac(mac, ESP_MAC_BT); deviceId = "mlc-s3-" + hexBytes(mac + 3, 3);
  preferences.begin("mlc-s3", false);
  if (preferences.getBytesLength("owner_key") == sizeof(ownerKey)) preferences.getBytes("owner_key", ownerKey, sizeof(ownerKey));
  else { esp_fill_random(ownerKey, sizeof(ownerKey)); if (preferences.putBytes("owner_key", ownerKey, sizeof(ownerKey)) != sizeof(ownerKey)) { Serial.println("Cannot persist owner key. Restart before pairing."); while (true) { screen.update(); delay(10); } } }
  bleSession.reset(); usbSession.reset();
  screen.brightness(preferences.getUChar("brightness", 160));
  String savedMode = preferences.getString("mode", "auto");
  if (savedMode == "playlist" && storage.ready && screen.playPlaylist()) {}
  else if (savedMode == "media" && storage.ready && screen.playMedia(preferences.getString("media", ""))) {}
  else screen.emotion(preferences.getString("emotion", "neutral"), savedMode != "manual");
  startAdvertising();
  Serial.printf("Device: %s. Enter 'pair' locally to obtain your private key.\n", deviceId.c_str());
  Serial.printf("Storage: %s; %lu free bytes.\n", storage.ready ? "ready" : storage.error.c_str(), (unsigned long)storageFree.load());
}
void companionLoop() {
  readSerial(); processBLE(); screen.update();
  if (millis() - statusSince > 10000) { statusSince = millis(); Serial.printf("@MLC,frames=%lu,oled=0x%02x,mode=%s,ble=%d,storage=%d\n", (unsigned long)screen.framesSent, screen.address, screen.modeName().c_str(), connected.load(), storage.ready); }
  delay(1);
}
