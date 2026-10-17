#pragma once
#include <stdint.h>

namespace config {
constexpr uint8_t SDA_PIN = 23, SCL_PIN = 24;
constexpr uint8_t MOTION_INT_PIN = 1, TOUCH_PIN = 0;
constexpr uint8_t BATTERY_PIN = 6, BATTERY_ENABLE_PIN = 26;
constexpr uint32_t STILLNESS_MS = 60000, TOUCH_LONG_MS = 2000;
constexpr uint32_t I2C_HZ = 400000, I2C_SAFE_HZ = 100000;
constexpr uint32_t DISPLAY_INTERVAL_MS = 33;
constexpr uint32_t ADVERTISE_MS = 300000, UPLOAD_IDLE_MS = 600000;
constexpr uint32_t MAX_JSON = 16384, MAX_MEDIA = 102421, RESERVE_BYTES = 65536;
constexpr uint8_t MAX_ASSETS = 32, UPLOAD_WINDOW = 8;
constexpr char VERSION[] = "0.7.11-c5";
constexpr char DEVICE_NAME[] = "Little Companion C5";
constexpr char DEVICE_PREFIX[] = "mlc-c5-";
constexpr char SETTINGS_NAMESPACE[] = "mlc-c5";
constexpr char CONTROL_URL[] = "https://quadcopteronline.org/";
constexpr char SERVICE[] = "c07e0001-7d3b-4f2f-a86e-5c87b6ab1d10";
constexpr char CONTROL[] = "c07e0002-7d3b-4f2f-a86e-5c87b6ab1d10";
constexpr char DATA[] = "c07e0003-7d3b-4f2f-a86e-5c87b6ab1d10";
constexpr char EVENT[] = "c07e0004-7d3b-4f2f-a86e-5c87b6ab1d10";
constexpr char INFO[] = "c07e0005-7d3b-4f2f-a86e-5c87b6ab1d10";
}
