// Frequency analysis for Xiao research recordings, kept numerically in step with
// hardware/research-signal-analysis.py so the admin view and the offline Python
// report describe the same recording with the same numbers:
//
//   Welch PSD   Hann window, 50% overlap, constant detrend, per-axis densities summed.
//   Spectrogram Same per-segment density, 256-sample Hann windows, 75% overlap.
//
// Pure functions only: no React, no network, no DOM. Input is the raw
// .skateresearch container exactly as the board wrote it.
import { decodeRecording, summaryRows } from "@skate-route-mapper/shared/xiaoResearch";

// The production pipeline streams accelerometer data at 50 Hz, so 25 Hz is the
// highest frequency it can represent. Research captures run far faster; the
// marker shows what the shipped stream would have thrown away.
export const productionStreamRateHz = 50;

const spectrumSegmentSamples = 1024;
const spectrogramSegmentSamples = 256;
const spectrogramOverlapSamples = 192;
const bandEdgesHz = [0, 5, 25, 50, 100, 200, 400];
const minimumSegmentSamples = 8;
const minimumDensity = 1e-12;

export type SignalAxis = {
  key: "x" | "y" | "z";
  label: string;
  values: Float32Array;
};

export type SignalWindow = {
  startSeconds: number;
  endSeconds: number;
  rmsG: number;
  peakNormG: number;
  clipped: number;
};

export type SpectrumSeries = {
  key: string;
  label: string;
  densities: Float64Array;
};

export type SignalSpectrum = {
  segmentSamples: number;
  binWidthHz: number;
  frequencies: Float64Array;
  series: SpectrumSeries[];
  minDensity: number;
  maxDensity: number;
};

export type SignalSpectrogram = {
  frames: number;
  bins: number;
  segmentSamples: number;
  times: Float64Array;
  frequencies: Float64Array;
  /** Row-major [frame][bin] power density in dB relative to 1 g squared per Hz. */
  decibels: Float32Array;
  minDecibels: number;
  maxDecibels: number;
};

export type FrequencyBand = {
  lowHz: number;
  highHz: number;
  rmsG: number;
  percentAcPower: number;
};

export type SignalMetrics = {
  /** Total AC power of the Welch spectrum, as the Python report's spectral acRmsG. */
  acRmsG: number;
  /** Straight time-domain RMS about the mean, as the report's vectorRmsAroundMeanG. */
  vectorRmsAroundMeanG: number;
  peakNormG: number;
  peakDeviationG: number;
  above25HzRmsG: number;
  above25HzPercentAcPower: number;
  clippedSamples: number;
  bands: FrequencyBand[];
};

export type SignalAnalysis = {
  captureId: number;
  rateHz: number;
  sampleCount: number;
  durationSeconds: number;
  boardElapsedSeconds: number;
  nyquistHz: number;
  productionNyquistHz: number;
  axes: SignalAxis[];
  axisMinG: number;
  axisMaxG: number;
  windows: SignalWindow[];
  windowRmsMaxG: number;
  spectrum: SignalSpectrum;
  spectrogram: SignalSpectrogram | null;
  metrics: SignalMetrics;
};

type AxisTriple = readonly [Float32Array, Float32Array, Float32Array];

type FftPlan = {
  size: number;
  cosines: Float64Array;
  sines: Float64Array;
  reversed: Uint32Array;
};

const fftPlans = new Map<number, FftPlan>();

function buildFftPlan(size: number): FftPlan {
  const half = size >> 1;
  const cosines = new Float64Array(half);
  const sines = new Float64Array(half);

  for (let index = 0; index < half; index += 1) {
    cosines[index] = Math.cos((-2 * Math.PI * index) / size);
    sines[index] = Math.sin((-2 * Math.PI * index) / size);
  }

  const bits = Math.log2(size);
  const reversed = new Uint32Array(size);

  for (let index = 0; index < size; index += 1) {
    let value = 0;

    for (let bit = 0; bit < bits; bit += 1) {
      value = (value << 1) | ((index >> bit) & 1);
    }

    reversed[index] = value;
  }

  return { size, cosines, sines, reversed };
}

function fftPlanFor(size: number) {
  const cached = fftPlans.get(size);

  if (cached) {
    return cached;
  }

  const plan = buildFftPlan(size);
  fftPlans.set(size, plan);

  return plan;
}

