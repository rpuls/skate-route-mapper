# Vibration Roughness Planning

This document plans the technical path for turning high-frequency skate vibration data into useful route roughness information without making BLE, phone storage, sync, or Postgres carry raw IMU samples at full rate for every ride.

It is intentionally written for both humans and AI coding agents. Treat it as a planning and research document before implementation. The first milestone is not a backend, database, or map feature. The first milestone is proving that the sensor hardware can see useful surface differences.

## Problem Statement

The product goal is to show a recorded route on a map with color-coded surface quality. A rider should be able to understand whether each part of a road or path is smooth, acceptable, rough, or effectively unskatable.

The current low-frequency sample flow is not enough to reliably classify pavement roughness. The Nesso N1 external IMU can likely sample at a higher rate than the app currently requests, but sending and storing raw high-frequency samples for normal user rides does not scale.

Example scale problem:

```text
1,000 samples/sec * 60 sec/min * 30 min = 1,800,000 raw samples
```

For each raw sample, the current `MeasurementSample` shape carries timestamp, accelerometer, gyroscope, vibration magnitude, GPS fields, and GPS confidence metadata. Storing millions of these rows per ride would create problems for:

- BLE bandwidth
- Nesso battery life
- phone battery life
- local mobile storage
- sync time and mobile data usage
- backend ingestion throughput
- Postgres table size and index growth
- admin analysis performance
- future map rendering and aggregation

The system needs a middle layer: sample high enough to detect vibration, but persist and sync compact vibration features.

## Critical First Question

Before investing in backend schema, sync contracts, or route rendering, answer this:

```text
Can the sensor produce a 5-10 Hz feature stream from high-rate internal IMU sampling
that clearly separates smooth asphalt, rough asphalt, paving stones, and unskatable
surface?
```

If the answer is no, software architecture will not fix the product. It will only store and display weak data.

The immediate project should therefore be signal-first:

1. Prove Nesso can access meaningful high-rate accelerometer data internally.
2. Prove short-window features separate known surfaces.
3. Only then build mobile storage, sync, backend models, and route segmentation.

## Decision Gates

Use explicit gates to avoid a sunk-cost trap.

### Gate A: Nesso Feasibility

Continue with Nesso only if a focused firmware-only experiment shows:

- actual measured internal IMU sample rate high enough for vibration detection
- stable sample timing over 5-10 second captures
- low or explainable dropped sample count
- visible feature separation between stillness, smooth asphalt, rough asphalt, paving stones, and clearly bad surfaces
- acceptable battery and thermal behavior for short tests

If Nesso cannot show meaningful separation within 1-2 focused experiments, stop Nesso-specific investment and evaluate alternative hardware.

### Gate B: Feature-Frame Feasibility

Continue to mobile/backend work only if Nesso can emit compact feature frames over BLE at `5Hz` or `10Hz` without losing the useful separation found in the firmware-only experiment.

### Gate C: Product Pipeline

Add Prisma models, sync operations, route segmentation, and map rendering only after feature-frame data is proven useful in real-world tests.

## Current State

### Current Nesso Firmware

The firmware lives in:

- `firmware/nesso-n1/SkateRouteNessoImu/SkateRouteNessoImu.ino`

Current BLE packet shape:

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

The shared parser lives in:

- `shared/src/nessoBle.ts`

Important details:

- The current firmware default interval is `20ms`, or `50Hz`.
- The current firmware minimum interval is `10ms`, or `100Hz`.
- The mobile foreground Nesso preview currently requests `200ms`, or `5Hz`.
- The Android background recorder also defaults to a `200ms` interval.
- Reaching `800Hz` or `1000Hz` would require firmware and protocol changes, not just an app setting change.

### Current Mobile Capture

The mobile app stores local rides and raw-ish samples in SQLite:

- `mobile/src/database/db.ts`
- `mobile/src/store/measurementStore.ts`
- `mobile/src/screens/RecordingScreen.tsx`
- `mobile/modules/background-recorder/android/src/main/java/expo/modules/backgroundrecorder/BackgroundRecorderService.kt`

