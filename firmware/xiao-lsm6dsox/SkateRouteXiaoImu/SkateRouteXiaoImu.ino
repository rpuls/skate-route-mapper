#include <Adafruit_LSM6DSOX.h>
#include <BLE2902.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <Wire.h>
#include "StreamTransport.h"
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

// How much ride the board can hold while the phone is out of touch.
//
// At the 20 ms default that is a little under an hour, which covers losing the
// link behind a building and getting it back, and covers a phone that stopped
// reading because iOS suspended the app. Records are 20 bytes, so this asks
// for 3.2 MB of the 8 MB SPIRAM; the research capture is allocated first and
// this falls back to whatever is left.
constexpr uint32_t RIDE_WINDOW_RECORDS = 160000;

/** The live packet layout, shared by the notification and the window. */
constexpr uint16_t IMU_RECORD_BYTES = 20;

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

  uint8_t packet[IMU_RECORD_BYTES] = {0};
  const uint32_t nowMs = millis();

  writeUint32Le(packet, 0, sequence++);
  writeUint32Le(packet, 4, nowMs);
  writeInt16Le(packet, 8, clampInt16((accel.acceleration.x / 9.80665f) * 1000.0f));
  writeInt16Le(packet, 10, clampInt16((accel.acceleration.y / 9.80665f) * 1000.0f));
  writeInt16Le(packet, 12, clampInt16((accel.acceleration.z / 9.80665f) * 1000.0f));
  writeInt16Le(packet, 14, clampInt16((gyro.gyro.x * 180.0f / PI) * 1000.0f));
  writeInt16Le(packet, 16, clampInt16((gyro.gyro.y * 180.0f / PI) * 1000.0f));
  writeInt16Le(packet, 18, clampInt16((gyro.gyro.z * 180.0f / PI) * 1000.0f));

  // Stored before it is sent, never after: a record the radio drops can still
  // be repaired, but only if it was already in the window when the attempt
  // failed. This is the line that makes interference survivable.
  const uint32_t seq = stream::append(stream::ID_RIDE_IMU, packet);

  if (stream::liveSubscribed()) {
    stream::notifyRecord(
      stream::ID_RIDE_IMU,
      seq == stream::NO_SEQ ? sequence - 1 : seq,
      packet,
      sizeof(packet)
    );
    return;
  }

  // Nobody is reading the stream, so serve the original characteristic that
  // the admin hardware bench and older app builds subscribe to. Exactly one of
  // the two is sent, so the wire cost is what it always was.
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

  // Research first: it needs a specific amount and falls back to internal RAM
  // if it cannot get it, which would quietly halve what a capture can hold.
  // The ride window takes what is left and reports what it actually got.
  stream::setup(imuService, research::handleCommand);
  research::setup();
  stream::declareRing(stream::ID_RIDE_IMU, stream::KIND_IMU_PACKET,
                      IMU_RECORD_BYTES, RIDE_WINDOW_RECORDS);

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
  research::imuAvailable = imuReady;
  research::captureTick();
  stream::commandTick();
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