/** In-place iterative radix-2 Cooley-Tukey transform. Size must be a power of two. */
function fft(plan: FftPlan, real: Float64Array, imaginary: Float64Array) {
  const { size, cosines, sines, reversed } = plan;

  for (let index = 0; index < size; index += 1) {
    const target = reversed[index]!;

    if (target > index) {
      const swappedReal = real[index]!;
      const swappedImaginary = imaginary[index]!;
      real[index] = real[target]!;
      imaginary[index] = imaginary[target]!;
      real[target] = swappedReal;
      imaginary[target] = swappedImaginary;
    }
  }

  for (let span = 2; span <= size; span <<= 1) {
    const half = span >> 1;
    const step = size / span;

    for (let start = 0; start < size; start += span) {
      for (let offset = 0; offset < half; offset += 1) {
        const twiddle = offset * step;
        const cosine = cosines[twiddle]!;
        const sine = sines[twiddle]!;
        const low = start + offset;
        const high = low + half;
        const highReal = real[high]!;
        const highImaginary = imaginary[high]!;
        const productReal = highReal * cosine - highImaginary * sine;
        const productImaginary = highReal * sine + highImaginary * cosine;
        real[high] = real[low]! - productReal;
        imaginary[high] = imaginary[low]! - productImaginary;
        real[low] = real[low]! + productReal;
        imaginary[low] = imaginary[low]! + productImaginary;
      }
    }
  }
}

function largestPowerOfTwoAtMost(value: number) {
  return value < 1 ? 0 : 2 ** Math.floor(Math.log2(value));
}

/** Periodic Hann window, matching scipy get_window("hann", size). */
function hannWindow(size: number) {
  const window = new Float64Array(size);

  for (let index = 0; index < size; index += 1) {
    window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / size);
  }

  return window;
}

type DensityWorkspace = {
  plan: FftPlan;
  window: Float64Array;
  scale: number;
  real: Float64Array;
  imaginary: Float64Array;
  bins: number;
};

function createWorkspace(segmentSamples: number, rateHz: number): DensityWorkspace {
  const window = hannWindow(segmentSamples);
  let windowPower = 0;

  for (let index = 0; index < segmentSamples; index += 1) {
    windowPower += window[index]! * window[index]!;
  }

  return {
    plan: fftPlanFor(segmentSamples),
    window,
    scale: 1 / (rateHz * windowPower),
    real: new Float64Array(segmentSamples),
    imaginary: new Float64Array(segmentSamples),
    bins: segmentSamples / 2 + 1,
  };
}

/**
 * One-sided power spectral density of a single segment, summed across the three
 * axes, written into output (length workspace.bins).
 */
function segmentDensity(
  workspace: DensityWorkspace,
  axes: AxisTriple,
  offset: number,
  output: Float64Array
) {
  const { plan, window, scale, real, imaginary, bins } = workspace;
  const segmentSamples = plan.size;
  const last = bins - 1;
  output.fill(0);

  for (const values of axes) {
    let mean = 0;

    for (let index = 0; index < segmentSamples; index += 1) {
      mean += values[offset + index]!;
    }

    mean /= segmentSamples;

    for (let index = 0; index < segmentSamples; index += 1) {
      real[index] = (values[offset + index]! - mean) * window[index]!;
      imaginary[index] = 0;
    }

    fft(plan, real, imaginary);

    for (let bin = 0; bin < bins; bin += 1) {
      const power = (real[bin]! * real[bin]! + imaginary[bin]! * imaginary[bin]!) * scale;
      // One-sided spectrum: interior bins also carry their mirrored twin energy.
      output[bin] = output[bin]! + (bin === 0 || bin === last ? power : power * 2);
    }
  }
}

function frequencyBins(segmentSamples: number, rateHz: number) {
  const bins = segmentSamples / 2 + 1;
  const frequencies = new Float64Array(bins);

  for (let bin = 0; bin < bins; bin += 1) {
    frequencies[bin] = (bin * rateHz) / segmentSamples;
  }

  return frequencies;
}

type WelchResult = {
  segmentSamples: number;
  binWidthHz: number;
  frequencies: Float64Array;
  densities: Float64Array;
};

/** Welch averaged periodogram over a slice of the three axes. */
function welch(
  axes: AxisTriple,
  start: number,
  length: number,
  rateHz: number,
  requestedSegmentSamples: number
): WelchResult | null {
  const segmentSamples = largestPowerOfTwoAtMost(Math.min(requestedSegmentSamples, length));

  if (segmentSamples < minimumSegmentSamples) {
    return null;
  }

  const workspace = createWorkspace(segmentSamples, rateHz);
  const hop = segmentSamples >> 1;
  const densities = new Float64Array(workspace.bins);
  const scratch = new Float64Array(workspace.bins);
  let segments = 0;

  for (let offset = start; offset + segmentSamples <= start + length; offset += hop) {
    segmentDensity(workspace, axes, offset, scratch);

    for (let bin = 0; bin < workspace.bins; bin += 1) {
      densities[bin] = densities[bin]! + scratch[bin]!;
    }

    segments += 1;
  }

  if (!segments) {
    return null;
  }

  for (let bin = 0; bin < workspace.bins; bin += 1) {
    densities[bin] = densities[bin]! / segments;
  }

  return {
    segmentSamples,
    binWidthHz: rateHz / segmentSamples,
    frequencies: frequencyBins(segmentSamples, rateHz),
    densities,
  };
}