Current sync sends queued operations to:

- `POST /v1/mobile/sync`

Current sample contract:

- `shared/src/mobileContracts.ts`

The sync path is idempotent by operation ID. Direct sample upload endpoints exist, but direct sample uploads are not deduplicated.

### Current Backend Storage

The backend stores one row per raw measurement sample:

- `Sample` in `db/schema.prisma`

That is acceptable for low-rate recording and debugging, but should not become the normal storage model for high-frequency production rides.

## Product Target

The user-facing output should be a route line divided into short segments, each with a roughness level and color.

Example user-facing levels:

```text
1 = excellent
2 = good
3 = okay
4 = rough
5 = very rough
6 = unskatable
```

The exact labels, thresholds, colors, and number of buckets are product decisions and should be calibrated with real rides. Six levels is a reasonable starting point because it gives more nuance than green/yellow/red without pretending to be laboratory-precise.

The backend should keep a continuous score behind the bucket so thresholds can be tuned later.

## Proposed Architecture

Use a layered signal pipeline.

```text
High-rate accelerometer-first IMU samples
  -> short-window vibration features
  -> GPS-aligned ride vibration frames
  -> distance-based route surface segments
  -> user-facing map colors
```

### Layer 1: Raw IMU Samples

Raw IMU samples are high-frequency accelerometer and optional gyroscope readings.

For roughness detection, prioritize accelerometer data first. Gyroscope data may be useful later for device motion, mounting analysis, or advanced filtering, but it should not be treated as the primary pavement roughness signal.

Normal production behavior:

- collect raw samples inside firmware or native code
- do not send all raw samples over BLE
- do not store all raw samples in Postgres
- do not sync all raw samples for normal rides

Allowed uses:

- developer calibration rides
- limited debug captures
- firmware validation
- sensor comparisons
- algorithm research

Raw capture should be gated by:

- explicit developer/debug mode
- short duration caps
- local-only defaults
- manual upload or sampled upload
- clear size estimates before upload

### Layer 2: Vibration Feature Frames

A vibration feature frame summarizes a short time window, for example `100ms`, `200ms`, or `250ms`.

At `1000Hz`, a `200ms` frame summarizes about `200` raw IMU samples and emits `5` feature frames per second.

This is the likely sweet spot for normal rides:

- high internal sample rate for real vibration detection
- low BLE and storage rate
- enough feature detail for future algorithms
- small enough payload for mobile sync

Example TypeScript shape:

```ts
type VibrationFrame = {
  timestamp: number;
  windowStartedAt: number;
  windowEndedAt: number;
  windowMs: number;
  rawSampleCount: number;
  sensorSource: "phone" | "external";
  sensorModel?: string | null;
  firmwareVersion?: string | null;

  accelRms: number;
  accelMean: number;
  accelPeak: number;
  accelPeakToPeak: number;
  accelStdDev: number;

  highFrequencyRms?: number | null;
  verticalRms?: number | null;
  jerkRms?: number | null;
  crestFactor?: number | null;

  gyroRms?: number | null;
  clippedSampleCount?: number;
  droppedSampleCount?: number;

  roughnessScore: number;
  roughnessLevel: 1 | 2 | 3 | 4 | 5 | 6;
  confidence: number;

  latitude: number | null;
  longitude: number | null;
  speed: number | null;
  locationTimestamp?: number | null;
  locationAccuracy?: number | null;
  locationAgeMs?: number | null;
};
```

Notes:

- `roughnessLevel` is useful for immediate display.
- `roughnessScore` preserves tunability.
- `accelRms`, `peak`, `stdDev`, and related fields keep enough signal for later algorithm work.
- accelerometer-derived fields are the first priority; gyro fields are optional/supporting until proven useful.
- GPS should still come from the phone.
- GPS quality metadata should stay attached so bad location data can be ignored or down-weighted later.

