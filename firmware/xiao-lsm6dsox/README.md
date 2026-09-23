# XIAO ESP32S3 + LSM6DSOX Firmware

The sketch also supports bounded FIFO research recordings: nominal 833 or
1,666 Hz acceleration, sensor timestamp statistics, and on-board summaries, retained in RAM and retrieved after
capture. See [research setup and protocol](../../hardware/research.md), including
the `PSRAM=opi` compile option for 30/60-second captures. Existing preview and
mobile packet formats are unchanged. Preview pauses during research capture.

The current hardware state and next physical experiment are recorded in the
[living hardware handoff](../../hardware/HARDWARE-HANDOFF.md).

This firmware runs on the Seeed Studio XIAO ESP32S3 wired to an Adafruit
LSM6DSOX breakout over I2C.

The mobile app should treat this board as an external IMU only:

- XIAO sends accelerometer and gyroscope samples over Bluetooth LE.
- The phone still owns GPS, route timing, ride storage, and camera capture.
- This is the supported external vibration sensor path.

## Wiring

```text
XIAO 3V3    -> LSM6DSOX VIN
XIAO GND    -> LSM6DSOX GND
XIAO D5/SCL -> LSM6DSOX SCL
XIAO D4/SDA -> LSM6DSOX SDA
```

For the first tests, power the XIAO from USB-C and leave the LiPo disconnected.

For the local USB/BLE dashboard and the staged battery hookup guide, see
[`hardware/README.md`](../../hardware/README.md). Run `npm run hardware:ui`
from the repo root. This BLE sketch prints USB status messages; use the
dashboard's BLE connection for its sensor readings. The separate USB-only
proof-of-concept sketch supports the dashboard's serial charts.

## BLE Service

- Device name: `Skate XIAO IMU`
- Service UUID: `7b32f8d0-5d0b-4f0e-a1f5-8f30c44c0001`
- IMU characteristic UUID: `7b32f8d1-5d0b-4f0e-a1f5-8f30c44c0001`
- Config characteristic UUID: `7b32f8d2-5d0b-4f0e-a1f5-8f30c44c0001`

IMU notifications are little-endian binary packets:

```text
uint32 sequence
uint32 uptimeMs
int16 axMg
int16 ayMg
int16 azMg
int16 gxMdps
int16 gyMdps
int16 gzMdps
```

The shared protocol constants and parser live in `shared/src/xiaoBle.ts`.

## Arduino CLI

USB diagnostics are best-effort: periodic status lines are only written when
the serial buffer has space, BLE callbacks do not print, and USB CDC writes
use a small positive timeout. This prevents an unread USB port from holding up
sampling while the cable is used only for power. Earlier firmware printed
status through multiple potentially blocking writes, a suspected cause of
long pauses between BLE samples. Compile and upload the updated sketch to
apply this change; refreshing the dashboard alone does not update firmware.

Validation: with USB supplying power and no serial reader open, connect BLE
and observe continuous readings near 50 samples/s for at least a minute.
Repeat after BLE disconnect/reconnect. This device validation is still pending.

```bash
arduino-cli core update-index --additional-urls https://espressif.github.io/arduino-esp32/package_esp32_index.json
arduino-cli core install esp32:esp32 --additional-urls https://espressif.github.io/arduino-esp32/package_esp32_index.json
arduino-cli lib install "Adafruit LSM6DS" "Adafruit Unified Sensor" "Adafruit BusIO"
arduino-cli compile --fqbn esp32:esp32:XIAO_ESP32S3 firmware/xiao-lsm6dsox/SkateRouteXiaoImu
arduino-cli upload -p COM3 --fqbn esp32:esp32:XIAO_ESP32S3 firmware/xiao-lsm6dsox/SkateRouteXiaoImu
```
