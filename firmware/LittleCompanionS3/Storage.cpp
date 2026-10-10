#include "Storage.h"
#include "Config.h"
#include <esp_partition.h>
#include <esp_random.h>

static String journalPath(const char* name, unsigned slot) { return String("/") + name + ".j" + slot; }
static uint32_t jsonCrc(JsonVariantConst v) {
  String text; serializeJson(v, text);
  return media::crc32(reinterpret_cast<const uint8_t*>(text.c_str()), text.length());
}
uint32_t Storage::sequence(const char* path, JsonDocument* result) {
  File f = LittleFS.open(path, "r");
  if (!f || f.size() > 24576) return 0;
  JsonDocument d;
  if (deserializeJson(d, f) || !d["seq"].is<uint32_t>() || !d["crc32"].is<uint32_t>() || !d["payload"].is<JsonObject>() ||
      d["crc32"].as<uint32_t>() != jsonCrc(d["payload"])) return 0;
  uint32_t seq = d["seq"].as<uint32_t>();
  if (seq && result) result->set(d["payload"]);
  return seq;
}
bool Storage::loadJournal(const char* name, JsonDocument& result, bool& found) {
  String a = journalPath(name, 0), b = journalPath(name, 1);
  found = LittleFS.exists(a) || LittleFS.exists(b);
  uint32_t sa = sequence(a.c_str()), sb = sequence(b.c_str());
  if (!sa && !sb) return !found;
  sequence((sa >= sb ? a : b).c_str(), &result);
  return true;
}
bool Storage::saveJournal(const char* name, JsonVariantConst payload) {
  if (!ready) return false;
  String a = journalPath(name, 0), b = journalPath(name, 1);
  uint32_t sa = sequence(a.c_str()), sb = sequence(b.c_str());
  String target = sa <= sb ? a : b, temp = target + ".tmp";
  JsonDocument d; d["seq"] = max(sa, sb) + 1; d["crc32"] = jsonCrc(payload); d["payload"].set(payload);
  if (measureJson(d) > 24576) return false;
  File f = LittleFS.open(temp, "w");
  if (!f) return false;
  size_t expected = measureJson(d), written = serializeJson(d, f); f.flush(); f.close();
  if (written != expected || !sequence(temp.c_str())) { LittleFS.remove(temp); return false; }
  // LittleFS's POSIX rename replaces one slot atomically. The other validated slot survives a power loss.
  return LittleFS.rename(temp, target);
}
static bool entirelyErased(const esp_partition_t* partition) {
  uint8_t buffer[512];
  if (!partition) return false;
  for (size_t pos = 0; pos < partition->size; pos += sizeof(buffer)) {
    size_t n = min(sizeof(buffer), size_t(partition->size - pos));
    if (esp_partition_read(partition, pos, buffer, n) != ESP_OK) return false;
    for (size_t i = 0; i < n; ++i) if (buffer[i] != 0xff) return false;
    yield();
  }
  return true;
}
bool Storage::begin() {
  if (!LittleFS.begin(false, "/littlefs", 10, "spiffs")) {
    const esp_partition_t* p = esp_partition_find_first(ESP_PARTITION_TYPE_DATA, ESP_PARTITION_SUBTYPE_DATA_SPIFFS, "spiffs");
    if (!entirelyErased(p) || !LittleFS.format() || !LittleFS.begin(false, "/littlefs", 10, "spiffs")) {
      error = "Storage could not mount; existing bytes were preserved."; return false;
    }
    Serial.println("Initialized an entirely erased LittleFS partition.");
  }
  LittleFS.mkdir("/media"); LittleFS.mkdir("/temp");
  bool found = false;
  if (!loadJournal("library", library, found)) { error = "Library journal is damaged; files preserved."; return false; }
  if (!found) { library["version"] = 1; library["items"].to<JsonArray>(); }
  if (library["version"] != 1 || !library["items"].is<JsonArray>() || library["items"].size() > config::MAX_ASSETS) { error = "Invalid library."; return false; }
  for (JsonObject item : library["items"].as<JsonArray>()) {
    String id = item["id"] | "", path = item["path"] | "";
    String prefix = String("/media/") + id + "-";
    if (!media::hex(id.c_str(), 32) || !path.startsWith(prefix) || !path.endsWith(".ola") || !LittleFS.exists(path)) { error = "Library references a missing file."; return false; }
  }
  if (!loadJournal("playlist", playlist, found)) { error = "Playlist journal is damaged; files preserved."; return false; }
  if (!found) { playlist["version"] = 1; playlist["name"] = "My little day"; playlist["mode"] = "loop"; playlist["items"].to<JsonArray>(); }
  ready = true;
  collectOrphans();
  return true;
}
JsonObject Storage::find(const String& id) {
  for (JsonObject item : library["items"].as<JsonArray>()) if (id == item["id"].as<String>()) return item;
  return JsonObject();
}
bool Storage::referenced(const String& id) {
  for (JsonObjectConst item : playlist["items"].as<JsonArrayConst>())
    if (item["type"] != "emotion" && id == item["id"].as<String>()) return true;
  return false;
}
bool Storage::validatePlaylist(JsonVariantConst p, String& why) {
  String mode = p["mode"] | "";
  if (p["version"] != 1 || (mode != "loop" && mode != "shuffle" && mode != "once") || !p["items"].is<JsonArrayConst>() || p["items"].size() > 64 || p["items"].size() == 0) { why = "Invalid playlist."; return false; }
  unsigned enabled = 0;
  for (JsonObjectConst item : p["items"].as<JsonArrayConst>()) {
    String type = item["type"] | "", id = item["id"] | "";
    if (!item["duration_ms"].is<uint32_t>() || item["duration_ms"].as<uint32_t>() < 1000 || item["duration_ms"].as<uint32_t>() > 600000 || !item["enabled"].is<bool>() || (item["repeat"].is<bool>() == false && !item["repeat"].isNull())) { why = "Invalid playlist item."; return false; }
    if (type == "emotion") {
      if (id != "neutral" && id != "happy" && id != "sad" && id != "surprised" && id != "sleepy" && id != "angry") { why = "Unknown emotion."; return false; }
    } else {
      JsonObject media = find(id);
      if ((type != "image" && type != "animation") || media.isNull() || type != media["kind"].as<String>()) { why = "Upload each referenced work first."; return false; }
    }
    if (item["enabled"].as<bool>()) ++enabled;
  }
  if (!enabled) { why = "Enable at least one item."; return false; }
  return true;
}
bool Storage::validateOLA(const String& path, uint32_t wholeCrc, media::Header& h, String& why) {
  File f = LittleFS.open(path, "r"); uint8_t head[21];
  if (!f || f.read(head, sizeof(head)) != sizeof(head) || !media::header(head, f.size(), h)) { why = "Invalid OLA header."; return false; }
  uint32_t all = media::crcUpdate(0xffffffff, head, sizeof(head)), payload = 0xffffffff;
  uint8_t buffer[1024];
  while (f.available()) {
    size_t n = f.read(buffer, sizeof(buffer)); if (!n) { why = "File read failed."; return false; }
    all = media::crcUpdate(all, buffer, n); payload = media::crcUpdate(payload, buffer, n); yield();
  }
  if ((all ^ 0xffffffff) != wholeCrc || (payload ^ 0xffffffff) != h.payloadCrc) { why = "File CRC mismatch; previous work preserved."; return false; }
  return true;
}
bool Storage::commitMedia(const String& temp, JsonVariantConst meta, const media::Header& h) {
  String id = meta["id"] | "", oldPath; JsonDocument next; next.set(library);
  JsonArray items = next["items"].as<JsonArray>(); JsonObject record;
  for (JsonObject item : items) if (id == item["id"].as<String>()) { record = item; oldPath = item["path"].as<String>(); break; }
  if (record.isNull()) record = items.add<JsonObject>();
  char suffix[9]; String path;
  do { snprintf(suffix, sizeof(suffix), "%08lx", (unsigned long)esp_random()); path = String("/media/") + id + "-" + suffix + ".ola"; } while (LittleFS.exists(path));
  if (!LittleFS.rename(temp, path)) return false;
  record.set(meta); record["path"] = path; record["frames"] = h.frames; record["fps"] = h.fps;
  if (!saveJournal("library", next.as<JsonVariantConst>())) return false;
  library.set(next);
  collectOrphans();
  return true;
}
bool Storage::deleteMedia(const String& id) {
  JsonObject previous = find(id); if (previous.isNull() || referenced(id)) return false;
  String path = previous["path"].as<String>();
  JsonDocument next; next.set(library); JsonArray a = next["items"].as<JsonArray>();
  for (size_t i = 0; i < a.size(); ++i) if (id == a[i]["id"].as<String>()) { a.remove(i); break; }
  if (!saveJournal("library", next.as<JsonVariantConst>())) return false;
  library.set(next); collectOrphans(); return true;
}
uint32_t Storage::freeBytes() const { return ready ? LittleFS.totalBytes() - LittleFS.usedBytes() : 0; }
void Storage::collectOrphans() {
  JsonDocument previousA, previousB;
  sequence(journalPath("library", 0).c_str(), &previousA);
  sequence(journalPath("library", 1).c_str(), &previousB);
  File root = LittleFS.open("/media"); if (!root) return;
  // Preserve files referenced by either validated recovery slot, including the previous generation.
  File entry = root.openNextFile();
  while (entry) {
    String path = entry.path(), name = entry.name(); bool used = false; entry.close();
    for (JsonObject item : library["items"].as<JsonArray>()) if (path == item["path"].as<String>()) { used = true; break; }
    for (JsonObjectConst item : previousA["items"].as<JsonArrayConst>()) if (path == item["path"].as<String>()) used = true;
    for (JsonObjectConst item : previousB["items"].as<JsonArrayConst>()) if (path == item["path"].as<String>()) used = true;
    if (!used && name.length() == 45 && name[32] == '-' && name.endsWith(".ola") && media::hex(name.substring(0, 32).c_str(), 32) && media::hex(name.substring(33, 41).c_str(), 8)) LittleFS.remove(path);
    entry = root.openNextFile();
  }
}
