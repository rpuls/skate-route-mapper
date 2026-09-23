# Research recording 456633385

## Conclusion

This is a valid and useful first high-rate capture. The file contains all 8,330
expected samples, its raw and summary checksums pass, the sensor FIFO reported
no overflow, the I2C bus reported no errors, and no acceleration channel
clipped. The board summaries independently match summaries recalculated from
the raw samples.

The recording demonstrates that the XIAO/LSM6DSOX path captures substantial
motion above 25 Hz, which the previous 50 samples/s stream cannot represent
without aliasing. It does not yet demonstrate that different road surfaces can
be classified. That requires controlled, labelled recordings with the sensor
rigidly mounted on the skate and speed recorded.

## Direct answers

### Is the recording complete for ten seconds?

Yes, according to every integrity signal currently available:

- Target and captured samples: 8,330 / 8,330.
- Nominal duration: 10.000 seconds at 833 samples/s.
- Board elapsed time: 10.121263 seconds.
- FIFO overflow count: 0.
- Sensor-bus error count: 0.
- Raw and summary CRC32 checksums: pass.
- Summary coverage: all 8,330 samples exactly once, with no gaps/overlaps.
- Adjacent identical XYZ records: only 2; longest identical run is 2 samples,
  so there is no sign of a frozen sensor register producing long repetitions.

One limitation remains: v1 stores sample indices rather than a timestamp for
each sample. Therefore the file proves the expected count and no detected FIFO
fault, but cannot independently audit the timing of every individual interval.

### How high-frequency is it really?

- Configured/nominal sample rate: 833 Hz.
- Nominal interval: 1.20048 ms.
- Theoretical Nyquist frequency: 416.5 Hz.
- Average rate from the board's total elapsed timer: 823.02 samples/s.
- Difference from nominal: -1.20%, plausible for clock/timing overhead but worth
  checking over longer recordings.
- Spectrum analysis resolution: about 0.813 Hz using 1,024-sample Welch windows.

The frequency axis is based on the nominal 833 Hz rate. Until hardware sample
timestamps are captured, all quoted frequencies inherit the roughly 1.2%
average timing difference.

### Does it contain information the old 50 Hz stream would miss?

Yes. About 28.4% of the estimated changing-signal power lies above 25 Hz. A
50 samples/s stream has a 25 Hz Nyquist limit and cannot represent that content
correctly. The high-rate recording contains measurable energy through the
25–50, 50–100, 100–200 and 200–400 Hz bands.

For the whole recording:

| Frequency band | RMS contribution | Share of changing-signal power |
| --- | ---: | ---: |
| 0–5 Hz | 0.242 g | 1.44% |
| 5–25 Hz | 1.695 g | 70.19% |
| 25–50 Hz | 0.635 g | 9.87% |
| 50–100 Hz | 0.500 g | 6.11% |
| 100–200 Hz | 0.522 g | 6.65% |
| 200–400 Hz | 0.468 g | 5.36% |
| 400–416.5 Hz | 0.126 g | 0.39% |

The strongest spectral peak is around 12.2 Hz, probably the main hand-shaking
rhythm or a mechanical response excited by it. Higher bands may contain impact
harmonics, structural resonance, sensor noise, or aliased energy. A labelled
road test is needed to learn which parts describe pavement.

As a useful sanity comparison, the quiet initial 0–0.5 seconds has about
0.0043 g RMS above 25 Hz. The active 1–5 second interval has about 1.399 g RMS
above 25 Hz, more than 300 times greater in amplitude. The initial interval is
short, so this is descriptive rather than a calibrated noise-floor test.

### Does it have enough dynamic range?

For this test, yes:

- Largest acceleration-vector magnitude: 13.64 g.
- Per-axis ranges: X -7.69 to +11.31 g; Y -5.32 to +7.42 g;
  Z -6.44 to +8.26 g.
- Clipped samples: 0 at the configured ±16 g range.

The test used much of the range without saturating it. Skate impacts may be
stronger, so clipping must remain part of every field-test report.

### Do the compact summaries preserve a useful signal?

