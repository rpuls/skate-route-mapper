import test from "node:test";
import assert from "node:assert/strict";
import { crc32, command, startArgument, parseResponse, parseStatus, analyzeCapture, encodeRecording, decodeRecording } from "../shared/src/xiaoResearch.mjs";

function fixture() {
  const scale = Math.fround(0.000488), raw = new Uint8Array(334 * 6), v = new DataView(raw.buffer);
  for (let i = 0; i < 334; i++) v.setInt16(i * 6 + 4, 2048, true);
  v.setInt16(167 * 6, 32767, true); // One known impulse in the second window.
  const summaries = new Uint8Array(48), s = new DataView(summaries.buffer);
  const base = 2048 * scale, impulse = 32767 * scale, peak = Math.hypot(base, impulse);
  for (let window = 0; window < 2; window++) {
    const offset = window * 24;
    s.setUint32(offset, window * 167, true); s.setUint32(offset + 4, 167, true);
    s.setFloat32(offset + 8, window ? impulse * Math.sqrt(166) / 167 : 0, true);
    s.setFloat32(offset + 12, window ? peak : base, true);
    s.setFloat32(offset + 16, window ? (base * 166 + peak) / 167 : base, true);
    s.setUint32(offset + 20, window ? 1 : 0, true);
  }
  const meta = { captureId: 42, state: 2, error: 0, rateHz: 833, windowSamples: 167, count: 334, target: 334,
    windows: 2, scaleG: scale, elapsedUs: 400960, overruns: 0, busErrors: 0, clipped: 1,
    rawCrc: crc32(raw), summariesCrc: crc32(summaries) };
  return { meta, raw, summaries };
}
test("CRC32 matches the published check vector", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});
test("commands preserve unsigned capture identifiers and offsets", () => {
  const bytes = command(3, 65535, 0xffffffff, 49920), v = new DataView(bytes.buffer);
  assert.equal(bytes.length, 12); assert.equal(v.getUint16(2, true), 65535);
  assert.equal(v.getUint32(4, true), 0xffffffff); assert.equal(v.getUint32(8, true), 49920);
});
test("start command packs duration and selectable ODR", () => {
  assert.equal(startArgument(10, 1666), (1666 << 16) | 10);
  assert.throws(() => startArgument(10, 1000), /Unsupported/);
});
test("extended status exposes sensor timestamp cadence", () => {
  const payload = new Uint8Array(96), v = new DataView(payload.buffer);
  payload[0] = 2; v.setUint16(2, 6, true); v.setUint32(4, 1666, true);
  v.setUint32(8, 16660, true); v.setUint32(12, 16660, true); v.setUint32(16, 51, true);
  v.setUint32(20, 99960, true); v.setUint32(28, 10000000, true); v.setUint32(52, 333, true);
  v.setFloat32(56, 0.000488, true); v.setUint32(64, 520, true); v.setUint32(76, 767, true);
  v.setUint32(80, 769, true); v.setFloat32(84, 768.3, true); v.setFloat32(88, 0.4, true); v.setUint32(92, 32, true);
  const status = parseStatus({ op: 1, captureId: 9, payload });
  assert.equal(status.rateHz, 1666); assert.equal(status.timestampDecimation, 32);
  assert.equal(status.timestampCount, 520);
});
test("pages validate identity fields, length and corruption", () => {
  const bytes = new Uint8Array(30), v = new DataView(bytes.buffer);
  v.setUint16(0, 0x5253, true); bytes[2] = 1; bytes[3] = 3;
  v.setUint16(4, 7, true); v.setUint32(8, 42, true); v.setUint32(12, 64, true);
  v.setUint16(16, 1, true); v.setUint16(18, 6, true);
  v.setUint32(26, crc32(bytes.subarray(0, 26)), true);
  const parsed = parseResponse(bytes);
  assert.equal(parsed.captureId, 42); assert.equal(parsed.offset, 64); assert.equal(parsed.count, 1);
  assert.throws(() => parseResponse(bytes.slice(0, -1)), /Truncated/);
  bytes[20] ^= 1; assert.throws(() => parseResponse(bytes), /checksum/);
});
test("rest plus known impulse produce matching on-board summaries and size projections", () => {
  const { meta, raw, summaries } = fixture();
  const report = analyzeCapture(meta, raw, summaries);
  assert.equal(report.complete, true); assert.equal(report.summariesMatchRaw, true);
  assert.equal(report.clippedSamples, 1); assert.equal(report.rawBytes, 2004);
  assert.equal(report.summaryBytes, 48); assert.equal(report.rawBytesPerHour, 17992800);
  assert.equal(report.rateWithinTolerance, true);
  assert.equal(analyzeCapture({ ...meta, elapsedUs: 800000 }, raw, summaries).rateWithinTolerance, false);
});
test("sensor timestamp rate is kept separate from board completion rate", () => {
  const { meta, raw, summaries } = fixture();
  const timed = { ...meta, timestampCount: 11, timestampDecimation: 32,
    minTimestampDeltaTicks: 1536, maxTimestampDeltaTicks: 1538,
    meanTimestampDeltaTicks: 1536.6, stdTimestampDeltaTicks: 0.5 };
  const report = analyzeCapture(timed, raw, summaries);
  assert.equal(report.sensorTimingMeasured, true);
  assert.ok(Math.abs(report.sensorTimestampRateHz - 833) < 1);
  assert.notEqual(report.sensorTimestampRateHz, report.boardCompletionRate);
});
test("saved container round trips both datasets and rejects corrupted raw data", () => {
  const { meta, raw, summaries } = fixture(), bytes = encodeRecording(meta, raw, summaries);
  const decoded = decodeRecording(bytes);
  assert.deepEqual(decoded.raw, raw); assert.deepEqual(decoded.summaries, summaries);
  bytes[bytes.length - summaries.length - 1] ^= 1;
  assert.throws(() => decodeRecording(bytes), /checksum/);
});
test("truncated files, overlapping summaries and incomplete captures are not passed", () => {
  const { meta, raw, summaries } = fixture();
  assert.throws(() => decodeRecording(encodeRecording(meta, raw, summaries).slice(0, -6)), /layout/);
  assert.equal(analyzeCapture({ ...meta, state: 3, error: 3, overruns: 1 }, raw, summaries).complete, false);
  new DataView(summaries.buffer).setUint32(24, 166, true);
  assert.throws(() => analyzeCapture({ ...meta, summariesCrc: crc32(summaries) }, raw, summaries), /gap or overlap/);
});
test("incorrect RMS is detected even when transport checksums match", () => {
  const { meta, raw, summaries } = fixture();
  new DataView(summaries.buffer).setFloat32(8, 2, true);
  assert.equal(analyzeCapture({ ...meta, summariesCrc: crc32(summaries) }, raw, summaries).summariesMatchRaw, false);
});
