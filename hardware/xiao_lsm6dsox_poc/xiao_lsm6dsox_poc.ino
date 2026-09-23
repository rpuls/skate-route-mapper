#include <Adafruit_LSM6DSOX.h>
#include <Wire.h>

constexpr int I2C_SDA_PIN = D4;
constexpr int I2C_SCL_PIN = D5;
constexpr uint32_t SERIAL_BAUD = 115200;

Adafruit_LSM6DSOX imu;
bool imuReady = false;

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

void setup() {
  Serial.begin(SERIAL_BAUD);
  delay(2500);

  Serial.println();
  Serial.println("XIAO ESP32S3 + LSM6DSOX proof of concept");
  Serial.print("SDA pin: ");
  Serial.println(I2C_SDA_PIN);
  Serial.print("SCL pin: ");
  Serial.println(I2C_SCL_PIN);

  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
  Wire.setClock(400000);

  scanI2cBus();
}

bool initializeImu() {
  Serial.println("Trying LSM6DSOX at I2C address 0x6A...");

  if (!imu.begin_I2C(0x6A, &Wire)) {
    Serial.println("LSM6DSOX not found at 0x6A.");
    return false;
  }

  imu.setAccelRange(LSM6DS_ACCEL_RANGE_16_G);
  imu.setGyroRange(LSM6DS_GYRO_RANGE_2000_DPS);
  imu.setAccelDataRate(LSM6DS_RATE_833_HZ);
  imu.setGyroDataRate(LSM6DS_RATE_833_HZ);

  Serial.println("LSM6DSOX initialized.");
  Serial.println("millis,ax_mps2,ay_mps2,az_mps2,gx_rads,gy_rads,gz_rads,temp_c");
  return true;
}

void loop() {
  if (!imuReady) {
    Serial.print("Heartbeat, millis=");
    Serial.println(millis());
    scanI2cBus();
    imuReady = initializeImu();
    delay(2000);
    return;
  }

  sensors_event_t accel;
  sensors_event_t gyro;
  sensors_event_t temp;

  imu.getEvent(&accel, &gyro, &temp);

  Serial.print(millis());
  Serial.print(",");
  Serial.print(accel.acceleration.x, 5);
  Serial.print(",");
  Serial.print(accel.acceleration.y, 5);
  Serial.print(",");
  Serial.print(accel.acceleration.z, 5);
  Serial.print(",");
  Serial.print(gyro.gyro.x, 5);
  Serial.print(",");
  Serial.print(gyro.gyro.y, 5);
  Serial.print(",");
  Serial.print(gyro.gyro.z, 5);
  Serial.print(",");
  Serial.println(temp.temperature, 2);

  delay(20);
}