### Layer 3: Route Surface Segments

Route surface segments are backend-derived map units. They group vibration frames by distance along the route.

Example segment length:

- start with `5m`
- evaluate `3m`, `5m`, and `10m` after real ride testing

Example TypeScript shape:

```ts
type RouteSurfaceSegment = {
  id: string;
  rideId: string;
  startDistanceMeters: number;
  endDistanceMeters: number;
  distanceMeters: number;

  startTimestamp: number;
  endTimestamp: number;

  startLatitude: number;
  startLongitude: number;
  endLatitude: number;
  endLongitude: number;

  roughnessScore: number;
  roughnessLevel: 1 | 2 | 3 | 4 | 5 | 6;
  confidence: number;

  frameCount: number;
  gpsPointCount: number;
  avgSpeed: number | null;
  source: "computed";
  algorithmVersion: string;
};
```

Route segments should be the main map-rendering surface. The mobile app and admin dashboard should not need to load raw high-frequency samples to color a route.

## Firmware Architecture

The preferred long-term design is to aggregate on the sensor device.

```text
IMU hardware
  -> high-rate firmware sampler
  -> ring buffer / current window accumulator
  -> vibration feature calculator
  -> compact BLE feature frame notifications
```

### Firmware Responsibilities

The firmware should eventually own:

- high-rate IMU sampling
- sensor configuration
- sample timing
- dropped sample counting
- clipping detection
- short-window feature calculation
- compact BLE feature notifications
- optional debug raw-stream mode

The firmware should not own:

- GPS
- route segmentation
- user accounts
- map rendering
- final cross-user road scoring

### Firmware Modes

Recommended modes:

```text
mode=preview
  Low rate raw-ish packets for connection UI and sanity checks.

mode=features
  High internal sample rate, compact feature frames over BLE.
  This should be the normal ride mode.

mode=debug_raw
  Raw packets over BLE or local export for short developer tests only.
```

### BLE Protocol Direction

The current 20-byte raw IMU packet is good for early testing, but not enough for the final feature-frame protocol.

Possible future packet families:

```text
0x01 raw_imu_sample
0x02 vibration_feature_frame
0x03 device_status
0x04 config_response
```

Feature frames should be binary, versioned, and compact. Avoid JSON over BLE.

Example binary feature frame fields:

```text
uint8  packetType
uint8  protocolVersion
uint16 payloadLength
uint32 sequence
uint32 windowStartedUptimeMs
uint16 windowMs
uint16 rawSampleCount
int16  accelRmsScaled
int16  accelPeakScaled
int16  accelStdDevScaled
int16  highFrequencyRmsScaled
uint16 droppedSampleCount
uint8  roughnessLevel
uint8  confidenceScaled
```

The exact fields should be decided after firmware feasibility tests.

## Mobile Architecture

The mobile app should treat vibration frames as the normal persistent unit for external high-frequency sensors.

Do not start this work until the firmware-only and BLE feature-frame experiments prove useful signal separation. Until then, mobile work should be limited to test harnesses, logs, exports, and small local-only prototypes.

Recommended changes when development begins:

- add shared `VibrationFrame` contracts
- add local SQLite table for vibration frames
- keep raw `samples` table for phone low-rate capture and debug use
- add pending sync operation type such as `ride.vibrationFrames`
- add map replay support for route segments or frames
- add developer setting for raw capture/debug upload

Possible local table:

```sql
CREATE TABLE vibration_frames (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rideId TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  windowStartedAt INTEGER NOT NULL,
  windowEndedAt INTEGER NOT NULL,
  windowMs INTEGER NOT NULL,
  rawSampleCount INTEGER NOT NULL,
  accelRms REAL NOT NULL,
  accelPeak REAL NOT NULL,
  accelStdDev REAL NOT NULL,
  highFrequencyRms REAL,
  roughnessScore REAL NOT NULL,
  roughnessLevel INTEGER NOT NULL,
  confidence REAL NOT NULL,
  latitude REAL,
  longitude REAL,
  speed REAL,
  locationTimestamp INTEGER,
  locationAccuracy REAL,
  locationAgeMs INTEGER,
  FOREIGN KEY (rideId) REFERENCES rides(id) ON DELETE CASCADE
);
```

