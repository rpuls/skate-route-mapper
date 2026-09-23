// The four panels of the research signal figure, drawn on canvas because a
// capture holds tens of thousands of samples per axis. Each chart is presentational:
// it receives a finished SignalAnalysis and renders it.
import { Box, Stack, Typography } from "@mui/material";
import { colors, space, typography } from "@skate-route-mapper/shared/design";
import { useCallback, useEffect, useRef } from "react";
import type { SignalAnalysis } from "../../features/research/signalAnalysis";
import { px } from "../../theme/adminTheme";
import {
  decadeTicks,
  drawPlotFrame,
  drawPlotMessage,
  formatDecade,
  formatTickValue,
  linearTicks,
  preparePlot,
  viridis,
  type PlotFrame,
  type Tick,
} from "./chartCanvas";

// Blue / orange / green, the same reading order as the offline matplotlib figure.
const seriesColors = [colors.link, colors.accent, colors.success] as const;
const spectrogramFixedRange = { minDecibels: -65, maxDecibels: -5 } as const;

function seriesColor(index: number) {
  return seriesColors[index % seriesColors.length]!;
}

function PlotCanvas({
  ariaLabel,
  draw,
}: {
  ariaLabel: string;
  draw: (canvas: HTMLCanvasElement) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;

    if (!canvas) {
      return;
    }

    const render = () => draw(canvas);
    render();

    const observer = new ResizeObserver(render);
    observer.observe(canvas);

    return () => observer.disconnect();
  }, [draw]);

  return <canvas aria-label={ariaLabel} ref={ref} />;
}