function computeSpectrogram(
  axes: AxisTriple,
  sampleCount: number,
  rateHz: number
): SignalSpectrogram | null {
  const segmentSamples = largestPowerOfTwoAtMost(
    Math.min(spectrogramSegmentSamples, sampleCount)
  );

  if (segmentSamples < minimumSegmentSamples) {
    return null;
  }

  const overlap = Math.min(spectrogramOverlapSamples, segmentSamples - 1);
  const hop = segmentSamples - overlap;
  const frames = Math.floor((sampleCount - segmentSamples) / hop) + 1;

  if (frames < 1) {
    return null;
  }

  const workspace = createWorkspace(segmentSamples, rateHz);
  const { bins } = workspace;
  const decibels = new Float32Array(frames * bins);
  const times = new Float64Array(frames);
  const scratch = new Float64Array(bins);
  let minDecibels = Infinity;
  let maxDecibels = -Infinity;

  for (let frame = 0; frame < frames; frame += 1) {
    const offset = frame * hop;
    segmentDensity(workspace, axes, offset, scratch);
    // scipy reports each segment at its centre.
    times[frame] = (offset + segmentSamples / 2) / rateHz;

    for (let bin = 0; bin < bins; bin += 1) {
      const value = 10 * Math.log10(Math.max(scratch[bin]!, minimumDensity));
      decibels[frame * bins + bin] = value;
      minDecibels = Math.min(minDecibels, value);
      maxDecibels = Math.max(maxDecibels, value);
    }
  }

  return {
    frames,
    bins,
    segmentSamples,
    times,
    frequencies: frequencyBins(segmentSamples, rateHz),
    decibels,
    minDecibels,
    maxDecibels,
  };
}

function frequencyBands(
  frequencies: Float64Array,
  densities: Float64Array,
  binWidthHz: number,
  nyquistHz: number,
  totalPower: number
): FrequencyBand[] {
  return bandEdgesHz
    .filter((lowHz) => lowHz < nyquistHz)
    .map((lowHz, index, edges) => {
      const nextEdge = edges[index + 1];
      // The final band runs to Nyquist inclusive, so reach past the last bin.
      const limitHz = nextEdge ?? nyquistHz + binWidthHz;
      let energy = 0;

      for (let bin = 1; bin < densities.length; bin += 1) {
        const frequency = frequencies[bin]!;

        if (frequency >= lowHz && frequency < limitHz) {
          energy += densities[bin]! * binWidthHz;
        }
      }

      return {
        lowHz,
        highHz: Math.min(limitHz, nyquistHz),
        rmsG: Math.sqrt(energy),
        percentAcPower: totalPower ? (100 * energy) / totalPower : 0,
      };
    });
}

function timeDomainMetrics(axes: AxisTriple, sampleCount: number) {
  const [x, y, z] = axes;
  let sumX = 0;
  let sumY = 0;
  let sumZ = 0;

  for (let index = 0; index < sampleCount; index += 1) {
    sumX += x[index]!;
    sumY += y[index]!;
    sumZ += z[index]!;
  }

  const meanX = sumX / sampleCount;
  const meanY = sumY / sampleCount;
  const meanZ = sumZ / sampleCount;
  let variance = 0;
  let peakDeviation = 0;
  let peakNorm = 0;
  let axisMin = Infinity;
  let axisMax = -Infinity;

  for (let index = 0; index < sampleCount; index += 1) {
    const valueX = x[index]!;
    const valueY = y[index]!;
    const valueZ = z[index]!;
    const deviation =
      (valueX - meanX) ** 2 + (valueY - meanY) ** 2 + (valueZ - meanZ) ** 2;
    variance += deviation;
    peakDeviation = Math.max(peakDeviation, deviation);
    peakNorm = Math.max(peakNorm, valueX ** 2 + valueY ** 2 + valueZ ** 2);
    axisMin = Math.min(axisMin, valueX, valueY, valueZ);
    axisMax = Math.max(axisMax, valueX, valueY, valueZ);
  }

  return {
    vectorRmsAroundMeanG: Math.sqrt(variance / sampleCount),
    peakDeviationG: Math.sqrt(peakDeviation),
    peakNormG: Math.sqrt(peakNorm),
    axisMinG: axisMin,
    axisMaxG: axisMax,
  };
}

