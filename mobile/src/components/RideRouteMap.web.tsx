import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors } from "@skate-route-mapper/shared/design";

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
  startCoordinate,
  visibleCoordinates,
}: RideRouteMapProps) {
  return (
    <View style={styles.mapFallback}>
      <Text style={styles.title}>Route preview</Text>
      <Text style={styles.text}>{visibleCoordinates.length} visible GPS points</Text>
      <Text style={styles.text}>
        Start: {formatCoordinate(startCoordinate)}
      </Text>
      <Text style={styles.text}>
        {currentMarkerTitle}: {formatCoordinate(currentCoordinate)}
      </Text>
      <Text style={styles.meta}>{currentMarkerDescription}</Text>
    </View>
  );
}

function formatCoordinate(coordinate: Coordinate | undefined) {
  if (!coordinate) {
    return "-";
  }

  return `${coordinate.latitude.toFixed(5)}, ${coordinate.longitude.toFixed(5)}`;
}

const styles = StyleSheet.create({
  mapFallback: {
    minHeight: 320,
    width: "100%",
    justifyContent: "center",
    padding: 20,
    backgroundColor: colors.surfaceMuted,
  },
  title: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "900",
    marginBottom: 10,
  },
  text: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 6,
  },
  meta: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: "700",
    marginTop: 8,
  },
});
