# XIAO vibration hardware: living handoff

Last updated: 2026-09-23

Read this file first when resuming the hardware work. It records the current
working state, facts established on the actual hardware, the next physical
steps, and the field-test protocol. Keep it current as experiments change the
conclusions.

## Objective

Build a battery-powered skateboard device that samples vibration fast enough
to distinguish road surfaces, calculates compact roughness features on the
device, and sends timestamped feature frames to the phone for alignment with
GPS. Full-rate raw acceleration is retained only for selected research rides.

The prototype is now battery-powered and remains reachable over BLE while
streaming samples. The immediate milestone is to install the native iPhone
development build, rigidly mount the assembly, and collect labelled raw
captures from real surfaces.

## Hardware on the bench

- Seeed Studio XIAO ESP32S3 base board with external BLE antenna connector.
  Its underside silkscreen and battery-pad layout were confirmed from a close
  photograph on 2026-09-22.
- Adafruit LSM6DSOX accelerometer/gyroscope breakout.
- Rechargeable pouch cell labelled `3.7 V`, `250 mAh`, `502030`, with a
  two-wire plug. A later component photograph also shows `0.92 Wh` and an
  protection assembly. A close photograph with the terminal tape temporarily
  removed confirms a populated single-cell protection PCB between the pouch
  tabs and output wires. The chip markings and cutoff thresholds remain
  unreadable. The AliExpress listing claims overcharge, over-discharge,
  over-current, and short-circuit protection. The supplied PDF is a generic
  3.7 V LiPo manual rather than a model-specific datasheet.
- The battery plug's measured size, face, and keying are consistent with a
  2-pin JST-PH/PHR-2 connector with 2.0 mm pitch. Confirm fit without force and
  measure each mating pigtail because battery-cable polarity is not
  standardized. Multimeter measurement at the battery plug confirmed `4.03 V`
  with red-to-red and black-to-black probing, and `-4.03 V` when reversed:
  this cell's red wire is positive and black wire is negative.
- The XIAO and sensor currently use loose jumper wiring. This is suitable for
  the bench and unsuitable for a moving skateboard.

Confirmed sensor wiring:

| XIAO | LSM6DSOX |
| --- | --- |
| `3V3` | `VIN` |
| `GND` | `GND` |
| `D4 / SDA` | `SDA` |
| `D5 / SCL` | `SCL` |

The sensor remains on the XIAO's regulated `3V3` rail during battery operation.
Do not connect it to the battery directly or to the sensor breakout's `3Vo`
output.

## Software that works

- Firmware: `firmware/xiao-lsm6dsox/SkateRouteXiaoImu/`
- Hardware bench: start the admin app, sign in, and open **Hardware bench** in
  desktop Chrome or Edge. The deployed HTTPS admin app can access hardware on
  the computer opening it.
- BLE device name: `Skate XIAO IMU`.
- Research capture rates: 833 or 1,666 samples/s, acceleration XYZ, ±16 g.
- Capture durations: 10, 30, or 60 seconds, held in PSRAM until replacement,
  reset, or power loss.
- The sensor FIFO runs independently of BLE. A capture continues if BLE
  disconnects, provided the board remains powered.
- Sensor timestamps are retained as statistics every 32 acceleration samples.
  At 1,666 Hz they audit cadence over 19.2 ms blocks.
- Existing `.skateresearch` files remain readable.
- The mobile `Research Collections` workflow can start a board capture, attach
  a category, label, note, photo and phone GPS fixes, retrieve and validate the
  retained data, save it in iPhone document storage, and export it through the
  share sheet. Signed-in users can upload the original file, context metadata,
  and photo to the production `ResearchCapture` table; admins can download the
  assets from the generated entity view. Physical-iPhone validation still
  remains.
- BLE research capture requires the signed iOS development build. Expo Go and
  the web target cannot load `react-native-ble-plx`.

Compile the research firmware with PSRAM enabled:

```powershell
npm run hardware:test
npm run build --workspace @skate-route-mapper/admin
arduino-cli compile --fqbn esp32:esp32:XIAO_ESP32S3:PSRAM=opi firmware/xiao-lsm6dsox/SkateRouteXiaoImu
arduino-cli upload -p COM3 --fqbn esp32:esp32:XIAO_ESP32S3:PSRAM=opi firmware/xiao-lsm6dsox/SkateRouteXiaoImu
npm run app
```

Use the actual serial port if it is no longer `COM3`.

## Facts established on this hardware

### Acquisition quality

Capture `skate-research-4199261890.skateresearch` proved:

| Measurement | Result |
| --- | ---: |
| Raw samples | 16,660 / 16,660 |
| Sensor timestamp rate | 1,666.67 Hz |
| Timestamp delta | 19.2 ms for every measured 32-sample block |
| FIFO faults | 0 |
| I2C bus errors | 0 |
| Clipped samples | 0 |
| Peak vector magnitude during hand motion | 3.596 g |
| Board/laptop summary agreement | within 0.000000119 g |

