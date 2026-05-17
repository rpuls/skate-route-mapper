import fs from "node:fs";

const filePath = process.argv[2];
const candidateThresholds = [0.22, 0.55, 0.85, 1.20, 1.55];
const rawBurstHighPassHalfWindow = 20;
const rawBurstActivityWindowSec = 0.25;
const rawBurstPeakThresholdG = 0.12;
const rawBurstPeakMinSeparationSec = 0.045;

if (!filePath) {
  console.error("Usage: node scripts/analyze-experimental-captures.mjs <csv-file>");
  process.exit(1);
}

const csv = fs.readFileSync(filePath, "utf8").trim();
const rows = parseCsv(csv);

if (rows.length === 0) {
  console.error("No rows found.");
  process.exit(1);
}

const captures = rows.flatMap((row, index) => {
  const payloadIndex = row.findIndex((field) => {
    const trimmed = field.trim();
    return trimmed.startsWith("{") && trimmed.endsWith("}");
  });

  if (payloadIndex < 0) {
    return [];
  }

  return [{
    row: index + 1,
    id: row[0] ?? null,
    userId: row[1] ?? null,
    createdAt: row[payloadIndex + 1] ?? row[row.length - 1] ?? null,
    payload: JSON.parse(row[payloadIndex]),
  }];
});

if (captures.length === 0) {
  console.error("No JSON payload rows found.");
  process.exit(1);
}

const allFrames = [];

for (const capture of captures) {
  const frames = Array.isArray(capture.payload.frames) ? capture.payload.frames : [];
  const rawBurstSamples = Array.isArray(capture.payload.rawBurst?.samples)
    ? capture.payload.rawBurst.samples
    : [];
  const levelCounts = countBy(frames, (frame) => frame.roughnessLevel);
  const contactCounts = countBy(frames, classifyContact);
  const sequenceGaps = countSequenceGaps(frames);

  for (const frame of frames) {
    allFrames.push({
      ...frame,
      captureRow: capture.row,
      subjectiveRoughnessLevel: capture.payload.subjectiveRoughnessLevel,
      label: capture.payload.label,
      notes: capture.payload.notes,
    });
  }

  console.log(`Capture ${capture.row}: ${capture.payload.label ?? "(no label)"}`);
  console.log(`  id=${capture.id ?? "-"} createdAt=${capture.createdAt ?? "-"}`);
  console.log(`  notes=${capture.payload.notes ?? "-"}`);
  console.log(`  captureType=${capture.payload.captureType ?? "-"}`);
  console.log(
    `  subjective=${capture.payload.subjectiveRoughnessLevel ?? "-"} durationMs=${capture.payload.durationMs ?? "-"} frames=${frames.length} rawBurstSamples=${rawBurstSamples.length}`
  );

  if (frames.length > 0) {
    console.log(
      `  levels=${formatCounts(levelCounts)} contact=${formatCounts(contactCounts)} sequenceGaps=${sequenceGaps}`
    );
    printMetric("accelRms", frames.map((frame) => frame.accelRms));
    printMetric("accelPeakToPeak", frames.map((frame) => frame.accelPeakToPeak));
    printMetric("estimatedScoreNoJerk", frames.map(estimateScoreNoJerk));
    printMetric("rawSampleCount", frames.map((frame) => frame.rawSampleCount));
    printMetric("windowMs", frames.map((frame) => frame.windowMs));
    console.log(`  firstLevels=${frames.slice(0, 16).map((frame) => frame.roughnessLevel).join(",")}`);
  }

  if (rawBurstSamples.length > 0) {
    printRawBurstSummary(capture.payload.rawBurst, rawBurstSamples);
  }

  console.log("");
}

