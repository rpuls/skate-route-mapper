#include <BLE2902.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <M5Unified.h>

namespace {
const char *DEVICE_NAME = "Skate Nesso N1";
const char *SERVICE_UUID = "7b32f8c0-5d0b-4f0e-a1f5-8f30c44c0001";
const char *IMU_CHARACTERISTIC_UUID = "7b32f8c1-5d0b-4f0e-a1f5-8f30c44c0001";
const char *CONFIG_CHARACTERISTIC_UUID = "7b32f8c2-5d0b-4f0e-a1f5-8f30c44c0001";

const uint16_t DEFAULT_SAMPLE_INTERVAL_MS = 20;
const uint16_t MIN_SAMPLE_INTERVAL_MS = 10;
const uint16_t MAX_SAMPLE_INTERVAL_MS = 1000;
const uint32_t BATTERY_REFRESH_MS = 30000;
const uint32_t CHARGE_STATE_REFRESH_MS = 1000;
const uint32_t BOOT_SPLASH_MS = 1600;
const uint32_t SCREEN_SLEEP_MS = 25000;

const uint16_t COLOR_BG = 0x1082;
const uint16_t COLOR_PANEL = 0xffff;
const uint16_t COLOR_TEXT = 0x18c3;
const uint16_t COLOR_MUTED = 0x8b0f;
const uint16_t COLOR_ORANGE = 0xfd20;
const uint16_t COLOR_GREEN = 0x26e9;
const uint16_t COLOR_RED = 0xe8a3;
const uint16_t COLOR_BLUE = 0x5d9f;

const int RIGHT_COLUMN_X = 110;
const int SAMPLE_RATE_Y = 54;
const int IMU_STATE_Y = 88;

BLEServer *server = nullptr;
BLECharacteristic *imuCharacteristic = nullptr;
BLECharacteristic *configCharacteristic = nullptr;

uint32_t sequence = 0;
uint32_t lastSampleAtMs = 0;
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

int16_t clampInt16(float value) {
  if (value > 32767.0f) return 32767;
  if (value < -32768.0f) return -32768;
  return static_cast<int16_t>(value);
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

  M5.Display.setTextColor(COLOR_PANEL, COLOR_BG);
  M5.Display.setTextSize(2);
  M5.Display.setCursor(10, height - 42);
  M5.Display.print("NESSO");

  M5.Display.setTextSize(1);
  M5.Display.setCursor(12, height - 20);
  M5.Display.print("SKATE IMU BOOT");
}

void drawConnectionStatus() {
  M5.Display.fillRoundRect(14, 14, 56, 22, 10, connectionColor());
  M5.Display.setTextColor(COLOR_PANEL, connectionColor());
  M5.Display.setTextSize(1);
  M5.Display.setCursor(22, 21);
  M5.Display.print(connectionLabel());

  displayedConnected = deviceConnected;
}

void drawBattery(int percent) {
  const int x = 14;
  const int y = 48;
  const bool charging = isBatteryCharging();
  const uint16_t batteryColor = percent <= 20 ? COLOR_RED : COLOR_GREEN;

  M5.Display.fillRect(x, y, 80, 54, COLOR_PANEL);
  M5.Display.setTextColor(COLOR_TEXT, COLOR_PANEL);
  M5.Display.setTextSize(3);
  M5.Display.setCursor(x, y);
  M5.Display.printf("%3d", percent);

  M5.Display.setTextSize(1);
  M5.Display.setCursor(x + 56, y + 15);
  M5.Display.print("%");

  M5.Display.drawRoundRect(x, y + 34, 72, 16, 4, COLOR_TEXT);
  M5.Display.fillRect(x + 72, y + 39, 4, 6, COLOR_TEXT);
  M5.Display.fillRoundRect(x + 3, y + 37, max(3, (66 * percent) / 100), 10, 3, batteryColor);
  if (charging) {
    const int boltX = x + 35;
    const int boltY = y + 36;
    M5.Display.fillTriangle(boltX + 5, boltY + 1, boltX - 2, boltY + 9, boltX + 5, boltY + 9, COLOR_PANEL);
    M5.Display.fillTriangle(boltX + 1, boltY + 8, boltX + 8, boltY + 8, boltX + 1, boltY + 16, COLOR_PANEL);
  }

  displayedBatteryPercent = percent;
  displayedCharging = charging;
}

void drawSampleRate() {
  M5.Display.fillRect(RIGHT_COLUMN_X, SAMPLE_RATE_Y, 44, 36, COLOR_PANEL);
  M5.Display.setTextColor(COLOR_MUTED, COLOR_PANEL);
  M5.Display.setTextSize(1);
  M5.Display.setCursor(RIGHT_COLUMN_X, SAMPLE_RATE_Y);
  M5.Display.print("HZ");
  M5.Display.setTextColor(COLOR_TEXT, COLOR_PANEL);
  M5.Display.setTextSize(2);
  M5.Display.setCursor(RIGHT_COLUMN_X, SAMPLE_RATE_Y + 14);
  M5.Display.printf("%2d", 1000 / sampleIntervalMs);

  displayedSampleIntervalMs = sampleIntervalMs;
}

void drawImuState() {
  M5.Display.fillRect(RIGHT_COLUMN_X, IMU_STATE_Y, 44, 34, COLOR_PANEL);
  M5.Display.setTextColor(COLOR_MUTED, COLOR_PANEL);
  M5.Display.setTextSize(1);
  M5.Display.setCursor(RIGHT_COLUMN_X, IMU_STATE_Y + 2);
  M5.Display.print("IMU");
  M5.Display.setTextColor(deviceConnected ? COLOR_GREEN : COLOR_MUTED, COLOR_PANEL);
  M5.Display.setTextSize(2);
  M5.Display.setCursor(RIGHT_COLUMN_X, IMU_STATE_Y + 16);
  M5.Display.print(deviceConnected ? "ON" : "--");
}

void drawDashboard() {
  const int width = M5.Display.width();
  const int height = M5.Display.height();

  M5.Display.fillScreen(COLOR_BG);
  M5.Display.fillRoundRect(6, 6, width - 12, height - 12, 12, COLOR_PANEL);

  M5.Display.setTextColor(COLOR_TEXT, COLOR_PANEL);
  M5.Display.setTextSize(1);
  M5.Display.setCursor(width - 72, 18);
  M5.Display.print("Nesso N1");

  drawConnectionStatus();
  drawBattery(getBatteryPercent());
  drawSampleRate();
  drawImuState();

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

  if (force || nowMs - lastBatteryAtMs >= BATTERY_REFRESH_MS) {
    const int battery = getBatteryPercent();
    const bool charging = isBatteryCharging();
    lastBatteryAtMs = nowMs;

    if (force || battery != displayedBatteryPercent || charging != displayedCharging) {
      drawBattery(battery);
    }
  }
}

void sendImuPacket() {
  if (!deviceConnected || imuCharacteristic == nullptr) {
    return;
  }

  if (!M5.Imu.update()) {
    return;
  }

  auto data = M5.Imu.getImuData();
  uint8_t packet[20] = {0};
  const uint32_t nowMs = millis();

  writeUint32Le(packet, 0, sequence++);
  writeUint32Le(packet, 4, nowMs);
  writeInt16Le(packet, 8, clampInt16(data.accel.x * 1000.0f));
  writeInt16Le(packet, 10, clampInt16(data.accel.y * 1000.0f));
  writeInt16Le(packet, 12, clampInt16(data.accel.z * 1000.0f));
  writeInt16Le(packet, 14, clampInt16(data.gyro.x * 1000.0f));
  writeInt16Le(packet, 16, clampInt16(data.gyro.y * 1000.0f));
  writeInt16Le(packet, 18, clampInt16(data.gyro.z * 1000.0f));

  imuCharacteristic->setValue(packet, sizeof(packet));
  imuCharacteristic->notify();
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
  auto cfg = M5.config();
  M5.begin(cfg);
  M5.Display.setRotation(1);
  M5.Display.setTextSize(1);
  bootStartedAtMs = millis();
  lastChargingState = isBatteryCharging();
  lastScreenInteractionAtMs = bootStartedAtMs;
  refreshDisplay(true);

  BLEDevice::init(DEVICE_NAME);
  server = BLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());

  BLEService *imuService = server->createService(SERVICE_UUID);

  imuCharacteristic = imuService->createCharacteristic(
    IMU_CHARACTERISTIC_UUID,
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

  const uint32_t nowMs = millis();
  if (nowMs - lastSampleAtMs >= sampleIntervalMs) {
    lastSampleAtMs = nowMs;
    sendImuPacket();
  }

  refreshDisplay();
  delay(1);
}