The LSM6DSOX has fixed 833 and 1,666 Hz modes; it does not offer exactly
1,000 Hz. At 30 km/h, 1,666 Hz corresponds to about 5 mm of travel per sample;
833 Hz corresponds to about 10 mm. Acceleration is not a direct road-height
profile because the wheel, deck, mounting, rider, speed, and filtering all
shape the signal.

Do not infer sensor rate from total board command time. The 10-second capture
completed at the board after 10.119 seconds, but hardware timestamps proved
that the sensor itself sustained 1,666.67 Hz. Board completion time includes
FIFO draining and stop latency.

### Signal separation

The clean settled portion (0–4 s) and strong hand-motion portion (6–10 s) of
capture `4199261890` showed:

| Measurement | Settled | Strong hand motion |
| --- | ---: | ---: |
| Vector RMS around mean | 0.0141 g | 1.4608 g |
| 95th-percentile deviation | 0.0229 g | 2.5661 g |
| Energy above 25 Hz | 0.0072 g RMS | 0.2178 g RMS |

Strong-motion RMS was about 104 times the settled value. This proves useful
dynamic range and clean high-rate capture. It does not establish pavement
classification: the hand motion was dominated near 8.1 Hz and about 97% of its
AC power was below 25 Hz.

The settled gravity vector measured about 0.95 g instead of 1.00 g. Relative
features remain useful, but a stationary six-face calibration is required
before absolute thresholds are treated as portable between devices.

Analysis artifacts:

- `hardware/analysis/4199261890/report.md`
- `hardware/analysis/4199261890/signal-analysis.png`
- `hardware/analysis/4199261890/metrics.json`

### BLE and storage limit

The 10-second capture produced 99,960 raw bytes and took 62.04 seconds to
retrieve through the current browser BLE request/read protocol:

- raw generation: about 10.00 kB/s
- measured useful BLE retrieval: about 1.63 kB/s
- projected raw storage at 1,666 Hz: 35.99 MB/hour
- projected compact summaries: about 0.43 MB/hour

The current protocol cannot drain full-rate raw data during a ride. Raw data is
generated about 6.1 times faster than it is retrieved. One hour would take
about 6.1 hours to retrieve at the measured rate.

This establishes the product architecture:

- **Normal ride mode:** sample fast on the XIAO, filter and calculate short
  vibration features there, and send small timestamped summaries to the phone.
- **Research mode:** explicitly enabled, duration-limited raw recording for
  algorithm development. Long research rides require local persistent storage
  or a redesigned and measured BLE notification stream.

## Portable power confirmed

The XIAO includes 3.7 V lithium-battery power and USB charging management. A
separate charger board is not inherently required. The original XIAO ESP32S3
does not provide battery-voltage telemetry to firmware, so the present UI
cannot show charge percentage or confirm which source is powering it.

The supplied battery manual specifies 3.7 V nominal, 4.2 V maximum, charging
at no more than 1C, and a 10-45 C charging temperature. The original XIAO's
documented 50 mA charge current is 0.2C for this 250 mAh cell, which is within
that electrical envelope. Treat the manual's instruction to discharge below
1 V before recycling as erroneous: it conflicts with the same document's
2.75 V lower limit. Never intentionally deep-discharge this pack; use an
appropriate battery-recycling service.

The underside photograph confirms the two unused rectangular battery pads. The
`BAT-` pad is closest to the USB connector and the `BAT+` pad is farther from
USB, matching Seeed's diagram. Continue to use the printed `+` and `-` marks
and USB position as the reference when the board is rotated.

The battery has now been connected to the rear XIAO pads with the confirmed
polarity. With USB absent, the device powers up, advertises over BLE, connects,
and continues sending sensor samples. This closes the portable-power gate. The
XIAO has no battery-voltage measurement circuit, so the app still cannot report
percentage, charge state, or distinguish battery power from USB power.

An external switch is not required for the first battery-powered prototype.
Unplugging the battery provides a true off state. The onboard buttons are BOOT
(GPIO0 after startup) and RESET/EN, rather than power switches. A later firmware
change can use a long BOOT press to shut down BLE and the IMU and enter deep
sleep; RESET then wakes/restarts the board. This is low-power standby and still
loses any capture held in PSRAM, so save captures before sleeping or unplugging.

If a hard-power switch is fitted, the selected candidate is an L068-A compact
self-locking two-pin push switch, listed as `30 V DC / 1 A` and approximately
`8 x 8 x 8.4 mm`. That rating is adequate in the cell's positive lead. It is
not presented as weather-sealed and has no panel-mount thread, so the enclosure
must retain it mechanically, protect it from water, and insulate both terminals.

The remaining final assembly work is to replace loose sensor jumpers with short
retained connections, insulate exposed joints, strain-relieve the battery and
sensor wires, and fit the optional switch in the positive battery lead. Save any
PSRAM capture before unplugging the battery.

Battery runtime is not yet measured. The 250 mAh label is a capacity claim, not
a proven runtime. Measure actual runtime only after the cell and charging setup
have passed the supervised checks; do not deliberately deep-discharge it.

