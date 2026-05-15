import AddIcon from "@mui/icons-material/Add";
import CenterFocusStrongIcon from "@mui/icons-material/CenterFocusStrong";
import RemoveIcon from "@mui/icons-material/Remove";
import PauseIcon from "@mui/icons-material/Pause";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import {
  Box,
  Button,
  Checkbox,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Slider,
  Stack,
  Typography,
} from "@mui/material";
import { colors, space } from "@skate-route-mapper/shared/design";
import type { PointerEvent as ReactPointerEvent, WheelEvent } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { px, radiusLevel, surfaceSx } from "../../theme/adminTheme";
import type { EntityRecord } from "../../types";

const playbackSpeeds = [0.5, 1, 2, 5] as const;
const playbackTickMs = 120;
const mapTileSize = 256;
const defaultMapWidth = 760;

type ChartSeries = "filtered" | "normalized" | "raw" | "smoothed";

type MapViewState = {
  centerX: number;
  centerY: number;
  height: number;
  width: number;
  zoom: number;
};

type MapInteraction = {
  panX: number;
  panY: number;
  zoomOffset: number;
};

type AnalysisSample = {
  ax: number;
  ay: number;
  az: number;
  gx: number;
  gy: number;
  gz: number;
  latitude: number | null;
  locationAccuracy: number | null;
  locationAgeMs: number | null;
  longitude: number | null;
  normalizedVibration: number;
  rawVibration: number;
  score: number;
  smoothedVibration: number;
  speed: number | null;
  timestamp: number;
  trusted: boolean;
  x: number;
  y: number;
};

type AnalysisSettings = {
  maxLocationAccuracy: number;
  maxLocationAgeMs: number;
  minSpeed: number;
  normalization: "raw" | "baseline" | "speed";
  smoothingWindow: number;
  upperClipPercentile: number;
};

const defaultSettings: AnalysisSettings = {
  maxLocationAccuracy: 25,
  maxLocationAgeMs: 2500,
  minSpeed: 0,
  normalization: "baseline",
  smoothingWindow: 5,
  upperClipPercentile: 98,
};

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function timestampValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const date = new Date(value);

    if (!Number.isNaN(date.getTime())) {
      return date.getTime();
    }
  }

  return null;
}

function percentile(values: number[], percentileValue: number) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.round((percentileValue / 100) * (sorted.length - 1)))
  );

  return sorted[index] ?? 0;
}

function rollingAverage(values: number[], index: number, windowSize: number) {
  const halfWindow = Math.floor(windowSize / 2);
  const start = Math.max(0, index - halfWindow);
  const end = Math.min(values.length, index + halfWindow + 1);
  const visibleValues = values.slice(start, end);

  if (visibleValues.length === 0) {
    return 0;
  }

  return (
    visibleValues.reduce((sum, value) => sum + value, 0) / visibleValues.length
  );
}

