export const RESEARCH_CONTROL_UUID: string;
export const RESEARCH_RESPONSE_UUID: string;
export const OP: Readonly<{ STATUS: 1; START: 2; RAW: 3; SUMMARIES: 4 }>;
export const STATE_NAMES: readonly string[];
export const ERROR_NAMES: readonly string[];

export type ResearchStatus = {
  captureId: number;
  state: number;
  error: number;
  rawStride: number;
  rateHz: 833 | 1666;
  count: number;
  target: number;
  windows: number;
  capacity: number;
  startedMs: number;
  elapsedUs: number;
  overruns: number;
  busErrors: number;
  clipped: number;
  rawCrc: number;
  summariesCrc: number;
  windowSamples: number;
  scaleG: number;
  freeHeap: number;
  timestampCount?: number;
  firstSensorTimestamp?: number;
  lastSensorTimestamp?: number;
  minTimestampDeltaTicks?: number;
  maxTimestampDeltaTicks?: number;
  meanTimestampDeltaTicks?: number;
  stdTimestampDeltaTicks?: number;
  timestampDecimation?: number;
  [key: string]: unknown;
};

export type ResearchResponse = {
  op: number;
  request: number;
  flags: number;
  captureId: number;
  offset: number;
  count: number;
  payload: Uint8Array;
};

export function crc32(bytes: Uint8Array): number;
export function command(op: number, request: number, captureId?: number, arg?: number): Uint8Array;
export function startArgument(seconds: number, rateHz: number): number;
export function parseResponse(bytes: Uint8Array): ResearchResponse;
export function parseStatus(response: ResearchResponse): ResearchStatus;
export function analyzeCapture(meta: ResearchStatus, raw: Uint8Array, summaries: Uint8Array): Record<string, unknown>;
export function encodeRecording(meta: ResearchStatus & Record<string, unknown>, raw: Uint8Array, summaries: Uint8Array): Uint8Array;
export function decodeRecordingHeader(bytes: Uint8Array): {
  meta: ResearchStatus & Record<string, unknown>;
  headerLength: number;
};
export function decodeRecording(bytes: Uint8Array): {
  meta: ResearchStatus & Record<string, unknown>;
  raw: Uint8Array;
  summaries: Uint8Array;
  report: Record<string, unknown>;
};
export type SummaryRow = {
  first: number;
  count: number;
  rmsG: number;
  peakNormG: number;
  meanNormG: number;
  clipped: number;
};
export function summaryRows(bytes: Uint8Array): SummaryRow[];
