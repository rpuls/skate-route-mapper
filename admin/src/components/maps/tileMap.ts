// Slippy-map arithmetic for the admin app's maps: Web Mercator projection, the
// view that frames a set of coordinates, the OpenStreetMap tiles that cover
// that view, and how a drag and a wheel move it.
//
// Pure functions only, with no React and no DOM, so both the ride replay map
// and the research track map project and frame identically. Whoever renders
// them decides what to draw on top.

/** The edge length of an OpenStreetMap raster tile, in pixels. */
export const mapTileSize = 256;

/**
 * Where the tiles come from, and who to credit for them.
 *
 * OpenStreetMap's tile usage policy requires the attribution to be visible, so
 * a map built on these helpers shows `tileAttribution` somewhere on the frame.
 */
export const tileAttribution = "© OpenStreetMap contributors";

/** Copenhagen, used to frame a map that has no coordinates to frame. */
const fallbackCenter = { latitude: 55.6761, longitude: 12.5683, zoom: 12 };

export type MapCoordinate = {
  latitude: number;
  longitude: number;
};

export type MapViewState = {
  centerX: number;
  centerY: number;
  height: number;
  width: number;
  zoom: number;
};

/** How far a viewer has dragged and zoomed away from the framed view. */
export type MapInteraction = {
  panX: number;
  panY: number;
  zoomOffset: number;
};

export const restingInteraction: MapInteraction = {
  panX: 0,
  panY: 0,
  zoomOffset: 0,
};

export type MapTile = {
  key: string;
  url: string;
  x: number;
  y: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function lngLatToWorld(longitude: number, latitude: number, zoom: number) {
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

/** Where a coordinate lands inside the view, in view pixels. */
export function mapPoint(coordinate: MapCoordinate, mapView: MapViewState) {
  const world = lngLatToWorld(coordinate.longitude, coordinate.latitude, mapView.zoom);

  return {
    x: world.x - mapView.centerX + mapView.width / 2,
    y: world.y - mapView.centerY + mapView.height / 2,
  };
}

/**
 * The view that fits every coordinate with a margin around it.
 *
 * Zoom is floored rather than rounded, because a track that overflows the frame
 * is worse than one drawn a little small.
 */
export function mapViewForCoordinates(
  coordinates: readonly MapCoordinate[],
  width: number,
  height: number
): MapViewState {
  if (coordinates.length === 0) {
    const center = lngLatToWorld(
      fallbackCenter.longitude,
      fallbackCenter.latitude,
      fallbackCenter.zoom
    );

    return {
      centerX: center.x,
      centerY: center.y,
      height,
      width,
      zoom: fallbackCenter.zoom,
    };
  }

  const latitudes = coordinates.map((coordinate) => coordinate.latitude);
  const longitudes = coordinates.map((coordinate) => coordinate.longitude);
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

/** Every tile that covers the view, plus a one-tile margin for smooth panning. */
export function mapTiles(mapView: MapViewState): MapTile[] {
  const halfWidth = mapView.width / 2;
  const halfHeight = mapView.height / 2;
  const startTileX = Math.floor((mapView.centerX - halfWidth) / mapTileSize) - 1;
  const endTileX = Math.floor((mapView.centerX + halfWidth) / mapTileSize) + 1;
  const startTileY = Math.floor((mapView.centerY - halfHeight) / mapTileSize) - 1;
  const endTileY = Math.floor((mapView.centerY + halfHeight) / mapTileSize) + 1;
  const maxTile = 2 ** mapView.zoom;
  const tiles: MapTile[] = [];

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

export function applyMapInteraction(
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

export function zoomedInteraction(interaction: MapInteraction, delta: number): MapInteraction {
  return {
    ...interaction,
    zoomOffset: clamp(interaction.zoomOffset + delta, -5, 5),
  };
}