function formatDuration(ms: number) {
  const safeMs = Math.max(0, ms);
  const totalSeconds = Math.floor(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatNumber(value: number | null | undefined, decimals = 3) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "Not set";
  }

  return value.toFixed(decimals);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function lngLatToWorld(longitude: number, latitude: number, zoom: number) {
  const sinLatitude = Math.sin((clamp(latitude, -85.05112878, 85.05112878) * Math.PI) / 180);
  const scale = mapTileSize * 2 ** zoom;

  return {
    x: ((longitude + 180) / 360) * scale,
    y:
      (0.5 -
        Math.log((1 + sinLatitude) / (1 - sinLatitude)) / (4 * Math.PI)) *
      scale,
  };
}

function mapPoint(
  sample: AnalysisSample,
  mapView: MapViewState
): { x: number; y: number } | null {
  if (sample.latitude === null || sample.longitude === null) {
    return null;
  }

  const world = lngLatToWorld(sample.longitude, sample.latitude, mapView.zoom);

  return {
    x: world.x - mapView.centerX + mapView.width / 2,
    y: world.y - mapView.centerY + mapView.height / 2,
  };
}

function mapViewForSamples(
  samples: AnalysisSample[],
  width: number,
  height: number
): MapViewState {
  const geoSamples = samples.filter(
    (sample) => sample.latitude !== null && sample.longitude !== null
  );

  if (geoSamples.length === 0) {
    const center = lngLatToWorld(12.5683, 55.6761, 12);

    return {
      centerX: center.x,
      centerY: center.y,
      height,
      width,
      zoom: 12,
    };
  }

  const latitudes = geoSamples.map((sample) => sample.latitude as number);
  const longitudes = geoSamples.map((sample) => sample.longitude as number);
  const minLatitude = Math.min(...latitudes);
  const maxLatitude = Math.max(...latitudes);
  const minLongitude = Math.min(...longitudes);
  const maxLongitude = Math.max(...longitudes);
  const centerLatitude = (minLatitude + maxLatitude) / 2;
  const centerLongitude = (minLongitude + maxLongitude) / 2;
  const minWorld = lngLatToWorld(minLongitude, maxLatitude, 0);
  const maxWorld = lngLatToWorld(maxLongitude, minLatitude, 0);
  const worldSpanX = Math.max(0.000001, Math.abs(maxWorld.x - minWorld.x));
  const worldSpanY = Math.max(0.000001, Math.abs(maxWorld.y - minWorld.y));
  const padding = 80;
  const zoom = clamp(
    Math.floor(
      Math.log2(
        Math.min(
          Math.max(1, width - padding) / worldSpanX,
          Math.max(1, height - padding) / worldSpanY
        )
      )
    ),
    3,
    18
  );
  const center = lngLatToWorld(centerLongitude, centerLatitude, zoom);

  return {
    centerX: center.x,
    centerY: center.y,
    height,
    width,
    zoom,
  };
}

function mapTiles(mapView: MapViewState) {
  const halfWidth = mapView.width / 2;
  const halfHeight = mapView.height / 2;
  const startTileX = Math.floor((mapView.centerX - halfWidth) / mapTileSize) - 1;
  const endTileX = Math.floor((mapView.centerX + halfWidth) / mapTileSize) + 1;
  const startTileY = Math.floor((mapView.centerY - halfHeight) / mapTileSize) - 1;
  const endTileY = Math.floor((mapView.centerY + halfHeight) / mapTileSize) + 1;
  const maxTile = 2 ** mapView.zoom;
  const tiles: Array<{
    key: string;
    url: string;
    x: number;
    y: number;
  }> = [];

  for (let tileX = startTileX; tileX <= endTileX; tileX += 1) {
    for (let tileY = startTileY; tileY <= endTileY; tileY += 1) {
      if (tileY < 0 || tileY >= maxTile) {
        continue;
      }

      const wrappedTileX = ((tileX % maxTile) + maxTile) % maxTile;

      tiles.push({
        key: `${mapView.zoom}-${tileX}-${tileY}`,
        url: `https://tile.openstreetmap.org/${mapView.zoom}/${wrappedTileX}/${tileY}.png`,
        x: tileX * mapTileSize - mapView.centerX + halfWidth,
        y: tileY * mapTileSize - mapView.centerY + halfHeight,
      });
    }
  }

  return tiles;
}

function applyMapInteraction(
  baseMapView: MapViewState,
  interaction: MapInteraction
): MapViewState {
  const zoom = clamp(baseMapView.zoom + interaction.zoomOffset, 3, 19);
  const zoomScale = 2 ** (zoom - baseMapView.zoom);

  return {
    ...baseMapView,
    centerX: baseMapView.centerX * zoomScale - interaction.panX,
    centerY: baseMapView.centerY * zoomScale - interaction.panY,
    zoom,
  };
}

function qualityColor(score: number) {
  if (score >= 0.8) {
    return "#d7263d";
  }

  if (score >= 0.6) {
    return "#f97316";
  }

  if (score >= 0.3) {
    return "#facc15";
  }

  return "#16a34a";
}

function toAnalysisSamples(
  samples: EntityRecord[],
  settings: AnalysisSettings,
  width: number,
  height: number
) {
  const parsed = samples
    .map((sample) => ({
      ax: numberValue(sample.ax) ?? 0,
      ay: numberValue(sample.ay) ?? 0,
      az: numberValue(sample.az) ?? 0,
      gx: numberValue(sample.gx) ?? 0,
      gy: numberValue(sample.gy) ?? 0,
      gz: numberValue(sample.gz) ?? 0,
      latitude: numberValue(sample.latitude),
      locationAccuracy: numberValue(sample.locationAccuracy),
      locationAgeMs: numberValue(sample.locationAgeMs),
      longitude: numberValue(sample.longitude),
      rawVibration: numberValue(sample.vibrationMagnitude) ?? 0,
      speed: numberValue(sample.speed),
      timestamp:
        timestampValue(sample.timestamp) ?? timestampValue(sample.recordedAt) ?? 0,
    }))
    .sort((left, right) => left.timestamp - right.timestamp);

  const rawValues = parsed.map((sample) => sample.rawVibration);
  const clipValue = percentile(rawValues, settings.upperClipPercentile) || 1;
  const baseline = percentile(rawValues, 50) || 1;
  const trustedGeoSamples = parsed.filter(
    (sample) => sample.latitude !== null && sample.longitude !== null
  );
  const latitudes = trustedGeoSamples.map((sample) => sample.latitude as number);
  const longitudes = trustedGeoSamples.map((sample) => sample.longitude as number);
  const minLatitude = latitudes.length > 0 ? Math.min(...latitudes) : 0;
  const maxLatitude = latitudes.length > 0 ? Math.max(...latitudes) : 1;
  const minLongitude = longitudes.length > 0 ? Math.min(...longitudes) : 0;
  const maxLongitude = longitudes.length > 0 ? Math.max(...longitudes) : 1;
  const latitudeRange = Math.max(0.000001, maxLatitude - minLatitude);
  const longitudeRange = Math.max(0.000001, maxLongitude - minLongitude);
  const smoothedRawValues = rawValues.map((_, index) =>
    rollingAverage(rawValues, index, settings.smoothingWindow)
  );

  return parsed.map<AnalysisSample>((sample, index) => {
    const clipped = Math.min(sample.rawVibration, clipValue);
    const speed = sample.speed ?? 0;
    const normalizedVibration =
      settings.normalization === "baseline"
        ? clipped / baseline
        : settings.normalization === "speed"
          ? clipped / Math.max(1, Math.sqrt(Math.max(0.1, speed)))
          : clipped;
    const normalizedClip =
      settings.normalization === "baseline"
        ? clipValue / baseline
        : settings.normalization === "speed"
          ? clipValue
          : clipValue;
    const score = Math.min(
      1,
      Math.max(0, normalizedVibration / Math.max(0.000001, normalizedClip))
    );
    const hasTrustedLocation =
      sample.latitude !== null &&
      sample.longitude !== null &&
      (sample.locationAccuracy ?? Number.POSITIVE_INFINITY) <=
        settings.maxLocationAccuracy &&
      (sample.locationAgeMs ?? Number.POSITIVE_INFINITY) <=
        settings.maxLocationAgeMs;
    const hasTrustedSpeed = speed >= settings.minSpeed;
    const x =
      sample.longitude === null
        ? 0
        : ((sample.longitude - minLongitude) / longitudeRange) * width;
    const y =
      sample.latitude === null
        ? height
        : height - ((sample.latitude - minLatitude) / latitudeRange) * height;

    return {
      ...sample,
      normalizedVibration,
      score,
      smoothedVibration: smoothedRawValues[index] ?? sample.rawVibration,
      trusted: hasTrustedLocation && hasTrustedSpeed,
      x,
      y,
    };
  });
}

function pointsForSeries(
  samples: AnalysisSample[],
  width: number,
  height: number,
  value: (sample: AnalysisSample) => number
) {
  if (samples.length === 0) {
    return "";
  }

  const values = samples.map(value);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = Math.max(0.000001, maxValue - minValue);

  return samples
    .map((sample, index) => {
      const x = samples.length <= 1 ? 0 : (index / (samples.length - 1)) * width;
      const y = height - ((value(sample) - minValue) / range) * height;

      return `${x},${y}`;
    })
    .join(" ");
}

function trustedPath(samples: AnalysisSample[]) {
  return samples.filter((sample) => sample.trusted);
}

function geoPath(samples: AnalysisSample[]) {
  return samples.filter(
    (sample) => sample.latitude !== null && sample.longitude !== null
  );
}

export function RideAnalysisPanel({ samples }: { samples: EntityRecord[] }) {
  const [settings, setSettings] = useState(defaultSettings);
  const [playbackIndex, setPlaybackIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] =
    useState<(typeof playbackSpeeds)[number]>(1);
  const [visibleSeries, setVisibleSeries] = useState<Record<ChartSeries, boolean>>({
    filtered: true,
    normalized: true,
    raw: true,
    smoothed: true,
  });
  const [mapInteraction, setMapInteraction] = useState<MapInteraction>({
    panX: 0,
    panY: 0,
    zoomOffset: 0,
  });
  const [mapWidth, setMapWidth] = useState(defaultMapWidth);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapDragRef = useRef<{
    panX: number;
    panY: number;
    pointerId: number;
    startX: number;
    startY: number;
  } | null>(null);
  const mapHeight = 340;
  const chartWidth = 760;
  const chartHeight = 220;
  const analysisSamples = useMemo(
    () => toAnalysisSamples(samples, settings, mapWidth, mapHeight),
    [mapWidth, samples, settings]
  );
  const trustedSamples = useMemo(
    () => trustedPath(analysisSamples),
    [analysisSamples]
  );
  const geoSamples = useMemo(() => geoPath(analysisSamples), [analysisSamples]);
  const baseMapView = useMemo(
    () => mapViewForSamples(analysisSamples, mapWidth, mapHeight),
    [analysisSamples, mapWidth]
  );
  const mapView = useMemo(
    () => applyMapInteraction(baseMapView, mapInteraction),
    [baseMapView, mapInteraction]
  );
  const tiles = useMemo(() => mapTiles(mapView), [mapView]);
  const currentSample = analysisSamples[playbackIndex];
  const currentMapSample =
    currentSample?.latitude !== null && currentSample?.longitude !== null
      ? currentSample
      : null;
  const currentMapPoint = currentMapSample
    ? mapPoint(currentMapSample, mapView)
    : null;
  const firstTimestamp = analysisSamples[0]?.timestamp ?? 0;
  const lastTimestamp =
    analysisSamples[analysisSamples.length - 1]?.timestamp ?? firstTimestamp;
  const elapsedMs = Math.max(0, (currentSample?.timestamp ?? firstTimestamp) - firstTimestamp);
  const totalMs = Math.max(0, lastTimestamp - firstTimestamp);
  const trustedPercent =
    analysisSamples.length === 0
      ? 0
      : (trustedSamples.length / analysisSamples.length) * 100;
  const severeSamples = trustedSamples.filter((sample) => sample.score >= 0.8);
  const severePercent =
    trustedSamples.length === 0
      ? 0
      : (severeSamples.length / trustedSamples.length) * 100;

  useEffect(() => {
    setPlaybackIndex(0);
    setIsPlaying(false);
  }, [samples]);

  useEffect(() => {
    setMapInteraction({
      panX: 0,
      panY: 0,
      zoomOffset: 0,
    });
  }, [samples]);

  useLayoutEffect(() => {
    const element = mapContainerRef.current;

    if (!element) {
      return;
    }

    const updateMapWidth = () => {
      const nextWidth = element.getBoundingClientRect().width;

      if (nextWidth && Number.isFinite(nextWidth)) {
        setMapWidth(Math.max(defaultMapWidth, Math.round(nextWidth)));
      }
    };

    updateMapWidth();

    const observer = new ResizeObserver((entries) => {
      const nextWidth =
        entries[0]?.contentRect.width ?? element.getBoundingClientRect().width;

      if (nextWidth && Number.isFinite(nextWidth)) {
        setMapWidth(Math.max(defaultMapWidth, Math.round(nextWidth)));
      }
    });

    observer.observe(element);
    window.addEventListener("resize", updateMapWidth);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateMapWidth);
    };
  }, []);

  useEffect(() => {
    if (!isPlaying || analysisSamples.length < 2) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }

      return;
    }

    timerRef.current = setInterval(() => {
      setPlaybackIndex((currentIndex) => {
        const current = analysisSamples[currentIndex];

        if (!current || currentIndex >= analysisSamples.length - 1) {
          setIsPlaying(false);
          return Math.max(0, analysisSamples.length - 1);
        }

        const targetTimestamp = current.timestamp + playbackTickMs * playbackSpeed;
        const nextIndex = analysisSamples.findIndex(
          (sample, sampleIndex) =>
            sampleIndex > currentIndex && sample.timestamp >= targetTimestamp
        );

        if (nextIndex === -1) {
          setIsPlaying(false);
          return analysisSamples.length - 1;
        }

        return nextIndex;
      });
    }, playbackTickMs);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [analysisSamples, isPlaying, playbackSpeed]);

  function updateSetting<TKey extends keyof AnalysisSettings>(
    key: TKey,
    value: AnalysisSettings[TKey]
  ) {
    setSettings((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function togglePlayback() {
    if (analysisSamples.length === 0) {
      return;
    }

    if (playbackIndex >= analysisSamples.length - 1) {
      setPlaybackIndex(0);
    }

    setIsPlaying((current) => !current);
  }

  function resetPlayback() {
    setPlaybackIndex(0);
    setIsPlaying(false);
  }

  function toggleSeries(series: ChartSeries) {
    setVisibleSeries((current) => ({
      ...current,
      [series]: !current[series],
    }));
  }

  function zoomMap(delta: number) {
    setMapInteraction((current) => ({
      ...current,
      zoomOffset: clamp(current.zoomOffset + delta, -5, 5),
    }));
  }

  function resetMapView() {
    setMapInteraction({
      panX: 0,
      panY: 0,
      zoomOffset: 0,
    });
  }

  function handleMapPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    mapDragRef.current = {
      panX: mapInteraction.panX,
      panY: mapInteraction.panY,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
  }

  function handleMapPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = mapDragRef.current;

    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    setMapInteraction((current) => ({
      ...current,
      panX: drag.panX + event.clientX - drag.startX,
      panY: drag.panY + event.clientY - drag.startY,
    }));
  }

  function handleMapPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (mapDragRef.current?.pointerId === event.pointerId) {
      mapDragRef.current = null;
    }
  }

  function handleMapWheel(event: WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    zoomMap(event.deltaY > 0 ? -1 : 1);
  }

  if (samples.length === 0) {
    return (
      <Paper
        elevation={0}
        sx={surfaceSx({ level: radiusLevel.embedded, padding: space.lg })}
      >
        <Typography color="text.secondary" sx={{ fontWeight: 800 }}>
          This ride has no samples to analyse yet.
        </Typography>
      </Paper>
    );
  }

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="h3">Ride analysis</Typography>
        <Typography color="text.secondary" sx={{ fontWeight: 700 }}>
          Frontend-only analysis for exploring raw signal quality, filtering,
          normalization, and route replay.
        </Typography>
      </Box>

      <Box
        sx={{
          display: "grid",
          gap: px(space.md),
          gridTemplateColumns: {
            xs: "1fr",
            lg: "repeat(4, minmax(0, 1fr))",
          },
        }}
      >
        <Metric label="Samples" value={analysisSamples.length} />
        <Metric label="Trusted GPS" value={`${trustedPercent.toFixed(0)}%`} />
        <Metric label="Severe roughness" value={`${severePercent.toFixed(0)}%`} />
        <Metric
          label="Current score"
          value={formatNumber(currentSample?.score, 2)}
        />
      </Box>

      <Paper
        elevation={0}
        sx={{
          ...surfaceSx({ level: radiusLevel.embedded, padding: space.lg }),
          overflowX: "auto",
        }}
      >
        <Stack spacing={2} sx={{ minWidth: defaultMapWidth }}>
          <Stack
            direction={{ xs: "column", md: "row" }}
            spacing={2}
            sx={{ alignItems: { md: "center" }, justifyContent: "space-between" }}
          >
            <Box>
              <Typography sx={{ fontWeight: 900 }}>Route replay</Typography>
              <Typography color="text.secondary" sx={{ fontWeight: 700 }}>
                {formatDuration(elapsedMs)} / {formatDuration(totalMs)}
              </Typography>
            </Box>
            <Stack direction="row" spacing={1}>
              <Button
                disabled={analysisSamples.length === 0}
                onClick={togglePlayback}
                startIcon={isPlaying ? <PauseIcon /> : <PlayArrowIcon />}
                variant="contained"
              >
                {isPlaying ? "Pause" : "Play"}
              </Button>
              <Button
                onClick={resetPlayback}
                startIcon={<RestartAltIcon />}
                variant="outlined"
              >
                Reset
              </Button>
              <FormControl sx={{ minWidth: 96 }}>
                <InputLabel>Speed</InputLabel>
                <Select
                  label="Speed"
                  onChange={(event) =>
                    setPlaybackSpeed(Number(event.target.value) as typeof playbackSpeed)
                  }
                  value={playbackSpeed}
                >
                  {playbackSpeeds.map((speed) => (
                    <MenuItem key={speed} value={speed}>
                      {speed}x
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Stack>
          </Stack>

          <Box
            onPointerCancel={handleMapPointerUp}
            onPointerDown={handleMapPointerDown}
            onPointerMove={handleMapPointerMove}
            onPointerUp={handleMapPointerUp}
            onWheel={handleMapWheel}
            ref={mapContainerRef}
            sx={{
              bgcolor: colors.surfaceMuted,
              borderRadius: px(18),
              cursor: mapDragRef.current ? "grabbing" : "grab",
              height: mapHeight,
              overflow: "hidden",
              position: "relative",
              touchAction: "none",
              userSelect: "none",
              width: "100%",
            }}
          >
            <svg
              height={mapHeight}
              style={{ display: "block", height: "100%", width: "100%" }}
              viewBox={`0 0 ${mapWidth} ${mapHeight}`}
              width={mapWidth}
            >
              <rect fill={colors.surfaceMuted} height={mapHeight} width={mapWidth} />
              {tiles.map((tile) => (
                <image
                  height={mapTileSize}
                  href={tile.url}
                  key={tile.key}
                  preserveAspectRatio="none"
                  width={mapTileSize}
                  x={tile.x}
                  y={tile.y}
                />
              ))}
              {geoSamples.length === 0 ? (
                <text
                  fill={colors.textMuted}
                  fontSize="18"
                  fontWeight="800"
                  textAnchor="middle"
                  x={mapWidth / 2}
                  y={mapHeight / 2}
                >
                  No GPS points for this ride
                </text>
              ) : null}
              {geoSamples.slice(1).map((sample, index) => {
                const previous = geoSamples[index];
                const previousPoint = previous ? mapPoint(previous, mapView) : null;
                const samplePoint = mapPoint(sample, mapView);

                if (!previousPoint || !samplePoint) {
                  return null;
                }

                return (
                  <line
                    key={`${sample.timestamp}-geo-${index}`}
                    stroke="rgba(23, 17, 12, 0.18)"
                    strokeLinecap="round"
                    strokeWidth="9"
                    x1={previousPoint.x}
                    x2={samplePoint.x}
                    y1={previousPoint.y}
                    y2={samplePoint.y}
                  />
                );
              })}
              {trustedSamples.slice(1).map((sample, index) => {
                const previous = trustedSamples[index];
                const previousPoint = previous ? mapPoint(previous, mapView) : null;
                const samplePoint = mapPoint(sample, mapView);

                if (!previousPoint || !samplePoint) {
                  return null;
                }

                return (
                  <line
                    key={`${sample.timestamp}-${index}`}
                    stroke={qualityColor(sample.score)}
                    strokeLinecap="round"
                    strokeWidth="6"
                    x1={previousPoint.x}
                    x2={samplePoint.x}
                    y1={previousPoint.y}
                    y2={samplePoint.y}
                  />
                );
              })}
              {currentMapSample && currentMapPoint ? (
                <circle
                  cx={currentMapPoint.x}
                  cy={currentMapPoint.y}
                  fill={qualityColor(currentMapSample.score)}
                  opacity={currentMapSample.trusted ? 1 : 0.45}
                  r="9"
                  stroke="#ffffff"
                  strokeWidth="4"
                />
              ) : null}
            </svg>
            <Stack
              direction="row"
              onPointerDown={(event) => event.stopPropagation()}
              spacing={0.5}
              sx={{
                bgcolor: "rgba(255, 255, 255, 0.9)",
                borderRadius: px(10),
                boxShadow: "0 8px 20px rgba(23, 17, 12, 0.16)",
                p: 0.5,
                position: "absolute",
                right: 8,
                top: 8,
              }}
            >
              <IconButton
                aria-label="Zoom in"
                onClick={() => zoomMap(1)}
                size="small"
              >
                <AddIcon />
              </IconButton>
              <IconButton
                aria-label="Zoom out"
                onClick={() => zoomMap(-1)}
                size="small"
              >
                <RemoveIcon />
              </IconButton>
              <IconButton
                aria-label="Reset map view"
                onClick={resetMapView}
                size="small"
              >
                <CenterFocusStrongIcon />
              </IconButton>
            </Stack>
            <Typography
              sx={{
                bgcolor: "rgba(255, 255, 255, 0.86)",
                borderRadius: px(8),
                bottom: 8,
                color: colors.textMuted,
                fontWeight: 800,
                left: 8,
                px: 1,
                position: "absolute",
              }}
              variant="caption"
            >
              OpenStreetMap
            </Typography>
          </Box>

          <input
            max={Math.max(0, analysisSamples.length - 1)}
            min={0}
            onChange={(event) => {
              setIsPlaying(false);
              setPlaybackIndex(Number(event.target.value));
            }}
            style={{ width: "100%" }}
            type="range"
            value={playbackIndex}
          />
        </Stack>
      </Paper>

      <Paper
        elevation={0}
        sx={{
          ...surfaceSx({ level: radiusLevel.embedded, padding: space.lg }),
          overflowX: "auto",
        }}
      >
        <Stack spacing={2} sx={{ minWidth: chartWidth }}>
          <Stack spacing={2}>
            <Typography sx={{ fontWeight: 900 }}>Signal chart</Typography>
            <Box
              sx={{
                display: "grid",
                gap: px(space.lg),
                gridTemplateColumns: {
                  xs: "1fr",
                  md: "repeat(2, minmax(0, 1fr))",
                },
              }}
            >
              <ControlSlider
                label="Smoothing window"
                max={25}
                min={1}
                onChange={(value) => updateSetting("smoothingWindow", value)}
                step={2}
                value={settings.smoothingWindow}
              />
              <ControlSlider
                label="Minimum speed m/s"
                max={5}
                min={0}
                onChange={(value) => updateSetting("minSpeed", value)}
                step={0.5}
                value={settings.minSpeed}
              />
              <ControlSlider
                label="Max GPS accuracy m"
                max={100}
                min={5}
                onChange={(value) => updateSetting("maxLocationAccuracy", value)}
                step={5}
                value={settings.maxLocationAccuracy}
              />
              <ControlSlider
                label="Max GPS age ms"
                max={10000}
                min={500}
                onChange={(value) => updateSetting("maxLocationAgeMs", value)}
                step={500}
                value={settings.maxLocationAgeMs}
              />
              <ControlSlider
                label="Upper clip percentile"
                max={100}
                min={80}
                onChange={(value) => updateSetting("upperClipPercentile", value)}
                step={1}
                value={settings.upperClipPercentile}
              />
              <FormControl>
                <InputLabel>Normalization</InputLabel>
                <Select
                  label="Normalization"
                  onChange={(event) =>
                    updateSetting(
                      "normalization",
                      event.target.value as AnalysisSettings["normalization"]
                    )
                  }
                  value={settings.normalization}
                >
                  <MenuItem value="raw">Raw clipped vibration</MenuItem>
                  <MenuItem value="baseline">Per-ride baseline</MenuItem>
                  <MenuItem value="speed">Speed adjusted</MenuItem>
                </Select>
              </FormControl>
            </Box>
            <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
              <SeriesToggle
                checked={visibleSeries.raw}
                color={colors.textMuted}
                label="Raw vibration"
                onChange={() => toggleSeries("raw")}
              />
              <SeriesToggle
                checked={visibleSeries.smoothed}
                color={colors.accent}
                label="Smoothed vibration"
                onChange={() => toggleSeries("smoothed")}
              />
              <SeriesToggle
                checked={visibleSeries.normalized}
                color="#d7263d"
                label="Normalized score"
                onChange={() => toggleSeries("normalized")}
              />
              <SeriesToggle
                checked={visibleSeries.filtered}
                color="rgba(23, 17, 12, 0.28)"
                label="Filtered out"
                onChange={() => toggleSeries("filtered")}
              />
            </Stack>
          </Stack>
          <svg height={chartHeight} viewBox={`0 0 ${chartWidth} ${chartHeight}`} width={chartWidth}>
            <rect fill="#ffffff" height={chartHeight} width={chartWidth} />
            {visibleSeries.filtered
              ? analysisSamples.map((sample, index) =>
                  sample.trusted ? null : (
                    <rect
                      fill="rgba(23, 17, 12, 0.08)"
                      height={chartHeight}
                      key={`${sample.timestamp}-untrusted-${index}`}
                      width={Math.max(1, chartWidth / Math.max(1, analysisSamples.length))}
                      x={(index / Math.max(1, analysisSamples.length - 1)) * chartWidth}
                      y={0}
                    />
                  )
                )
              : null}
            {visibleSeries.raw ? (
              <polyline
                fill="none"
                points={pointsForSeries(
                  analysisSamples,
                  chartWidth,
                  chartHeight,
                  (sample) => sample.rawVibration
                )}
                stroke={colors.textMuted}
                strokeWidth="2"
              />
            ) : null}
            {visibleSeries.smoothed ? (
              <polyline
                fill="none"
                points={pointsForSeries(
                  analysisSamples,
                  chartWidth,
                  chartHeight,
                  (sample) => sample.smoothedVibration
                )}
                stroke={colors.accent}
                strokeWidth="3"
              />
            ) : null}
            {visibleSeries.normalized ? (
              <polyline
                fill="none"
                points={pointsForSeries(
                  analysisSamples,
                  chartWidth,
                  chartHeight,
                  (sample) => sample.score
                )}
                stroke="#d7263d"
                strokeWidth="2"
              />
            ) : null}
            {analysisSamples.length > 1 ? (
              <line
                stroke="#111111"
                strokeDasharray="4 4"
                strokeWidth="2"
                x1={(playbackIndex / (analysisSamples.length - 1)) * chartWidth}
                x2={(playbackIndex / (analysisSamples.length - 1)) * chartWidth}
                y1={0}
                y2={chartHeight}
              />
            ) : null}
          </svg>
        </Stack>
      </Paper>

      {currentSample ? (
        <Paper
          elevation={0}
          sx={surfaceSx({ level: radiusLevel.embedded, padding: space.lg })}
        >
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
            <Metric label="Raw vibration" value={formatNumber(currentSample.rawVibration)} />
            <Metric label="Smoothed" value={formatNumber(currentSample.smoothedVibration)} />
            <Metric label="Normalized" value={formatNumber(currentSample.normalizedVibration)} />
            <Metric label="Speed" value={formatNumber(currentSample.speed)} />
            <Metric
              label="GPS accuracy"
              value={formatNumber(currentSample.locationAccuracy, 1)}
            />
            <Metric label="GPS age" value={formatNumber(currentSample.locationAgeMs, 0)} />
            <Metric label="Latitude" value={formatNumber(currentSample.latitude, 6)} />
            <Metric label="Longitude" value={formatNumber(currentSample.longitude, 6)} />
          </Box>
        </Paper>
      ) : null}
    </Stack>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <Paper
      elevation={0}
      sx={surfaceSx({ level: radiusLevel.embedded, padding: space.md })}
    >
      <Typography color="text.secondary" sx={{ fontWeight: 900 }} variant="caption">
        {label}
      </Typography>
      <Typography sx={{ fontWeight: 900 }}>{value}</Typography>
    </Paper>
  );
}

function ControlSlider({
  label,
  max,
  min,
  onChange,
  step,
  value,
}: {
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  step: number;
  value: number;
}) {
  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: "space-between" }}>
        <Typography sx={{ fontWeight: 800 }}>{label}</Typography>
        <Typography color="text.secondary" sx={{ fontWeight: 800 }}>
          {value}
        </Typography>
      </Stack>
      <Slider
        max={max}
        min={min}
        onChange={(_, nextValue) => onChange(Number(nextValue))}
        step={step}
        value={value}
      />
    </Box>
  );
}

function SeriesToggle({
  checked,
  color,
  label,
  onChange,
}: {
  checked: boolean;
  color: string;
  label: string;
  onChange: () => void;
}) {
  return (
    <FormControlLabel
      control={
        <Checkbox
          checked={checked}
          onChange={onChange}
          sx={{
            color,
            "&.Mui-checked": {
              color,
            },
          }}
        />
      }
      label={
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Box
            sx={{
              bgcolor: color,
              borderRadius: "999px",
              height: 10,
              width: 22,
            }}
          />
          <Typography color="text.secondary" sx={{ fontWeight: 800 }} variant="caption">
            {label}
          </Typography>
        </Stack>
      }
      sx={{ mr: 1 }}
    />
  );
}