if (captures.length > 1) {
  console.log("Aggregate");
  console.log(`  captures=${captures.length} frames=${allFrames.length}`);
  console.log(`  levels=${formatCounts(countBy(allFrames, (frame) => frame.roughnessLevel))}`);
  console.log(`  contact=${formatCounts(countBy(allFrames, classifyContact))}`);
  printMetric("accelRms", allFrames.map((frame) => frame.accelRms));
  printMetric("accelPeakToPeak", allFrames.map((frame) => frame.accelPeakToPeak));
  printMetric("estimatedScoreNoJerk", allFrames.map(estimateScoreNoJerk));
  console.log("");

  console.log("By subjective level");
  const groups = groupBy(allFrames, (frame) => frame.subjectiveRoughnessLevel ?? "none");
  for (const [level, frames] of [...groups.entries()].sort(([a], [b]) => Number(a) - Number(b))) {
    console.log(`  Subjective ${level}: frames=${frames.length}`);
    printMetric("  accelRms", frames.map((frame) => frame.accelRms));
    printMetric("  accelPeakToPeak", frames.map((frame) => frame.accelPeakToPeak));
    printMetric("  estimatedScoreNoJerk", frames.map(estimateScoreNoJerk));
    console.log(`    firmwareLevels=${formatCounts(countBy(frames, (frame) => frame.roughnessLevel))}`);
    console.log(`    candidateLevels=${formatCounts(countBy(frames, candidateLevelForFrame))}`);
    console.log(`    contact=${formatCounts(countBy(frames, classifyContact))}`);
  }
}

function parseCsv(value) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    const next = value[index + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        index++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  row.push(field.replace(/\r$/, ""));
  rows.push(row);

  return rows.filter((candidate) => candidate.some((fieldValue) => fieldValue.length > 0));
}

function printMetric(name, values) {
  const stats = describe(values);
  if (!stats) {
    console.log(`  ${name}: n=0`);
    return;
  }

  console.log(
    `  ${name}: n=${stats.n} min=${formatNumber(stats.min)} p10=${formatNumber(stats.p10)} p25=${formatNumber(stats.p25)} median=${formatNumber(stats.median)} p75=${formatNumber(stats.p75)} p90=${formatNumber(stats.p90)} p95=${formatNumber(stats.p95)} max=${formatNumber(stats.max)} mean=${formatNumber(stats.mean)} sd=${formatNumber(stats.sd)}`
  );
}

function printRawBurstSummary(rawBurst, samples) {
  const sortedSamples = [...samples].sort((left, right) => left.sampleIndex - right.sampleIndex);
  const first = sortedSamples[0];
  const last = sortedSamples[sortedSamples.length - 1];
  const durationUs = first && last ? Math.max(0, last.offsetUs - first.offsetUs) : 0;
  const sampleRateHz = durationUs > 0 ? ((sortedSamples.length - 1) * 1000000) / durationUs : 0;
  const sampleGaps = countSequenceGapsBy(sortedSamples, (sample) => sample.sampleIndex);
  const timingGaps = rawBurstTimingGaps(sortedSamples);
  const derived = deriveRawBurstSignals(sortedSamples);
  const activeWindows = topRawBurstActivityWindows(derived);
  const peaks = rawBurstPeaks(derived, rawBurstPeakThresholdG, rawBurstPeakMinSeparationSec);

  console.log(
    `  rawBurst status=${rawBurst?.status?.status ?? "-"} captureId=${rawBurst?.status?.captureId ?? "-"} packets=${sortedSamples.length} sampleGaps=${sampleGaps} estimatedHz=${formatNumber(sampleRateHz)}`
  );
  console.log(
    `  rawBurst spanSec=${formatNumber(durationUs / 1000000)} timingGaps=${timingGaps.length} firstGapTimes=${timingGaps.slice(0, 8).map((gap) => `${formatNumber(gap.atSec)}s/${formatNumber(gap.deltaUs / 1000)}ms`).join(",") || "-"}`
  );
  printMetric("raw.ax", sortedSamples.map((sample) => sample.ax));
  printMetric("raw.ay", sortedSamples.map((sample) => sample.ay));
  printMetric("raw.az", sortedSamples.map((sample) => sample.az));
  printMetric("raw.gx", sortedSamples.map((sample) => sample.gx));
  printMetric("raw.gy", sortedSamples.map((sample) => sample.gy));
  printMetric("raw.gz", sortedSamples.map((sample) => sample.gz));
  printMetric("raw.accelMagnitude", derived.map((sample) => sample.accelMagnitude));
  printMetric("raw.highPassAbs", derived.map((sample) => sample.highPassAbs));
  printMetric("raw.offsetDeltaUs", offsetDeltas(sortedSamples));
  console.log(
    `  raw.highPassPeaks threshold=${formatNumber(rawBurstPeakThresholdG)}g minSep=${formatNumber(rawBurstPeakMinSeparationSec)}s count=${peaks.length} firstTimes=${peaks.slice(0, 32).map((peak) => formatNumber(peak.timeSec)).join(",") || "-"}`
  );
  console.log("  raw.topActivityWindows");
  for (const window of activeWindows.slice(0, 8)) {
    console.log(
      `    ${formatNumber(window.startSec)}-${formatNumber(window.endSec)}s n=${window.count} hpRms=${formatNumber(window.highPassRms)} hpP2p=${formatNumber(window.highPassPeakToPeak)} magP2p=${formatNumber(window.magnitudePeakToPeak)}`
    );
  }
}

