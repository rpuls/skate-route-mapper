#include <Adafruit_LSM6DSOX.h>
#include <BLE2902.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <Wire.h>
#include "ResearchCapture.h"

namespace {
const char *DEVICE_NAME = "Skate XIAO IMU";
const char *SERVICE_UUID = "7b32f8d0-5d0b-4f0e-a1f5-8f30c44c0001";
const char *IMU_CHARACTERISTIC_UUID = "7b32f8d1-5d0b-4f0e-a1f5-8f30c44c0001";
const char *CONFIG_CHARACTERISTIC_UUID = "7b32f8d2-5d0b-4f0e-a1f5-8f30c44c0001";

constexpr int I2C_SDA_PIN = D4;
constexpr int I2C_SCL_PIN = D5;
constexpr uint8_t LSM6DSOX_ADDRESS = 0x6A;
constexpr uint32_t SERIAL_BAUD = 115200;
constexpr uint16_t DEFAULT_SAMPLE_INTERVAL_MS = 20;
constexpr uint16_t MIN_SAMPLE_INTERVAL_MS = 10;
constexpr uint16_t MAX_SAMPLE_INTERVAL_MS = 1000;
constexpr uint32_t STATUS_INTERVAL_MS = 3000;

BLEServer *server = nullptr;
BLECharacteristic *imuCharacteristic = nullptr;
BLECharacteristic *configCharacteristic = nullptr;
Adafruit_LSM6DSOX imu;

uint32_t sequence = 0;
uint32_t lastSampleAtMs = 0;
uint32_t lastStatusAtMs = 0;
uint16_t sampleIntervalMs = DEFAULT_SAMPLE_INTERVAL_MS;
bool deviceConnected = false;
bool wasConnected = false;
bool imuReady = false;

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

void scanI2cBus() {
  Serial.println("Scanning I2C bus...");

  uint8_t found = 0;
  for (uint8_t address = 1; address < 127; address++) {
    Wire.beginTransmission(address);
    if (Wire.endTransmission() == 0) {
      Serial.print("  found 0x");
      if (address < 16) {
        Serial.print("0");
      }
      Serial.println(address, HEX);
      found++;
    }
  }

  if (found == 0) {
    Serial.println("  no I2C devices found");
  }
}

bool initializeImu() {
  Serial.println("Trying LSM6DSOX at I2C address 0x6A...");

  if (!imu.begin_I2C(LSM6DSOX_ADDRESS, &Wire)) {
    Serial.println("LSM6DSOX not found. Check VIN/GND/SDA/SCL wiring.");
    return false;
  }

  imu.setAccelRange(LSM6DS_ACCEL_RANGE_16_G);
  imu.setGyroRange(LSM6DS_GYRO_RANGE_2000_DPS);
  imu.setAccelDataRate(LSM6DS_RATE_833_HZ);
  imu.setGyroDataRate(LSM6DS_RATE_833_HZ);

  Serial.println("LSM6DSOX initialized.");
  return true;
}

void writeConfigValue() {
  if (configCharacteristic == nullptr) {
    return;
  }

  uint8_t value[2] = {
    static_cast<uint8_t>(sampleIntervalMs & 0xff),
    static_cast<uint8_t>((sampleIntervalMs >> 8) & 0xff),
  };
  configCharacteristic->setValue(value, sizeof(value));
}

void sendImuPacket() {
  if (!deviceConnected || imuCharacteristic == nullptr || !imuReady) {
    return;
  }

  sensors_event_t accel;
  sensors_event_t gyro;
  sensors_event_t temp;
  imu.getEvent(&accel, &gyro, &temp);

  uint8_t packet[20] = {0};
  const uint32_t nowMs = millis();

  writeUint32Le(packet, 0, sequence++);
  writeUint32Le(packet, 4, nowMs);
  writeInt16Le(packet, 8, clampInt16((accel.acceleration.x / 9.80665f) * 1000.0f));
  writeInt16Le(packet, 10, clampInt16((accel.acceleration.y / 9.80665f) * 1000.0f));
  writeInt16Le(packet, 12, clampInt16((accel.acceleration.z / 9.80665f) * 1000.0f));
  writeInt16Le(packet, 14, clampInt16((gyro.gyro.x * 180.0f / PI) * 1000.0f));
  writeInt16Le(packet, 16, clampInt16((gyro.gyro.y * 180.0f / PI) * 1000.0f));
  writeInt16Le(packet, 18, clampInt16((gyro.gyro.z * 180.0f / PI) * 1000.0f));

  imuCharacteristic->setValue(packet, sizeof(packet));
  imuCharacteristic->notify();
}

void printStatus() {
  // USB can remain powered with no serial reader. Drop diagnostics when
  // the TX buffer is full instead of stalling sensor sampling on each print.
  if (!Serial) return;
  char line[128];
  const int length = snprintf(
    line, sizeof(line), "status imu=%s ble=%s interval_ms=%u sequence=%lu\r\n",
    imuReady ? "ready" : "missing",
    deviceConnected ? "connected" : "advertising",
    static_cast<unsigned int>(sampleIntervalMs),
    static_cast<unsigned long>(sequence)
  );
  if (length > 0 && length < static_cast<int>(sizeof(line)) &&
      Serial.availableForWrite() >= length) {
    Serial.write(reinterpret_cast<const uint8_t *>(line), length);
  }
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
    writeConfigValue();

    // The periodic status reports the interval; never block a BLE callback
    // waiting for a USB serial reader.
  }
};
}

void setup() {
  Serial.begin(SERIAL_BAUD);
#if ARDUINO_USB_CDC_ON_BOOT
  // Bound other diagnostic writes too. Use a small positive timeout for
  // compatibility with HWCDC implementations with zero-timeout edge cases.
  Serial.setTxTimeoutMs(1);
#endif
  delay(1500);

  Serial.println();
  Serial.println("Skate Route XIAO IMU BLE firmware - bounded USB logging");
  Serial.print("SDA pin: ");
  Serial.println(I2C_SDA_PIN);
  Serial.print("SCL pin: ");
  Serial.println(I2C_SCL_PIN);

  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
  Wire.setClock(400000);
  Wire.setTimeOut(20);
  scanI2cBus();
  imuReady = initializeImu();

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
  writeConfigValue();

  research::setup(imuService);
  imuService->start();

  BLEAdvertising *advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(SERVICE_UUID);
  advertising->setScanResponse(true);
  advertising->setMinPreferred(0x0);
  BLEDevice::startAdvertising();

  Serial.println("BLE advertising started.");
  printStatus();
}

void loop() {
  research::captureTick();
  research::commandTick(imuReady);
  // Capture is independent of BLE, and the live preview must never hold up FIFO draining.
  if (research::recording()) {
    delay(0);
    return;
  }
  if (!imuReady) {
    const uint32_t nowMs = millis();
    if (nowMs - lastStatusAtMs >= STATUS_INTERVAL_MS) {
      lastStatusAtMs = nowMs;
      scanI2cBus();
      imuReady = initializeImu();
      printStatus();
    }
    delay(10);
    return;
  }

  if (!deviceConnected && wasConnected) {
    delay(500);
    server->startAdvertising();
    wasConnected = false;
  }

  if (deviceConnected && !wasConnected) {
    wasConnected = true;
  }

  const uint32_t nowMs = millis();
  if (nowMs - lastSampleAtMs >= sampleIntervalMs) {
    lastSampleAtMs = nowMs;
    sendImuPacket();
  }

  if (nowMs - lastStatusAtMs >= STATUS_INTERVAL_MS) {
    lastStatusAtMs = nowMs;
    printStatus();
  }

  delay(1);
}
