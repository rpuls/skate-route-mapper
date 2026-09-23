// Small canvas helpers shared by the research signal charts: device-pixel setup,
// tick selection, and axis/grid painting. Charts stay responsible for their own
// scales and marks; this file only draws the furniture around them.
import { colors, typography } from "@skate-route-mapper/shared/design";

export type PlotFrame = {
  context: CanvasRenderingContext2D;
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export type Tick = {
  /** Pixel position along the axis. */
  position: number;
  label: string;
};

const captionFont = `${typography.sizes.caption}px ${typography.family}`;

export function preparePlot(
  canvas: HTMLCanvasElement,
  margins: { left: number; right: number; top: number; bottom: number }
): PlotFrame | null {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;

  if (!width || !height) {
    return null;
  }

  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);

  const context = canvas.getContext("2d");

  if (!context) {
    return null;
  }

  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  context.font = captionFont;
  context.textBaseline = "alphabetic";

  return {
    context,
    width,
    height,
    left: margins.left,
    right: width - margins.right,
    top: margins.top,
    bottom: height - margins.bottom,
  };
}

/** Rounded 1/2/5 steps covering the range, as matplotlib would pick them. */
export function linearTicks(min: number, max: number, target: number) {
  if (!(max > min) || target < 2) {
    return [min];
  }

  const rough = (max - min) / target;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const step = (normalized > 5 ? 10 : normalized > 2 ? 5 : normalized > 1 ? 2 : 1) * magnitude;
  const values: number[] = [];

  for (let value = Math.ceil(min / step) * step; value <= max + step / 1000; value += step) {
    // Re-round so 0.1 steps do not accumulate binary drift into the labels.
    values.push(Math.round(value / step) * step);
  }

  return values;
}

/** Powers of ten inside the range, for logarithmic axes. */
export function decadeTicks(min: number, max: number) {
  if (!(min > 0) || !(max > min)) {
    return [];
  }

  const values: number[] = [];

  for (
    let exponent = Math.floor(Math.log10(min));
    exponent <= Math.ceil(Math.log10(max));
    exponent += 1
  ) {
    const value = 10 ** exponent;

    if (value >= min && value <= max) {
      values.push(value);
    }
  }

  return values;
}

export function formatDecade(value: number) {
  const exponent = Math.round(Math.log10(value));

  if (exponent >= 0 && exponent <= 3) {
    return String(10 ** exponent);
  }

  return `1e${exponent}`;
}

export function formatTickValue(value: number, step: number) {
  const decimals = Math.max(0, Math.min(4, Math.ceil(-Math.log10(Math.abs(step || 1)))));

  return value.toFixed(decimals);
}

export function drawPlotFrame(
  frame: PlotFrame,
  options: { xTicks: Tick[]; yTicks: Tick[]; xLabel?: string; yLabel?: string }
) {
  const { context, left, right, top, bottom } = frame;

  context.fillStyle = colors.surface;
  context.fillRect(left, top, right - left, bottom - top);

  context.lineWidth = 1;
  context.strokeStyle = colors.border;
  context.beginPath();

  for (const tick of options.yTicks) {
    const y = Math.round(tick.position) + 0.5;
    context.moveTo(left, y);
    context.lineTo(right, y);
  }

  for (const tick of options.xTicks) {
    const x = Math.round(tick.position) + 0.5;
    context.moveTo(x, top);
    context.lineTo(x, bottom);
  }

  context.stroke();

  context.fillStyle = colors.textMuted;
  context.textAlign = "right";

  for (const tick of options.yTicks) {
    context.fillText(tick.label, left - 6, tick.position + 4);
  }

  context.textAlign = "center";

  for (const tick of options.xTicks) {
    context.fillText(tick.label, tick.position, bottom + 16);
  }

  if (options.xLabel) {
    context.fillText(options.xLabel, (left + right) / 2, bottom + 32);
  }

  if (options.yLabel) {
    context.save();
    context.translate(12, (top + bottom) / 2);
    context.rotate(-Math.PI / 2);
    context.textAlign = "center";
    context.fillText(options.yLabel, 0, 0);
    context.restore();
  }

  context.textAlign = "left";
}

export function drawPlotMessage(frame: PlotFrame, message: string) {
  const { context, left, right, top, bottom } = frame;
  context.fillStyle = colors.surface;
  context.fillRect(left, top, right - left, bottom - top);
  context.fillStyle = colors.textMuted;
  context.textAlign = "center";
  context.fillText(message, (left + right) / 2, (top + bottom) / 2);
  context.textAlign = "left";
}

// Viridis sampled at ten evenly spaced stops. A perceptually uniform, colour-vision
// safe ramp is a functional requirement for a heat map, so it is not covered by the
// brand palette in shared/src/design.ts; it is data encoding rather than decoration.
const viridisStops = [
  [68, 1, 84],
  [72, 40, 120],
  [62, 74, 137],
  [49, 104, 142],
  [38, 130, 142],
  [31, 158, 137],
  [53, 183, 121],
  [109, 205, 89],
  [180, 222, 44],
  [253, 231, 37],
] as const;

/** Sequential colour ramp for heat maps. Input is clamped to 0...1. */
export function viridis(value: number): [number, number, number] {
  const position = Math.min(1, Math.max(0, value)) * (viridisStops.length - 1);
  const index = Math.min(viridisStops.length - 2, Math.floor(position));
  const blend = position - index;
  const from = viridisStops[index]!;
  const to = viridisStops[index + 1]!;

  return [
    Math.round(from[0] + (to[0] - from[0]) * blend),
    Math.round(from[1] + (to[1] - from[1]) * blend),
    Math.round(from[2] + (to[2] - from[2]) * blend),
  ];
}
