import React from "react";
import MapView, { Marker, Polyline } from "react-native-maps";

type Coordinate = {
  latitude: number;
  longitude: number;
};

type RideRouteMapProps = {
  currentCoordinate: Coordinate | undefined;
  currentMarkerDescription: string;
  currentMarkerTitle: string;
  initialRegion: Coordinate & {
    latitudeDelta: number;
    longitudeDelta: number;
  };
  startCoordinate: Coordinate | undefined;
  visibleCoordinates: Coordinate[];
};

export default function RideRouteMap({
  currentCoordinate,
  currentMarkerDescription,
  currentMarkerTitle,
  initialRegion,
  startCoordinate,
  visibleCoordinates,
}: RideRouteMapProps) {
  return (
    <MapView style={{ height: 320, width: "100%" }} initialRegion={initialRegion}>
      {visibleCoordinates.length > 1 && (
        <Polyline coordinates={visibleCoordinates} strokeWidth={5} />
      )}

      {startCoordinate ? <Marker coordinate={startCoordinate} title="Start" /> : null}

      {currentCoordinate ? (
        <Marker
          coordinate={currentCoordinate}
          title={currentMarkerTitle}
          description={currentMarkerDescription}
        />
      ) : null}
    </MapView>
  );
}
