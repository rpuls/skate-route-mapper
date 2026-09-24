# Vibration Roughness Plan

## Goal

Produce a colour-coded skate route where each segment represents the road
surface experienced while the wheels were in contact with the road. The phone
owns GPS and the route. The XIAO device measures high-rate vibration and will
eventually send compact time-window features during ordinary rides.

## Proven hardware baseline

The supported sensor is a Seeed Studio XIAO ESP32S3 connected to an Adafruit
LSM6DSOX breakout. The current firmware has demonstrated complete bounded
captures at a measured sensor cadence near 1,666 Hz. It retains raw signed
three-axis acceleration in board RAM and computes 200 ms summaries. Captures
include sensor-timestamp evidence, CRCs, FIFO errors, bus errors, overruns and
clipping counts.

Supported research captures are:

| Rate | Durations | Raw payload at 60 s |
| --- | --- | --- |
| 833 Hz | 10, 30, 60 s | about 300 kB |
| 1,666 Hz | 10, 30, 60 s | about 600 kB |

BLE is the control and retrieval channel. It is not the high-rate sampling
clock. A capture continues on the board if BLE disconnects. Power loss, reset,
or starting another capture destroys the retained capture.

## Field research workflow

The mobile app's `Research Collections` screen starts the board capture and
stores the experimental context:

- category: airborne/contact, smooth asphalt, rough asphalt, paving/joints,
  isolated bump, or other
- a specific human label and free-form note
- a context photograph
- a phone GPS track covering exactly the board's recording window: a fix about
  every second with the platform's reported ground speed, and a summary carrying
  average/median/peak reported speed alongside a distance-based cross-check from
  the shared ride filter
- a context fix taken before the capture, and one taken at retrieval
- phone request time, board capture ID, rate, duration and sample count
- original `.skateresearch` file and validation report
- optional signed-in upload to the production `ResearchCapture` table, with
  authenticated admin download for laptop analysis

The phone retrieves the capture after it is complete. The shared codec rejects
bad lengths, missing/overlapping summary coverage, raw or summary CRC mismatch,
and unsupported board metadata before the collection is saved.

Uploaded captures are reviewed in the admin entity viewer, which shows the
surface photo, the GPS track on a map and the signal analysis together, and
which is where a label, category or note is corrected. For offline work,
`npm run research:fetch` pulls the whole dataset — rows, recordings and photos —
into the gitignored `research-data/` folder. See the README for the command and
`docs/api.md` for the endpoint it calls.

The first outdoor set should keep the enclosure position and sensor orientation
fixed. Record at least two repeat runs for each condition:

1. mounted board stationary
2. repeated hops or curb transitions to identify airborne/contact boundaries
3. smooth asphalt
4. rough asphalt
5. paving stones or regular joints
6. one isolated seam or bump

Use the same wheels, tire pressure where applicable, mounting, short path and
similar speed. Speed is measured rather than estimated now, and the live read-out
on the capture card is there to hold a run near a target speed, so notes need not
guess at it. Notes should include surface, run number, wheel setup, mounting
changes and unusual events. Repeatability within one condition matters as much as
separation between conditions.

Start with 10-second captures to validate the full field workflow, then use 30
seconds for contact-state experiments. Use 60 seconds only when the extra data
is useful because current BLE retrieval is much slower than recording.

## Questions each experiment must answer

### Data integrity

- Did sample count equal the requested target?
- Was sensor timestamp coverage complete and within five percent of the nominal
  rate?
- Were FIFO overruns and sensor bus errors zero?
- Did any axis clip during impacts?
- Did all transferred checksums and derived summaries validate?

### Airborne/contact detection

- Does wheel contact produce persistent energy in frequency bands that vanish
  while airborne?
- Can contact transitions be detected without mistaking carving, pushing, deck
  flex, or a jump landing for ordinary roughness?
- How much hysteresis and minimum-state duration prevent rapid false switching?
- Does acceleration magnitude, individual board axes, or gyro data provide the
  clearest contact evidence?

### Surface discrimination

