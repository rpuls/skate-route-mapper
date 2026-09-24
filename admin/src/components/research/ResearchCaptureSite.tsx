// Where a research capture was taken, and what the road looked like there.
//
// A capture's numbers mean nothing without this. The same asphalt reads rougher
// at 20 km/h than at 8, so the speed over the recorded window is part of the
// measurement rather than decoration, and the surface photo is what says
// whether a spectrum is describing cobbles or a kerb.
//
// Presentational: the inspector fetches and decodes, this draws.
import BrokenImageIcon from "@mui/icons-material/BrokenImage";
import {
  Alert,
  Box,
  CircularProgress,
  Stack,
  Typography,
} from "@mui/material";
import { colors, space } from "@skate-route-mapper/shared/design";
import {
  formatDistance,
  formatDuration,
  formatSpeedKmh,
} from "@skate-route-mapper/shared/rideTracking";
import type { ReactNode } from "react";
import { useMemo } from "react";
import type { CaptureField } from "../../features/research/captureField";
import { px, radiusLevel, radiusPx } from "../../theme/adminTheme";
import { DetailItem } from "../common/DetailItem";
import { TrackMap, type TrackMapMarker } from "../maps/TrackMap";

const panelHeight = 320;

function Panel({
  caption,
  children,
  title,
}: {
  caption?: string | undefined;
  children: ReactNode;
  title: string;
}) {
  return (
    <Stack spacing={1} sx={{ minWidth: 0 }}>
      <Typography sx={{ fontWeight: 900 }}>{title}</Typography>
      {children}
      {caption ? (
        <Typography color="text.secondary" variant="caption">
          {caption}
        </Typography>
      ) : null}
    </Stack>
  );
}

function PhotoPlaceholder({ children }: { children: ReactNode }) {
  return (
    <Stack
      spacing={1}
      sx={{
        alignItems: "center",
        bgcolor: colors.surfaceMuted,
        borderRadius: radiusPx(radiusLevel.utility),
        color: colors.textMuted,
        height: panelHeight,
        justifyContent: "center",
      }}
    >
      {children}
    </Stack>
  );
}

function SurfacePhoto({
  error,
  isPending,
  url,
}: {
  error: string | null;
  isPending: boolean;
  url: string | null;
}) {
  if (url) {
    return (
      <Box
        alt="Surface photographed at the capture site"
        component="img"
        onClick={() => window.open(url, "_blank", "noopener")}
        src={url}
        sx={{
          bgcolor: colors.surfaceMuted,
          borderRadius: radiusPx(radiusLevel.utility),
          cursor: "zoom-in",
          display: "block",
          height: panelHeight,
          objectFit: "cover",
          width: "100%",
        }}
      />
    );
  }

  if (isPending) {
    return (
      <PhotoPlaceholder>
        <CircularProgress size={20} />
      </PhotoPlaceholder>
    );
  }

  return (
    <PhotoPlaceholder>
      <BrokenImageIcon />
      <Typography sx={{ fontWeight: 800 }} variant="caption">
        {error ?? "No surface photo was taken"}
      </Typography>
    </PhotoPlaceholder>
  );
}

/**
 * The speed figures for the capture window.
 *
 * Both answers are shown because they fail differently: the reported speeds are
 * the platform's own Doppler-derived ground speed, the best measurement over a
 * run this short, and the position-derived ones come from the same filter and
 * maths a ride uses and say whether the reported speeds were plausible at all.
 */
function SpeedFigures({ field }: { field: CaptureField }) {
  const speed = field.track?.speed;

  if (!speed) {
    return null;
  }

  return (
    <Box
      sx={{
        display: "grid",
        gap: px(space.md),
        gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", lg: "repeat(4, 1fr)" },
      }}
    >
      <DetailItem
        label="Fixes"
        value={`${speed.fixCount} logged, ${speed.acceptedFixCount} kept`}
      />
      <DetailItem
        label="Reported speed"
        value={
          speed.reportedFixCount > 0
            ? `${formatSpeedKmh(speed.reportedMeanMps)} mean, ${formatSpeedKmh(speed.reportedMaxMps)} peak`
            : "Not reported"
        }
      />
      <DetailItem
        label="Speed from positions"
        value={`${formatSpeedKmh(speed.avgSpeedMps)} average, ${formatSpeedKmh(speed.maxSpeedMps)} peak`}
      />
      <DetailItem
        label="Distance covered"
        value={`${formatDistance(speed.distanceMeters)} over ${formatDuration(speed.movingSeconds)}`}
      />
      <DetailItem
        label="Worst accuracy"
        value={
          speed.worstAccuracyMeters === null
            ? "Not reported"
            : `${speed.worstAccuracyMeters.toFixed(1)} m`
        }
      />
    </Box>
  );
}

export function ResearchCaptureSite({
  field,
  photoError,
  photoPending,
  photoUrl,
}: {
  field: CaptureField;
  photoError: string | null;
  photoPending: boolean;
  photoUrl: string | null;
}) {
  // Both are memoised because the map frames itself from them, and rebuilding
  // the arrays on every render would refit the view under anyone panning it.
  const path = useMemo(
    () =>
      (field.track?.fixes ?? []).map((fix) => ({
        latitude: fix.latitude,
        longitude: fix.longitude,
      })),
    [field]
  );
  const markers = useMemo(() => {
    const entries: TrackMapMarker[] = [];
    const firstFix = path[0];
    const lastFix = path[path.length - 1];

    if (firstFix) {
      entries.push({ coordinate: firstFix, color: colors.success, label: "Recording started" });
    }

    if (lastFix && path.length > 1) {
      entries.push({ coordinate: lastFix, color: colors.accentStrong, label: "Recording ended" });
    }

    // A capture from before the track existed still knows where the rider stood
    // when the board was told to record, which is better than an empty map.
    if (path.length === 0 && field.startLocation) {
      entries.push({
        coordinate: field.startLocation,
        color: colors.link,
        label: "Position before recording",
      });
    }

    return entries;
  }, [field.startLocation, path]);

  const trackCaption = field.track?.error
    ? field.track.error
    : path.length > 0
      ? `${path.length} phone fixes logged for the recording window.`
      : markers.length > 0
        ? "This capture has no GPS track, only the position taken before recording."
        : "This capture was saved before the phone logged GPS, so it carries no position.";

  return (
    <Stack spacing={3} sx={{ minWidth: 0 }}>
      <Box
        sx={{
          display: "grid",
          gap: px(space.lg),
          gridTemplateColumns: { xs: "1fr", md: "minmax(0, 1fr) minmax(0, 1fr)" },
        }}
      >
        <Panel
          caption={photoUrl ? "Click the photo to open it full size." : undefined}
          title="Surface"
        >
          <SurfacePhoto error={photoError} isPending={photoPending} url={photoUrl} />
        </Panel>
        <Panel caption={trackCaption} title="Where it was recorded">
          <TrackMap
            emptyMessage="No GPS position was recorded"
            height={panelHeight}
            markers={markers}
            path={path}
          />
        </Panel>
      </Box>

      {field.track?.error ? <Alert severity="warning">{field.track.error}</Alert> : null}

      <SpeedFigures field={field} />
    </Stack>
  );
}
