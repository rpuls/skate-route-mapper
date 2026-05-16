#include <BLE2902.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <M5Unified.h>
#include <math.h>

namespace {
const char *DEVICE_NAME = "Skate Nesso N1 Gate A";
const char *SERVICE_UUID = "7b32f8d0-5d0b-4f0e-a1f5-8f30c44c0001";
const char *FEATURE_CHARACTERISTIC_UUID = "7b32f8d1-5d0b-4f0e-a1f5-8f30c44c0001";
const char *CONFIG_CHARACTERISTIC_UUID = "7b32f8d2-5d0b-4f0e-a1f5-8f30c44c0001";
const char *FIRMWARE_LABEL = "calibration v2";

const uint16_t DEFAULT_SAMPLE_INTERVAL_MS = 200;
const uint16_t MIN_SAMPLE_INTERVAL_MS = 100;
const uint16_t MAX_SAMPLE_INTERVAL_MS = 1000;
const uint8_t FEATURE_PACKET_TYPE = 0x02;
const uint8_t FEATURE_PROTOCOL_VERSION = 1;
const uint32_t BATTERY_REFRESH_MS = 30000;
const uint32_t CHARGE_STATE_REFRESH_MS = 1000;
const uint32_t BOOT_SPLASH_MS = 1600;
const uint32_t SCREEN_SLEEP_MS = 25000;
const uint32_t SERIAL_BAUD = 115200;
const float VIBRATION_BASELINE_ALPHA = 0.06f;
const float ROUGHNESS_SCORE_SMOOTHING_ALPHA = 0.18f;

const uint16_t COLOR_BG = 0x18c3;
const uint16_t COLOR_PANEL = COLOR_BG;
const uint16_t COLOR_TEXT = 0xef7d;
const uint16_t COLOR_MUTED = 0x8410;
const uint16_t COLOR_ORANGE = 0xfd20;
const uint16_t COLOR_GREEN = 0x3fe7;
const uint16_t COLOR_RED = 0xe8a3;
const uint16_t COLOR_BLUE = 0x45bf;

const int RIGHT_COLUMN_X = 120;
const int SAMPLE_RATE_Y = 48;
const int IMU_STATE_Y = 82;
const int FEATURE_STATE_Y = 112;

BLEServer *server = nullptr;
BLECharacteristic *imuCharacteristic = nullptr;
BLECharacteristic *configCharacteristic = nullptr;

uint32_t sequence = 0;
uint32_t featureWindowStartedAtMs = 0;
uint32_t lastFeatureSampleAtUs = 0;
uint32_t lastBatteryAtMs = 0;
uint32_t lastChargeCheckAtMs = 0;
uint32_t bootStartedAtMs = 0;
uint32_t lastScreenInteractionAtMs = 0;
uint16_t sampleIntervalMs = DEFAULT_SAMPLE_INTERVAL_MS;
bool deviceConnected = false;
bool wasConnected = false;
bool bootSplashActive = true;
bool dashboardDrawn = false;
bool screenAwake = true;
bool displayedConnected = false;
int displayedBatteryPercent = -1;
bool displayedCharging = false;
bool lastChargingState = false;
uint16_t displayedSampleIntervalMs = 0;
uint32_t displayedFeatureSequence = 0xffffffff;
uint16_t displayedWindowSampleCount = 0xffff;

uint16_t featureSampleCount = 0;
uint16_t lateSampleCount = 0;
uint16_t lastWindowSampleCount = 0;
uint16_t lastWindowMs = 0;
uint8_t lastRoughnessLevel = 0;
uint8_t lastConfidence = 0;
float featureMagnitudeSum = 0.0f;
float featureMagnitudeSumSquares = 0.0f;
float featureMinMagnitude = 1000.0f;
float featureMaxMagnitude = 0.0f;
float featureVibrationSumSquares = 0.0f;
float featureVibrationMin = 1000.0f;
float featureVibrationMax = 0.0f;
float featurePreviousVibration = 0.0f;
float featureJerkSumSquares = 0.0f;
float vibrationBaselineX = 0.0f;
float vibrationBaselineY = 0.0f;
float vibrationBaselineZ = 0.0f;
float smoothedRoughnessScore = 0.0f;
bool vibrationFilterInitialized = false;
bool roughnessScoreInitialized = false;

void writeUint32Le(uint8_t *buffer, size_t offset, uint32_t value) {
  buffer[offset] = value & 0xff;
  buffer[offset + 1] = (value >> 8) & 0xff;
  buffer[offset + 2] = (value >> 16) & 0xff;
  buffer[offset + 3] = (value >> 24) & 0xff;
}

void writeInt16Le(uint8_t *buffer, size_t offset, int16_t value) {
  buffer[offset] = value & 0xff;
  buffer[offset + 1] = (value >> 8) & 0xff;
}

void writeUint16Le(uint8_t *buffer, size_t offset, uint16_t value) {
  buffer[offset] = value & 0xff;
  buffer[offset + 1] = (value >> 8) & 0xff;
}

int16_t clampInt16(float value) {
  if (value > 32767.0f) return 32767;
  if (value < -32768.0f) return -32768;
  return static_cast<int16_t>(value);
}

uint16_t clampUint16(float value) {
  if (value > 65535.0f) return 65535;
  if (value < 0.0f) return 0;
  return static_cast<uint16_t>(value);
}

float roughnessScoreFor(float vibrationRms, float vibrationPeakToPeak, float jerkRms) {
  const float cappedPeakToPeak = min(3.0f, vibrationPeakToPeak);
  const float cappedJerk = min(1.5f, jerkRms);

  return
    (vibrationRms * 0.55f) +
    (cappedPeakToPeak * 0.08f) +
    (cappedJerk * 0.04f);
}

uint8_t roughnessLevelFor(float score) {
  if (score < 0.10f) return 1;
  if (score < 0.22f) return 2;
  if (score < 0.42f) return 3;
  if (score < 0.75f) return 4;
  if (score < 1.20f) return 5;
  return 6;
}

uint8_t confidenceFor(uint16_t rawSampleCount, uint16_t lateCount, uint16_t windowMs) {
  const float expectedAt100Hz = max(1.0f, windowMs / 10.0f);
  const float sampleRatio = min(1.0f, rawSampleCount / expectedAt100Hz);
  const float latePenalty = min(0.5f, lateCount * 0.05f);
  const float confidence = max(0.0f, min(1.0f, sampleRatio - latePenalty));

  return static_cast<uint8_t>(confidence * 100.0f);
}

void resetFeatureWindow(uint32_t nowMs) {
  featureWindowStartedAtMs = nowMs;
  lastFeatureSampleAtUs = 0;
  featureSampleCount = 0;
  lateSampleCount = 0;
  featureMagnitudeSum = 0.0f;
  featureMagnitudeSumSquares = 0.0f;
  featureMinMagnitude = 1000.0f;
  featureMaxMagnitude = 0.0f;
  featureVibrationSumSquares = 0.0f;
  featureVibrationMin = 1000.0f;
  featureVibrationMax = 0.0f;
  featurePreviousVibration = 0.0f;
  featureJerkSumSquares = 0.0f;
}

int getBatteryPercent() {
  const int battery = M5.Power.getBatteryLevel();

  if (battery < 0) return 0;
  if (battery > 100) return 100;
  return battery;
}

bool isBatteryCharging() {
  return M5.Power.isCharging() == m5::Power_Class::is_charging;
}

const char *connectionLabel() {
  if (deviceConnected) {
    return "LINKED";
  }

  return "PAIR";
}

uint16_t connectionColor() {
  if (deviceConnected) return COLOR_GREEN;
  return COLOR_BLUE;
}

void drawLogoMark(int centerX, int centerY) {
  M5.Display.fillRoundRect(centerX - 24, centerY - 24, 48, 48, 12, COLOR_ORANGE);
  M5.Display.fillRoundRect(centerX - 12, centerY - 32, 24, 64, 6, COLOR_TEXT);
  M5.Display.fillRoundRect(centerX - 34, centerY + 24, 68, 7, 4, COLOR_TEXT);
  M5.Display.fillCircle(centerX - 22, centerY + 34, 5, COLOR_ORANGE);
  M5.Display.fillCircle(centerX + 22, centerY + 34, 5, COLOR_ORANGE);

  M5.Display.setTextColor(COLOR_PANEL, COLOR_TEXT);
  M5.Display.setTextSize(2);
  M5.Display.setCursor(centerX - 12, centerY - 8);
  M5.Display.print("N1");
}

void drawBootSplash() {
  const int width = M5.Display.width();
  const int height = M5.Display.height();

  M5.Display.fillScreen(COLOR_BG);
  drawLogoMark(width / 2, height / 2 - 18);

  M5.Display.setTextColor(COLOR_TEXT, COLOR_BG);
  M5.Display.setTextSize(2);
  M5.Display.setCursor(10, height - 42);
  M5.Display.print("NESSO");

  M5.Display.setTextSize(1);
  M5.Display.setCursor(12, height - 20);
  M5.Display.print("FEATURE BOOT");
}

void drawConnectionStatus() {
  M5.Display.fillRect(14, 14, 58, 22, connectionColor());
  M5.Display.setTextColor(COLOR_BG, connectionColor());
  M5.Display.setTextSize(1);
  M5.Display.setCursor(22, 21);
  M5.Display.print(connectionLabel());

  displayedConnected = deviceConnected;
}

void drawBattery(int percent) {
  const int x = 14;
  const int y = 63;
  const bool charging = isBatteryCharging();
  const uint16_t batteryColor = percent <= 20 ? COLOR_RED : COLOR_GREEN;

  M5.Display.fillRect(x, y, 82, 54, COLOR_BG);
  M5.Display.setTextColor(COLOR_TEXT, COLOR_BG);
  M5.Display.setTextSize(3);
  M5.Display.setCursor(x, y);
  M5.Display.printf("%3d", percent);

  M5.Display.setTextSize(1);
  M5.Display.setCursor(x + 56, y + 15);
  M5.Display.print("%");

  M5.Display.drawRect(x, y + 34, 72, 16, COLOR_TEXT);
  M5.Display.fillRect(x + 72, y + 39, 4, 6, COLOR_TEXT);
  M5.Display.fillRect(x + 3, y + 37, max(3, (66 * percent) / 100), 10, batteryColor);
  if (charging) {
    const int boltX = x + 35;
    const int boltY = y + 36;
    M5.Display.fillTriangle(boltX + 5, boltY + 1, boltX - 2, boltY + 9, boltX + 5, boltY + 9, COLOR_BG);
    M5.Display.fillTriangle(boltX + 1, boltY + 8, boltX + 8, boltY + 8, boltX + 1, boltY + 16, COLOR_BG);
  }

  displayedBatteryPercent = percent;
  displayedCharging = charging;
}

void drawSampleRate() {
  M5.Display.fillRect(RIGHT_COLUMN_X, SAMPLE_RATE_Y, 44, 36, COLOR_BG);
  M5.Display.setTextColor(COLOR_MUTED, COLOR_BG);
  M5.Display.setTextSize(1);
  M5.Display.setCursor(RIGHT_COLUMN_X, SAMPLE_RATE_Y);
  M5.Display.print("FPS");
  M5.Display.setTextColor(COLOR_TEXT, COLOR_BG);
  M5.Display.setTextSize(2);
  M5.Display.setCursor(RIGHT_COLUMN_X, SAMPLE_RATE_Y + 14);
  M5.Display.printf("%2d", 1000 / sampleIntervalMs);

  displayedSampleIntervalMs = sampleIntervalMs;
}

void drawImuState() {
  M5.Display.fillRect(RIGHT_COLUMN_X, IMU_STATE_Y, 44, 34, COLOR_BG);
  M5.Display.setTextColor(COLOR_MUTED, COLOR_BG);
  M5.Display.setTextSize(1);
  M5.Display.setCursor(RIGHT_COLUMN_X, IMU_STATE_Y + 2);
  M5.Display.print("IMU");
  M5.Display.setTextColor(deviceConnected ? COLOR_GREEN : COLOR_MUTED, COLOR_BG);
  M5.Display.setTextSize(2);
  M5.Display.setCursor(RIGHT_COLUMN_X, IMU_STATE_Y + 16);
  M5.Display.print(deviceConnected ? "ON" : "--");
}

void drawFeatureState() {
  M5.Display.fillRect(RIGHT_COLUMN_X, FEATURE_STATE_Y, 44, 14, COLOR_BG);
  M5.Display.setTextColor(COLOR_MUTED, COLOR_BG);
  M5.Display.setTextSize(1);
  M5.Display.setCursor(RIGHT_COLUMN_X, FEATURE_STATE_Y);
  M5.Display.printf("S%u", lastWindowSampleCount);

  displayedFeatureSequence = sequence;
  displayedWindowSampleCount = lastWindowSampleCount;
}

void drawDashboard() {
  const int width = M5.Display.width();

  M5.Display.fillScreen(COLOR_BG);

  M5.Display.setTextColor(COLOR_TEXT, COLOR_BG);
  M5.Display.setTextSize(1);
  M5.Display.setCursor(width - 72, 18);
  M5.Display.print("Nesso Gate A");

  drawConnectionStatus();
  drawBattery(getBatteryPercent());
  drawSampleRate();
  drawImuState();
  drawFeatureState();

  dashboardDrawn = true;
  lastBatteryAtMs = millis();
}

bool didPressWakeButton() {
  return M5.BtnA.wasPressed() ||
    M5.BtnB.wasPressed() ||
    M5.BtnC.wasPressed() ||
    M5.BtnPWR.wasPressed();
}

void sleepScreen() {
  if (!screenAwake) {
    return;
  }

  M5.Display.sleep();
  screenAwake = false;
}

void wakeScreen() {
  if (screenAwake) {
    lastScreenInteractionAtMs = millis();
    return;
  }

  M5.Display.wakeup();
  screenAwake = true;
  dashboardDrawn = false;
  displayedBatteryPercent = -1;
  displayedCharging = false;
  displayedSampleIntervalMs = 0;
  displayedFeatureSequence = 0xffffffff;
  displayedWindowSampleCount = 0xffff;
  lastScreenInteractionAtMs = millis();
  drawDashboard();
}

void updateScreenPower() {
  const uint32_t nowMs = millis();

  if (didPressWakeButton()) {
    wakeScreen();
    return;
  }

  if (nowMs - lastChargeCheckAtMs >= CHARGE_STATE_REFRESH_MS) {
    const bool charging = isBatteryCharging();
    lastChargeCheckAtMs = nowMs;

    if (charging != lastChargingState) {
      lastChargingState = charging;

      if (!screenAwake && charging) {
        wakeScreen();
        return;
      }

      if (screenAwake) {
        lastScreenInteractionAtMs = nowMs;
        drawBattery(getBatteryPercent());
      }
    }
  }

  if (
    screenAwake &&
    !bootSplashActive &&
    nowMs - lastScreenInteractionAtMs >= SCREEN_SLEEP_MS
  ) {
    sleepScreen();
  }
}

void refreshDisplay(bool force = false) {
  const uint32_t nowMs = millis();

  if (!screenAwake) {
    return;
  }

  if (bootSplashActive && nowMs - bootStartedAtMs < BOOT_SPLASH_MS) {
    if (force) {
      drawBootSplash();
    }
    return;
  }

  bootSplashActive = false;

  if (!dashboardDrawn) {
    drawDashboard();
    return;
  }

  if (force || deviceConnected != displayedConnected) {
    drawConnectionStatus();
    drawImuState();
  }

  if (force || sampleIntervalMs != displayedSampleIntervalMs) {
    drawSampleRate();
  }

  if (
    force ||
    sequence != displayedFeatureSequence ||
    lastWindowSampleCount != displayedWindowSampleCount
  ) {
    drawFeatureState();
  }

  if (force || nowMs - lastBatteryAtMs >= BATTERY_REFRESH_MS) {
    const int battery = getBatteryPercent();
    const bool charging = isBatteryCharging();
    lastBatteryAtMs = nowMs;

    if (force || battery != displayedBatteryPercent || charging != displayedCharging) {
      drawBattery(battery);
    }
  }
}

void addFeatureSample() {
  if (!M5.Imu.update()) {
    return;
  }

  const uint32_t nowUs = micros();
  if (lastFeatureSampleAtUs != 0 && nowUs - lastFeatureSampleAtUs > 15000) {
    lateSampleCount++;
  }
  lastFeatureSampleAtUs = nowUs;

  auto data = M5.Imu.getImuData();
  if (!vibrationFilterInitialized) {
    vibrationBaselineX = data.accel.x;
    vibrationBaselineY = data.accel.y;
    vibrationBaselineZ = data.accel.z;
    vibrationFilterInitialized = true;
  }

  vibrationBaselineX += (data.accel.x - vibrationBaselineX) * VIBRATION_BASELINE_ALPHA;
  vibrationBaselineY += (data.accel.y - vibrationBaselineY) * VIBRATION_BASELINE_ALPHA;
  vibrationBaselineZ += (data.accel.z - vibrationBaselineZ) * VIBRATION_BASELINE_ALPHA;

  const float vibrationX = data.accel.x - vibrationBaselineX;
  const float vibrationY = data.accel.y - vibrationBaselineY;
  const float vibrationZ = data.accel.z - vibrationBaselineZ;
  const float vibrationMagnitude = sqrtf(
    vibrationX * vibrationX +
    vibrationY * vibrationY +
    vibrationZ * vibrationZ
  );
  const float magnitude = sqrtf(
    data.accel.x * data.accel.x +
    data.accel.y * data.accel.y +
    data.accel.z * data.accel.z
  );
  featureMagnitudeSum += magnitude;
  featureMagnitudeSumSquares += magnitude * magnitude;
  featureMinMagnitude = min(featureMinMagnitude, magnitude);
  featureMaxMagnitude = max(featureMaxMagnitude, magnitude);
  featureVibrationSumSquares += vibrationMagnitude * vibrationMagnitude;
  featureVibrationMin = min(featureVibrationMin, vibrationMagnitude);
  featureVibrationMax = max(featureVibrationMax, vibrationMagnitude);

  if (featureSampleCount > 0) {
    const float jerk = vibrationMagnitude - featurePreviousVibration;
    featureJerkSumSquares += jerk * jerk;
  }

  featurePreviousVibration = vibrationMagnitude;
  featureSampleCount++;
}

void sendFeaturePacket() {
  if (featureSampleCount == 0) {
    lastWindowSampleCount = 0;
    lastWindowMs = 0;
    lastRoughnessLevel = 0;
    lastConfidence = 0;
    Serial.printf(
      "feature skipped connected=%d samples=0 uptimeMs=%lu\n",
      deviceConnected ? 1 : 0,
      millis()
    );
    return;
  }

  uint8_t packet[20] = {0};
  const uint32_t nowMs = millis();
  const uint32_t elapsedWindowMs = nowMs - featureWindowStartedAtMs;
  const uint16_t windowMs = elapsedWindowMs == 0
    ? 1
    : static_cast<uint16_t>(elapsedWindowMs > 65535 ? 65535 : elapsedWindowMs);
  const float meanMagnitude = featureMagnitudeSum / featureSampleCount;
  const float variance = max(
    0.0f,
    (featureMagnitudeSumSquares / featureSampleCount) - (meanMagnitude * meanMagnitude)
  );
  const float rawMagnitudeStdDev = sqrtf(variance);
  const float rawMagnitudePeakToPeak = featureMaxMagnitude - featureMinMagnitude;
  const float vibrationRms = sqrtf(featureVibrationSumSquares / featureSampleCount);
  const float vibrationPeakToPeak = featureVibrationMax - featureVibrationMin;
  const float jerkRms = featureSampleCount > 1
    ? sqrtf(featureJerkSumSquares / (featureSampleCount - 1))
    : 0.0f;
  const float roughnessScore = roughnessScoreFor(
    vibrationRms,
    vibrationPeakToPeak,
    jerkRms
  );
  if (!roughnessScoreInitialized) {
    smoothedRoughnessScore = roughnessScore;
    roughnessScoreInitialized = true;
  } else {
    smoothedRoughnessScore +=
      (roughnessScore - smoothedRoughnessScore) * ROUGHNESS_SCORE_SMOOTHING_ALPHA;
  }
  const uint8_t roughnessLevel = roughnessLevelFor(smoothedRoughnessScore);
  const uint8_t confidence = confidenceFor(featureSampleCount, lateSampleCount, windowMs);
  const bool canNotify = deviceConnected && imuCharacteristic != nullptr;

  packet[0] = FEATURE_PACKET_TYPE;
  packet[1] = FEATURE_PROTOCOL_VERSION;
  writeUint16Le(packet, 2, windowMs);
  writeUint32Le(packet, 4, sequence++);
  writeUint32Le(packet, 8, nowMs);
  writeUint16Le(packet, 12, featureSampleCount);
  writeUint16Le(packet, 14, clampUint16(vibrationRms * 1000.0f));
  writeUint16Le(packet, 16, clampUint16(vibrationPeakToPeak * 1000.0f));
  packet[18] = roughnessLevel;
  packet[19] = confidence;

  if (canNotify) {
    imuCharacteristic->setValue(packet, sizeof(packet));
    imuCharacteristic->notify();
  }

  lastWindowSampleCount = featureSampleCount;
  lastWindowMs = windowMs;
  lastRoughnessLevel = roughnessLevel;
  lastConfidence = confidence;

  Serial.printf(
    "feature %s seq=%lu notified=%d connected=%d windowMs=%u samples=%u late=%u vibRms=%.4f vibP2p=%.4f jerkRms=%.4f rawStd=%.4f rawP2p=%.4f score=%.4f smoothScore=%.4f level=%u confidence=%u\n",
    FIRMWARE_LABEL,
    sequence,
    canNotify ? 1 : 0,
    deviceConnected ? 1 : 0,
    windowMs,
    featureSampleCount,
    lateSampleCount,
    vibrationRms,
    vibrationPeakToPeak,
    jerkRms,
    rawMagnitudeStdDev,
    rawMagnitudePeakToPeak,
    roughnessScore,
    smoothedRoughnessScore,
    roughnessLevel,
    confidence
  );
}

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *server) override {
    deviceConnected = true;
  }

  void onDisconnect(BLEServer *server) override {
    deviceConnected = false;
  }
};

class ConfigCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *characteristic) override {
    String value = characteristic->getValue();

    if (value.length() < 2) {
      return;
    }

    const uint16_t requested =
      static_cast<uint8_t>(value[0]) |
      (static_cast<uint8_t>(value[1]) << 8);

    sampleIntervalMs = constrain(
      requested,
      MIN_SAMPLE_INTERVAL_MS,
      MAX_SAMPLE_INTERVAL_MS
    );
    configCharacteristic->setValue(sampleIntervalMs);
  }
};
}

void setup() {
  Serial.begin(SERIAL_BAUD);
  delay(100);
  Serial.printf("Skate Nesso N1 Gate A feature firmware booting (%s)\n", FIRMWARE_LABEL);
  Serial.printf("service=%s feature=%s config=%s\n", SERVICE_UUID, FEATURE_CHARACTERISTIC_UUID, CONFIG_CHARACTERISTIC_UUID);

  auto cfg = M5.config();
  M5.begin(cfg);
  M5.Display.setRotation(1);
  M5.Display.setTextSize(1);
  bootStartedAtMs = millis();
  lastChargingState = isBatteryCharging();
  lastScreenInteractionAtMs = bootStartedAtMs;
  refreshDisplay(true);
  resetFeatureWindow(millis());

  BLEDevice::init(DEVICE_NAME);
  server = BLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());

  BLEService *imuService = server->createService(SERVICE_UUID);

  imuCharacteristic = imuService->createCharacteristic(
    FEATURE_CHARACTERISTIC_UUID,
    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY
  );
  imuCharacteristic->addDescriptor(new BLE2902());

  configCharacteristic = imuService->createCharacteristic(
    CONFIG_CHARACTERISTIC_UUID,
    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_WRITE
  );
  configCharacteristic->setCallbacks(new ConfigCallbacks());
  configCharacteristic->setValue(sampleIntervalMs);

  imuService->start();

  BLEAdvertising *advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(SERVICE_UUID);
  advertising->setScanResponse(true);
  advertising->setMinPreferred(0x0);
  BLEDevice::startAdvertising();
  refreshDisplay(true);
}

void loop() {
  M5.update();
  updateScreenPower();

  if (deviceConnected && !wasConnected) {
    wasConnected = true;
    refreshDisplay(true);
  }

  if (!deviceConnected && wasConnected) {
    delay(500);
    server->startAdvertising();
    wasConnected = false;
    refreshDisplay(true);
  }

  addFeatureSample();

  const uint32_t nowMs = millis();
  if (nowMs - featureWindowStartedAtMs >= sampleIntervalMs) {
    sendFeaturePacket();
    resetFeatureWindow(nowMs);
  }

  refreshDisplay();
  delay(1);
}