Possible pending operation:

```ts
type RideVibrationFramesOperation = {
  operationId: string;
  type: "ride.vibrationFrames";
  createdAt: number;
  payload: {
    rideId: string;
    frames: VibrationFrame[];
  };
};
```

## Backend Data Model Direction

Do not replace `Sample` immediately. Add a new model for compact vibration frames and a model for derived route segments.

This section is a post-signal-proof direction, not the next implementation step. Do not add these models until compact vibration frames have been validated with real surface tests.

Possible Prisma models:

```prisma
model VibrationFrame {
  id                 BigInt   @id @default(autoincrement())
  rideId             String   @map("ride_id")
  recordedAt         DateTime @map("recorded_at")
  windowStartedAt    DateTime @map("window_started_at")
  windowEndedAt      DateTime @map("window_ended_at")
  windowMs           Int      @map("window_ms")
  rawSampleCount     Int      @map("raw_sample_count")
  accelRms           Float    @map("accel_rms")
  accelPeak          Float    @map("accel_peak")
  accelStdDev        Float    @map("accel_std_dev")
  highFrequencyRms   Float?   @map("high_frequency_rms")
  roughnessScore     Float    @map("roughness_score")
  roughnessLevel     Int      @map("roughness_level")
  confidence         Float
  latitude           Float?
  longitude          Float?
  speed              Float?
  locationTimestamp  DateTime? @map("location_timestamp")
  locationAccuracy   Float?    @map("location_accuracy")
  locationAgeMs      Int?      @map("location_age_ms")
  algorithmVersion   String?   @map("algorithm_version")
  createdAt          DateTime  @default(now()) @map("created_at")
  ride               Ride      @relation(fields: [rideId], references: [id], onDelete: Cascade)

  @@index([rideId, recordedAt])
  @@map("vibration_frames")
}

model RouteSurfaceSegment {
  id                  String   @id @default(cuid())
  rideId              String   @map("ride_id")
  startDistanceMeters Float    @map("start_distance_meters")
  endDistanceMeters   Float    @map("end_distance_meters")
  startTimestamp      DateTime @map("start_timestamp")
  endTimestamp        DateTime @map("end_timestamp")
  startLatitude       Float    @map("start_latitude")
  startLongitude      Float    @map("start_longitude")
  endLatitude         Float    @map("end_latitude")
  endLongitude        Float    @map("end_longitude")
  roughnessScore      Float    @map("roughness_score")
  roughnessLevel      Int      @map("roughness_level")
  confidence          Float
  frameCount          Int      @map("frame_count")
  gpsPointCount       Int      @map("gps_point_count")
  avgSpeed            Float?   @map("avg_speed")
  algorithmVersion    String   @map("algorithm_version")
  createdAt           DateTime @default(now()) @map("created_at")
  ride                Ride     @relation(fields: [rideId], references: [id], onDelete: Cascade)

  @@index([rideId, startDistanceMeters])
  @@map("route_surface_segments")
}
```

Potential `Ride` summary additions:

```prisma
vibrationFrameCount Int @default(0)
surfaceSegmentCount Int @default(0)
avgRoughnessScore   Float?
maxRoughnessScore   Float?
```

## Algorithm Strategy

Start with simple, explainable features before machine learning.

Candidate features per window:

- acceleration magnitude RMS
- acceleration magnitude standard deviation
- peak acceleration magnitude
- peak-to-peak acceleration
- high-pass filtered RMS to reduce gravity/body tilt
- jerk RMS, based on acceleration changes
- vertical-axis RMS if orientation can be trusted
- crest factor, meaning peak divided by RMS
- clipped sample count
- dropped sample count
- speed-normalized roughness score
- optional gyroscope RMS, only if experiments show it adds useful information

