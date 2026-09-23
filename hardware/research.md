# Bounded XIAO research capture

This desk experiment compares FIFO-captured acceleration with compact summaries
calculated on the board from the same samples. It is not an hour-long ride
recorder or calibrated pavement classifier. Physical capture, memory allocation
and BLE retrieval still need validation on the actual board.

## Install and run

Keep the battery disconnected and USB power connected. No extra wiring is
needed. Close serial readers and disconnect the dashboard before flashing.
From the repository root, run these checks yourself (per AGENTS.md):

```powershell
npm run hardware:test
npm run build --workspace @skate-route-mapper/admin
arduino-cli compile --fqbn esp32:esp32:XIAO_ESP32S3:PSRAM=opi firmware/xiao-lsm6dsox/SkateRouteXiaoImu
```

Only after successful compilation, upload using the actual port (previously COM3):

```powershell
arduino-cli upload -p COM3 --fqbn esp32:esp32:XIAO_ESP32S3:PSRAM=opi firmware/xiao-lsm6dsox/SkateRouteXiaoImu
npm run app
```

`PSRAM=opi` enables external RAM on this XIAO ESP32S3. Firmware tries to allocate
599,760 raw bytes there for 99,960 samples (60 nominal seconds at 1,666 Hz). If unavailable,
it tries 49,980 internal-RAM bytes for ten seconds. If neither succeeds,
preview remains available but recording is disabled. Summary storage is a
separate fixed 7,224 bytes. The UI reports actual capacity and free internal heap.

## Desk tests

1. Open the admin app in desktop Chrome/Edge, choose Hardware bench, and connect BLE.
2. Under **Research desk recording**, press **Check recorder**. Check capacity.
3. Select **1,666 Hz**, **10 seconds**, and enter a note such as `5 s still, then 5 s shaking`.
4. Press **Start / replace board recording**. Support the boards; rest them for
   the first half, then gently shake for the second half. Live preview pauses.
5. When complete, press **Retrieve both datasets**. Retrieval can take longer
   than capture, especially with a small BLE MTU. Progress is shown.
6. Review sensor-timestamp cadence, integrity checks, clipping, the chart and file sizes.
7. Press **Save recording to laptop**. One `.skateresearch` file contains raw
   data, board summaries and metadata, using the browser's download flow.
8. Use **Open a saved recording** to verify that file without the board.

Repeat entirely at rest, then with short taps beside the sensor. Save each
recording before starting another: start/replace overwrites board memory. A
previous retrieved browser recording remains available until another retrieval
or file-open replaces it; it is separate from the board's new capture.

Disconnect test: start a capture, wait for Recording status, then disconnect
BLE in the page. Keep USB power. Wait for the selected duration plus five
seconds, reconnect and check recorder. Advertising restart is deferred until
capture ends to avoid pausing FIFO draining. Retrieve and save. Also interrupt
retrieval: after reconnect, the page resumes verified records for the same
capture. After a page refresh it can retrieve the whole retained capture again.

Acceptance evidence:

- Ten nominal seconds gives 16,660 samples at 1,666 Hz (or 8,330 at 833 Hz).
- Sensor timestamps report average, minimum and maximum block cadence plus
  block-period variation. Board command elapsed time is reported separately.
- FIFO faults and bus errors are zero. A fault stops capture; partial data is
  retained but marked failed, never treated as complete continuous data.
- Whole-data checksums pass after transfer. Summary coverage has no gaps.
- Laptop feature recomputation agrees with board summaries within float tolerance.
- Stillness produces small RMS; shaking/taps produce larger responses.
- Clipping is reported separately; nonzero clipping limits peak analysis even
  when transport integrity checks pass.
- BLE disconnect/retrieval interruption does not alter retained data.
- The saved file reopens and passes the same checks.

The board stops at a fixed sample count, with a timeout five seconds beyond
nominal duration. It does not acquire while downloading. All retention is RAM:
reset/power loss loses it. Persistent storage, background phone recording and
GPS clock alignment are not implemented in this desk slice.

## Storage comparison

Research v1 stores signed little-endian int16 acceleration X/Y/Z: six bytes per
sample. Sensitivity is approximately 0.000488 g/LSB at +/-16 g; metadata saves
the exact float used. Gyroscope and temperature are excluded from research v1.
The legacy preview remains separate. No per-sample JSON/timestamp object is stored.

| Dataset | Compact payload per hour |
| --- | ---: |
| 833 Hz acceleration XYZ | 17.993 MB |
| 833 Hz acceleration + gyro XYZ (future) | 35.986 MB |
| 1,666 Hz acceleration XYZ | 35.986 MB |
| 24-byte summaries every ~200 ms | about 0.431 MB |

MB means 1,000,000 bytes. Metadata, BLE framing and filesystem/database overhead
add to this. CSV is substantially larger. These projections do not establish
capture capability, throughput, battery runtime or available phone storage.