export function ChartLegend({
  entries,
}: {
  entries: { color: string; label: string; dashed?: boolean }[];
}) {
  return (
    <Stack direction="row" spacing={2} sx={{ flexWrap: "wrap", rowGap: px(space.xs) }}>
      {entries.map((entry) => (
        <Stack direction="row" key={entry.label} spacing={0.75} sx={{ alignItems: "center" }}>
          <Box
            sx={{
              bgcolor: entry.dashed ? "transparent" : entry.color,
              borderTop: entry.dashed ? `2px dashed ${entry.color}` : "none",
              borderRadius: entry.dashed ? 0 : "2px",
              height: entry.dashed ? 0 : 4,
              width: 18,
            }}
          />
          <Typography color="text.secondary" sx={{ fontWeight: 800 }} variant="caption">
            {entry.label}
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
}

function timeTicks(frame: PlotFrame, durationSeconds: number): Tick[] {
  const values = linearTicks(0, durationSeconds, Math.max(2, Math.floor((frame.right - frame.left) / 90)));
  const step = values.length > 1 ? values[1]! - values[0]! : durationSeconds;

  return values.map((value) => ({
    position: frame.left + (value / durationSeconds) * (frame.right - frame.left),
    label: formatTickValue(value, step),
  }));
}

export function RawAccelerationChart({ analysis }: { analysis: SignalAnalysis }) {
  const draw = useCallback(
    (canvas: HTMLCanvasElement) => {
      const frame = preparePlot(canvas, { left: 56, right: 16, top: 12, bottom: 44 });

      if (!frame) {
        return;
      }

      const { context, left, right, top, bottom } = frame;
      const padding = Math.max(0.1, (analysis.axisMaxG - analysis.axisMinG) * 0.05);
      const low = analysis.axisMinG - padding;
      const high = analysis.axisMaxG + padding;
      const values = linearTicks(low, high, Math.max(2, Math.floor((bottom - top) / 40)));
      const step = values.length > 1 ? values[1]! - values[0]! : high - low;
      const toY = (value: number) => bottom - ((value - low) / (high - low)) * (bottom - top);

      drawPlotFrame(frame, {
        xTicks: timeTicks(frame, analysis.durationSeconds),
        yTicks: values.map((value) => ({ position: toY(value), label: formatTickValue(value, step) })),
        xLabel: "Nominal sample time (s)",
        yLabel: "Acceleration (g)",
      });

      context.save();
      context.beginPath();
      context.rect(left, top, right - left, bottom - top);
      context.clip();

      const columns = Math.max(1, Math.round(right - left));
      context.lineWidth = 1;

      analysis.axes.forEach((axis, index) => {
        context.strokeStyle = seriesColor(index);
        context.beginPath();
        let started = false;

        // One min/max pair per pixel column keeps every spike visible no matter
        // how many samples the capture holds.
        for (let column = 0; column < columns; column += 1) {
          const first = Math.floor((column * analysis.sampleCount) / columns);
          const end = Math.floor(((column + 1) * analysis.sampleCount) / columns);

          if (end <= first) {
            continue;
          }

          let lowest = Infinity;
          let highest = -Infinity;

          for (let sample = first; sample < end; sample += 1) {
            const value = axis.values[sample]!;
            lowest = Math.min(lowest, value);
            highest = Math.max(highest, value);
          }

          const x = left + column;

          if (started) {
            context.lineTo(x, toY(lowest));
          } else {
            context.moveTo(x, toY(lowest));
            started = true;
          }

          context.lineTo(x, toY(highest));
        }

        context.stroke();
      });

      context.restore();
    },
    [analysis]
  );

  return <PlotCanvas ariaLabel="Raw X, Y and Z acceleration over the whole recording" draw={draw} />;
}

export function WindowRmsChart({ analysis }: { analysis: SignalAnalysis }) {
  const draw = useCallback(
    (canvas: HTMLCanvasElement) => {
      const frame = preparePlot(canvas, { left: 56, right: 16, top: 12, bottom: 44 });

      if (!frame) {
        return;
      }

      const { context, left, right, top, bottom } = frame;

      if (!analysis.windows.length) {
        drawPlotMessage(frame, "This recording carries no board window summaries");
        return;
      }

      const high = Math.max(analysis.windowRmsMaxG * 1.05, 0.1);
      const values = linearTicks(0, high, Math.max(2, Math.floor((bottom - top) / 40)));
      const step = values.length > 1 ? values[1]! - values[0]! : high;
      const toX = (seconds: number) =>
        left + (seconds / analysis.durationSeconds) * (right - left);
      const toY = (value: number) => bottom - (value / high) * (bottom - top);

      drawPlotFrame(frame, {
        xTicks: timeTicks(frame, analysis.durationSeconds),
        yTicks: values.map((value) => ({ position: toY(value), label: formatTickValue(value, step) })),
        xLabel: "Nominal sample time (s)",
        yLabel: "Vector RMS about mean (g)",
      });

      context.save();
      context.beginPath();
      context.rect(left, top, right - left, bottom - top);
      context.clip();
      context.strokeStyle = seriesColor(0);
      context.lineWidth = 1.8;
      context.beginPath();

      analysis.windows.forEach((window, index) => {
        const y = toY(window.rmsG);

        if (!index) {
          context.moveTo(toX(window.startSeconds), y);
        } else {
          context.lineTo(toX(window.startSeconds), y);
        }

        context.lineTo(toX(window.endSeconds), y);
      });

      context.stroke();
      context.restore();
    },
    [analysis]
  );

  return <PlotCanvas ariaLabel="Board vibration summary per 200 millisecond window" draw={draw} />;
}

export function PowerSpectrumChart({ analysis }: { analysis: SignalAnalysis }) {
  const draw = useCallback(
    (canvas: HTMLCanvasElement) => {
      const frame = preparePlot(canvas, { left: 62, right: 16, top: 12, bottom: 44 });

      if (!frame) {
        return;
      }

      const { context, left, right, top, bottom } = frame;
      const { spectrum } = analysis;
      const high = spectrum.maxDensity * 2;
      // Keep the useful decades on screen even when a few bins sit near zero.
      const low = Math.max(spectrum.minDensity, high * 1e-7);
      const logLow = Math.log10(low);
      const logHigh = Math.log10(high);
      const toX = (hertz: number) => left + (hertz / analysis.nyquistHz) * (right - left);
      const toY = (density: number) =>
        bottom -
        ((Math.log10(Math.max(density, low)) - logLow) / (logHigh - logLow)) * (bottom - top);
      const frequencies = linearTicks(0, analysis.nyquistHz, Math.max(2, Math.floor((right - left) / 80)));
      const frequencyStep = frequencies.length > 1 ? frequencies[1]! - frequencies[0]! : analysis.nyquistHz;

      drawPlotFrame(frame, {
        xTicks: frequencies
          .filter((value) => value <= analysis.nyquistHz)
          .map((value) => ({ position: toX(value), label: formatTickValue(value, frequencyStep) })),
        yTicks: decadeTicks(low, high).map((value) => ({
          position: toY(value),
          label: formatDecade(value),
        })),
        xLabel: "Frequency (Hz, nominal clock)",
        yLabel: "Power density (g²/Hz)",
      });

      context.save();
      context.beginPath();
      context.rect(left, top, right - left, bottom - top);
      context.clip();

      spectrum.series.forEach((entry, index) => {
        context.strokeStyle = seriesColor(index);
        context.lineWidth = 1;
        context.beginPath();

        for (let bin = 1; bin < entry.densities.length; bin += 1) {
          const x = toX(spectrum.frequencies[bin]!);
          const y = toY(entry.densities[bin]!);

          if (bin === 1) {
            context.moveTo(x, y);
          } else {
            context.lineTo(x, y);
          }
        }

        context.stroke();
      });

      // Everything to the right of this line is what the 50 Hz production stream
      // cannot represent.
      const markerX = toX(analysis.productionNyquistHz);
      context.strokeStyle = colors.text;
      context.lineWidth = 1;
      context.setLineDash([5, 4]);
      context.beginPath();
      context.moveTo(markerX, top);
      context.lineTo(markerX, bottom);
      context.stroke();
      context.setLineDash([]);
      context.restore();
    },
    [analysis]
  );

  return <PlotCanvas ariaLabel="Power spectral density of the summed axes" draw={draw} />;
}

export function SpectrogramChart({
  analysis,
  fixedScale,
}: {
  analysis: SignalAnalysis;
  fixedScale: boolean;
}) {
  const draw = useCallback(
    (canvas: HTMLCanvasElement) => {
      const frame = preparePlot(canvas, { left: 56, right: 92, top: 12, bottom: 44 });

      if (!frame) {
        return;
      }

      const { context, left, right, top, bottom } = frame;
      const { spectrogram } = analysis;

      if (!spectrogram) {
        drawPlotMessage(frame, "This recording is too short for a spectrogram");
        return;
      }

      const minDecibels = fixedScale ? spectrogramFixedRange.minDecibels : spectrogram.minDecibels;
      const maxDecibels = fixedScale ? spectrogramFixedRange.maxDecibels : spectrogram.maxDecibels;
      const span = Math.max(maxDecibels - minDecibels, 1e-6);
      const { frames, bins } = spectrogram;

      const tile = document.createElement("canvas");
      tile.width = frames;
      tile.height = bins;
      const tileContext = tile.getContext("2d");

      if (!tileContext) {
        return;
      }

      const image = tileContext.createImageData(frames, bins);

      for (let frameIndex = 0; frameIndex < frames; frameIndex += 1) {
        for (let bin = 0; bin < bins; bin += 1) {
          const decibels = spectrogram.decibels[frameIndex * bins + bin]!;
          const [red, green, blue] = viridis((decibels - minDecibels) / span);
          // Row 0 is the top of the image, but bin 0 is the bottom of the axis.
          const pixel = ((bins - 1 - bin) * frames + frameIndex) * 4;
          image.data[pixel] = red;
          image.data[pixel + 1] = green;
          image.data[pixel + 2] = blue;
          image.data[pixel + 3] = 255;
        }
      }

      tileContext.putImageData(image, 0, 0);

      const highestFrequency = spectrogram.frequencies[bins - 1]!;
      const values = linearTicks(0, highestFrequency, Math.max(2, Math.floor((bottom - top) / 40)));
      const step = values.length > 1 ? values[1]! - values[0]! : highestFrequency;
      const toX = (seconds: number) =>
        left + (seconds / analysis.durationSeconds) * (right - left);
      const toY = (hertz: number) => bottom - (hertz / highestFrequency) * (bottom - top);

      drawPlotFrame(frame, {
        xTicks: timeTicks(frame, analysis.durationSeconds),
        yTicks: values.map((value) => ({
          position: toY(value),
          label: formatTickValue(value, step),
        })),
        xLabel: "Nominal sample time (s)",
        yLabel: "Frequency (Hz)",
      });

      // Each cell is centred on its segment midpoint and its bin frequency, so the
      // image covers half a cell beyond the first and last of each, not the whole
      // plot. Drawing it anywhere else would shift events away from the time axis
      // that the panels above share.
      const halfFrame =
        frames > 1
          ? (spectrogram.times[1]! - spectrogram.times[0]!) / 2
          : spectrogram.segmentSamples / (2 * analysis.rateHz);
      const halfBin = bins > 1 ? highestFrequency / (2 * (bins - 1)) : 0;
      const imageLeft = toX(spectrogram.times[0]! - halfFrame);
      const imageRight = toX(spectrogram.times[frames - 1]! + halfFrame);
      const imageTop = toY(highestFrequency + halfBin);
      const imageBottom = toY(-halfBin);

      context.save();
      context.beginPath();
      context.rect(left, top, right - left, bottom - top);
      context.clip();
      context.imageSmoothingEnabled = frames > right - left;
      context.drawImage(
        tile,
        imageLeft,
        imageTop,
        imageRight - imageLeft,
        imageBottom - imageTop
      );
      context.restore();

      // Colour bar.
      const barLeft = right + 16;
      const barWidth = 14;
      const gradient = context.createLinearGradient(0, bottom, 0, top);

      for (let stop = 0; stop <= 10; stop += 1) {
        const [red, green, blue] = viridis(stop / 10);
        gradient.addColorStop(stop / 10, `rgb(${red}, ${green}, ${blue})`);
      }

      context.fillStyle = gradient;
      context.fillRect(barLeft, top, barWidth, bottom - top);

      context.fillStyle = colors.textMuted;
      context.textAlign = "left";

      const barValues = linearTicks(minDecibels, maxDecibels, Math.max(2, Math.floor((bottom - top) / 40)));
      const barStep = barValues.length > 1 ? barValues[1]! - barValues[0]! : span;

      for (const value of barValues) {
        const y = bottom - ((value - minDecibels) / span) * (bottom - top);
        context.fillText(formatTickValue(value, barStep), barLeft + barWidth + 4, y + 4);
      }

      context.save();
      context.translate(frame.width - 6, (top + bottom) / 2);
      context.rotate(-Math.PI / 2);
      context.textAlign = "center";
      context.font = `${typography.sizes.caption}px ${typography.family}`;
      context.fillText("dB relative to 1 g²/Hz", 0, 0);
      context.restore();
      context.textAlign = "left";
    },
    [analysis, fixedScale]
  );

  return <PlotCanvas ariaLabel="Spectrogram showing when fast vibration occurs" draw={draw} />;
}
