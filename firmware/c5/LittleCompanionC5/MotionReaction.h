#pragma once
#include <stdint.h>

// Require deliberate, sustained reversals rather than light everyday movement.
// Inputs are acceleration minus the slowly tracked gravity/reference vector.
class MotionReaction {
public:
  static constexpr float TRIGGER_G = .35f;
  static constexpr uint8_t REQUIRED_PEAKS = 4;
  static constexpr uint32_t MIN_GAP_MS = 100, MAX_GAP_MS = 650, MAX_SEQUENCE_MS = 1800;
  constexpr void reset() { *this = MotionReaction(); }
  constexpr void sample(float x, float y, float z, uint32_t now) {
    offsetX = bound(x * 7.f, -6.f, 6.f);
    offsetY = bound(y * 6.f, -4.f, 4.f);
    if (peaks && (now - peakAt > MAX_GAP_MS || (peaks < REQUIRED_PEAKS && now - firstAt > MAX_SEQUENCE_MS))) peaks = 0;
    float energy = x*x + y*y + z*z;
    if (energy < TRIGGER_G*TRIGGER_G) return;
    bool first = peaks == 0;
    float dot = x*previous[0] + y*previous[1] + z*previous[2];
    float previousEnergy = previous[0]*previous[0] + previous[1]*previous[1] + previous[2]*previous[2];
    // Clearly opposing directions (cosine <= -0.25), without requiring exact backtracking.
    bool reversed = dot < 0.f && dot*dot >= .0625f*energy*previousEnergy;
    if (!first && !reversed) return;
    if (!first && now - peakAt < MIN_GAP_MS) {
      // Very rapid reversals restart qualification, instead of aliasing into it.
      peaks = 1; firstAt = peakAt = now;
      previous[0] = x; previous[1] = y; previous[2] = z;
      return;
    }
    if (first) firstAt = now;
    if (peaks < REQUIRED_PEAKS) ++peaks;
    peakAt = now; previous[0] = x; previous[1] = y; previous[2] = z;
    if (peaks == REQUIRED_PEAKS) {
      if (!active(now)) ++episodes;
      triggered = true; shakeAt = now;
      strength = bound(energy / 1.44f, 0.3f, 1.f);
    }
  }
  constexpr float level(uint32_t now) const {
    if (!triggered || now - shakeAt >= 1800) return 0.f;
    uint32_t elapsed = now - shakeAt;
    return strength * (elapsed <= 800 ? 1.f : (1800 - elapsed) / 1000.f);
  }
  constexpr bool active(uint32_t now) const { return level(now) > 0.f; }
  constexpr float x() const { return offsetX; }
  constexpr float y() const { return offsetY; }
  constexpr uint32_t count() const { return episodes; }
private:
  static constexpr float bound(float x, float lo, float hi) { return x < lo ? lo : x > hi ? hi : x; }
  bool triggered = false;
  uint8_t peaks = 0;
  uint32_t peakAt = 0, firstAt = 0, shakeAt = 0, episodes = 0;
  float previous[3] = {}, strength = 0.f, offsetX = 0.f, offsetY = 0.f;
};
