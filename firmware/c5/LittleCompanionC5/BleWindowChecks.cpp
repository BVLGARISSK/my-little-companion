#include "BleWindow.h"
#include "Config.h"

namespace {
constexpr bool discoveryDeadline() {
  BleWindow w(config::ADVERTISE_MS, config::UPLOAD_IDLE_MS); w.open(100);
  return w.remaining(300099) == 1 && w.remaining(300100) == 0;
}
constexpr bool connectionNearDeadline() {
  BleWindow w(300000, 600000); w.open(100); w.onConnection(300099);
  return w.remaining(300100) == 599999 && w.remaining(900099) == 0;
}
constexpr bool uploadAndReconnect() {
  BleWindow w(300000, 600000); w.open(0); w.onConnection(100);
  w.onUpload(550000); w.onConnection(600000);
  return w.remaining(600000) == 550000 && w.remaining(1149999) == 1 && w.remaining(1150000) == 0;
}
constexpr bool unsignedWrap() {
  BleWindow w(300000, 600000); w.open(UINT32_MAX - 100); w.onConnection(UINT32_MAX - 50);
  w.onUpload(UINT32_MAX - 10);
  return w.remaining(9) == 599980 && w.remaining(599989) == 0;
}
constexpr bool explicitReopen() {
  BleWindow w(300000, 600000); w.open(0); w.onConnection(100); w.open(900000);
  if (w.hasConnected() || w.remaining(900000) != 300000) return false;
  w.open(1000000, true);
  return w.hasConnected() && w.remaining(1000000) == 600000;
}
static_assert(discoveryDeadline(), "An unused boot window closes at five minutes.");
static_assert(connectionNearDeadline(), "Connecting grants a ten-minute upload idle window.");
static_assert(uploadAndReconnect(), "Uploads extend the deadline; reconnecting alone does not.");
static_assert(unsignedWrap(), "Timers must survive millis() overflow.");
static_assert(explicitReopen(), "The local ble command can reopen either window.");
}
