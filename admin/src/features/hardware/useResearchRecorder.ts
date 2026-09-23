import {
  ERROR_NAMES,
  OP,
  STATE_NAMES,
  analyzeCapture,
  decodeRecording,
  encodeRecording,
  parseStatus,
  startArgument,
  type ResearchStatus,
} from "@skate-route-mapper/shared/xiaoResearch";
import { useCallback, useEffect, useMemo, useState } from "react";
import { errorMessage } from "./browserHardware";
import type { ResearchClient } from "./researchClient";

export type ResearchReport = {
  complete: boolean; samples: number; windows: number; observedSeconds: number;
  boardCompletionRate: number; sensorTimingMeasured: boolean; sensorTimestampRateHz: number | null;
  sensorBlockMinRateHz: number | null; sensorBlockMaxRateHz: number | null; timestampBlockMilliseconds: number | null;
  sensorBlockStdPercent: number | null; timestampCount: number | null; expectedTimestampCount: number | null;
  rateWithinTolerance: boolean; timingChecksPassed: boolean; summariesMatchRaw: boolean;
  rawBytes: number; summaryBytes: number; reductionFactor: number; rawBytesPerHour: number;
  summaryBytesPerHour: number; maxSummaryErrorG: number; clippedSamples: number;
};

export type ResearchRecording = {
  meta: ResearchStatus & Record<string, unknown>;
  raw: Uint8Array;
  summaries: Uint8Array;
  bytes: Uint8Array;
  report: ResearchReport;
};

type RetrievalCache = {
  meta: ResearchStatus; raw: Uint8Array; summaries: Uint8Array;
  rawCount: number; summaryCount: number; transferMs: number;
};

const sleep = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

export function useResearchRecorder(client: ResearchClient | null, connectionVersion: number) {
  const [status, setStatus] = useState<ResearchStatus | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("Connect BLE, then check the recorder.");
  const [transfer, setTransfer] = useState("");
  const [recording, setRecording] = useState<ResearchRecording | null>(null);
  const [cache, setCache] = useState<RetrievalCache | null>(null);

  useEffect(() => {
    setStatus(null); setCache(null);
    setMessage(client
      ? "Connected. Check the recorder to detect firmware and retained captures."
      : "Disconnected. A started capture continues while the board remains powered.");
  }, [client, connectionVersion]);

  const perform = useCallback(async (action: (active: ResearchClient) => Promise<void>) => {
    if (!client || working) return;
    setWorking(true);
    try { await action(client); }
    catch (error) {
      setMessage(`${errorMessage(error)}. Missing controls require the research firmware; interrupted retrieval can be resumed.`);
    } finally { setWorking(false); }
  }, [client, working]);

  const showStatus = useCallback((next: ResearchStatus) => {
    setStatus(next);
    setMessage(`${STATE_NAMES[next.state]} · ${next.count.toLocaleString()} / ${next.target.toLocaleString()} samples · ${ERROR_NAMES[next.error] || "Unknown error"}`);
  }, []);

  const check = useCallback(() => perform(async (active) => {
    showStatus(parseStatus(await active.request(OP.STATUS)));
  }), [perform, showStatus]);

  const start = useCallback((seconds: number, rateHz: number) => perform(async (active) => {
    let next = parseStatus(await active.request(OP.START, 0, startArgument(seconds, rateHz)));
    showStatus(next); setCache(null);
    while (next.state === 1) {
      setTransfer("Recording independently on the board. Live preview pauses during capture; keep it powered.");
      await sleep(1000);
      next = parseStatus(await active.request(OP.STATUS));
      showStatus(next);
    }
    setTransfer("Capture ended. Retrieve both datasets to inspect and save them.");
  }), [perform, showStatus]);

  const retrieve = useCallback((label: string) => perform(async (active) => {
    const meta = parseStatus(await active.request(OP.STATUS));
    showStatus(meta);
    if (![2, 3].includes(meta.state) || !meta.count) throw new Error("No finished samples to retrieve");
    let dataset = cache;
    if (!dataset || dataset.meta.captureId !== meta.captureId || dataset.meta.rawCrc !== meta.rawCrc || dataset.meta.count !== meta.count) {
      dataset = { meta, raw: new Uint8Array(meta.count * 6), summaries: new Uint8Array(meta.windows * 24), rawCount: 0, summaryCount: 0, transferMs: 0 };
    }
    const started = performance.now();
    try {
      const parts = [
        { op: OP.RAW, key: "raw" as const, countKey: "rawCount" as const, total: meta.count, stride: 6 },
        { op: OP.SUMMARIES, key: "summaries" as const, countKey: "summaryCount" as const, total: meta.windows, stride: 24 },
      ];
      for (const part of parts) {
        while (dataset[part.countKey] < part.total) {
          const offset = dataset[part.countKey];
          const page = await active.request(part.op, meta.captureId, offset);
          if (!page.count || page.count + offset > part.total || page.payload.length !== page.count * part.stride) {
            throw new Error("Invalid research page length");
          }
          dataset[part.key].set(page.payload, offset * part.stride);
          dataset[part.countKey] += page.count;
          setTransfer(`Retrieving ${part.key}: ${dataset[part.countKey].toLocaleString()} / ${part.total.toLocaleString()} records.`);
        }
      }
    } finally {
      dataset.transferMs += performance.now() - started;
      setCache(dataset);
    }
    const recordMeta = {
      ...meta, label: label.trim().slice(0, 200), exportedAt: new Date().toISOString(), transferMs: dataset.transferMs,
      timing: "sample index plus sensor timestamp statistics; not GPS-aligned", channels: "acceleration XYZ only",
    };
    const bytes = encodeRecording(recordMeta, dataset.raw, dataset.summaries);
    setRecording({ meta: recordMeta, raw: dataset.raw, summaries: dataset.summaries, bytes, report: analyzeCapture(recordMeta, dataset.raw, dataset.summaries) as ResearchReport });
    setTransfer("Both datasets verified and ready to save.");
  }), [cache, perform, showStatus]);

  const openFile = useCallback(async (file: File) => {
    if (file.size > 2 * 1024 * 1024) throw new Error("File exceeds the v1 desk-capture size limit");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const decoded = decodeRecording(bytes);
    setRecording({ ...decoded, bytes, report: decoded.report as unknown as ResearchReport });
    setTransfer(`Opened ${file.name}; checksums and summaries were recalculated.`);
  }, []);

  const save = useCallback(() => {
    if (!recording) return;
    const url = URL.createObjectURL(new Blob([new Uint8Array(recording.bytes)], { type: "application/octet-stream" }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `skate-research-${recording.meta.captureId}.skateresearch`; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }, [recording]);

  const memory = useMemo(() => {
    if (!status) return "Recorder capacity is unknown until checked.";
    const timing = (status.timestampCount ?? 0) >= 2 && (status.meanTimestampDeltaTicks ?? 0) > 0
      ? ` Sensor timing: ${((status.timestampDecimation ?? 0) * 40000 / (status.meanTimestampDeltaTicks ?? 1)).toFixed(1)} Hz.`
      : " Sensor timing awaits a timestamp-enabled capture.";
    return `Board buffer: ${(status.capacity * 6 / 1e6).toFixed(3)} MB (${Math.floor(status.capacity / status.rateHz)} s). Free heap: ${(status.freeHeap / 1024).toFixed(0)} KiB. FIFO faults: ${status.overruns}; bus errors: ${status.busErrors}; clipped: ${status.clipped}.${timing}`;
  }, [status]);

  return { status, working, message, transfer, recording, memory, check, start, retrieve, openFile, save };
}