Yes for the current RMS/peak metrics. Fifty ~200 ms summaries cover the raw
recording. Recalculation from raw samples differs from the board by at most
0.000000467 g, consistent with float rounding. Window RMS ranges from 0.0041 g
to 3.8164 g, clearly distinguishing still and forceful-motion periods.

This verifies faithful computation, not that the current RMS is the best road
roughness feature. Frequency-band summaries should be evaluated next because
surface texture can differ even when total RMS is similar.

### Is storage practical?

- Saved test file: 52,305 bytes.
- Raw samples: 49,980 bytes.
- Summaries: 1,200 bytes.
- Metadata/framing: 1,125 bytes.
- Projected one-hour raw acceleration payload: 17.993 MB.
- Projected one-hour summary payload: 0.431 MB.

One hour of compact raw acceleration is reasonable for laptop and modern phone
storage. It is not reasonable to retain in the current 60-second RAM buffer.
Raw gyro would approximately double the raw payload.

### Can BLE currently sustain an hour of raw recording?

No. This file's retrieval took 28.62 seconds for about 51 KB of raw plus
summary payload: roughly 1.8 KB/s end-to-end. Acquisition generates about
5.0 KB/s at 833 Hz for acceleration alone. The conservative request/read
protocol therefore cannot drain continuously at the production rate.

That does not affect this bounded test because acquisition finishes before
download. For long research rides we need either faster BLE batching with
measured sustained throughput, persistent storage on the device, or both.
Normal ride summaries are only about 120 bytes/s and should be easy to deliver.

## Can this measure road-surface roughness?

The hardware now passes the first prerequisite: it captures high-rate,
high-dynamic-range vibration and produces faithful compact summaries without
depending on live BLE delivery. This is materially better than the earlier
50 Hz stream for vibration research.

It has not passed the surface-discrimination test yet. Hand shaking is a broad,
large motion and is not representative of wheel-to-road vibration. Road scoring
also depends on mounting stiffness, wheel type, speed, rider movement, turns,
pushes, jumps and impacts. One unlabelled recording cannot separate these.

## Questions the next experiments should answer

1. **Repeatability:** Does the same surface at similar speed produce similar
   band energies and RMS on repeated passes?
2. **Separation:** Are smooth asphalt, rough asphalt, paving stones and tactile
   paving measurably different after accounting for speed?
3. **Mounting:** Does a rigid skate mount preserve signal while a loose mount
   creates its own resonance?
4. **Useful bandwidth:** Which frequency bands carry repeatable surface
   differences? Is 833 Hz sufficient, or does 416 Hz work just as well?
5. **Window size:** Are ~200 ms windows stable enough, or should classification
   combine them into 0.5–2 second decisions while preserving short defects?
6. **Dynamic range:** Do real skating impacts clip ±16 g?
7. **Timing:** Can sample timing be aligned to phone GPS with bounded clock
   drift over a full ride?
8. **Long capture:** Can storage/transfer retain an hour without overwriting
   unacknowledged data or exhausting battery?
9. **Feature sufficiency:** Can compact band-energy/peak features reproduce
   classifications obtained from raw research data?
10. **Confounders:** Can the algorithm identify standing still, carrying the
    skate, pushing, braking, turning and jumping instead of calling them road
    roughness?

## Recommended next data set

Before an outdoor skate, collect three labelled 30-second desk recordings with
the board held/mounted identically:

1. Completely still.
2. Repeated gentle taps at known times.
3. A small motor, electric toothbrush, or phone vibration source held against
   the same mounting surface, if available.

Then do short, repeated skating passes over two obviously different surfaces,
with a rigid mount and simple spoken/written labels. Raw research capture can
remain bounded for these trials. We should compare band energy and repeatability
before creating levels 1–5.

## Analysis method and limits

Frequency estimates use Welch power spectra: 1,024-sample Hann windows, 50%
overlap, constant detrending, with power summed across X/Y/Z. This is appropriate
for a first robust spectrum estimate but not a final classifier. Near-Nyquist
energy may include aliasing because the present sensor-filter configuration has
not yet been tuned as an anti-alias filter. Gravity remains in raw plots but
per-window means are removed for RMS/PSD calculations.

The analysis script reads the binary locally and writes only derived metrics and
plots. The raw sample array is not printed into chat.