Important research question:

- Should roughness be normalized by speed?

The same surface may produce different vibration at different speeds. The backend should preserve speed and raw feature values so speed normalization can be changed later.

Possible first roughness score:

```text
roughnessScore =
  weighted(highPassAccelRms, accelStdDev, peakToPeak, jerkRms)
  adjusted by confidence
  optionally normalized by speed band
```

Avoid overfitting early. The first algorithm should be transparent and easy to recalibrate.

## Calibration Plan

Collect controlled test rides across known surfaces:

- very smooth asphalt
- normal bike path
- older rough asphalt
- paving stones
- cracked pavement
- gravel or unskatable surface

For each test:

- same route if possible
- multiple speeds
- same rider/device mounting position
- label ground truth manually
- collect optional raw debug data for short windows
- collect normal feature frames
- compare Nesso feature output against raw data and subjective labels

Suggested debug capture strategy:

- normal ride stores feature frames for the whole route
- selected 5-15 second windows store raw data locally
- raw windows can be uploaded manually for algorithm research

### Firmware-Only Feasibility Experiment

Before mobile/backend development, create a tiny Nesso firmware experiment that does not depend on the app.

Experiment behavior:

- configure accelerometer output data rate as high as Nesso/M5Unified allows
- sample internally for `5-10` seconds
- do not stream raw samples over BLE during the capture
- compute feature summaries on-device
- send only summary output over serial and/or BLE after each capture

Summary output should include:

- requested sample rate
- actual measured sample count
- actual measured sample rate
- capture duration
- per-axis min/max
- acceleration magnitude RMS
- high-pass acceleration RMS if practical
- peak acceleration magnitude
- peak-to-peak acceleration
- jerk RMS if practical
- clipped sample count
- dropped or late sample count

Test cases:

- table stillness
- hand vibration
- smooth asphalt
- rough asphalt
- paving stones
- clearly bad or unskatable surface

Expected decision:

- If summaries separate these surfaces clearly enough, continue toward feature frames.
- If summaries do not separate them, evaluate alternative hardware before building more app/backend infrastructure.

## Alternative Hardware Section

The Nesso N1 should be tested first because the project already has firmware and BLE integration.

Move to alternative hardware only if one or more of these are true:

- Nesso IMU cannot sample fast enough internally.
- Nesso firmware cannot access stable high-rate IMU data.
- BLE stack cannot reliably send feature frames while maintaining connection.
- sensor noise floor is too high to distinguish useful surface categories.
- battery life is unacceptable even with feature-frame BLE.
- device mounting is physically unsuitable for skating use.

Alternative device requirements:

- IMU sample rate at least `400Hz`, ideally `800Hz` or `1000Hz`
- accelerometer range configurable, likely at least `+/-8g`
- sufficient resolution and low noise
- stable timestamps
- onboard compute for feature extraction
- BLE support for compact feature frames
- battery suitable for 1-3 hour rides
- firmware can be customized
- physically mountable on skate, board, shoe, or rider

Potential hardware families to research:

- ESP32-based IMU boards with high-rate accelerometers
- Nordic nRF52/nRF53 BLE boards with IMU
- dedicated sports/condition-monitoring vibration sensors
- phone-only fallback using Android high-rate sensors where available

Hardware selection should be driven by measured data quality, not advertised sample rate alone.

### DIY Candidate: XIAO nRF52840 Sense

Potential control board:

- Seeed Studio XIAO nRF52840 Sense
- Product page: <https://eu.robotshop.com/nl/products/seeed-studio-xiao-nrf52840-sense-tinyml-tensorflow-lite-imu-microfoon-bluetooth-50>

Why it is interesting:

- Nordic nRF52840 microcontroller
- Bluetooth 5.0 / BLE
- small `21 x 17.8 mm` board
- low-power wearable/IoT-friendly direction
- built-in lithium battery charge management
- Arduino and CircuitPython support
- available SPI/I2C interfaces