An hour in compact phone/laptop files looks plausible. An hour entirely in this
board buffer is unsupported. A future recorder must drain pages concurrently
with capture fast enough, or use appropriately sized persistent storage. It
needs a measured outage budget, acknowledgements and overflow accounting.
Normal rides should retain summaries; raw research mode should be opt-in and
capped. This slice does not implement continuous production recording.

## Offline analysis and CSV

The dashboard analyzes both datasets automatically. Terminal analysis:

```powershell
node hardware/analyze-research.mjs "C:\path\skate-research-123.skateresearch"
```

To additionally export raw and summary CSVs, supply an existing directory:

```powershell
node hardware/analyze-research.mjs "C:\path\skate-research-123.skateresearch" "C:\path\analysis"
```

The CLI validates integrity and recalculates features. Exit status 2 means an
incomplete capture, mismatched summaries or measured rate outside 5% of nominal.
Exports never overwrite existing CSVs.

## Sampling and summaries

Research selects accelerometer ODR 833 or 1,666 Hz and +/-16 g, resets FIFO in
bypass, disables compression/other FIFO sources, and enables continuous
uncompressed acceleration batching. The sensor adds its 25-microsecond hardware
timestamp to the FIFO every 32 samples. I2C stays at 400 kHz. Each FIFO entry is
a tag plus six data bytes. The loop drains at most 64 entries per pass and checks
full/overflow and I2C failures. BLE callbacks only enqueue commands; the main
loop owns sensor/buffer mutations. Capturing never depends on BLE receipt.

Relative sample times still use sample index / nominal ODR. Metadata also
contains FIFO-enable board uptime, measured command elapsed time, and statistics
from the sensor timestamps. Timestamp deltas measure average cadence and its
range/variation across 32-sample blocks (about 38.4 ms at 833 Hz or 19.2 ms at
1,666 Hz). They do not measure individual-sample jitter and are not GPS-aligned.
BLE arrival time must not become GPS time.
Filtering is the current default UI path with LPF2 disabled; calibration and
bandwidth tuning remain future work.

Each ~200 ms window (167 samples at 833 Hz or 333 at 1,666 Hz) stores:

| Offset | Encoding | Meaning |
| --- | --- | --- |
| 0 | uint32 | First raw sample index |
| 4 | uint32 | Sample count |
| 8 | float32 | sqrt(sum of per-axis population variances), g |
| 12 | float32 | Peak vector magnitude, g (includes gravity) |
| 16 | float32 | Mean vector magnitude, g |
| 20 | uint32 | Samples with any raw axis at/beyond +/-32760 |

Firmware uses Welford accumulation. A final partial window is included. Laptop
recalculation verifies the computation/coverage, not pavement classification.
Hand movement and changing orientation affect RMS too.

## Research protocol v1

Legacy preview UUIDs/20-byte format remain unchanged. Added characteristics:

- Command (write with response): `7b32f8d3-5d0b-4f0e-a1f5-8f30c44c0001`
- Response (read with ATT long-read support): `7b32f8d4-5d0b-4f0e-a1f5-8f30c44c0001`

Command: version u8, opcode u8, request ID u16, capture ID u32, argument u32.
Opcodes: 1 status, 2 start (10/30/60 seconds and 833/1,666 Hz), 3 raw page (sample offset),
4 summary page (window offset).

Response: magic u16 0x5253, version u8, opcode u8, request ID u16, flags u16,
capture ID u32, offset u32, count u16, payload bytes u16, payload, CRC32 u32.
Flags: 0 success, 1 rejected start, 2 unavailable page, 3 unknown operation.
New status/start payloads are 96 bytes, including sensor timestamp statistics;
the client still accepts the older 64-byte status. Exact fields are in
`shared/src/xiaoResearch.mjs`.
Pages hold at most 64 raw or 16 summary records (384 payload bytes). All
integers/floats are little-endian. CRC32 covers header/payload excluding itself,
polynomial 0xEDB88320 with initial/final XOR 0xFFFFFFFF. Finished datasets
also have whole-data CRCs.

The client keeps one request in flight, correlates identities/offsets, validates
length and CRC, and retries read requests at most three times. START is never
automatically retried; check status after an uncertain start. The response
stays stable until another request executes, allowing small-MTU long reads.
Entire captures are retained until replacement/reset: re-reading pages is safe.
There is no delete-on-ACK in this bounded mode; future streaming needs explicit
acknowledgement/reclamation before reusing memory.

Saved container: `SKATER01` (8 bytes), uint32 JSON-header length, UTF-8 JSON
metadata, packed raw bytes, packed summary bytes. Metadata includes lengths
and dataset CRCs. The decoder rejects truncated/oversized files, checksum
mismatches and invalid summary coverage.

## References

- [ST LSM6DSOX datasheet](https://www.st.com/resource/en/datasheet/lsm6dsox.pdf): FIFO registers, tags, status and ODR.
- [ST FIFO example](https://github.com/STMicroelectronics/STMems_Standard_C_drivers/blob/master/lsm6dsox_STdC/examples/lsm6dsox_fifo.c)
- [Existing vibration plan](../docs/vibration-roughness-plan.md)
