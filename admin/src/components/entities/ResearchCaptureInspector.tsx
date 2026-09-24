// Research capture detail view, registered for the researchCaptures resource in
// features/entities/entityViewRegistry.ts.
//
// It answers two questions about a stored capture. What the board measured: the
// recording is downloaded once, decoded with the shared container reader, and
// analysed client side, reproducing hardware/research-signal-analysis.py in the
// browser. And what was being measured: the surface photo and the GPS track,
// which come from the same download and say whether a spectrum describes
// cobbles at walking pace or smooth asphalt at twenty.
//
// The label, category and note are the only writable parts of a capture, and
// they are edited here rather than through the generic dialog because a note
// runs to four thousand characters and deserves a box it fits in.
import CloseIcon from "@mui/icons-material/Close";
import DownloadIcon from "@mui/icons-material/Download";
import EditIcon from "@mui/icons-material/Edit";
import SaveIcon from "@mui/icons-material/Save";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Divider,
  FormControlLabel,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { colors, space } from "@skate-route-mapper/shared/design";
import {
  researchCategories,
  researchCategoryLabel,
} from "@skate-route-mapper/shared/researchContracts";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { downloadResearchCaptureAsset } from "../../api/adminApi";
import { useUpdateEntityRecord } from "../../features/entities/entityQueries";
import type { EntityDetailViewProps } from "../../features/entities/entityViewContract";
import { emptyCaptureField, readCaptureField } from "../../features/research/captureField";
import {
  useResearchCapturePhoto,
  useResearchCaptureRecording,
} from "../../features/research/researchQueries";
import {
  analyzeRecording,
  productionStreamRateHz,
  type SignalAnalysis,
} from "../../features/research/signalAnalysis";
import { adminLayout, px, radiusLevel, radiusPx, surfaceSx } from "../../theme/adminTheme";
import { DetailItem } from "../common/DetailItem";
import { PageCard } from "../common/PageCard";
import { ResearchCaptureSite } from "../research/ResearchCaptureSite";
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
        <Box sx={{ ...surfaceSx({ level: radiusLevel.inner, padding: space.none }), overflowX: "auto" }}>
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

/**
 * The three fields a capture lets an administrator correct.
 *
 * Which fields those are is still the API's answer, not this component's: the
 * datamodel marks them editable and the form only offers what it is given, so a
 * capture that the API later froze would show nothing to edit rather than
 * offering a save that fails.
 */
