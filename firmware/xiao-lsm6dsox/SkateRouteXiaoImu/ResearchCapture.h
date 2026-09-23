#pragma once
#include <esp_heap_caps.h>
#include <esp_system.h>
#include <esp_random.h>

// Desk capture v1: acceleration only, selectable 833/1666 Hz, +/-16 g. See
// hardware/research.md for the protocol and ST FIFO register references.
namespace research {
constexpr uint32_t DEFAULT_RATE = 833, HIGH_RATE = 1666;
constexpr uint32_t MAX_SAMPLES = HIGH_RATE * 60;
constexpr uint32_t MAX_WINDOWS = 301;
constexpr uint32_t TIMESTAMP_DECIMATION = 32;
constexpr float SCALE_G = 0.000488f;
constexpr uint8_t ADDRESS = 0x6A;
constexpr uint8_t STATUS = 1, START = 2, RAW = 3, SUMMARIES = 4;
constexpr uint8_t IDLE = 0, RECORDING = 1, COMPLETE = 2, FAILED = 3;
constexpr uint8_t MEMORY_ERROR = 1, BUS_ERROR = 2, FIFO_ERROR = 3,
                  TAG_ERROR = 4, TIMEOUT_ERROR = 5;
BLECharacteristic *response = nullptr;
uint8_t *raw = nullptr;
uint8_t summaries[MAX_WINDOWS * 24];
uint32_t capacity = 0, captureId = 0, count = 0, target = 0, windows = 0;
uint32_t rateHz = DEFAULT_RATE, windowSamples = 167;
uint32_t startedMs = 0, startedUs = 0, elapsedUs = 0, overruns = 0, busErrors = 0;
uint32_t clipped = 0, rawCrc = 0, summariesCrc = 0, windowCount = 0, windowClipped = 0;
uint32_t timestampCount = 0, firstTimestamp = 0, lastTimestamp = 0;
uint32_t minTimestampDelta = 0, maxTimestampDelta = 0, timestampDeltaCount = 0;
uint8_t state = IDLE, error = 0;
double means[3] = {}, m2[3] = {}, sumNorm = 0, peakNorm = 0;
double timestampMeanDelta = 0, timestampM2Delta = 0;
portMUX_TYPE commandMux = portMUX_INITIALIZER_UNLOCKED;
uint8_t pendingCommand[12];
bool pending = false;

void u16(uint8_t *p, uint16_t v) { p[0] = v; p[1] = v >> 8; }
void u32(uint8_t *p, uint32_t v) { for (int i = 0; i < 4; ++i) p[i] = v >> (8 * i); }
uint32_t read32(const uint8_t *p) {
  return uint32_t(p[0]) | (uint32_t(p[1]) << 8) | (uint32_t(p[2]) << 16) | (uint32_t(p[3]) << 24);
}
void f32(uint8_t *p, float v) { uint32_t bits; memcpy(&bits, &v, 4); u32(p, bits); }
uint32_t crc32(const uint8_t *data, size_t size) {
  uint32_t crc = 0xffffffff;
  for (size_t i = 0; i < size; ++i) {
    crc ^= data[i];
    for (int j = 0; j < 8; ++j) crc = (crc >> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return ~crc;
}
bool writeReg(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(ADDRESS); Wire.write(reg); Wire.write(value);
  return Wire.endTransmission() == 0;
}
bool readReg(uint8_t reg, uint8_t *out, uint8_t size) {
  Wire.beginTransmission(ADDRESS); Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(ADDRESS, size) != size) return false;
  for (uint8_t i = 0; i < size; ++i) out[i] = Wire.read();
  return true;
}
void resetWindow() {
  windowCount = windowClipped = 0; sumNorm = peakNorm = 0;
  for (int i = 0; i < 3; ++i) means[i] = m2[i] = 0;
}
void finishWindow() {
  if (!windowCount || windows >= MAX_WINDOWS) return;
  uint8_t *out = summaries + windows++ * 24;
  u32(out, count - windowCount); u32(out + 4, windowCount);
  f32(out + 8, sqrt((m2[0] + m2[1] + m2[2]) / windowCount));
  f32(out + 12, peakNorm); f32(out + 16, sumNorm / windowCount);
  u32(out + 20, windowClipped);
  resetWindow();
}
void finish(uint8_t failure = 0) {
  elapsedUs = micros() - startedUs;
  if (!writeReg(0x0A, 0) || !writeReg(0x19, 0)) { ++busErrors; if (!failure) failure = BUS_ERROR; }
  finishWindow();
  error = failure; state = failure ? FAILED : COMPLETE;
  rawCrc = crc32(raw, count * 6);
  summariesCrc = crc32(summaries, windows * 24);
}
bool recording() { return state == RECORDING; }
void beginCapture(uint32_t seconds, uint32_t requestedRate) {
  captureId = esp_random(); if (!captureId) captureId = 1;
  count = windows = overruns = busErrors = clipped = rawCrc = summariesCrc = 0;
  timestampCount = timestampDeltaCount = firstTimestamp = lastTimestamp = 0;
  minTimestampDelta = maxTimestampDelta = 0;
  timestampMeanDelta = timestampM2Delta = 0;
  elapsedUs = 0; error = 0; resetWindow();
  rateHz = requestedRate; windowSamples = (rateHz + 2) / 5;
  startedMs = millis(); startedUs = micros();
  target = seconds * rateHz;
  if (!raw || target > capacity) { state = FAILED; error = MEMORY_ERROR; return; }
  const uint8_t odr = rateHz == HIGH_RATE ? 0x80 : 0x70;
  const uint8_t bdr = rateHz == HIGH_RATE ? 0x08 : 0x07;
  // Bypass resets FIFO. Timestamp tag 0x04 is batched every 32 samples.
  bool ok = writeReg(0x0A, 0) && writeReg(0x07, 0) && writeReg(0x08, 0) &&
            writeReg(0x10, odr | 0x04) && writeReg(0x19, 0x20) &&
            writeReg(0x09, bdr) && writeReg(0x0A, 0xC6);
  uint8_t config[4] = {}, ctrl1 = 0, ctrl10 = 0;
  ok = ok && readReg(0x07, config, 4) && readReg(0x10, &ctrl1, 1) &&
       readReg(0x19, &ctrl10, 1) && config[0] == 0 && config[1] == 0 &&
       config[2] == bdr && config[3] == 0xC6 && ctrl1 == (odr | 0x04) &&
       (ctrl10 & 0x20);
  if (!ok) { ++busErrors; finish(BUS_ERROR); return; }
  startedMs = millis(); startedUs = micros(); state = RECORDING;
}
void captureTick() {
  if (!recording()) return;
  uint8_t status[2];
  if (!readReg(0x3A, status, 2)) { ++busErrors; finish(BUS_ERROR); return; }
  // Fail closed on FIFO overflow (including latched overflow) or full FIFO.
  if (status[1] & 0x68) { ++overruns; finish(FIFO_ERROR); return; }
  uint16_t available = status[0] | ((status[1] & 3) << 8);
  // Bound each pass so BLE command handling and the scheduler can run.
  const uint16_t batch = available > 64 ? 64 : available;
  for (uint16_t n = 0; n < batch && count < target; ++n) {
    uint8_t entry[7];
    if (!readReg(0x78, entry, 7)) { ++busErrors; finish(BUS_ERROR); return; }
    const uint8_t tag = entry[0] >> 3;
    if (tag == 4) {
      const uint32_t sensorTimestamp = read32(entry + 1);
      if (!timestampCount) firstTimestamp = sensorTimestamp;
      else {
        const uint32_t delta = sensorTimestamp - lastTimestamp;
        if (!timestampDeltaCount || delta < minTimestampDelta) minTimestampDelta = delta;
        if (delta > maxTimestampDelta) maxTimestampDelta = delta;
        ++timestampDeltaCount;
        const double difference = delta - timestampMeanDelta;
        timestampMeanDelta += difference / timestampDeltaCount;
        timestampM2Delta += difference * (delta - timestampMeanDelta);
      }
      lastTimestamp = sensorTimestamp; ++timestampCount;
      continue;
    }
    if (tag != 2) { finish(TAG_ERROR); return; }
    memcpy(raw + count * 6, entry + 1, 6);
    ++windowCount;
    double norm2 = 0; bool sampleClipped = false;
    for (int axis = 0; axis < 3; ++axis) {
      int16_t value = int16_t(uint16_t(entry[1 + axis * 2]) | (uint16_t(entry[2 + axis * 2]) << 8));
      sampleClipped |= value >= 32760 || value <= -32760;
      double g = value * double(SCALE_G);
      double delta = g - means[axis]; means[axis] += delta / windowCount;
      m2[axis] += delta * (g - means[axis]); norm2 += g * g;
    }
    if (sampleClipped) { ++clipped; ++windowClipped; }
    double norm = sqrt(norm2); sumNorm += norm; if (norm > peakNorm) peakNorm = norm;
    ++count;
    if (windowCount == windowSamples) finishWindow();
  }
  if (count == target) { finish(); return; }
  if (micros() - startedUs > (target / rateHz + 5) * 1000000UL) finish(TIMEOUT_ERROR);
}

class Commands : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *c) override {
    String value = c->getValue();
    if (value.length() != 12 || uint8_t(value[0]) != 1) return;
    // Sensor bus and buffer mutations happen exclusively in loop(), not BLE callbacks.
    portENTER_CRITICAL(&commandMux);
    if (!pending) { memcpy(pendingCommand, value.c_str(), 12); pending = true; }
    portEXIT_CRITICAL(&commandMux);
  }
};
void commandTick(bool imuReady) {
  uint8_t cmd[12]; bool ready;
  portENTER_CRITICAL(&commandMux);
  ready = pending;
  if (ready) { memcpy(cmd, pendingCommand, 12); pending = false; }
  portEXIT_CRITICAL(&commandMux);
  if (!ready) return;
  uint8_t op = cmd[1]; uint32_t requestedId = read32(cmd + 4), arg = read32(cmd + 8);
  uint8_t out[408] = {}; // Header 20 + 64 raw records (384) + CRC 4.
  uint16_t records = 0, bytes = 0, flags = 0;
  if (op == START) {
    const uint32_t seconds = arg & 0xffff, requestedRate = arg >> 16;
    const uint32_t selectedRate = requestedRate ? requestedRate : DEFAULT_RATE;
    // START is not automatically retried by the client. Preserve old data on rejection.
    if (recording() || !imuReady || (seconds != 10 && seconds != 30 && seconds != 60) ||
        (selectedRate != DEFAULT_RATE && selectedRate != HIGH_RATE) || seconds * selectedRate > capacity) flags = 1;
    else beginCapture(seconds, selectedRate);
  }
  if (op == STATUS || op == START) {
    uint8_t *p = out + 20;
    p[0] = state; p[1] = error; u16(p + 2, 6);
    u32(p + 4, rateHz); u32(p + 8, count); u32(p + 12, target);
    u32(p + 16, windows); u32(p + 20, capacity); u32(p + 24, startedMs);
    u32(p + 28, recording() ? micros() - startedUs : elapsedUs);
    u32(p + 32, overruns); u32(p + 36, busErrors); u32(p + 40, clipped);
    u32(p + 44, rawCrc); u32(p + 48, summariesCrc); u32(p + 52, windowSamples);
    f32(p + 56, SCALE_G); u32(p + 60, ESP.getFreeHeap());
    u32(p + 64, timestampCount); u32(p + 68, firstTimestamp); u32(p + 72, lastTimestamp);
    u32(p + 76, minTimestampDelta); u32(p + 80, maxTimestampDelta);
    f32(p + 84, timestampMeanDelta);
    f32(p + 88, timestampDeltaCount ? sqrt(timestampM2Delta / timestampDeltaCount) : 0);
    u32(p + 92, TIMESTAMP_DECIMATION);
    bytes = 96;
  } else if (op == RAW || op == SUMMARIES) {
    uint32_t total = op == RAW ? count : windows;
    uint16_t stride = op == RAW ? 6 : 24, maximum = op == RAW ? 64 : 16;
    if (recording() || !captureId || requestedId != captureId || arg >= total) flags = 2;
    else {
      records = total - arg > maximum ? maximum : total - arg;
      bytes = records * stride;
      memcpy(out + 20, (op == RAW ? raw : summaries) + arg * stride, bytes);
    }
  } else flags = 3;
  u16(out, 0x5253); out[2] = 1; out[3] = op;
  out[4] = cmd[2]; out[5] = cmd[3]; u16(out + 6, flags);
  u32(out + 8, captureId); u32(out + 12, arg);
  u16(out + 16, records); u16(out + 18, bytes);
  u32(out + 20 + bytes, crc32(out, 20 + bytes));
  // Stable until the next request: supports ATT long reads at small MTUs.
  response->setValue(out, 24 + bytes);
}
void setup(BLEService *service) {
  raw = static_cast<uint8_t *>(heap_caps_malloc(MAX_SAMPLES * 6, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
  if (raw) capacity = MAX_SAMPLES;
  else {
    raw = static_cast<uint8_t *>(heap_caps_malloc(DEFAULT_RATE * 10 * 6, MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT));
    if (raw) capacity = DEFAULT_RATE * 10;
  }
  auto control = service->createCharacteristic(
    "7b32f8d3-5d0b-4f0e-a1f5-8f30c44c0001", BLECharacteristic::PROPERTY_WRITE);
  control->setCallbacks(new Commands());
  response = service->createCharacteristic(
    "7b32f8d4-5d0b-4f0e-a1f5-8f30c44c0001", BLECharacteristic::PROPERTY_READ);
  uint8_t empty = 0; response->setValue(&empty, 1);
}
} // namespace research
