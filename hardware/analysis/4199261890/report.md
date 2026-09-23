# Research capture 4199261890

## Verdict

This is a complete, high-quality 10-second sensor capture. The LSM6DSOX
sustained 1,666.67 samples/s in every retained 32-sample timestamp block. All
16,660 samples arrived, timestamp coverage is complete, checksums and board
summaries agree with laptop recomputation, and there were no FIFO faults, bus
errors, or clipped samples.

It validates the acquisition path and clearly distinguishes settled from hand
motion. It does not yet validate road-surface classification because hand motion
is dominated by low frequencies and the sensor was not rigidly mounted to a
rolling skateboard.

## Timing and integrity

| Measurement | Result |
| --- | ---: |
| Samples | 16,660 / 16,660 |
| Nominal duration | 10.000 s |
| Sensor timestamp cadence | 1,666.67 Hz |
| Timestamp block duration | 19.2 ms |
| Timestamp blocks | 521 (520 expected, accepted startup phase +1) |
| Minimum / maximum timestamp delta | 768 / 768 ticks |
| Timestamp-block variation | 0 ticks |
| FIFO faults / bus errors | 0 / 0 |
| Clipped samples | 0 |
| Peak acceleration-vector magnitude | 3.596 g |
| Largest board/laptop summary difference | 0.000000119 g |

The 10.119 s board completion time includes FIFO draining and stop latency. It
is not the sensor sample clock. The sensor-generated timestamps provide the
cadence result above. Timing is audited per 32-sample block; individual-sample
jitter is not retained.

## Settled versus hand motion

The requested five-second boundary was gradual in the data: small movement
starts near 4 s and strong repeated motion starts around 5.8 s. Comparing a
clean settled interval (0–4 s) with strong motion (6–10 s):

| Measurement | Settled 0–4 s | Strong motion 6–10 s |
| --- | ---: | ---: |
| Vector RMS around mean | 0.0141 g | 1.4608 g |
| Median deviation | 0.0094 g | 1.2027 g |
| 95th percentile deviation | 0.0229 g | 2.5661 g |
| Peak deviation | 0.1072 g | 3.4187 g |
| AC energy above 25 Hz | 0.0072 g RMS | 0.2178 g RMS |

Strong-motion RMS is about 104 times the settled value (about 40.3 dB). Energy
above 25 Hz is about 30 times the settled high-frequency floor. The dominant
hand-motion component is around 8.13 Hz, followed by harmonics near 16.27,
24.40, 32.54, and 40.67 Hz. About 97.1% of strong-motion AC power lies from
5–25 Hz; only 2.2% lies above 25 Hz. This test therefore proves clean high-rate
capture, but it does not prove that 1,666 Hz is required for pavement sensing.

The settled mean acceleration-vector magnitude is about 0.95 g rather than
1.00 g. A stationary six-orientation calibration should measure scale and
offset before fixed road-quality thresholds are chosen.

## Transfer and storage

| Measurement | Result |
| --- | ---: |
| Raw payload | 99,960 bytes |
| Summary payload | 1,224 bytes |
| Saved file | 102,880 bytes |
| BLE retrieval | 62.04 s |
| Useful payload throughput | about 1.63 kB/s |
| Raw generation rate | about 10.00 kB/s |
| Projected raw hour | 35.99 MB |
| Projected summary hour | 0.43 MB |

The current browser request/read protocol cannot drain raw 1,666 Hz data while
recording: generation is about 6.1 times faster than measured retrieval. At the
same rate, one hour of raw data would take roughly 6.1 hours to retrieve.

Normal ride mode should compute filtered roughness features on the XIAO and send
small timestamped summaries to the phone. Raw research mode should write to
local persistent storage or use a redesigned BLE notification stream with
measured acknowledgements and buffering. Compact summaries already fit easily
within the measured BLE throughput.

## Recommended next tests

1. Perform a six-face stationary calibration to estimate acceleration offsets
   and scale.
2. Rigidly fasten the sensor and XIAO to the skateboard. Loose jumper wires and
   hand holding make vibration measurements hard to reproduce.
3. Record labelled passes over smooth pavement, rough pavement, paving joints,
   and one isolated bump at similar speed.
4. Record the same surface at several speeds. Save phone GPS speed alongside
   each segment.
5. Compare 833 and 1,666 Hz on the same route. If little useful road energy is
   present above roughly 350–400 Hz, 833 Hz halves raw storage and bandwidth.
6. Evaluate band-limited features such as 20–50, 50–100, 100–200, and 200–400 Hz
   RMS. These reject much of tilt, carving, and hand motion that contaminates
   the current broadband 200 ms RMS.
