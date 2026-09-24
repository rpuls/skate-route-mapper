// Desk-research protocol v1. Independent of the legacy 20-byte preview protocol.
export const RESEARCH_CONTROL_UUID = "7b32f8d3-5d0b-4f0e-a1f5-8f30c44c0001";
export const RESEARCH_RESPONSE_UUID = "7b32f8d4-5d0b-4f0e-a1f5-8f30c44c0001";
export const OP = Object.freeze({ STATUS: 1, START: 2, RAW: 3, SUMMARIES: 4 });
export const STATE_NAMES = ["Idle", "Recording on board", "Complete", "Capture failed"];
export const ERROR_NAMES = ["None", "Insufficient memory", "Sensor bus error", "FIFO full / overflow", "Unexpected FIFO tag", "Sampling timeout"];
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (~crc) >>> 0;
}
const view = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
export function command(op, request, captureId = 0, arg = 0) {
  const bytes = new Uint8Array(12), v = view(bytes);
  bytes[0] = 1; bytes[1] = op; v.setUint16(2, request, true);
  v.setUint32(4, captureId, true); v.setUint32(8, arg, true);
  return bytes;
}
export function startArgument(seconds, rateHz) {
  if (![10, 30, 60].includes(seconds) || ![833, 1666].includes(rateHz)) throw new Error("Unsupported research capture request");
  return ((rateHz << 16) | seconds) >>> 0;
}
export function parseResponse(bytes) {
  if (bytes.length < 24) throw new Error("Incomplete research response");
  const v = view(bytes), payloadBytes = v.getUint16(18, true);
  if (v.getUint16(0, true) !== 0x5253 || bytes[2] !== 1) throw new Error("Unknown research protocol");
  if (bytes.length !== 24 + payloadBytes) throw new Error("Truncated research page");
  if (crc32(bytes.subarray(0, bytes.length - 4)) !== v.getUint32(bytes.length - 4, true)) throw new Error("Research page checksum mismatch");
  return { op: bytes[3], request: v.getUint16(4, true), flags: v.getUint16(6, true),
    captureId: v.getUint32(8, true), offset: v.getUint32(12, true), count: v.getUint16(16, true),
    payload: bytes.slice(20, 20 + payloadBytes) };
}
export function parseStatus(response) {
  if (![OP.STATUS, OP.START].includes(response.op) || ![64, 96].includes(response.payload.length)) throw new Error("Invalid research status");
  const v = view(response.payload);
  const status = { captureId: response.captureId, state: v.getUint8(0), error: v.getUint8(1), rawStride: v.getUint16(2, true),
    rateHz: v.getUint32(4, true), count: v.getUint32(8, true), target: v.getUint32(12, true),
    windows: v.getUint32(16, true), capacity: v.getUint32(20, true), startedMs: v.getUint32(24, true),
    elapsedUs: v.getUint32(28, true), overruns: v.getUint32(32, true), busErrors: v.getUint32(36, true),
    clipped: v.getUint32(40, true), rawCrc: v.getUint32(44, true), summariesCrc: v.getUint32(48, true),
    windowSamples: v.getUint32(52, true), scaleG: v.getFloat32(56, true), freeHeap: v.getUint32(60, true) };
  if (response.payload.length === 96) Object.assign(status, {
    timestampCount: v.getUint32(64, true), firstSensorTimestamp: v.getUint32(68, true), lastSensorTimestamp: v.getUint32(72, true),
    minTimestampDeltaTicks: v.getUint32(76, true), maxTimestampDeltaTicks: v.getUint32(80, true),
    meanTimestampDeltaTicks: v.getFloat32(84, true), stdTimestampDeltaTicks: v.getFloat32(88, true),
    timestampDecimation: v.getUint32(92, true)
  });
  if (status.state > 3 || status.rawStride !== 6 || ![833, 1666].includes(status.rateHz) ||
      status.windowSamples !== Math.round(status.rateHz / 5) || status.count > status.capacity ||
      status.capacity > 1666 * 60 || status.target > 1666 * 60 ||
      !Number.isFinite(status.scaleG) || Math.abs(status.scaleG - 0.000488) > 1e-9) throw new Error("Unsupported research capture configuration");
  return status;
}
export function summaryRows(bytes) {
  if (bytes.length % 24) throw new Error("Incomplete summary record");
  const v = view(bytes), rows = [];
  for (let i = 0; i < bytes.length; i += 24) rows.push({ first: v.getUint32(i, true), count: v.getUint32(i + 4, true),
    rmsG: v.getFloat32(i + 8, true), peakNormG: v.getFloat32(i + 12, true), meanNormG: v.getFloat32(i + 16, true), clipped: v.getUint32(i + 20, true) });
  return rows;
}
export function computeSummary(raw, scale, first, count) {
  const v = view(raw), mean = [0, 0, 0], m2 = [0, 0, 0];
  let peakNormG = 0, sumNorm = 0, clipped = 0;
  for (let n = 0; n < count; n++) {
    let norm2 = 0, clip = false;
    for (let axis = 0; axis < 3; axis++) {
      const value = v.getInt16((first + n) * 6 + axis * 2, true), g = value * scale;
      clip ||= Math.abs(value) >= 32760;
      const delta = g - mean[axis]; mean[axis] += delta / (n + 1); m2[axis] += delta * (g - mean[axis]);
      norm2 += g * g;
    }
    const norm = Math.sqrt(norm2); sumNorm += norm; peakNormG = Math.max(peakNormG, norm);
    if (clip) clipped++;
  }
  return { first, count, rmsG: Math.sqrt(m2.reduce((a, b) => a + b, 0) / count), peakNormG, meanNormG: sumNorm / count, clipped };
}
export function analyzeCapture(meta, raw, summaries) {
  if (![833, 1666].includes(meta.rateHz) || meta.windowSamples !== Math.round(meta.rateHz / 5) || !Number.isFinite(meta.scaleG) || meta.scaleG <= 0 ||
      ![2, 3].includes(meta.state) || !meta.count || meta.count > 99960 || !Number.isFinite(meta.elapsedUs) || meta.elapsedUs <= 0 ||
      raw.length !== meta.count * 6 || summaries.length !== meta.windows * 24) throw new Error("Capture lengths or metadata are invalid");
  if (crc32(raw) !== meta.rawCrc || crc32(summaries) !== meta.summariesCrc) throw new Error("Recording checksum mismatch");
  const rows = summaryRows(summaries);
  let expected = 0, maxSummaryErrorG = 0, totalClipped = 0;
  for (const row of rows) {
    if (row.first !== expected || row.count !== Math.min(meta.windowSamples, meta.count - expected) || row.count <= 0) throw new Error("Summary coverage has a gap or overlap");
    const computed = computeSummary(raw, meta.scaleG, row.first, row.count);
    for (const key of ["rmsG", "peakNormG", "meanNormG"]) {
      if (!Number.isFinite(row[key])) throw new Error("Non-finite summary");
      maxSummaryErrorG = Math.max(maxSummaryErrorG, Math.abs(row[key] - computed[key]));
    }
    if (row.clipped !== computed.clipped) throw new Error("Summary clipping count mismatch");
    totalClipped += row.clipped; expected += row.count;
  }
  if (expected !== meta.count || totalClipped !== meta.clipped) throw new Error("Incomplete summary coverage");
  const observedSeconds = meta.elapsedUs / 1e6;
  const nominalSeconds = meta.count / meta.rateHz;
  const boardCompletionRate = meta.count / observedSeconds;
  const timestampTimingValid = meta.timestampCount >= 2 && meta.timestampDecimation > 0 &&
    Number.isFinite(meta.meanTimestampDeltaTicks) && meta.meanTimestampDeltaTicks > 0 &&
    meta.minTimestampDeltaTicks > 0 && meta.maxTimestampDeltaTicks >= meta.minTimestampDeltaTicks;
  const sensorTimestampRateHz = timestampTimingValid ? meta.timestampDecimation * 40000 / meta.meanTimestampDeltaTicks : null;
  const sensorBlockMinRateHz = timestampTimingValid ? meta.timestampDecimation * 40000 / meta.maxTimestampDeltaTicks : null;
  const sensorBlockMaxRateHz = timestampTimingValid ? meta.timestampDecimation * 40000 / meta.minTimestampDeltaTicks : null;
  const sensorTimingExpected = Number.isInteger(meta.timestampCount);
  const expectedTimestampCount = timestampTimingValid ? Math.floor(meta.count / meta.timestampDecimation) : null;
  const timestampCoverageGood = timestampTimingValid && Math.abs(meta.timestampCount - expectedTimestampCount) <= 2;
  const timingChecksPassed = !sensorTimingExpected || (timestampTimingValid && timestampCoverageGood);
  const rateForCheck = sensorTimestampRateHz ?? boardCompletionRate;
  return {
    complete: meta.state === 2 && meta.error === 0 && meta.count === meta.target && meta.overruns === 0 && meta.busErrors === 0,
    samples: meta.count, windows: meta.windows, nominalSeconds, observedSeconds,
    observedSamplesPerSecond: boardCompletionRate, boardCompletionRate,
    sensorTimestampRateHz, sensorBlockMinRateHz, sensorBlockMaxRateHz,
    sensorBlockStdPercent: timestampTimingValid ? meta.stdTimestampDeltaTicks / meta.meanTimestampDeltaTicks * 100 : null,
    sensorTimingMeasured: timestampTimingValid, timestampCoverageGood, timingChecksPassed,
    timestampCount: meta.timestampCount ?? null, expectedTimestampCount,
    timestampBlockMilliseconds: timestampTimingValid ? meta.meanTimestampDeltaTicks / 40 : null,
    rateWithinTolerance: timingChecksPassed && Math.abs(rateForCheck / meta.rateHz - 1) <= 0.05,
    rawBytes: raw.length, summaryBytes: summaries.length,
    rawBytesPerHour: meta.rateHz * 6 * 3600,
    summaryBytesPerHour: meta.rateHz / meta.windowSamples * 24 * 3600,
    reductionFactor: raw.length / summaries.length,
    maxSummaryErrorG, summariesMatchRaw: maxSummaryErrorG < 0.00001, clippedSamples: totalClipped,
    note: timestampTimingValid
      ? "Sensor cadence uses LSM6DSOX 25 microsecond timestamps over batched sample blocks; individual sample jitter and GPS clock alignment are not measured."
      : "Hour figures project compact payload size, not proven recording duration or BLE throughput. This older capture has no sensor timing evidence."
  };
}
const MAGIC = new TextEncoder().encode("SKATER01");
export function encodeRecording(meta, raw, summaries) {
  const report = analyzeCapture(meta, raw, summaries);
  const header = new TextEncoder().encode(JSON.stringify({ format: "skate-research-v1", ...meta, report }));
  const output = new Uint8Array(12 + header.length + raw.length + summaries.length);
  output.set(MAGIC); view(output).setUint32(8, header.length, true);
  output.set(header, 12); output.set(raw, 12 + header.length); output.set(summaries, 12 + header.length + raw.length);
  return output;
}
// The header alone, for a reader that wants what the phone recorded about a
// capture without paying for the sample block. Same framing and same checks as
// a full decode, so a file either reads here and there or in neither place.
export function decodeRecordingHeader(bytes) {
  if (bytes.length < 12 || MAGIC.some((v, i) => bytes[i] !== v)) throw new Error("Not a skate research recording");
  const headerLength = view(bytes).getUint32(8, true);
  if (headerLength > 65536 || bytes.length < 12 + headerLength) throw new Error("Invalid recording header length");
  const meta = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + headerLength)));
  if (meta.format !== "skate-research-v1" || !Number.isInteger(meta.count) || meta.count < 0 || meta.count > 99960 ||
      !Number.isInteger(meta.windows) || meta.windows < 0 || meta.windows > 301 ||
      bytes.length !== 12 + headerLength + meta.count * 6 + meta.windows * 24) throw new Error("Invalid recording layout");
  return { meta, headerLength };
}
export function decodeRecording(bytes) {
  const { meta, headerLength } = decodeRecordingHeader(bytes);
  const raw = bytes.slice(12 + headerLength, 12 + headerLength + meta.count * 6);
  const summaries = bytes.slice(12 + headerLength + meta.count * 6);
  return { meta, raw, summaries, report: analyzeCapture(meta, raw, summaries) };
}
