import { colors, typography } from "@skate-route-mapper/shared/design";
import { summaryRows } from "@skate-route-mapper/shared/xiaoResearch";
import { useEffect, useRef } from "react";
import type { HardwareSample } from "../../features/hardware/telemetry";
import type { ResearchRecording } from "../../features/hardware/useResearchRecorder";

function prepareCanvas(canvas: HTMLCanvasElement) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);
  return { context, width, height };
}

export function LiveAccelerationChart({ now, samples }: { now: number; samples: HardwareSample[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const prepared = prepareCanvas(canvas);
    if (!prepared) return;
    const { context, width, height } = prepared;
    const visible = samples.filter((sample) => now - sample.receivedAt <= 10_000);
    const limit = Math.max(1.2, ...visible.map((sample) => Math.max(Math.abs(sample.ax), Math.abs(sample.ay), Math.abs(sample.az)))) * 1.1;
    const left = 52, right = width - 12, top = 24, bottom = height - 28;
    const y = (value: number) => top + (1 - value / limit) * (bottom - top) / 2;
    context.font = `${typography.sizes.caption}px system-ui`;
    context.fillStyle = colors.textMuted;
    for (const value of [-limit, 0, limit]) {
      context.fillText(value.toFixed(1), 8, y(value) + 4);
      context.strokeStyle = colors.border;
      context.beginPath(); context.moveTo(left, y(value)); context.lineTo(right, y(value)); context.stroke();
    }
    context.fillText("−10 s", left, height - 8);
    context.fillText("now", right - 30, height - 8);
    (["ax", "ay", "az"] as const).forEach((axis, index) => {
      context.strokeStyle = [colors.accentStrong, colors.link, colors.success][index]!;
      context.lineWidth = 2;
      context.beginPath();
      let previous: HardwareSample | undefined;
      for (const sample of visible) {
        const x = left + (1 - (now - sample.receivedAt) / 10_000) * (right - left);
        if (!previous || sample.receivedAt - previous.receivedAt > 250) context.moveTo(x, y(sample[axis]));
        else context.lineTo(x, y(sample[axis]));
        previous = sample;
      }
      context.stroke();
    });
    if (!visible.length) {
      context.fillStyle = colors.textMuted;
      context.fillText("Waiting for live sensor readings", left + 8, top + 24);
    }
  }, [now, samples]);

  return <canvas ref={ref} aria-label="Last ten seconds of X, Y and Z acceleration" />;
}

export function ResearchRecordingChart({ recording }: { recording: ResearchRecording | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const draw = () => {
      const prepared = prepareCanvas(canvas);
      if (!prepared) return;
      const { context, width, height } = prepared;
      if (!recording) {
        context.fillStyle = colors.textMuted;
        context.fillText("Retrieve or open a recording to compare datasets", 24, 38);
        return;
      }
      const rows = summaryRows(recording.summaries);
      const values = new DataView(recording.raw.buffer, recording.raw.byteOffset, recording.raw.byteLength);
      const norm = (index: number) => Math.hypot(
        values.getInt16(index * 6, true), values.getInt16(index * 6 + 2, true), values.getInt16(index * 6 + 4, true),
      ) * recording.meta.scaleG;
      const limit = Math.max(1.2, ...rows.map((row) => row.peakNormG)) * 1.1;
      const left = 45, right = width - 12, top = 24, bottom = height - 28;
      const x = (index: number) => left + index / recording.meta.count * (right - left);
      const y = (g: number) => bottom - g / limit * (bottom - top);
      context.font = `${typography.sizes.caption}px system-ui`;
      context.fillStyle = colors.textMuted;
      context.fillText(`${limit.toFixed(1)} g`, 4, top);
      context.fillText("0", 12, bottom);
      context.fillText("0 s", left, height - 8);
      context.fillText(`${(recording.meta.count / recording.meta.rateHz).toFixed(1)} s`, right - 45, height - 8);
      const buckets = Math.max(1, Math.floor(right - left));
      context.strokeStyle = colors.accentStrong;
      context.beginPath();
      for (let bucket = 0; bucket < buckets; bucket += 1) {
        const first = Math.floor(bucket * recording.meta.count / buckets);
        const end = Math.floor((bucket + 1) * recording.meta.count / buckets);
        let low = Infinity, high = -Infinity;
        for (let index = first; index < end; index += 1) {
          const g = norm(index); low = Math.min(low, g); high = Math.max(high, g);
        }
        if (end > first) { context.moveTo(x(first), y(low) + 0.5); context.lineTo(x(first), y(high) - 0.5); }
      }
      context.stroke();
      context.strokeStyle = colors.link;
      context.lineWidth = 2;
      context.beginPath();
      rows.forEach((row, index) => {
        if (!index) context.moveTo(x(row.first), y(row.rmsG));
        else context.lineTo(x(row.first), y(row.rmsG));
        context.lineTo(x(row.first + row.count), y(row.rmsG));
      });
      context.stroke();
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [recording]);

  return <canvas ref={ref} aria-label="Raw acceleration envelope and board vibration summaries" />;
}
