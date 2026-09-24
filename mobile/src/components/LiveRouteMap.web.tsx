import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, shadows, space } from "@skate-route-mapper/shared/design";
import { Icon } from "./Icon";

export type Coordinate = {
  latitude: number;
  longitude: number;
};

type Region = Coordinate & {
  latitudeDelta: number;
  longitudeDelta: number;
};

/**
 * Web fallback for the live ride map.
 *
 * `react-native-maps` has no web renderer, and `npm run dev:web` exists to
 * check layout rather than cartography. So this fills exactly the same box and
 * reports what the real map would be drawing, which is what makes a layout
 * problem visible in the browser.
 */
export default function LiveRouteMap({
  coordinates,
  follow,
  onRecenter,
  region,
}: {
  coordinates: Coordinate[];
  follow: boolean;
  onRecenter: () => void;
  /** Unused here: the fallback has no pannable map to drag away from. */
  onUserPan: () => void;
  region: Region | null;
  showsUserLocation: boolean;
}) {
  const latest = coordinates[coordinates.length - 1] ?? null;

  return (
    <View style={styles.frame}>
      <View style={styles.badge}>
        <Text style={styles.badgeText}>map · web fallback</Text>
      </View>

      <View style={styles.readout}>
        <Text style={styles.line}>{coordinates.length} route points</Text>
        <Text style={styles.line}>Here: {formatCoordinate(latest)}</Text>
        <Text style={styles.line}>Centre: {formatCoordinate(region)}</Text>
        <Text style={styles.meta}>
          {follow ? "Following the rider" : "Panned away from the rider"}
        </Text>
      </View>

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

function formatCoordinate(coordinate: Coordinate | null) {
  if (!coordinate) {
    return "-";
  }

  return `${coordinate.latitude.toFixed(5)}, ${coordinate.longitude.toFixed(5)}`;
}

const styles = StyleSheet.create({
  frame: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.xl,
    flex: 1,
    justifyContent: "center",
    minHeight: 0,
    overflow: "hidden",
    padding: space.xl,
    ...shadows.tile,
  },
  badge: {
    backgroundColor: colors.surface,
    borderRadius: radius.xs,
    left: space.lg,
    paddingHorizontal: space.sm,
    paddingVertical: 4,
    position: "absolute",
    top: space.lg,
  },
  badgeText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
  },
  readout: {
    gap: 6,
  },
  line: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "800",
  },
  meta: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: "700",
    marginTop: space.sm,
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
