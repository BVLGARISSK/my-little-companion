#pragma once
#include <stdint.h>

namespace config {
constexpr uint8_t SDA_PIN = 8, SCL_PIN = 9;
constexpr uint32_t I2C_HZ = 100000;
constexpr uint32_t ADVERTISE_MS = 180000, AUTH_MS = 60000, IDLE_MS = 600000;
constexpr uint32_t MAX_JSON = 16384, MAX_MEDIA = 102421, RESERVE_BYTES = 65536;
constexpr uint8_t MAX_ASSETS = 32, UPLOAD_WINDOW = 8;
constexpr char VERSION[] = "0.3.0-s3";
constexpr char SERVICE[] = "c07e0001-7d3b-4f2f-a86e-5c87b6ab1d10";
constexpr char CONTROL[] = "c07e0002-7d3b-4f2f-a86e-5c87b6ab1d10";
constexpr char DATA[] = "c07e0003-7d3b-4f2f-a86e-5c87b6ab1d10";
constexpr char EVENT[] = "c07e0004-7d3b-4f2f-a86e-5c87b6ab1d10";
constexpr char INFO[] = "c07e0005-7d3b-4f2f-a86e-5c87b6ab1d10";
}
