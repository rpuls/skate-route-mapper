# XIAO hardware bench

Start with [the living hardware handoff](HARDWARE-HANDOFF.md). It contains the
current proven results, battery/assembly gate, and next outdoor experiment. Keep
that document current when a hardware experiment changes the conclusions.

For the bounded 833/1,666 Hz research capture and raw/summary file comparison,
see [Research desk tests](research.md). The original preview described below
still runs at roughly 50 samples/s and pauses during research capture.

## Where we resumed (2026-09-22)

The photos show a Seeed Studio XIAO ESP32S3-family board, an Adafruit LSM6DSOX
breakout, and a cell marked 3.7 V / 250 mAh / 502030. USB and BLE operation and
complete 833/1,666 Hz FIFO captures have now been confirmed on this hardware.
The functional I2C path supports the documented wiring, but the battery,
permanent joints, cell protection, and charging behavior remain unverified.

Existing software:

- `xiao_lsm6dsox_poc/xiao_lsm6dsox_poc.ino`: USB CSV sensor readings at
  115200 baud, roughly 50 samples/s, with I2C diagnostics.
- `../firmware/xiao-lsm6dsox/SkateRouteXiaoImu/SkateRouteXiaoImu.ino`:
  BLE IMU notifications (50/s default), USB text status every three seconds.
  This sketch does **not** stream acceleration over USB.
- `../shared/src/xiaoBle.ts`: existing BLE parser reused by the admin hardware bench.
- Mobile XIAO BLE integration exists in the working tree, but physical-device
  operation has not been reverified during this resumption.

## Admin hardware bench

The bench is a page in the admin app. For local use, start the normal stack:

```powershell
npm run app
```

Open the admin app in desktop Chrome or Edge, sign in, and choose **Hardware
bench** from the menu or dashboard. The production HTTPS admin app can also
connect to USB/BLE hardware attached to the computer opening it. Device data
stays in that browser unless a saved recording is uploaded through a separate
research workflow. Closing the page ends the connection.

Use **Connect USB** with the original proof-of-concept sketch. Close Arduino
Serial Monitor and `read_serial.ps1` first: only one reader can own the port.
The browser's port chooser determines the port; COM3 in older docs is only an
example. USB uses 115200 baud and asserts DTR, matching the old reader.

If the log shows `status imu=ready ble=advertising`, the board has the BLE
sketch. Press **Disconnect** in the page, leave USB plugged in for power,
then **Connect BLE** and choose **Skate XIAO IMU**. Turn on Windows Bluetooth
and disconnect any phone app using the sensor. The board's supplied external
antenna should be attached for BLE testing.

The page shows acceleration, rotation, recent motion variation, reception
rate, stale/disconnected readings and device messages. Chip temperature is
available over USB CSV only. Battery telemetry is explicitly unavailable.
During a USB session the BLE tile only reflects any firmware status received;
it does not represent a browser BLE link.

Last received numeric values stay visible with an explicit stale label when
the stream pauses; the chart remains a rolling ten-second window. When data
resumes after a gap, the log records elapsed time, device uptime and BLE
sequence advance to help distinguish slow production from missed packets.
If BLE samples arrive in bursts separated by long pauses with USB used only
for power, upload the updated BLE firmware with bounded USB logging. This
addresses a suspected blocking serial-output path; verify the actual sample
rate on the device after uploading.

Troubleshooting:

- No USB port: check that the USB cable carries data and Windows sees the
  board. Close other port readers.
- Port opens but no messages: wait several seconds; if needed, briefly press
  RESET on the XIAO (the port may reconnect). Do not press BOOT for this test.
- `LSM6DSOX not found`: disconnect power, then check the wiring below.
- No BLE device: verify BLE firmware, USB power, Windows Bluetooth, antenna,
  and that another client is not connected. The USB-only sketch has no BLE.

## Physical steps, one checkpoint at a time

### 1. Restore the USB baseline

Keep the cell unplugged. With USB also unplugged, check the four connections
against the board labels, not wire colors:

| XIAO | LSM6DSOX |
| --- | --- |
| 3V3 | VIN |
| GND | GND |
| D4 / SDA | SDA |
| D5 / SCL | SCL |

The sensor's `3Vo` pad is an output; use `VIN` for its power input. Use the
XIAO's regulated `3V3` supply so the sensor can remain powered when USB is
removed later. Check that headers are soldered rather than merely resting in
the holes. The current photo does not conclusively show the solder joints.