Risks and caveats:

- the built-in 6-axis IMU may or may not be sufficient for road roughness detection
- a production-like skate sensor still needs battery, charging safety, enclosure, mounting, weather protection, and firmware
- the board is a prototype platform, not a finished sensor product

### DIY Candidate: nRF52840 plus ICM-42688-P

Potential high-rate IMU:

- TDK InvenSense ICM-42688-P
- DigiKey product page: <https://www.digikey.nl/nl/products/detail/tdk-invensense/ICM-42688-P/10824934>
- TDK/DigiKey datasheet reference: <https://www.digikey.com/en/htmldatasheets/production/5637231/0/0/1/icm-42688-p.html>

Why it is interesting:

- 6-axis accelerometer/gyroscope IMU
- accelerometer full-scale ranges include `+/-2g`, `+/-4g`, `+/-8g`, and `+/-16g`
- accelerometer output data rate is documented up to `32kHz`
- host interface includes high-speed SPI
- marketed for wearable, sports, robotics, and IoT-style applications

Possible architecture:

```text
nRF52840 BLE MCU
  -> SPI
  -> ICM-42688-P high-rate accelerometer
  -> firmware feature extraction
  -> compact BLE feature frames
  -> phone GPS + mobile app
```

Risks and caveats:

- this is a DIY hardware project, not an off-the-shelf product
- requires board design or suitable breakout/evaluation board
- needs battery, charging, enclosure, waterproofing, vibration-safe mounting, and firmware
- high advertised ODR does not guarantee useful skate-road signal without testing
- high-rate SPI and firmware timing must be validated under battery-powered conditions

## Research Questions

Before building the final pipeline, answer these:

- What sample rate is enough to separate smooth, medium, rough, and unskatable surfaces?
- Can Nesso N1 produce reliable internal data above `100Hz`?
- Does M5Unified expose the IMU at the needed rate?
- Is the current IMU sensor configured with a suitable accelerometer range and low-pass filter?
- What BLE notification rate and packet size are reliable on Android and iOS?
- Is `100ms`, `200ms`, or `250ms` the best feature window?
- Is `5m` the right route segment size?
- How much does speed affect roughness scoring?
- How much does mounting position affect signal quality?
- Can phone GPS accuracy support 5m route segments reliably?
- Should route segments use distance, time, or map-matched geometry?
- If Nesso fails, is XIAO nRF52840 Sense sufficient by itself, or is a separate ICM-42688-P-class IMU needed over SPI?
- What battery size and enclosure constraints are acceptable for a DIY alternative sensor?

## Development Phases

### Phase 0: Firmware-Only Nesso Feasibility

Goal:

- prove whether Nesso can internally access useful high-rate accelerometer data before involving the app or backend

Tasks:

- create a tiny firmware-only experiment
- configure Nesso IMU/accelerometer output data rate as high as practical
- sample internally for `5-10` seconds
- compute summary features on-device
- output only summary data over serial and/or BLE
- test table stillness, hand vibration, smooth asphalt, rough asphalt, paving stones, and unskatable surface
- record requested sample rate, measured sample rate, RMS, peak, peak-to-peak, clipped samples, and dropped/late samples

Expected output:

- hard decision on whether Nesso is worth continued investment

### Phase 1: Feature Separation And BLE Prototype

Goal:

- produce a compact `5Hz` or `10Hz` feature stream that keeps the useful surface separation found in Phase 0

Tasks:

- add firmware feature mode
- prioritize accelerometer magnitude high-pass RMS, peak-to-peak, jerk RMS, clipping, and dropped sample count
- emit compact binary feature frames over BLE
- verify BLE stability and packet loss
- compare feature frames across known surfaces
- do not change backend model yet

Expected output:

- decision on whether Nesso feature frames are good enough for mobile integration

### Phase 2: Mobile Local Capture Prototype

Goal:

- capture validated feature frames locally on the phone without backend dependency

