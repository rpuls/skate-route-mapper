import React, { useEffect, useRef } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import MapView, { Polyline, type Region } from "react-native-maps";
import { colors, radius, shadows, space } from "@skate-route-mapper/shared/design";
import { Icon } from "./Icon";

export type Coordinate = {
  latitude: number;
  longitude: number;
};

/**
 * The map on the ride screen.
 *
 * `RideRouteMap` draws a finished ride at a fixed height inside a scrolling
 * detail page. This one fills whatever box it is given and follows a ride that
 * is still happening, which are different enough jobs that sharing one
 * component would mean a prop for every difference.
 *
 * Following is a mode, not a state: the map keeps the rider centred until they
 * pan away, and the recentre button puts them back. A map that snaps back on
 * its own cannot be read ahead of a junction.
 */
export default function LiveRouteMap({
  coordinates,
  follow,
  onRecenter,
  onUserPan,
  region,
  showsUserLocation,
}: {
  coordinates: Coordinate[];
  follow: boolean;
  onRecenter: () => void;
  /** The rider dragged the map themselves, so stop following them. */
  onUserPan: () => void;
  region: Region | null;
  showsUserLocation: boolean;
}) {
  const map = useRef<MapView | null>(null);
  const latest = coordinates[coordinates.length - 1];

  useEffect(() => {
    if (!follow || !map.current) {
      return;
    }

    const target = latest ?? (region ? { latitude: region.latitude, longitude: region.longitude } : null);

    if (target) {
      map.current.animateCamera({ center: target }, { duration: 600 });
    }
  }, [follow, latest?.latitude, latest?.longitude, region?.latitude, region?.longitude]);

  return (
    <View style={styles.frame}>
      <MapView
        initialRegion={region ?? undefined}
        onRegionChangeComplete={(_next, details) => {
          // Only a gesture turns following off. Every camera animation this
          // component runs also fires this, and treating those as panning
          // would switch following off the moment it started working.
          if (details?.isGesture) {
            onUserPan();
          }
        }}
        pitchEnabled={false}
        ref={map}
        rotateEnabled={false}
        showsCompass={false}
        showsMyLocationButton={false}
        showsUserLocation={showsUserLocation}
        style={StyleSheet.absoluteFill}
        toolbarEnabled={false}
      >
        {coordinates.length > 1 ? (
          <Polyline
            coordinates={coordinates}
            strokeColor={colors.accent}
            strokeWidth={6}
          />
        ) : null}
      </MapView>

      <Pressable
        accessibilityLabel="Centre on my location"
        accessibilityRole="button"
        onPress={onRecenter}
        style={({ pressed }) => [styles.recenter, pressed && styles.pressed]}
      >
        <Icon
          color={follow ? colors.accent : colors.text}
          name="myLocation"
          size={22}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.xl,
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
    ...shadows.tile,
  },
  recenter: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    bottom: space.lg,
    height: 44,
    justifyContent: "center",
    position: "absolute",
    right: space.lg,
    width: 44,
    // `control`, not `tile`: the frame around this clips, so the shadow has
    // only the inset above to spread into. A tile shadow would be sliced off
    // against the map's rounded edge.
    ...shadows.control,
  },
  pressed: {
    opacity: 0.7,
  },
});