function numberFrom(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function analyzeRecording(bytes: Uint8Array): SignalAnalysis {
  const { meta, raw, summaries } = decodeRecording(bytes);
  const sampleCount = meta.count;
  const rateHz = meta.rateHz;

  if (!sampleCount) {
    throw new Error("Recording contains no samples");
  }

  const values = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const x = new Float32Array(sampleCount);
  const y = new Float32Array(sampleCount);
  const z = new Float32Array(sampleCount);

  for (let index = 0; index < sampleCount; index += 1) {
    x[index] = values.getInt16(index * 6, true) * meta.scaleG;
    y[index] = values.getInt16(index * 6 + 2, true) * meta.scaleG;
    z[index] = values.getInt16(index * 6 + 4, true) * meta.scaleG;
  }

  const axes: AxisTriple = [x, y, z];
  const half = Math.floor(sampleCount / 2);
  const whole = welch(axes, 0, sampleCount, rateHz, spectrumSegmentSamples);

  if (!whole) {
    throw new Error("Recording is too short to analyse");
  }

  const firstHalf = welch(axes, 0, half, rateHz, spectrumSegmentSamples);
  const secondHalf = welch(axes, half, sampleCount - half, rateHz, spectrumSegmentSamples);
  const series: SpectrumSeries[] = [
    { key: "whole", label: "Whole recording", densities: whole.densities },
  ];

  // Half spectra are only comparable when they landed on the same bin grid.
  if (firstHalf && firstHalf.segmentSamples === whole.segmentSamples) {
    series.push({ key: "firstHalf", label: "First half", densities: firstHalf.densities });
  }

  if (secondHalf && secondHalf.segmentSamples === whole.segmentSamples) {
    series.push({ key: "secondHalf", label: "Second half", densities: secondHalf.densities });
  }

  let minDensity = Infinity;
  let maxDensity = 0;

  for (const entry of series) {
    for (let bin = 1; bin < entry.densities.length; bin += 1) {
      const density = entry.densities[bin]!;

      if (density > 0) {
        minDensity = Math.min(minDensity, density);
        maxDensity = Math.max(maxDensity, density);
      }
    }
  }

  const nyquistHz = rateHz / 2;
  let totalPower = 0;
  let above25Power = 0;

  for (let bin = 1; bin < whole.densities.length; bin += 1) {
    const energy = whole.densities[bin]! * whole.binWidthHz;
    totalPower += energy;

    if (whole.frequencies[bin]! >= productionStreamRateHz / 2) {
      above25Power += energy;
    }
  }

  const timeMetrics = timeDomainMetrics(axes, sampleCount);
  const windows = summaryRows(summaries).map((row) => ({
    startSeconds: row.first / rateHz,
    endSeconds: (row.first + row.count) / rateHz,
    rmsG: row.rmsG,
    peakNormG: row.peakNormG,
    clipped: row.clipped,
  }));

  return {
    captureId: meta.captureId,
    rateHz,
    sampleCount,
    durationSeconds: sampleCount / rateHz,
    boardElapsedSeconds: numberFrom(meta.elapsedUs) / 1e6,
    nyquistHz,
    productionNyquistHz: productionStreamRateHz / 2,
    axes: [
      { key: "x", label: "X", values: x },
      { key: "y", label: "Y", values: y },
      { key: "z", label: "Z", values: z },
    ],
    axisMinG: timeMetrics.axisMinG,
    axisMaxG: timeMetrics.axisMaxG,
    windows,
    windowRmsMaxG: windows.reduce((peak, window) => Math.max(peak, window.rmsG), 0),
    spectrum: {
      segmentSamples: whole.segmentSamples,
      binWidthHz: whole.binWidthHz,
      frequencies: whole.frequencies,
      series,
      minDensity: Number.isFinite(minDensity) ? minDensity : minimumDensity,
      maxDensity: maxDensity || minimumDensity,
    },
    spectrogram: computeSpectrogram(axes, sampleCount, rateHz),
    metrics: {
      acRmsG: Math.sqrt(totalPower),
      vectorRmsAroundMeanG: timeMetrics.vectorRmsAroundMeanG,
      peakNormG: timeMetrics.peakNormG,
      peakDeviationG: timeMetrics.peakDeviationG,
      above25HzRmsG: Math.sqrt(above25Power),
      above25HzPercentAcPower: totalPower ? (100 * above25Power) / totalPower : 0,
      clippedSamples: numberFrom(meta.clipped),
      bands: frequencyBands(
        whole.frequencies,
        whole.densities,
        whole.binWidthHz,
        nyquistHz,
        totalPower
      ),
    },
  };
}
