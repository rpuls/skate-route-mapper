# Nesso N1 Firmware

This folder stores Arduino sketches that run on the Arduino Nesso N1.

The mobile app should treat the Nesso as an external IMU only:

- Nesso N1 sends accelerometer and gyroscope samples over Bluetooth LE.
- The phone still owns GPS, route timing, ride storage, and camera capture.
- Android background recording should connect to the same BLE service from the
  native foreground service when external sensor mode is enabled.

## Current Sketch

`SkateRouteNessoImu/SkateRouteNessoImu.ino` advertises a custom BLE service and
notifies compact binary IMU packets.

The protocol constants are mirrored in `shared/src/nessoBle.ts`.

The device display is intentionally optimized for the Nesso N1's small touch
screen:

- startup shows a high-contrast Nesso skate IMU splash/logo
- main screen shows large battery percentage text
- BLE state uses compact labels: `BOOT`, `PAIR`, and `LINKED`
- sample rate and a simple IMU on/off state stay visible while connected
- the display sleeps after 25 seconds to save battery; press the side button
  next to the display to wake and redraw the dashboard

## Arduino IDE Setup

Install these libraries/board packages before flashing:

- M5Stack board manager version `>= 3.2.5`
- Board option: `ArduinoNessoN1`
- `M5Unified` version `>= 0.2.11`
- `M5GFX` version `>= 0.2.17`

Then open `SkateRouteNessoImu/SkateRouteNessoImu.ino` in Arduino IDE and upload
it to the Nesso N1.

With Arduino CLI, the same flow is:

```bash
arduino-cli core update-index --additional-urls https://static-cdn.m5stack.com/resource/arduino/package_m5stack_index.json
arduino-cli core install m5stack:esp32 --additional-urls https://static-cdn.m5stack.com/resource/arduino/package_m5stack_index.json
arduino-cli lib install M5Unified M5GFX
arduino-cli board list
arduino-cli compile --fqbn m5stack:esp32:arduino_nesso_n1 firmware/nesso-n1/SkateRouteNessoImu
arduino-cli upload -p /dev/cu.usbmodem14301 --fqbn m5stack:esp32:arduino_nesso_n1 firmware/nesso-n1/SkateRouteNessoImu
```

If upload does not start, put the Nesso N1 in download mode: hold the reset
button on the left side until the internal blue LED starts flashing, then run
the upload again.

## BLE Service

- Device name: `Skate Nesso N1`
- Service UUID: `7b32f8c0-5d0b-4f0e-a1f5-8f30c44c0001`
- IMU characteristic UUID: `7b32f8c1-5d0b-4f0e-a1f5-8f30c44c0001`
- Config characteristic UUID: `7b32f8c2-5d0b-4f0e-a1f5-8f30c44c0001`

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

The mobile app converts:

- accel milligravity to `g`
- gyro millidegrees/second to radians/second
- phone GPS to `latitude`, `longitude`, and `speed`
