import { readFile, writeFile } from "node:fs/promises";
import { resolve, basename, join } from "node:path";
import { decodeRecording, summaryRows } from "../shared/src/xiaoResearch.mjs";

const [file, outputDirectory] = process.argv.slice(2);
if (!file) {
  console.error('Usage: node hardware/analyze-research.mjs "recording.skateresearch" [existing-output-directory]');
  process.exitCode = 1;
} else {
  const recording = decodeRecording(new Uint8Array(await readFile(file)));
  console.log(JSON.stringify({ file: resolve(file), label: recording.meta.label, ...recording.report }, null, 2));
  if (outputDirectory) {
    const { meta, raw, summaries } = recording, v = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const lines = ["sample_index,nominal_time_s,ax_g,ay_g,az_g"];
    for (let i = 0; i < meta.count; i++) lines.push([i, (i / meta.rateHz).toFixed(6),
      ...[0, 1, 2].map((axis) => (v.getInt16(i * 6 + axis * 2, true) * meta.scaleG).toFixed(6))].join(","));
    const summary = ["first_sample,count,nominal_start_s,nominal_end_s,rms_g,peak_norm_g,mean_norm_g,clipped_samples",
      ...summaryRows(summaries).map((row) => [row.first, row.count, row.first / meta.rateHz,
        (row.first + row.count) / meta.rateHz, row.rmsG, row.peakNormG, row.meanNormG, row.clipped].join(","))];
    const stem = basename(file, ".skateresearch");
    // Exclusive creation keeps an analysis rerun from overwriting existing exports.
    await writeFile(join(resolve(outputDirectory), `${stem}-raw.csv`), lines.join("\n") + "\n", { flag: "wx" });
    await writeFile(join(resolve(outputDirectory), `${stem}-summaries.csv`), summary.join("\n") + "\n", { flag: "wx" });
    console.log("Exported raw and summary CSV files. CSV is larger than the compact recording.");
  }
  if (!recording.report.complete || !recording.report.summariesMatchRaw || !recording.report.rateWithinTolerance) process.exitCode = 2;
}
