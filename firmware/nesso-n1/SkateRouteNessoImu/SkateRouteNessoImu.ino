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

BLEServer *server = nullptr;
BLECharacteristic *imuCharacteristic = nullptr;
BLECharacteristic *configCharacteristic = nullptr;

uint32_t sequence = 0;
uint32_t lastSampleAtMs = 0;
uint16_t sampleIntervalMs = DEFAULT_SAMPLE_INTERVAL_MS;
bool deviceConnected = false;
bool wasConnected = false;

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

void updateDisplay(const char *status) {
  M5.Display.clear();
  M5.Display.setCursor(8, 20);
  M5.Display.print("Skate IMU");
  M5.Display.setCursor(8, 48);
  M5.Display.print(status);
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
  updateDisplay("Starting BLE");

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
  updateDisplay("Advertising");
}

void loop() {
  if (deviceConnected && !wasConnected) {
    updateDisplay("Connected");
    wasConnected = true;
  }

  if (!deviceConnected && wasConnected) {
    delay(500);
    server->startAdvertising();
    updateDisplay("Advertising");
    wasConnected = false;
  }

  const uint32_t nowMs = millis();
  if (nowMs - lastSampleAtMs >= sampleIntervalMs) {
    lastSampleAtMs = nowMs;
    sendImuPacket();
  }

  delay(1);
}