- Are repeat runs on one surface more similar than runs on different surfaces?
- Which bands separate smooth asphalt, rough asphalt and regular joints?
- Does useful discrimination remain after normalising for speed?
- How sensitive are features to mounting position, wheel hardness/diameter and
  sensor orientation?
- Does energy above 350–400 Hz add useful separation? If not, 833 Hz is preferred
  because it halves memory and transfer cost.

### Time and location

- What feature-window duration is stable while still locating changes along a
  route: 100, 200, 500 ms, or another value?
- How should device elapsed time align to phone time despite separate clocks? A
  capture stores the phone clock at both ends of its GPS window and the board
  reports `elapsedUs`, so the two windows can be lined up end to end — but
  nothing yet ties an individual raw sample to a fix.
- How should GPS uncertainty and speed affect the length and confidence of a
  coloured route segment?

## Signal-analysis direction

Raw research data should remain available while the algorithm is being formed.
Candidate offline features include:

- gravity/high-pass separated acceleration
- vector and per-axis RMS
- peak and crest factor
- spectral energy in bands such as 20–50, 50–100, 100–200, 200–400 and, at
  1,666 Hz, 400–800 Hz
- jerk or impact counts with refractory time
- gyro energy for carving/pushing context
- contact confidence and clipped-sample fraction

Do not treat broadband acceleration RMS alone as road roughness. Tilt, pushing,
turning, carrying the board and landings all add energy that is unrelated to
the surface under rolling wheels.

Use `hardware/analyze-research.mjs` for structural/timing analysis and
`hardware/research-signal-analysis.py` for plots and spectral comparisons.

## Intended production data flow

Research mode and normal ride mode serve different needs:

### Research mode

- bounded raw high-rate board capture
- labelled phone context
- slow, lossless retrieval after sampling
- used for algorithm development and calibration

### Normal ride mode

- board samples continuously at the chosen internal rate
- board detects road contact and computes compact features locally
- board sends sequence-numbered time windows rather than raw samples
- phone combines device windows with GPS and speed
- gaps remain visible and recoverable where buffering permits
- route processing aggregates windows into confidence-scored coloured segments

A normal feature frame should eventually contain at least:

- capture/device time range and sequence number
- contact-state/confidence and usable sample fraction
- roughness features and provisional level
- clipping/error flags
- firmware and calibration version

The board should buffer a practical number of compact frames so temporary BLE
loss does not create silent gaps. The phone must acknowledge received ranges and
deduplicate retransmissions.

## Remaining gates

1. Complete several labelled outdoor collections with the iPhone workflow.
2. Prove repeatable airborne/contact separation.
3. Prove surface separation across repeat runs and comparable speeds.
4. Select 833 or 1,666 Hz from evidence about useful upper-band energy.
5. Freeze a first contact detector and roughness feature set for firmware.
6. Add clock alignment and sequence-numbered compact BLE frames.
7. Calibrate provisional road levels against labelled routes.
8. Evaluate multiple devices, mounting positions, wheel setups and riders before
   interpreting the levels as general road quality.

A collection now carries a phone GPS track over the capture window, so every run
has a measured speed to normalise against. It is about one fix a second, which
characterises a 10 to 60 second run but does not align an individual raw sample to
a position. Once the feature windows are stable, normal ride collection must
record continuous phone GPS and explicit phone/device clock alignment.

Two things are still absent from a capture and worth knowing before the data is
trusted too far: the board records accelerometer only, so gyro energy is not
available as carving/pushing context, and wheel setup and mounting position are
free text in the note rather than structured fields.

## Canonical implementation references

- Current hardware and physical setup: `hardware/HARDWARE-HANDOFF.md`
- Research protocol: `hardware/research.md`
- Firmware: `firmware/xiao-lsm6dsox/`
- Mobile field workflow: `mobile/src/screens/ResearchScreen.tsx`
- Phone GPS and speed for a capture: `mobile/src/research/captureTrack.ts`
- Mobile BLE client: `mobile/src/native/XiaoBle.ts`
- Shared validation and file codec: `shared/src/xiaoResearch.mjs`
