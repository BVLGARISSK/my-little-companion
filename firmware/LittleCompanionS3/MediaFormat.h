#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>

namespace media {
constexpr size_t FRAME_BYTES = 1024, HEADER_BYTES = 21;
inline uint16_t le16(const uint8_t* p) { return uint16_t(p[0]) | uint16_t(p[1]) << 8; }
inline uint32_t le32(const uint8_t* p) { return uint32_t(p[0]) | uint32_t(p[1]) << 8 | uint32_t(p[2]) << 16 | uint32_t(p[3]) << 24; }
inline void put16(uint8_t* p, uint16_t n) { p[0] = n; p[1] = n >> 8; }
inline uint32_t crcUpdate(uint32_t crc, const uint8_t* p, size_t n) {
  while (n--) {
    crc ^= *p++;
    for (uint8_t bit = 0; bit < 8; ++bit) crc = (crc >> 1) ^ (0xedb88320u & (0u - (crc & 1)));
  }
  return crc;
}
inline uint32_t crc32(const uint8_t* p, size_t n) { return crcUpdate(0xffffffffu, p, n) ^ 0xffffffffu; }
struct Header { uint16_t frames; uint8_t fps; uint32_t payloadCrc; };
inline bool header(const uint8_t* p, size_t length, Header& out) {
  if (length < HEADER_BYTES || memcmp(p, "OLA1", 4) || p[4] != 1 || le16(p + 5) != 128 || le16(p + 7) != 64 || p[12] != 0) return false;
  out.frames = le16(p + 9); out.fps = p[11]; out.payloadCrc = le32(p + 17);
  return out.frames >= 1 && out.frames <= 100 &&
    (out.frames == 1 ? out.fps == 1 : (out.fps == 5 || out.fps == 8 || out.fps == 10)) &&
    le32(p + 13) == uint32_t(out.frames) * FRAME_BYTES && length == HEADER_BYTES + uint32_t(out.frames) * FRAME_BYTES;
}
inline bool hex(const char* s, size_t n, bool lowerOnly = true) {
  if (!s || strlen(s) != n) return false;
  for (size_t i = 0; i < n; ++i)
    if (!((s[i] >= '0' && s[i] <= '9') || (s[i] >= 'a' && s[i] <= 'f') || (!lowerOnly && s[i] >= 'A' && s[i] <= 'F'))) return false;
  return true;
}
}
