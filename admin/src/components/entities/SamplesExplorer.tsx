import {
  Box,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import type { AdminResource } from "@skate-route-mapper/shared/adminResources";
import { space } from "@skate-route-mapper/shared/design";
import { useEffect, useMemo, useState } from "react";
import {
  useAdminRideDetail,
  useEntityRecords,
} from "../../features/entities/entityQueries";
import { px, radiusLevel, surfaceSx } from "../../theme/adminTheme";
import type { AdminSession, EntityRecord } from "../../types";

const allUsersValue = "__all__";
const anonymousUserValue = "__anonymous__";

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function nullableStringValue(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function displayDate(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") {
    return "Not set";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString();
}

function numberValue(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return "Not set";
  }

  return String(value);
}

function rideLabel(ride: EntityRecord) {
  const started = displayDate(ride.startedAt);
  const vehicle = stringValue(ride.vehicleType) || "ride";
  const samples = numberValue(ride.sampleCount);

  return `${started} - ${vehicle} - ${samples} samples`;
}

function sampleTimestamp(sample: EntityRecord) {
  return displayDate(sample.timestamp);
}

export function SamplesExplorer({
  initialRideId,
  resources,
  session,
}: {
  initialRideId: string | null;
  resources: AdminResource[];
  session: AdminSession;
}) {
  const usersResource = resources.find((resource) => resource.name === "users") ?? null;
  const ridesResource = resources.find((resource) => resource.name === "rides") ?? null;
  const usersQuery = useEntityRecords(session, usersResource);
  const ridesQuery = useEntityRecords(session, ridesResource);
  const users = usersQuery.data ?? [];
  const rides = ridesQuery.data ?? [];

  const [selectedUserId, setSelectedUserId] = useState(allUsersValue);
  const [selectedRideId, setSelectedRideId] = useState(initialRideId ?? "");

  useEffect(() => {
    if (initialRideId) {
      setSelectedRideId(initialRideId);
    }
  }, [initialRideId]);

  const filteredRides = useMemo(() => {
    if (selectedUserId === allUsersValue) {
      return rides;
    }

    if (selectedUserId === anonymousUserValue) {
      return rides.filter((ride) => !nullableStringValue(ride.userId));
    }

    return rides.filter((ride) => nullableStringValue(ride.userId) === selectedUserId);
  }, [rides, selectedUserId]);

  useEffect(() => {
    if (!selectedRideId) {
      return;
    }

    if (!filteredRides.some((ride) => stringValue(ride.id) === selectedRideId)) {
      setSelectedRideId("");
    }
  }, [filteredRides, selectedRideId]);

  const rideDetailQuery = useAdminRideDetail(session, selectedRideId || null);
  const samples = rideDetailQuery.data?.samples ?? [];

  return (
    <Stack spacing={2} sx={{ minWidth: 0 }}>
      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={2}
        sx={{ alignItems: { xs: "stretch", md: "center" } }}
      >
        <FormControl sx={{ minWidth: { md: 260 } }}>
          <InputLabel>User</InputLabel>
          <Select
            label="User"
            onChange={(event) => {
              setSelectedUserId(event.target.value);
              setSelectedRideId("");
            }}
            value={selectedUserId}
          >
            <MenuItem value={allUsersValue}>All users</MenuItem>
            <MenuItem value={anonymousUserValue}>Anonymous / no user</MenuItem>
            {users.map((user) => {
              const userId = stringValue(user.id);

              return (
                <MenuItem key={userId} value={userId}>
                  {stringValue(user.email) || userId}
                </MenuItem>
              );
            })}
          </Select>
        </FormControl>

        <FormControl sx={{ minWidth: { md: 420 } }}>
          <InputLabel>Ride</InputLabel>
          <Select
            label="Ride"
            onChange={(event) => setSelectedRideId(event.target.value)}
            value={selectedRideId}
          >
            <MenuItem value="">Choose a ride</MenuItem>
            {filteredRides.map((ride) => {
              const rideId = stringValue(ride.id);

              return (
                <MenuItem key={rideId} value={rideId}>
                  {rideLabel(ride)}
                </MenuItem>
              );
            })}
          </Select>
        </FormControl>
      </Stack>

      <Box>
        <Typography variant="h3">Samples</Typography>
        <Typography color="text.secondary" sx={{ fontWeight: 700 }}>
          {selectedRideId
            ? `${samples.length} samples for selected ride`
            : "Choose a ride to view its samples"}
        </Typography>
      </Box>

      {selectedRideId ? (
        <TableContainer
          component={Box}
          sx={{
            ...surfaceSx({ level: radiusLevel.embedded, padding: space.none }),
            maxWidth: "100%",
            overflowX: "auto",
            width: "100%",
          }}
        >
          <Table size="small" sx={{ minWidth: 1120 }}>
            <TableHead>
              <TableRow>
                {[
                  "Timestamp",
                  "AX",
                  "AY",
                  "AZ",
                  "GX",
                  "GY",
                  "GZ",
                  "Vibration",
                  "Latitude",
                  "Longitude",
                  "Speed",
                  "Location age ms",
                ].map((label) => (
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
              {samples.map((sample, index) => (
                <TableRow key={`${selectedRideId}-${index}`}>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{sampleTimestamp(sample)}</TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{numberValue(sample.ax)}</TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{numberValue(sample.ay)}</TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{numberValue(sample.az)}</TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{numberValue(sample.gx)}</TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{numberValue(sample.gy)}</TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{numberValue(sample.gz)}</TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>
                    {numberValue(sample.vibrationMagnitude)}
                  </TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>
                    {numberValue(sample.latitude)}
                  </TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>
                    {numberValue(sample.longitude)}
                  </TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{numberValue(sample.speed)}</TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>
                    {numberValue(sample.locationAgeMs)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      ) : (
        <Box
          sx={{
            ...surfaceSx({ level: radiusLevel.embedded, padding: space.lg }),
          }}
        >
          <Typography color="text.secondary" sx={{ fontWeight: 800 }}>
            Select a user and ride to inspect samples.
          </Typography>
        </Box>
      )}
    </Stack>
  );
}
