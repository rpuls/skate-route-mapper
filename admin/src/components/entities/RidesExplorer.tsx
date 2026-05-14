import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import EditIcon from "@mui/icons-material/Edit";
import {
  Box,
  Button,
  Divider,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import type { AdminResource } from "@skate-route-mapper/shared/adminResources";
import { colors, space } from "@skate-route-mapper/shared/design";
import { useEffect, useMemo, useState } from "react";
import { useAdminRideDetail } from "../../features/entities/entityQueries";
import { px, radiusLevel, surfaceSx } from "../../theme/adminTheme";
import type { AdminSession, EntityRecord } from "../../types";
import { EntityTable } from "./EntityTable";

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

export function RidesExplorer({
  onEditRecord,
  onViewSamples,
  records,
  resource,
  session,
}: {
  onEditRecord: (record: EntityRecord) => void;
  onViewSamples: (rideId: string) => void;
  records: EntityRecord[];
  resource: AdminResource;
  session: AdminSession;
}) {
  const [selectedRecord, setSelectedRecord] = useState<EntityRecord | null>(
    records[0] ?? null
  );
  const selectedRideId = stringValue(selectedRecord?.[resource.idField]);
  const rideDetailQuery = useAdminRideDetail(session, selectedRideId);
  const detail = rideDetailQuery.data?.ride ?? selectedRecord;
  const sampleCount = useMemo(
    () => rideDetailQuery.data?.samples.length ?? detail?.sampleCount ?? 0,
    [detail?.sampleCount, rideDetailQuery.data?.samples.length]
  );

  useEffect(() => {
    if (selectedRecord) {
      return;
    }

    setSelectedRecord(records[0] ?? null);
  }, [records, selectedRecord]);

  return (
    <Stack spacing={2} sx={{ minWidth: 0 }}>
      <EntityTable
        onSelectRecord={setSelectedRecord}
        records={records}
        resource={resource}
        selectedRecord={selectedRecord}
      />

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
                  onClick={() => selectedRideId && onViewSamples(selectedRideId)}
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
              <DetailItem label="Samples" value={sampleCount} />
              <DetailItem label="GPS points" value={detail.gpsPointCount} />
              <DetailItem label="Average vibration" value={detail.avgVibration} />
              <DetailItem label="Max vibration" value={detail.maxVibration} />
              <DetailItem label="User ID" value={detail.userId} />
              <DetailItem label="Device ID" value={detail.deviceId} />
              <DetailItem label="Client ID" value={detail.clientId} />
              <DetailItem label="Device model" value={detail.deviceModel} />
            </Box>
          </Stack>
        ) : (
          <Typography color="text.secondary" sx={{ fontWeight: 800 }}>
            Select a ride to inspect metadata and samples.
          </Typography>
        )}
      </Paper>
    </Stack>
  );
}