Plug in USB, open the dashboard and connect. Rest the sensor flat: acceleration
magnitude should be near 1 g and rotation near zero. Gently tilt it, then tap
the surface beside it. The chart should respond. Support the boards so their
wires do not pull loose.

### 2. Verify BLE while still USB powered

Identify the installed firmware from USB first. If it is USB-only, use the
[BLE firmware instructions](../firmware/xiao-lsm6dsox/README.md) to compile
and upload the BLE sketch using the actual detected port. Close the browser
serial connection before uploading. Firmware flashing replaces the current
sketch; the original USB sketch remains available in this repository.

Fit the supplied antenna with the board unpowered: align the small snap
connector squarely, then press straight down gently. Do not force a tilted
connector. Test BLE notifications in the dashboard before changing power.

### 3. Connect the battery after confirming its details

The XIAO ESP32S3 already includes a lithium battery charging circuit and can
run from a suitable rechargeable 3.7 V cell. A separate charger is not
automatically needed. Charging, cell protection, and measuring remaining
charge are different functions.

Before the soldering step, obtain the cell's product information to confirm
its permitted charging current and protection against over-discharge/short
circuits. The label alone does not establish those details. Also establish
whether a multimeter, soldering iron and matching battery connector pigtail
are available. Do not assume connector polarity from its shape or wire colors.

The intended connection is a **matching connector pigtail soldered to the
XIAO's dedicated rear BAT+ / BAT− pads**, with the battery unplugged and USB
removed while soldering. Identify pads against the manufacturer's back-side
diagram and the actual board before working. The cell must not connect to
`3V3`, an arbitrary GPIO, or the sensor's white I2C connectors.

Keep the cell's existing connector; do not solder directly on the pouch cell.
Check pigtail polarity with a meter before mating it, inspect for solder
bridges, and insulate and strain-relieve the connections. Detailed pad-by-pad
guidance should follow confirmation of the underside of this board and the
cell specifications. Stop if the cell is swollen, damaged or becomes hot.

Once those checks are complete, verify BLE readings with USB removed and
battery attached, then verify supervised charging via the XIAO USB port.
Do not deliberately run the cell flat as a test. The sensor stays wired to
3V3; the XIAO's 5V pin is not powered during battery-only operation.

### 4. Add software battery readings if desired

This original ESP32S3 model does not expose a built-in battery-voltage ADC
connection. Its charging LED is a physical indicator, not existing software
telemetry. Do not confuse documentation for the newer ESP32S3 Plus with this
board.

An appropriately designed voltage divider into a spare ADC pin could add
voltage measurement; a compatible fuel gauge could provide a charge estimate.
Choose and document that circuit before adding firmware or displaying a
percentage. Never connect raw cell voltage directly to a GPIO. Charging state
also needs an actual signal; it cannot be inferred from a BLE or USB link.

## Measurement limits and validation

The live-preview path transmits about 50 samples/s and is intended for bench
visualization. Research mode separately drains the FIFO at selectable 833 or
1,666 Hz; the actual board completed 16,660 samples at a timestamp-measured
1,666.67 Hz with no FIFO or bus errors. Road-surface discrimination remains
unvalidated until the assembly is rigidly mounted and tested outdoors.
The BLE packet's int16 millidegrees/s encoding clips rotation at about
±32.767 degrees/s despite the sensor's ±2000 degrees/s range. The dashboard
preserves the existing protocol; this limitation needs a versioned protocol
change before using fast rotations quantitatively.

The chart uses browser arrival times and retains ten seconds. Motion variation
is the square root of the summed per-axis variances over the last two seconds;
it also reacts to tilt and is not a calibrated roughness score. Browser
background throttling and transport buffering can affect the displayed rate.

Per AGENTS.md, the user runs build/dev checks:

```powershell
npm run build --workspace @skate-route-mapper/admin
npm run app
```

USB, BLE, reconnect behavior, and bounded research capture are confirmed.
Remaining physical acceptance is permanent wiring, battery-only operation,
supervised charging, rigid mounting, and labelled road captures.

## Manufacturer and browser references

- [Seeed XIAO ESP32S3 hardware, battery and antenna guide](https://wiki.seeedstudio.com/xiao_esp32s3_getting_started/)
- [Web Serial API](https://developer.chrome.com/docs/capabilities/serial)
- [Web Bluetooth API](https://developer.chrome.com/docs/capabilities/bluetooth)