function describe(values) {
  const numbers = values
    .filter((value) => typeof value === "number" && Number.isFinite(value))
    .sort((left, right) => left - right);

  if (numbers.length === 0) return null;

  const total = numbers.reduce((sum, value) => sum + value, 0);
  const mean = total / numbers.length;
  const variance =
    numbers.reduce((sum, value) => sum + (value - mean) ** 2, 0) / numbers.length;

  return {
    n: numbers.length,
    min: numbers[0],
    p10: percentile(numbers, 0.1),
    p25: percentile(numbers, 0.25),
    median: percentile(numbers, 0.5),
    p75: percentile(numbers, 0.75),
    p90: percentile(numbers, 0.9),
    p95: percentile(numbers, 0.95),
    max: numbers[numbers.length - 1],
    mean,
    sd: Math.sqrt(variance),
  };
}

function percentile(sortedNumbers, fraction) {
  if (sortedNumbers.length === 1) return sortedNumbers[0];
  const index = (sortedNumbers.length - 1) * fraction;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  return sortedNumbers[lower] * (1 - weight) + sortedNumbers[upper] * weight;
}

function classifyContact(frame) {
  if (frame.accelRms >= 0.035 || frame.accelPeakToPeak >= 0.12) return "grounded";
  if (frame.accelRms <= 0.018 && frame.accelPeakToPeak <= 0.07) return "airborne";
  return "unknown";
}

function estimateScoreNoJerk(frame) {
  return frame.accelRms * 0.55 + Math.min(3, frame.accelPeakToPeak) * 0.08;
}

function candidateLevelForFrame(frame) {
  const score = estimateScoreNoJerk(frame);
  if (score < candidateThresholds[0]) return 1;
  if (score < candidateThresholds[1]) return 2;
  if (score < candidateThresholds[2]) return 3;
  if (score < candidateThresholds[3]) return 4;
  if (score < candidateThresholds[4]) return 5;
  return 6;
}

function countSequenceGaps(frames) {
  return countSequenceGapsBy(frames, (frame) => frame.sequence);
}

function countSequenceGapsBy(values, getSequence) {
  let gaps = 0;
  for (let index = 1; index < values.length; index++) {
    if (getSequence(values[index]) !== getSequence(values[index - 1]) + 1) {
      gaps++;
    }
  }
  return gaps;
}

function offsetDeltas(samples) {
  const deltas = [];
  for (let index = 1; index < samples.length; index++) {
    deltas.push(samples[index].offsetUs - samples[index - 1].offsetUs);
  }
  return deltas;
}