Tasks:

- add mobile parser for feature frames
- store feature frames locally in a prototype table or export file
- attach phone GPS and GPS confidence metadata
- add simple local/export inspection path
- keep raw capture local-only and capped
- do not add Prisma models or production sync yet

Expected output:

- local ride datasets proving that feature frames plus GPS are useful enough for route roughness work

### Phase 3: Contract And Storage

Goal:

- make feature frames a first-class shared/mobile/backend contract after signal is proven

Tasks:

- add `VibrationFrame` shared contract
- add backend validation
- add mobile local table
- add sync operation
- add Prisma model and migration
- add contract tests

Expected output:

- scalable end-to-end upload of compact ride vibration data

### Phase 4: Route Segmentation

Goal:

- produce map-ready route segments

Tasks:

- derive distance along route from GPS points
- group vibration frames into distance windows
- calculate segment roughness score and confidence
- store `RouteSurfaceSegment`
- expose admin/mobile read endpoint for segment rendering

Expected output:

- route replay can render color-coded roughness without loading raw samples

### Phase 5: Calibration And Algorithm Iteration

Goal:

- improve roughness score quality with real-world data

Tasks:

- collect labeled test rides
- tune feature weights and thresholds
- compare window sizes and segment lengths
- account for speed and GPS confidence
- version algorithms
- allow recomputation of route segments from stored feature frames

Expected output:

- stable enough roughness classification for user-facing maps

### Phase 6: Alternative Hardware Prototype

Goal:

- avoid Nesso sunk cost if feasibility gates fail

Tasks:

- evaluate XIAO nRF52840 Sense as a compact BLE control board
- evaluate ICM-42688-P or similar high-rate IMU over SPI
- build a bench prototype with battery assumptions
- repeat Phase 0 and Phase 1 experiments on the alternative hardware

Expected output:

- decision on whether a DIY high-rate sensor path is better than Nesso

## Guardrails

- Do not make raw `Sample` rows the normal high-frequency storage path.
- Do not send raw `1000Hz` IMU data over BLE during normal rides.
- Do not reduce normal storage all the way to only `1-6` buckets.
- Do not build backend/product infrastructure until hardware signal is proven.
- Do not let Nesso convenience become a sunk-cost trap.
- Keep compact feature values so algorithms can improve later.
- Keep algorithm versions attached to generated scores and segments.
- Keep GPS confidence metadata through the pipeline.
- Keep debug/raw capture explicitly opt-in and capped.
- Validate storage size and sync payload size before releasing.

## Open Decisions

- final feature window size
- final route segment size
- final roughness scale labels and colors
- Nesso internal max reliable sample rate
- first firmware feature formula
- whether roughness frames should be produced by firmware, Android native service, or both
- how much raw debug data to keep locally
- whether backend should store all vibration frames or only route segments for normal rides
- whether cross-user road scoring should use map matching before aggregation
- whether XIAO nRF52840 Sense is useful as a complete prototype board or mainly as a BLE MCU paired with a better external IMU
- whether ICM-42688-P is the right fallback IMU or only a reference candidate

## Recommended Starting Position

Use Nesso first, but test it in a firmware-only, signal-first way. Do not begin with backend or production mobile work. First prove that Nesso can internally sample fast enough and produce features that separate known surfaces.

If Nesso passes that test, build a feature-frame BLE mode that emits compact frames at `5Hz` or `10Hz`. Then move to mobile local capture, then contracts/storage, then route segmentation.

If Nesso fails after 1-2 focused experiments, evaluate a DIY high-rate sensor path. A likely candidate is an nRF52840 BLE board such as XIAO nRF52840 Sense paired with an ICM-42688-P-class IMU over SPI, plus battery, charging, enclosure, and custom firmware.

For production data, store compact vibration frames and backend-derived route surface segments. Keep raw data only for short, explicit debug captures.

This gives the project enough data to improve algorithms later without turning every ride into a massive raw sensor upload.
