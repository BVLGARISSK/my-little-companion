#include "DisplayDiff.h"

namespace {
constexpr bool allByteChangesAndClears() {
  uint8_t oldPage[128] = {}, newPage[128] = {};
  for (unsigned i = 0; i < 128; ++i) {
    newPage[i] = 0x80;
    auto set = displaydiff::page(oldPage, newPage);
    auto clear = displaydiff::page(newPage, oldPage);
    if (set.first != i / 8 || set.end != i / 8 + 1 ||
        clear.first != set.first || clear.end != set.end) return false;
    newPage[i] = 0;
  }
  return true;
}
constexpr bool separatedChangesAndNoChange() {
  uint8_t oldPage[128] = {}, newPage[128] = {};
  auto empty = displaydiff::page(oldPage, newPage);
  if (empty.first != 16 || empty.end != 0) return false;
  newPage[0] = 1; newPage[127] = 1;
  auto full = displaydiff::page(oldPage, newPage);
  if (full.first != 0 || full.end != 16) return false;
  oldPage[0] = 1; oldPage[127] = 1;
  auto equal = displaydiff::page(oldPage, newPage);
  return equal.first == 16 && equal.end == 0;
}
static_assert(allByteChangesAndClears(), "Every changed or erased byte must be covered by an in-bounds tile span.");
static_assert(separatedChangesAndNoChange(), "Separated page edges must be covered; identical pages must send nothing.");
}
