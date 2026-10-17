#pragma once
#include <stdint.h>

// Unsigned subtraction keeps deadlines correct when millis() wraps.
class BleWindow {
public:
  constexpr BleWindow(uint32_t discoveryMs, uint32_t uploadIdleMs) : discoveryMs(discoveryMs), uploadIdleMs(uploadIdleMs) {}
  constexpr void open(uint32_t now, bool connected = false) { activityAt = now; connectedBefore = connected; }
  constexpr void onConnection(uint32_t now) { if (!connectedBefore) { connectedBefore = true; activityAt = now; } }
  constexpr void onUpload(uint32_t now) { if (connectedBefore) activityAt = now; }
  constexpr uint32_t remaining(uint32_t now) const {
    const uint32_t limit = connectedBefore ? uploadIdleMs : discoveryMs, elapsed = now - activityAt;
    return elapsed < limit ? limit - elapsed : 0;
  }
  constexpr bool hasConnected() const { return connectedBefore; }
private:
  uint32_t discoveryMs, uploadIdleMs, activityAt = 0;
  bool connectedBefore = false;
};
