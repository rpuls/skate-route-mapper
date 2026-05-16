# Nesso N1 Gate A Feature Firmware

This folder contains the isolated Gate A firmware experiment for compact
roughness feature frames.

It intentionally does not replace or modify the legacy raw IMU firmware in
`firmware/nesso-n1`. Use this sketch when testing whether Nesso can sample
internally at a useful rate and send only lower-rate qualitative data to the
mobile app.

## Current Status

This branch is a Gate A signal prototype, not the production storage pipeline.
The current firmware label is `calibration v2`.

Observed bench/indoor behavior after `calibration v2`:

- smooth hand movement is barely detected
- low vibration no longer immediately maxes out the `1-6` scale
- semi-rough indoor vibration reaches roughly level `3-4`
- higher levels still need outdoor testing on real rough asphalt

The next test should record serial output on real surfaces, especially smooth
asphalt, normal asphalt, bad asphalt, paving stones, and unskatable surfaces.

## Sketch

`SkateRouteNessoFeatureFrames/SkateRouteNessoFeatureFrames.ino` advertises a
separate Gate A BLE service so the mobile pairing flow cannot accidentally
connect to the legacy raw-stream firmware.

Differences from the legacy sketch:

- BLE device name is `Skate Nesso N1 Gate A`
- BLE service UUID is `7b32f8d0-5d0b-4f0e-a1f5-8f30c44c0001`
- BLE feature characteristic UUID is `7b32f8d1-5d0b-4f0e-a1f5-8f30c44c0001`
- BLE config characteristic UUID is `7b32f8d2-5d0b-4f0e-a1f5-8f30c44c0001`
- the firmware samples IMU data internally during each feature window
- roughness scoring uses a moving per-axis acceleration baseline, then scores
  the high-pass vibration component rather than raw acceleration magnitude
  variation
- `calibration v2` widens the roughness level thresholds and reports the live
  `1-6` level from a smoothed roughness score so brief impacts and mild
  vibration do not instantly pin the UI at level `6`
- the default feature window is `200ms`, or `5Hz`
- the minimum feature window is `100ms`, or `10Hz`
- normal BLE notifications are compact feature frames, not raw per-sample IMU
  readings
- mobile UI should show surface quality and confidence instead of a sample graph

## BLE Feature Frame

Feature notifications are little-endian binary packets:

```text
uint8  packetType          // 0x02
uint8  protocolVersion     // 1
uint16 windowMs
uint32 sequence
uint32 uptimeMs
uint16 rawSampleCount
uint16 highPassVibrationRmsMg
uint16 highPassVibrationPeakToPeakMg
uint8  roughnessLevel      // 1 excellent, 6 unskatable
uint8  confidencePercent
```

The BLE packet shape intentionally stayed stable during calibration v2. In the
shared parser, these high-pass vibration fields are still exposed as
`accelRms` and `accelPeakToPeak` for now. Rename them only when the feature-frame
contract graduates beyond the Gate A prototype.

The shared parser for this packet lives in `shared/src/nessoBle.ts`.

## Arduino CLI

```bash
arduino-cli compile --fqbn m5stack:esp32:arduino_nesso_n1 firmware/nesso-n1-new/SkateRouteNessoFeatureFrames
arduino-cli upload -p /dev/cu.usbmodem14301 --fqbn m5stack:esp32:arduino_nesso_n1 firmware/nesso-n1-new/SkateRouteNessoFeatureFrames
```

## Debugging

The sketch writes one serial log line per feature window at `115200` baud.
After flashing, keep the Nesso connected over USB and run:

```bash
arduino-cli monitor -p COM3 --config baudrate=115200
```

Replace `COM3` with the port from `arduino-cli board list`.

Expected output while the firmware is working:

```text
Skate Nesso N1 Gate A feature firmware booting (calibration v2)
feature calibration v2 seq=12 notified=1 connected=1 windowMs=200 samples=130 late=0 vibRms=0.0123 vibP2p=0.0550 jerkRms=0.0040 rawStd=0.0100 rawP2p=0.0500 score=0.0117 smoothScore=0.0108 level=1 confidence=100
```

Useful interpretation:

- If serial output does not include `calibration v2`, the Nesso is not running
  the current branch firmware.
- `samples=0` means the firmware is not getting IMU readings.
- `samples>0` and `notified=0` means the firmware is computing frames but no
  phone is connected.
- `samples>0` and `notified=1` means the firmware is sending BLE feature
  notifications; if the phone still shows `Frames 0`, debug the mobile BLE
  notification/parser path.
- `rawStd` and `rawP2p` show broader movement/acceleration variation.
- `vibRms`, `vibP2p`, and `jerkRms` show the filtered vibration signal used for
  scoring.
- `score` is the instant roughness score for the current feature window.
- `smoothScore` is the rolling score used for the reported `level`.

The Nesso display also shows `S<number>` in the lower-right corner. That is the
raw sample count from the latest feature window.

## Next Calibration Tests

For each test, capture at least 10-20 serial lines and note the surface label:

- table stillness
- smooth hand movement
- skate rolling on very smooth indoor wood
- skate rolling on the indoor mat used during calibration
- smooth asphalt
- normal asphalt or bike path
- rough asphalt
- paving stones or cracked pavement
- clearly bad or unskatable surface

Record `vibRms`, `vibP2p`, `score`, `smoothScore`, and `level`. If live levels
still bounce too much during real rides, the next firmware experiment should
compare longer rolling averages such as `2s`, `5s`, and distance-based windows.

The old raw-stream firmware remains at:

```bash
firmware/nesso-n1/SkateRouteNessoImu
```
