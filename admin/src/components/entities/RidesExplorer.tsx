import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import EditIcon from "@mui/icons-material/Edit";
import RefreshIcon from "@mui/icons-material/Refresh";
import {
  Alert,
  Box,
  Button,
  Divider,
  Stack,
  Typography,
} from "@mui/material";
import { space } from "@skate-route-mapper/shared/design";
import {
  formatDistance,
  formatDuration,
  formatSpeedKmh,
} from "@skate-route-mapper/shared/rideTracking";
import { useEffect, useMemo, useState } from "react";
import type { EntityListViewProps } from "../../features/entities/entityViewContract";
import {
  useAdminRideDetail,
  useRecomputeRideMetrics,
} from "../../features/entities/entityQueries";
import { px } from "../../theme/adminTheme";
import type { EntityRecord } from "../../types";
import { EntityTable } from "./EntityTable";
import { RideAnalysisPanel } from "./RideAnalysisPanel";

// Samples for one ride are browsed in the samples resource rather than here.
const samplesResourceName = "samples";

function stringValue(value: unknown) {
  return typeof value === "string" ? value : null;
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return "Not set";
  }

  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : String(value);
  }

  if (typeof value === "string" && value.includes("T")) {
    const date = new Date(value);

    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleString();
    }
  }

  return String(value);
}

function DetailItem({ label, value }: { label: string; value: unknown }) {
  return (
    <Box>
      <Typography color="text.secondary" sx={{ fontWeight: 900 }} variant="caption">
        {label}
      </Typography>
      <Typography sx={{ fontWeight: 800, overflowWrap: "anywhere" }}>
        {displayValue(value)}
      </Typography>
    </Box>
  );
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Route figures are computed when a ride finishes, so a ride recorded before
 * ride tracking existed has none. "Not recorded" is the honest answer; a zero
 * would read as a ride that went nowhere.
 */
function RouteMetricItem({
  label,
  value,
  format,
}: {
  label: string;
  value: unknown;
  format: (value: number) => string;
}) {
  const numeric = numberValue(value);

  return (
    <DetailItem label={label} value={numeric === null ? "Not recorded" : format(numeric)} />
  );
}

export function RidesExplorer({
  onEditRecord,
  onOpenResource,
  onSortChange,
  records,
  resource,
  session,
  sort,
}: EntityListViewProps) {
  const [selectedRecord, setSelectedRecord] = useState<EntityRecord | null>(
    records[0] ?? null
  );
  const selectedRideId = stringValue(selectedRecord?.[resource.idField]);
  const rideDetailQuery = useAdminRideDetail(session, selectedRideId);
  const recomputeMetrics = useRecomputeRideMetrics(session);
  const detail = rideDetailQuery.data?.ride ?? selectedRecord;
  const sampleCount = useMemo(
    () => detail?.sampleCount ?? rideDetailQuery.data?.samples.length ?? 0,
    [detail?.sampleCount, rideDetailQuery.data?.samples.length]
  );

  useEffect(() => {
    if (
      selectedRecord &&
      records.some(
        (record) => record[resource.idField] === selectedRecord[resource.idField]
      )
    ) {
      return;
    }

    setSelectedRecord(records[0] ?? null);
  }, [records, resource.idField, selectedRecord]);

  return (
    <Stack spacing={2} sx={{ minWidth: 0 }}>
      <EntityTable
        onSelectRecord={setSelectedRecord}
        onSortChange={onSortChange}
        records={records}
        resource={resource}
        selectedRecord={selectedRecord}
        sort={sort}
      />

      <Divider />

      <Box sx={{ minWidth: 0 }}>
        {detail ? (
          <Stack spacing={2}>
            <Stack
              direction={{ xs: "column", md: "row" }}
              spacing={2}
              sx={{ justifyContent: "space-between" }}
            >
              <Box>
                <Typography variant="h3">Ride details</Typography>
                <Typography color="text.secondary" sx={{ fontWeight: 700 }}>
                  {selectedRideId}
                </Typography>
              </Box>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                <Button
                  disabled={!selectedRideId || recomputeMetrics.isPending}
                  onClick={() =>
                    selectedRideId && recomputeMetrics.mutate(selectedRideId)
                  }
                  startIcon={<RefreshIcon />}
                  variant="outlined"
                >
                  {recomputeMetrics.isPending ? "Recomputing" : "Recompute route"}
                </Button>
                <Button
                  disabled={!selectedRecord}
                  onClick={() => selectedRecord && onEditRecord(selectedRecord)}
                  startIcon={<EditIcon />}
                  variant="outlined"
                >
                  Edit record
                </Button>
                <Button
                  disabled={!selectedRideId}
                  endIcon={<ArrowForwardIcon />}
                  onClick={() =>
                    selectedRideId && onOpenResource(samplesResourceName, selectedRideId)
                  }
                  variant="contained"
                >
                  View samples
                </Button>
              </Stack>
            </Stack>

            <Divider />

            <Box
              sx={{
                display: "grid",
                gap: px(space.md),
                gridTemplateColumns: {
                  xs: "1fr",
                  md: "repeat(4, minmax(0, 1fr))",
                },
              }}
            >
              <DetailItem label="Started" value={detail.startedAt} />
              <DetailItem label="Ended" value={detail.endedAt} />
              <DetailItem label="Vehicle" value={detail.vehicleType} />
              <DetailItem label="Sensor" value={detail.sensorSource} />
              <RouteMetricItem
                format={formatDistance}
                label="Distance"
                value={detail.distanceMeters}
              />
              <RouteMetricItem
                format={formatDuration}
                label="Moving time"
                value={detail.movingSeconds}
              />
              <RouteMetricItem
                format={(value) => formatSpeedKmh(value)}
                label="Average speed"
                value={detail.avgSpeedMps}
              />
              <RouteMetricItem
                format={(value) => formatSpeedKmh(value)}
                label="Max speed"
                value={detail.maxSpeedMps}
              />
              <DetailItem label="Samples" value={sampleCount} />
              <DetailItem label="GPS points" value={detail.gpsPointCount} />
              <DetailItem
                label="Fixes kept / dropped"
                value={
                  numberValue(detail.acceptedFixCount) === null
                    ? "Not recorded"
                    : `${detail.acceptedFixCount} / ${detail.rejectedFixCount ?? 0}`
                }
              />
              <DetailItem label="Average vibration" value={detail.avgVibration} />
              <DetailItem label="Max vibration" value={detail.maxVibration} />
              <DetailItem label="Vibration samples" value={detail.vibrationSampleCount} />
              <DetailItem label="User ID" value={detail.userId} />
              <DetailItem label="Device ID" value={detail.deviceId} />
              <DetailItem label="Client ID" value={detail.clientId} />
              <DetailItem label="Device model" value={detail.deviceModel} />
            </Box>

            <Divider />

            {recomputeMetrics.isError ? (
              <Alert severity="error">
                {recomputeMetrics.error instanceof Error
                  ? recomputeMetrics.error.message
                  : "Unable to recompute this ride."}
              </Alert>
            ) : null}

            <RideAnalysisPanel samples={rideDetailQuery.data?.samples ?? []} />
            {rideDetailQuery.data?.samplesTruncated ? (
              <Alert severity="info">
                Showing the first {rideDetailQuery.data.samplesReturned} samples for this ride.
              </Alert>
            ) : null}
          </Stack>
        ) : (
          <Typography color="text.secondary" sx={{ fontWeight: 800 }}>
            Select a ride to inspect metadata and samples.
          </Typography>
        )}
      </Box>
    </Stack>
  );
}
