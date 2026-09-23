// Research capture detail view, registered for the researchCaptures resource in
// features/entities/entityViewRegistry.ts.
//
// It reproduces hardware/research-signal-analysis.py in the browser so a stored
// capture can be read without exporting it: the recording is downloaded once,
// decoded with the shared container reader, and analysed client side.
import DownloadIcon from "@mui/icons-material/Download";
import EditIcon from "@mui/icons-material/Edit";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Divider,
  FormControlLabel,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { colors, space } from "@skate-route-mapper/shared/design";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { downloadResearchCaptureAsset } from "../../api/adminApi";
import type { EntityDetailViewProps } from "../../features/entities/entityViewContract";
import { useResearchCaptureRecording } from "../../features/research/researchQueries";
import {
  analyzeRecording,
  productionStreamRateHz,
  type SignalAnalysis,
} from "../../features/research/signalAnalysis";
import { px, radiusLevel, radiusPx, surfaceSx } from "../../theme/adminTheme";
import {
  ChartLegend,
  PowerSpectrumChart,
  RawAccelerationChart,
  SpectrogramChart,
  WindowRmsChart,
} from "../research/ResearchSignalCharts";

const wholeNumbers = new Intl.NumberFormat();
const seriesColors = [colors.link, colors.accent, colors.success] as const;

function textOf(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography color="text.secondary" sx={{ fontWeight: 900 }} variant="caption">
        {label}
      </Typography>
      <Typography sx={{ fontWeight: 800, overflowWrap: "anywhere" }}>{value}</Typography>
    </Box>
  );
}

function ChartPanel({
  children,
  height,
  legend,
  title,
}: {
  children: ReactNode;
  height: number;
  legend?: ReactNode;
  title: string;
}) {
  return (
    <Stack spacing={1} sx={{ minWidth: 0 }}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1}
        sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}
      >
        <Typography sx={{ fontWeight: 900 }}>{title}</Typography>
        {legend}
      </Stack>
      <Box
        sx={{
          "& canvas": {
            bgcolor: colors.surface,
            borderRadius: radiusPx(radiusLevel.utility),
            display: "block",
            height,
            width: "100%",
          },
        }}
      >
        {children}
      </Box>
    </Stack>
  );
}

