#pragma once
#include <stdint.h>

namespace displaydiff {
struct Span { uint8_t first = 16, end = 0; };
// SH1106 full buffer: eight pages, sixteen 8-byte tiles per page.
// Compare the physical U8g2 buffer, so R0 and R2 use the same coordinates.
constexpr Span page(const uint8_t* before, const uint8_t* after) {
  Span span;
  for (uint8_t tile = 0; tile < 16; ++tile) {
    for (uint8_t byte = 0; byte < 8; ++byte) {
      const uint8_t index = tile * 8 + byte;
      if (before[index] != after[index]) {
        if (span.first == 16) span.first = tile;
        span.end = tile + 1;
        break;
      }
    }
  }
  return span;
}
}