function CaptureDetailsEditor({
  onClose,
  record,
  resource,
  session,
}: {
  onClose: () => void;
  record: EntityDetailViewProps["record"];
  resource: EntityDetailViewProps["resource"];
  session: EntityDetailViewProps["session"];
}) {
  const updateMutation = useUpdateEntityRecord(session, resource);
  const editableFields = new Set(
    resource.fields.filter((field) => field.edit).map((field) => field.name)
  );
  const [label, setLabel] = useState(textOf(record.label) ?? "");
  const [category, setCategory] = useState(textOf(record.category) ?? "");
  const [note, setNote] = useState(textOf(record.note) ?? "");
  const knownCategory = researchCategories.some((option) => option.value === category);

  async function save() {
    await updateMutation.mutateAsync({
      id: String(record[resource.idField]),
      payload: {
        ...(editableFields.has("label") ? { label } : {}),
        ...(editableFields.has("category") ? { category } : {}),
        ...(editableFields.has("note") ? { note } : {}),
      },
    });

    onClose();
  }

  return (
    <Stack
      component="form"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      spacing={2}
      sx={{ minWidth: 0 }}
    >
      <Box
        sx={{
          display: "grid",
          gap: px(space.lg),
          gridTemplateColumns: { xs: "1fr", md: "minmax(0, 2fr) minmax(0, 1fr)" },
        }}
      >
        {editableFields.has("label") ? (
          <TextField
            label="Title"
            onChange={(event) => setLabel(event.target.value)}
            required
            value={label}
          />
        ) : null}
        {editableFields.has("category") ? (
          <TextField
            label="Category"
            onChange={(event) => setCategory(event.target.value)}
            select
            value={category}
          >
            {researchCategories.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
            {knownCategory || category === "" ? null : (
              <MenuItem value={category}>{category}</MenuItem>
            )}
          </TextField>
        ) : null}
      </Box>

      {editableFields.has("note") ? (
        <TextField
          label="Notes"
          maxRows={16}
          minRows={4}
          multiline
          onChange={(event) => setNote(event.target.value)}
          value={note}
        />
      ) : null}

      {updateMutation.error ? (
        <Alert severity="error">
          {updateMutation.error instanceof Error
            ? updateMutation.error.message
            : "Unable to save this capture"}
        </Alert>
      ) : null}

      <Stack direction={{ xs: "column-reverse", sm: "row" }} spacing={1}>
        <Button
          onClick={onClose}
          startIcon={<CloseIcon />}
          variant="outlined"
        >
          Cancel
        </Button>
        <Button
          disabled={updateMutation.isPending}
          startIcon={<SaveIcon />}
          type="submit"
          variant="contained"
        >
          {updateMutation.isPending ? "Saving..." : "Save details"}
        </Button>
      </Stack>
    </Stack>
  );
}

export function ResearchCaptureInspector({
  record,
  resource,
  session,
}: EntityDetailViewProps) {
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const recordId = String(record[resource.idField] ?? "");
  const recordingQuery = useResearchCaptureRecording(session, recordId || null);
  const recording = recordingQuery.data;
  const hasPhoto = Boolean(record.photoContentType);
  const photoQuery = useResearchCapturePhoto(session, recordId || null, hasPhoto);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

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

  // The GPS track and the capture's positions travel in the recording's own
  // header, so reading them costs one more parse of bytes already in hand
  // rather than another request.
  const field = useMemo(() => (recording ? readCaptureField(recording) : null), [recording]);

  // The browser frees an object URL only when it is told to, and an admin
  // selects a different capture every time they click a row.
  useEffect(() => {
    const blob = photoQuery.data;

    if (!blob) {
      setPhotoUrl(null);
      return;
    }

    const url = URL.createObjectURL(blob);

    setPhotoUrl(url);

    return () => {
      URL.revokeObjectURL(url);
      setPhotoUrl(null);
    };
  }, [photoQuery.data]);

  // A different capture is a different record, not a half-finished edit of this one.
  useEffect(() => {
    setIsEditing(false);
    setDownloadError(null);
  }, [recordId]);

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
  const category = textOf(record.category);

  return (
    <Stack sx={{ gap: px(adminLayout.containerGap), minWidth: 0 }}>
      <PageCard>
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
                {[category ? researchCategoryLabel(category) : null, capturedLabel]
                  .filter(Boolean)
                  .join(" - ")}
              </Typography>
            </Box>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
              {resource.canEdit && !isEditing ? (
                <Button
                  onClick={() => setIsEditing(true)}
                  startIcon={<EditIcon />}
                  variant="outlined"
                >
                  Edit details
                </Button>
              ) : null}
              {hasPhoto ? (
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

          {isEditing ? (
            <CaptureDetailsEditor
              key={recordId}
              onClose={() => setIsEditing(false)}
              record={record}
              resource={resource}
              session={session}
            />
          ) : textOf(record.note) ? (
            <Typography color="text.secondary" sx={{ whiteSpace: "pre-wrap" }}>
              {textOf(record.note)}
            </Typography>
          ) : null}

          {downloadError ? <Alert severity="error">{downloadError}</Alert> : null}

          <Divider />

          <ResearchCaptureSite
            field={field ?? emptyCaptureField}
            photoError={photoQuery.error instanceof Error ? photoQuery.error.message : null}
            photoPending={hasPhoto && photoQuery.isPending}
            photoUrl={photoUrl}
          />
        </Stack>
      </PageCard>

      <PageCard>
        {recordingQuery.isPending ? (
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
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
      </PageCard>
    </Stack>
  );
}