function SignalFigure({ analysis }: { analysis: SignalAnalysis }) {
  const [fixedScale, setFixedScale] = useState(true);
  const { metrics } = analysis;

  return (
    <Stack spacing={3} sx={{ minWidth: 0 }}>
      <Box
        sx={{
          display: "grid",
          gap: px(space.md),
          gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", lg: "repeat(4, 1fr)" },
        }}
      >
        <DetailItem label="Samples" value={wholeNumbers.format(analysis.sampleCount)} />
        <DetailItem
          label="Sample rate"
          value={`${analysis.rateHz} Hz, Nyquist ${analysis.nyquistHz} Hz`}
        />
        <DetailItem
          label="Duration"
          value={`${analysis.durationSeconds.toFixed(2)} s nominal, ${analysis.boardElapsedSeconds.toFixed(2)} s on board`}
        />
        <DetailItem label="Peak vector magnitude" value={`${metrics.peakNormG.toFixed(2)} g`} />
        <DetailItem
          label="AC RMS about mean"
          value={`${metrics.vectorRmsAroundMeanG.toFixed(3)} g`}
        />
        <DetailItem label="Peak deviation" value={`${metrics.peakDeviationG.toFixed(2)} g`} />
        <DetailItem
          label={`Above ${analysis.productionNyquistHz} Hz`}
          value={`${metrics.above25HzPercentAcPower.toFixed(1)}% of AC power, ${metrics.above25HzRmsG.toFixed(3)} g RMS`}
        />
        <DetailItem label="Clipped samples" value={wholeNumbers.format(metrics.clippedSamples)} />
      </Box>

      <Divider />

      <ChartPanel
        height={230}
        legend={
          <ChartLegend
            entries={analysis.axes.map((axis, index) => ({
              color: seriesColors[index % seriesColors.length]!,
              label: axis.label,
            }))}
          />
        }
        title={`Raw acceleration: ${wholeNumbers.format(analysis.sampleCount)} original samples (gravity included)`}
      >
        <RawAccelerationChart analysis={analysis} />
      </ChartPanel>

      <ChartPanel height={200} title="Motion variation in board summary windows">
        <WindowRmsChart analysis={analysis} />
      </ChartPanel>

      <ChartPanel
        height={250}
        legend={
          <ChartLegend
            entries={[
              ...analysis.spectrum.series.map((entry, index) => ({
                color: seriesColors[index % seriesColors.length]!,
                label: entry.label,
              })),
              {
                color: colors.text,
                dashed: true,
                label: `${productionStreamRateHz} Hz stream: Nyquist limit`,
              },
            ]}
          />
        }
        title="Frequency content: sum of per-axis power spectra"
      >
        <PowerSpectrumChart analysis={analysis} />
      </ChartPanel>

      <ChartPanel
        height={300}
        legend={
          <FormControlLabel
            control={
              <Checkbox
                checked={fixedScale}
                onChange={(event) => setFixedScale(event.target.checked)}
              />
            }
            label={
              <Typography color="text.secondary" sx={{ fontWeight: 800 }} variant="caption">
                Fixed -65 to -5 dB scale
              </Typography>
            }
          />
        }
        title="When fast vibration occurs (sum of XYZ spectral power)"
      >
        <SpectrogramChart analysis={analysis} fixedScale={fixedScale} />
      </ChartPanel>

      <Divider />

      <Stack spacing={1} sx={{ minWidth: 0 }}>
        <Typography sx={{ fontWeight: 900 }}>Energy by frequency band</Typography>
        <Box sx={{ ...surfaceSx({ level: radiusLevel.embedded, padding: space.none }), overflowX: "auto" }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                {["Band", "RMS (g)", "Share of AC power"].map((label) => (
                  <TableCell
                    key={label}
                    sx={{
                      color: "text.secondary",
                      fontWeight: 900,
                      textTransform: "uppercase",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {label}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {metrics.bands.map((band) => (
                <TableRow key={band.lowHz}>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>
                    {band.lowHz} to {band.highHz} Hz
                  </TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{band.rmsG.toFixed(4)}</TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>
                    {band.percentAcPower.toFixed(2)}%
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
        <Typography color="text.secondary" variant="caption">
          Welch PSD: Hann windows of {analysis.spectrum.segmentSamples} samples, 50% overlap,
          constant detrending per segment, three axis densities summed, bins{" "}
          {analysis.spectrum.binWidthHz.toFixed(3)} Hz wide. Bands integrate discrete bins
          excluding DC. Near-Nyquist energy can contain aliases. Desk and bench captures are not
          road classification.
        </Typography>
      </Stack>
    </Stack>
  );
}

export function ResearchCaptureInspector({
  onEditRecord,
  record,
  resource,
  session,
}: EntityDetailViewProps) {
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const recordId = String(record[resource.idField] ?? "");
  const recordingQuery = useResearchCaptureRecording(session, recordId || null);
  const recording = recordingQuery.data;

  const analysis = useMemo(() => {
    if (!recording) {
      return null;
    }

    try {
      return { analysis: analyzeRecording(recording), error: null };
    } catch (failure) {
      return {
        analysis: null,
        error: failure instanceof Error ? failure.message : "Unable to analyse this recording",
      };
    }
  }, [recording]);

  async function download(asset: "recording" | "photo") {
    setDownloadError(null);

    try {
      await downloadResearchCaptureAsset(session, recordId, asset);
    } catch (failure) {
      setDownloadError(failure instanceof Error ? failure.message : "Download failed");
    }
  }

  const capturedAt = textOf(record.capturedAt);
  const capturedLabel = capturedAt ? new Date(capturedAt).toLocaleString() : "Not set";

  return (
    <Paper
      elevation={0}
      sx={{
        ...surfaceSx({
          bgcolor: colors.surface,
          level: radiusLevel.embedded,
          padding: space.lg,
        }),
        minWidth: 0,
      }}
    >
      <Stack spacing={2} sx={{ minWidth: 0 }}>
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={2}
          sx={{ justifyContent: "space-between" }}
        >
          <Box>
            <Typography variant="h3">
              {textOf(record.label) ?? `Research capture ${recordId}`}
            </Typography>
            <Typography color="text.secondary" sx={{ fontWeight: 700 }}>
              {[textOf(record.category), capturedLabel].filter(Boolean).join(" - ")}
            </Typography>
          </Box>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
            {resource.canEdit || resource.canDelete ? (
              <Button onClick={onEditRecord} startIcon={<EditIcon />} variant="outlined">
                Edit record
              </Button>
            ) : null}
            {record.photoContentType ? (
              <Button
                onClick={() => download("photo")}
                startIcon={<DownloadIcon />}
                variant="outlined"
              >
                Download photo
              </Button>
            ) : null}
            <Button
              onClick={() => download("recording")}
              startIcon={<DownloadIcon />}
              variant="contained"
            >
              Download recording
            </Button>
          </Stack>
        </Stack>

        {textOf(record.note) ? (
          <Typography color="text.secondary">{textOf(record.note)}</Typography>
        ) : null}

        {downloadError ? <Alert severity="error">{downloadError}</Alert> : null}

        <Divider />

        {recordingQuery.isPending ? (
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", py: px(space.lg) }}>
            <CircularProgress size={20} />
            <Typography color="text.secondary" sx={{ fontWeight: 800 }}>
              Loading recording and running the signal analysis...
            </Typography>
          </Stack>
        ) : recordingQuery.error ? (
          <Alert severity="error">
            {recordingQuery.error instanceof Error
              ? recordingQuery.error.message
              : "Unable to load this recording"}
          </Alert>
        ) : analysis?.error ? (
          <Alert severity="error">{analysis.error}</Alert>
        ) : analysis?.analysis ? (
          <SignalFigure analysis={analysis.analysis} />
        ) : null}
      </Stack>
    </Paper>
  );
}