function rawBurstTimingGaps(samples) {
  const gaps = [];
  for (let index = 1; index < samples.length; index++) {
    const previous = samples[index - 1];
    const current = samples[index];
    const deltaUs = current.offsetUs - previous.offsetUs;
    const skippedSamples = current.sampleIndex - previous.sampleIndex - 1;
    if (skippedSamples > 0 || deltaUs > 20000) {
      gaps.push({
        atSec: current.offsetUs / 1000000,
        deltaUs,
        skippedSamples,
      });
    }
  }
  return gaps;
}

function deriveRawBurstSignals(samples) {
  const magnitudes = samples.map((sample) => (
    Math.sqrt(sample.ax * sample.ax + sample.ay * sample.ay + sample.az * sample.az)
  ));
  const baseline = movingAverage(magnitudes, rawBurstHighPassHalfWindow);

  return samples.map((sample, index) => {
    const highPass = magnitudes[index] - baseline[index];
    return {
      ...sample,
      timeSec: sample.offsetUs / 1000000,
      accelMagnitude: magnitudes[index],
      highPass,
      highPassAbs: Math.abs(highPass),
    };
  });
}

function movingAverage(values, halfWindow) {
  return values.map((_, index) => {
    const start = Math.max(0, index - halfWindow);
    const end = Math.min(values.length - 1, index + halfWindow);
    let sum = 0;
    for (let cursor = start; cursor <= end; cursor++) {
      sum += values[cursor];
    }
    return sum / (end - start + 1);
  });
}

function topRawBurstActivityWindows(samples) {
  if (samples.length === 0) return [];

  const windows = [];
  const startSec = samples[0].timeSec;
  const endSec = samples[samples.length - 1].timeSec;

  for (
    let windowStartSec = startSec;
    windowStartSec < endSec;
    windowStartSec += rawBurstActivityWindowSec
  ) {
    const windowEndSec = windowStartSec + rawBurstActivityWindowSec;
    const values = samples.filter((sample) => (
      sample.timeSec >= windowStartSec && sample.timeSec < windowEndSec
    ));

    if (values.length === 0) {
      continue;
    }

    const highPassValues = values.map((sample) => sample.highPass);
    const magnitudeValues = values.map((sample) => sample.accelMagnitude);
    const highPassRms = Math.sqrt(
      highPassValues.reduce((sum, value) => sum + value * value, 0) / highPassValues.length
    );

    windows.push({
      startSec: windowStartSec,
      endSec: windowEndSec,
      count: values.length,
      highPassRms,
      highPassPeakToPeak: Math.max(...highPassValues) - Math.min(...highPassValues),
      magnitudePeakToPeak: Math.max(...magnitudeValues) - Math.min(...magnitudeValues),
    });
  }

  return windows.sort((left, right) => right.highPassRms - left.highPassRms);
}

function rawBurstPeaks(samples, threshold, minSeparationSec) {
  const peaks = [];
  let lastPeakTimeSec = -Infinity;

  for (let index = 1; index < samples.length - 1; index++) {
    const previous = samples[index - 1];
    const current = samples[index];
    const next = samples[index + 1];

    if (
      current.highPassAbs >= threshold &&
      current.highPassAbs >= previous.highPassAbs &&
      current.highPassAbs > next.highPassAbs &&
      current.timeSec - lastPeakTimeSec >= minSeparationSec
    ) {
      peaks.push(current);
      lastPeakTimeSec = current.timeSec;
    }
  }

  return peaks;
}

function countBy(values, getKey) {
  const counts = new Map();
  for (const value of values) {
    const key = String(getKey(value));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function groupBy(values, getKey) {
  const groups = new Map();
  for (const value of values) {
    const key = String(getKey(value));
    const group = groups.get(key) ?? [];
    group.push(value);
    groups.set(key, group);
  }
  return groups;
}

function formatCounts(counts) {
  if (counts.size === 0) return "-";
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
    .map(([key, count]) => `${key}:${count}`)
    .join(" ");
}

function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}
