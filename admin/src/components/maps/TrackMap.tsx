// A map of one recorded path, drawn on OpenStreetMap tiles.
//
// Presentational: it takes coordinates and draws them. It is the plain sibling
// of the ride replay map in RideAnalysisPanel, which colours its route by
// roughness and carries a playback marker; this one is for a path that is
// simply where something happened, such as the stretch of road a research
// capture was taken over.
import AddIcon from "@mui/icons-material/Add";
import CenterFocusStrongIcon from "@mui/icons-material/CenterFocusStrong";
import RemoveIcon from "@mui/icons-material/Remove";
import { Box, IconButton, Stack, Typography } from "@mui/material";
import { colors, shadows } from "@skate-route-mapper/shared/design";
import type { PointerEvent as ReactPointerEvent, WheelEvent } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { radiusLevel, radiusPx } from "../../theme/adminTheme";
import {
  applyMapInteraction,
  mapPoint,
  mapTileSize,
  mapTiles,
  mapViewForCoordinates,
  restingInteraction,
  tileAttribution,
  zoomedInteraction,
  type MapCoordinate,
  type MapInteraction,
} from "./tileMap";

const defaultMapWidth = 760;
const noMarkers: readonly TrackMapMarker[] = [];

/** A single position worth calling out, such as where a capture began. */
export type TrackMapMarker = {
  coordinate: MapCoordinate;
  color: string;
  label: string;
};

export function TrackMap({
  emptyMessage = "No GPS positions were recorded",
  height = 320,
  markers = noMarkers,
  path,
}: {
  emptyMessage?: string;
  height?: number;
  markers?: readonly TrackMapMarker[];
  /** The recorded positions in order. One or none is fine; it draws no line. */
  path: readonly MapCoordinate[];
}) {
  const [interaction, setInteraction] = useState<MapInteraction>(restingInteraction);
  const [width, setWidth] = useState(defaultMapWidth);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    panX: number;
    panY: number;
    pointerId: number;
    startX: number;
    startY: number;
  } | null>(null);

  // A marker outside the path still has to be on screen, so both are framed.
  const framed = useMemo(
    () => [...path, ...markers.map((marker) => marker.coordinate)],
    [markers, path]
  );
  const baseMapView = useMemo(
    () => mapViewForCoordinates(framed, width, height),
    [framed, height, width]
  );
  const mapView = useMemo(
    () => applyMapInteraction(baseMapView, interaction),
    [baseMapView, interaction]
  );
  const tiles = useMemo(() => mapTiles(mapView), [mapView]);
  const points = useMemo(
    () => path.map((coordinate) => mapPoint(coordinate, mapView)),
    [mapView, path]
  );

  // A new path is a new subject and deserves a fresh view. What it must not do
  // is undo a pan: a caller that rebuilds the same coordinates on every render
  // would otherwise snap the map back the moment anyone dragged it, so the
  // reset watches what the path contains rather than which array it is.
  const pathSignature = useMemo(
    () =>
      path.length === 0
        ? "empty"
        : `${path.length}:${path[0]?.latitude},${path[0]?.longitude}:${path[path.length - 1]?.latitude},${path[path.length - 1]?.longitude}`,
    [path]
  );

  useEffect(() => {
    setInteraction(restingInteraction);
  }, [pathSignature]);

  useLayoutEffect(() => {
    const element = containerRef.current;

    if (!element) {
      return;
    }

    const updateWidth = () => {
      const nextWidth = element.getBoundingClientRect().width;

      if (nextWidth && Number.isFinite(nextWidth)) {
        setWidth(Math.max(defaultMapWidth, Math.round(nextWidth)));
      }
    };

    updateWidth();

    const observer = new ResizeObserver(updateWidth);

    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      panX: interaction.panX,
      panY: interaction.panY,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;

    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    setInteraction((current) => ({
      ...current,
      panX: drag.panX + event.clientX - drag.startX,
      panY: drag.panY + event.clientY - drag.startY,
    }));
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    setInteraction((current) => zoomedInteraction(current, event.deltaY > 0 ? -1 : 1));
  }

  return (
    <Box
      onPointerCancel={handlePointerUp}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onWheel={handleWheel}
      ref={containerRef}
      sx={{
        bgcolor: colors.surfaceMuted,
        borderRadius: radiusPx(radiusLevel.inner),
        cursor: "grab",
        height,
        overflow: "hidden",
        position: "relative",
        touchAction: "none",
        userSelect: "none",
        width: "100%",
      }}
    >
      <svg
        height={height}
        style={{ display: "block", height: "100%", width: "100%" }}
        viewBox={`0 0 ${width} ${height}`}
        width={width}
      >
        <rect fill={colors.surfaceMuted} height={height} width={width} />
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
        {framed.length === 0 ? (
          <text
            fill={colors.textMuted}
            fontSize="16"
            fontWeight="800"
            textAnchor="middle"
            x={width / 2}
            y={height / 2}
          >
            {emptyMessage}
          </text>
        ) : null}
        {points.length > 1 ? (
          <polyline
            fill="none"
            points={points.map((point) => `${point.x},${point.y}`).join(" ")}
            stroke={colors.link}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="6"
          />
        ) : null}
        {markers.map((marker) => {
          const point = mapPoint(marker.coordinate, mapView);

          return (
            <circle
              cx={point.x}
              cy={point.y}
              fill={marker.color}
              key={marker.label}
              r="8"
              stroke={colors.surface}
              strokeWidth="3"
            >
              <title>{marker.label}</title>
            </circle>
          );
        })}
      </svg>

      <Stack
        direction="row"
        onPointerDown={(event) => event.stopPropagation()}
        spacing={0.5}
        sx={{
          bgcolor: colors.surface,
          borderRadius: radiusPx(radiusLevel.embedded),
          boxShadow: `0 8px 20px ${shadows.tile.shadowColor}`,
          p: 0.5,
          position: "absolute",
          right: 8,
          top: 8,
        }}
      >
        <IconButton
          aria-label="Zoom in"
          onClick={() => setInteraction((current) => zoomedInteraction(current, 1))}
          size="small"
        >
          <AddIcon />
        </IconButton>
        <IconButton
          aria-label="Zoom out"
          onClick={() => setInteraction((current) => zoomedInteraction(current, -1))}
          size="small"
        >
          <RemoveIcon />
        </IconButton>
        <IconButton
          aria-label="Reset map view"
          onClick={() => setInteraction(restingInteraction)}
          size="small"
        >
          <CenterFocusStrongIcon />
        </IconButton>
      </Stack>

      <Typography
        sx={{
          bgcolor: colors.surface,
          borderRadius: radiusPx(radiusLevel.embedded),
          bottom: 8,
          color: colors.textMuted,
          fontWeight: 800,
          left: 8,
          px: 1,
          position: "absolute",
        }}
        variant="caption"
      >
        {tileAttribution}
      </Typography>
    </Box>
  );
}