## Mechanical assembly for road data

Road experiments require repeatable mechanical coupling. Loose boards, jumper
wires, and a hand-held sensor change the signal more than many pavement changes.

- Mount the IMU breakout rigidly to the enclosure using screws or a hard bonded
  mount. Do not put soft foam between the IMU and enclosure.
- Mount the enclosure rigidly to the same deck location for every comparison.
  Start near a truck where vibration is strong and repeatable, while maintaining
  wheel clearance and avoiding direct impact or road spray.
- Mark and photograph the sensor X/Y/Z orientation. Keep it unchanged between
  labelled runs.
- Cushion and retain the pouch cell separately so it cannot move, bend, rub on
  board edges, or transmit force through its wires.
- Strain-relieve every cable. The battery, antenna, and sensor wires must not
  carry enclosure loads.
- Keep the external BLE antenna fitted and away from large metal parts and the
  battery where practical.
- Use a closed enclosure before riding. The first mounted rolling test can be a
  riderless hand-pushed board to verify retention and clearance.

## First outdoor experiment

The mobile app starts the bounded recording. The phone does not need a stable
BLE stream during sampling:

1. Power the assembled device from the battery and open **Research
   Collections** in the signed iPhone development build.
2. Select 1,666 Hz and initially 10 seconds.
3. Choose a category, photograph the test surface, and enter a precise label
   and note: surface, mounting position, run number, wheel setup and approximate
   speed.
4. Press **Start**. The capture continues if BLE disconnects.
5. Perform the short pass. Do not reset or remove battery power afterward.
6. Reconnect/check the board if needed, then retrieve and verify the file before
   starting another board recording.

Collect at least two repeat runs for each condition without moving the device:

1. mounted board stationary
2. smooth asphalt
3. rough asphalt
4. paving stones or regular joints
5. one isolated seam or bump

Use the same short path and similar speed where possible. Record speed with the
phone or a video/GPS reference; roughness depends on speed. Avoid combining
many unknown surfaces into one capture. Separate labelled files are easier to
compare and calibrate.

After 10-second captures work reliably, use 30 or 60 seconds. A 60-second raw
capture is about 600 kB and will take roughly six minutes to retrieve using the
current protocol. Keep the device powered throughout retrieval.

For each file, verify:

- target sample count and complete timestamp coverage
- zero FIFO faults and bus errors
- zero or explainable clipping
- repeat runs of one surface have similar band energies
- different surfaces separate more than repeated runs of the same surface
- separation remains understandable after accounting for speed

Analyze a saved file with:

```powershell
node hardware/analyze-research.mjs "C:\path\capture.skateresearch"
```

Use `hardware/research-signal-analysis.py` to generate the PNG/PDF spectral
report. Raw samples remain local; reports contain derived values and plots.

## Decisions after the first road files

1. Compare useful road energy below and above roughly 350–400 Hz. If the upper
   band adds little separation, prefer 833 Hz to halve storage and bandwidth.
2. Evaluate filtered bands such as 20–50, 50–100, 100–200, and 200–400 Hz. A
   band-limited roughness feature should reject tilt, pushing, and carving more
   effectively than the current broadband 200 ms RMS.
3. Perform six-face accelerometer calibration and save coefficients in firmware.
4. Add a phone or physical-button capture trigger so a laptop is unnecessary.
5. Benchmark a notification-based BLE bulk-transfer protocol with sequence
   numbers, acknowledgements, larger negotiated MTU, and double buffering.
6. If sustained raw transfer cannot exceed generation with margin, add local
   persistent storage for research mode. Compact normal-mode summaries already
   fit comfortably through measured BLE throughput.
7. Add battery voltage/charge telemetry only after choosing and documenting a
   divider or fuel-gauge circuit. Do not infer battery state from USB or BLE.

## Canonical supporting files

- Hardware dashboard and staged setup: `hardware/README.md`
- Research protocol and desk procedure: `hardware/research.md`
- Custom PCB concept study: `hardware/custom-pcb-concept.md`. Exploration
  only — nothing in it has been built, ordered or drawn, and none of it
  changes the bench hardware recorded above.
- Firmware instructions: `firmware/xiao-lsm6dsox/README.md`
- Firmware: `firmware/xiao-lsm6dsox/SkateRouteXiaoImu/`
- Shared recording parser: `shared/src/xiaoResearch.mjs`
- Product signal plan: `docs/vibration-roughness-plan.md`
- Official XIAO power/battery documentation:
  <https://wiki.seeedstudio.com/xiao_esp32s3_getting_started/#battery-usage>
- LSM6DSOX datasheet:
  <https://www.st.com/resource/en/datasheet/lsm6dsox.pdf>

Suggested prompt after chat compaction:

> Read `hardware/HARDWARE-HANDOFF.md` and continue the XIAO vibration hardware
> experiment from its current state. Preserve the proven 1,666 Hz timestamped
> capture path and guide the next battery, mounting, or labelled-road step.
