import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import * as Location from "expo-location";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import {
  buttonVariants,
  colors,
  controlSize,
  radius,
  shadows,
  space,
  stateStyles,
} from "@skate-route-mapper/shared/design";
import {
  formatDistance,
  formatDuration,
  formatSpeedKmh,
  usableSpeed,
} from "@skate-route-mapper/shared/rideTracking";
import { Card } from "../components/Card";
import { Icon, type IconName } from "../components/Icon";
import LiveRouteMap, { type Coordinate } from "../components/LiveRouteMap";
import { Page, StatusPill } from "../components/Page";
import { Sheet } from "../components/Sheet";
import { getRideRouteCoordinates } from "../database/db";
import { useXiaoConnection } from "../native/xiaoConnection";
import {
  recordedSeconds,
  useMeasurementStore,
} from "../store/measurementStore";
import type { VehicleType } from "../types/measurement";

/**
 * The screen the app opens on: one ride, from ready to finished.
 *
 * Starting and recording used to be two routes, which meant the live figures
 * lived behind a navigation step and the start screen led with a research tile
 * most riders will never tap. Both states belong to the same activity, so they
 * share a screen: the map keeps its place, and only the card at the bottom
 * changes. Nothing a rider needs mid-ride is ever more than a glance away, and
 * nothing scrolls.
 *
 * Everything optional is a sheet. Ride type and sensor pairing are settings
 * you touch once, so they open over the screen and close again rather than
 * taking up permanent space or pushing the start button below the fold.
 */

const rideOptions: { value: VehicleType; label: string; icon: IconName }[] = [
  { value: "skates", label: "Inline skates", icon: "skates" },
  { value: "skateboard", label: "Skateboard", icon: "skateboard" },
  { value: "longboard", label: "Longboard", icon: "longboard" },
];

const defaultDelta = 0.004;

type OpenSheet = "ride" | "sensor" | null;

export default function StartRideScreen() {
  const navigation = useNavigation<any>();

  const vehicleType = useMeasurementStore((state) => state.vehicleType);
  const setVehicleType = useMeasurementStore((state) => state.setVehicleType);
  const recording = useMeasurementStore((state) => state.recording);
  const pausedAt = useMeasurementStore((state) => state.pausedAt);
  const pausedMs = useMeasurementStore((state) => state.pausedMs);
  const permissionMessage = useMeasurementStore(
    (state) => state.permissionMessage
  );
  const latestSample = useMeasurementStore(
    (state) => state.latestExternalImuSample
  );
  const lastRideMetrics = useMeasurementStore((state) => state.lastRideMetrics);
  const startRecording = useMeasurementStore((state) => state.startRecording);
  const stopRecording = useMeasurementStore((state) => state.stopRecording);
  const pauseRide = useMeasurementStore((state) => state.pauseRide);
  const resumeRide = useMeasurementStore((state) => state.resumeRide);

  const xiao = useXiaoConnection();

  const [sheet, setSheet] = useState<OpenSheet>(null);
  const [now, setNow] = useState(() => Date.now());
  const [route, setRoute] = useState<Coordinate[]>([]);
  const [origin, setOrigin] = useState<Coordinate | null>(null);
  const [locationGranted, setLocationGranted] = useState<boolean | null>(null);
  const [follow, setFollow] = useState(true);
  const [busy, setBusy] = useState<"starting" | "finishing" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const finishedRideId = useRef<string | null>(null);

  const paused = pausedAt !== null;
  const isRecording = Boolean(recording);

  // One ticking clock for the whole screen. The elapsed time has to keep
  // moving between fixes, which arrive a second or two apart at best.
  useEffect(() => {
    if (!isRecording || paused) {
      return;
    }

    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(timer);
  }, [isRecording, paused]);

  // A map with nothing on it is not worth the permission prompt, so the ask
  // happens here, where the map is, rather than at launch.
  useFocusEffect(
    useCallback(() => {
      let active = true;

      async function locate() {
        const permission = await Location.getForegroundPermissionsAsync();
        const granted = permission.granted
          ? permission
          : await Location.requestForegroundPermissionsAsync();

        if (!active) {
          return;
        }

        setLocationGranted(granted.granted);

        if (!granted.granted) {
          return;
        }

        const known =
          (await Location.getLastKnownPositionAsync()) ??
          (await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          }).catch(() => null));

        if (active && known) {
          setOrigin({
            latitude: known.coords.latitude,
            longitude: known.coords.longitude,
          });
        }
      }

      void locate();

      return () => {
        active = false;
      };
    }, [])
  );

  // The route is re-read when a fix has actually been kept, rather than on a
  // timer: the count only moves when there is a new point to draw.
  const acceptedFixCount = recording?.metrics.acceptedFixCount ?? 0;
  const rideId = recording?.rideId ?? null;

  useEffect(() => {
    if (!rideId) {
      setRoute([]);
      return;
    }

    setRoute(getRideRouteCoordinates(rideId));
  }, [rideId, acceptedFixCount]);

  const lastFix = recording?.lastFix ?? null;
  const centre = lastFix
    ? { latitude: lastFix.latitude, longitude: lastFix.longitude }
    : origin;

  const region = centre
    ? {
        ...centre,
        latitudeDelta: defaultDelta,
        longitudeDelta: defaultDelta,
      }
    : null;

  const gps = useMemo(() => {
    if (locationGranted === false) {
      return { label: "Location off", color: colors.neutral };
    }

    if (!recording) {
      return origin
        ? { label: "GPS ready", color: colors.surface }
        : { label: "Finding you", color: colors.pageSoft };
    }

    if (!lastFix) {
      return { label: "Searching", color: colors.pageSoft };
    }

    if (now - lastFix.timestamp > 15_000) {
      return { label: "GPS stale", color: colors.pageSoft };
    }

    return {
      label:
        lastFix.accuracy === null
          ? "GPS ok"
          : `GPS ±${Math.round(lastFix.accuracy)} m`,
      color: colors.surface,
    };
  }, [lastFix, locationGranted, now, origin, recording]);

  const ride =
    rideOptions.find((option) => option.value === vehicleType) ??
    rideOptions[0];
  const sensorConnected = xiao.status === "connected";
  const sensorConnecting = xiao.status === "connecting";

  const sensorDotColor = sensorConnected
    ? colors.success
    : sensorConnecting
      ? colors.pageSoft
      : colors.neutral;

  const sensorLabel = sensorConnected
    ? "Connected"
    : sensorConnecting
      ? "Connecting..."
      : xiao.status === "unsupported"
        ? "Unavailable"
        : "Off";

  const start = async () => {
    if (busy) {
      return;
    }

    setBusy("starting");
    setError(null);

    const result = await startRecording();

    setBusy(null);
    setNow(Date.now());
    setFollow(true);

    if (!result.ok) {
      setError(result.message);
    }
  };

  const finish = async () => {
    if (busy || !recording) {
      return;
    }

    finishedRideId.current = recording.rideId;
    setBusy("finishing");
    await stopRecording();
    setBusy(null);

    // A finished ride is the thing the rider wants to look at, and the detail
    // screen is already the place that draws it.
    if (finishedRideId.current) {
      navigation.navigate("RideDetail", { rideId: finishedRideId.current });
    }
  };

  const elapsed = recordedSeconds({ recording, pausedAt, pausedMs }, now);
  const currentSpeed = usableSpeed(lastFix?.speed ?? null);
  const vibration = latestSample
    ? Math.hypot(latestSample.ax, latestSample.ay, latestSample.az)
    : null;

  return (
    <Page
      layout="fill"
      title={isRecording ? ride.label : "Ready to roll"}
      footer={
        <>
          {isRecording ? (
            <Card>
              <View style={styles.timerRow}>
                <Text style={styles.timer}>{formatClock(elapsed)}</Text>

                <View style={styles.recState}>
                  <View
                    style={[
                      styles.recDot,
                      {
                        backgroundColor: paused
                          ? colors.textMuted
                          : colors.danger,
                      },
                    ]}
                  />
                  <Text
                    style={[
                      styles.recLabel,
                      { color: paused ? colors.textMuted : colors.danger },
                    ]}
                  >
                    {paused ? "Paused" : "Recording"}
                  </Text>
                </View>
              </View>

              <View style={styles.statRow}>
                <Stat
                  label="Distance"
                  value={formatDistance(recording?.metrics.distanceMeters ?? 0)}
                />
                <Stat label="Speed" value={formatSpeedKmh(currentSpeed)} />

                {sensorConnected ? (
                  <Stat
                    label="Surface"
                    tone="warm"
                    value={
                      vibration === null ? "—" : `${vibration.toFixed(2)} g`
                    }
                  />
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setSheet("sensor")}
                    style={styles.statAdd}
                  >
                    <Text style={styles.statLabel}>Surface</Text>
                    <View style={styles.statAddRow}>
                      <Icon color={colors.accent} name="add" size={18} />
                      <Text style={styles.statAddText}>Sensor</Text>
                    </View>
                  </Pressable>
                )}
              </View>

              <View style={styles.actionRow}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => (paused ? resumeRide() : pauseRide())}
                  style={({ pressed }) => [
                    styles.pauseButton,
                    pressed && styles.pressed,
                  ]}
                >
                  <Icon
                    color={colors.accent}
                    name={paused ? "play" : "pause"}
                    size={24}
                  />
                  <Text style={styles.pauseText}>
                    {paused ? "Resume" : "Pause"}
                  </Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  disabled={busy === "finishing"}
                  onPress={finish}
                  style={({ pressed }) => [
                    styles.finishButton,
                    pressed && styles.pressed,
                    busy === "finishing" && stateStyles.disabled,
                  ]}
                >
                  <Icon color={colors.textOnOrange} name="stop" size={24} />
                  <Text style={styles.finishText}>
                    {busy === "finishing" ? "Saving" : "Finish"}
                  </Text>
                </Pressable>
              </View>

              <Pressable
                accessibilityRole="button"
                onPress={() => navigation.navigate("Recording")}
                style={({ pressed }) => [
                  styles.detailLink,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.detailLinkText}>
                  Live detail and GPS quality
                </Text>
                <Icon color={colors.textMuted} name="openInNew" size={18} />
              </Pressable>
            </Card>
          ) : (
            <Card>
              <View style={styles.setupRow}>
                <Pressable
                  accessibilityLabel={`Ride type: ${ride.label}. Change`}
                  accessibilityRole="button"
                  onPress={() => setSheet("ride")}
                  style={({ pressed }) => [
                    styles.rideButton,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.rideIcon}>
                    <Icon color={colors.accent} name={ride.icon} size={26} />
                  </View>
                  <View style={styles.rideBadge}>
                    <Icon
                      color={colors.textMuted}
                      name="expandMore"
                      size={16}
                    />
                  </View>
                </Pressable>

                <Pressable
                  accessibilityLabel={`Surface sensor: ${sensorLabel}. Change`}
                  accessibilityRole="button"
                  onPress={() => setSheet("sensor")}
                  style={({ pressed }) => [
                    styles.sensorButton,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.sensorIcon}>
                    <Icon
                      color={sensorConnected ? colors.accent : colors.textMuted}
                      name="sensors"
                      size={24}
                    />
                    <View
                      style={[
                        styles.sensorDot,
                        { backgroundColor: sensorDotColor },
                      ]}
                    />
                  </View>

                  <View style={styles.sensorCopy}>
                    <Text style={styles.sensorCaption}>Surface sensor</Text>
                    <Text style={styles.sensorValue} numberOfLines={1}>
                      {sensorLabel}
                    </Text>
                  </View>
                </Pressable>
              </View>

              <Pressable
                accessibilityRole="button"
                disabled={busy === "starting"}
                onPress={start}
                style={({ pressed }) => [
                  styles.startButton,
                  pressed && styles.pressed,
                  busy === "starting" && stateStyles.disabled,
                ]}
              >
                <Icon color={colors.textOnOrange} name="play" size={30} />
                <Text style={styles.startText}>
                  {busy === "starting" ? "Starting..." : "Start ride"}
                </Text>
              </Pressable>

              <Text style={styles.hint}>
                {error ??
                  permissionMessage ??
                  (sensorConnected
                    ? "Recording GPS route + road surface"
                    : "GPS only — you can add the sensor mid-ride")}
              </Text>
            </Card>
          )}

          {/* The ride that just finished is a footnote to the one about to
              start, so it sits under the card on the page rather than inside
              it competing with the start button. */}
          {!isRecording && lastRideMetrics ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => navigation.navigate("Rides")}
              style={({ pressed }) => [
                styles.lastRide,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.lastRideText} numberOfLines={1}>
                Last ride {formatDistance(lastRideMetrics.distanceMeters)} in{" "}
                {formatDuration(lastRideMetrics.movingSeconds)}
              </Text>
              <Icon color={colors.textOnOrange} name="openInNew" size={18} />
            </Pressable>
          ) : null}
        </>
      }
    >
      {/* The GPS state is about the map, so it sits on the map rather than in
          the page header, which belongs to the app rather than to this screen. */}
      <View style={styles.mapHeader}>
        <StatusPill dotColor={gps.color} label={gps.label} />
      </View>

      <LiveRouteMap
        coordinates={route}
        follow={follow}
        onRecenter={() => setFollow(true)}
        onUserPan={() => setFollow(false)}
        region={region}
        showsUserLocation={locationGranted === true}
      />

      <RideSheet
        onClose={() => setSheet(null)}
        onPick={(value) => {
          setVehicleType(value);
          setSheet(null);
        }}
        selected={vehicleType}
        visible={sheet === "ride"}
      />

      <SensorSheet
        onClose={() => setSheet(null)}
        visible={sheet === "sensor"}
      />
    </Page>
  );
}

function Stat({
  label,
  tone = "cool",
  value,
}: {
  label: string;
  tone?: "cool" | "warm";
  value: string;
}) {
  return (
    <View style={[styles.stat, tone === "warm" && styles.statWarm]}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

function RideSheet({
  onClose,
  onPick,
  selected,
  visible,
}: {
  onClose: () => void;
  onPick: (value: VehicleType) => void;
  selected: VehicleType;
  visible: boolean;
}) {
  return (
    <Sheet
      onClose={onClose}
      subtitle="We'll remember your choice for next time."
      title="Ride type"
      visible={visible}
    >
      {rideOptions.map((option) => {
        const isSelected = option.value === selected;

        return (
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ selected: isSelected }}
            key={option.value}
            onPress={() => onPick(option.value)}
            style={[styles.rideOption, isSelected && styles.rideOptionSelected]}
          >
            <View style={styles.rideOptionIcon}>
              <Icon color={colors.accent} name={option.icon} size={28} />
            </View>

            <Text style={styles.rideOptionLabel}>{option.label}</Text>

            {isSelected ? (
              <Icon color={colors.accent} name="checkCircle" size={24} />
            ) : null}
          </Pressable>
        );
      })}
    </Sheet>
  );
}

function SensorSheet({
  onClose,
  visible,
}: {
  onClose: () => void;
  visible: boolean;
}) {
  const xiao = useXiaoConnection();

  const connected = xiao.status === "connected";
  const connecting = xiao.status === "connecting";
  const supported = xiao.status !== "unsupported";

  return (
    <Sheet
      onClose={onClose}
      subtitle="Optional. Clip it to your board or skate and it maps how smooth the road is along your route."
      title="Surface sensor"
      visible={visible}
    >
      <View style={styles.sensorPanel}>
        <View style={styles.sensorPanelRow}>
          <View style={styles.sensorPanelIcon}>
            <Icon
              color={connected ? colors.accent : colors.textMuted}
              name="sensors"
              size={28}
            />
          </View>

          <View style={styles.sensorCopy}>
            <Text style={styles.sensorPanelTitle}>XIAO sensor</Text>
            <View style={styles.sensorStatusRow}>
              <View
                style={[
                  styles.sensorStatusDot,
                  {
                    backgroundColor: connected
                      ? colors.success
                      : connecting
                        ? colors.pageSoft
                        : colors.neutral,
                  },
                ]}
              />
              <Text style={styles.sensorStatusText}>
                {xiao.error ?? xiao.detail}
              </Text>
            </View>
          </View>
        </View>

        {connected ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => void xiao.disconnect()}
            style={styles.disconnectButton}
          >
            <Text style={styles.disconnectText}>Disconnect</Text>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            disabled={connecting || !supported}
            onPress={() => void xiao.connect()}
            style={[
              styles.connectButton,
              (connecting || !supported) && stateStyles.disabled,
            ]}
          >
            <Icon color={colors.textOnOrange} name="bluetooth" size={22} />
            <Text style={styles.connectText}>
              {connecting ? "Connecting..." : "Connect"}
            </Text>
          </Pressable>
        )}
      </View>

      <View style={styles.toggleRow}>
        <View style={styles.sensorCopy}>
          <Text style={styles.toggleTitle}>Auto-connect on launch</Text>
          <Text style={styles.toggleDetail}>
            Connects in the background when the sensor is nearby.
          </Text>
        </View>

        <Switch
          disabled={!supported}
          onValueChange={xiao.setAutoConnect}
          thumbColor={colors.surface}
          trackColor={{ false: colors.track, true: colors.accent }}
          value={xiao.autoConnect}
        />
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={onClose}
        style={styles.doneButton}
      >
        <Text style={styles.doneText}>Done</Text>
      </Pressable>
    </Sheet>
  );
}

/**
 * `hh:mm:ss`, because a ride clock that drops the hours reads as a reset.
 *
 * `formatDuration` is the right thing for a saved ride ("1 h 12 m"), but a
 * running timer has to change every second to look alive.
 */
function formatClock(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  const pad = (value: number) => String(value).padStart(2, "0");

  return `${pad(Math.floor(whole / 3600))}:${pad(Math.floor(whole / 60) % 60)}:${pad(
    whole % 60
  )}`;
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.75,
  },
  mapHeader: {
    alignItems: "flex-start",
    paddingBottom: space.sm,
  },

  // Idle card
  setupRow: {
    flexDirection: "row",
    gap: space.sm,
  },
  rideButton: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 2,
    justifyContent: "center",
    minHeight: controlSize.sm,
    padding: space.sm,
  },
  rideIcon: {
    alignItems: "center",
    backgroundColor: colors.surfaceWarm,
    borderRadius: radius.sm,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  rideBadge: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    bottom: 1,
    height: 18,
    justifyContent: "center",
    position: "absolute",
    right: 1,
    width: 18,
  },
  sensorButton: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 2,
    flex: 1,
    flexDirection: "row",
    gap: space.md,
    minHeight: controlSize.sm,
    minWidth: 0,
    padding: space.sm,
  },
  sensorIcon: {
    alignItems: "center",
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.sm,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  sensorDot: {
    borderColor: colors.surface,
    borderRadius: radius.pill,
    borderWidth: 2,
    height: 14,
    position: "absolute",
    right: -3,
    top: -3,
    width: 14,
  },
  sensorCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  sensorCaption: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
  },
  sensorValue: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "800",
  },
  startButton: {
    alignItems: "center",
    backgroundColor: buttonVariants.secondary.filled.backgroundColor,
    borderRadius: radius.pill,
    flexDirection: "row",
    gap: space.sm,
    height: controlSize.xl,
    justifyContent: "center",
  },
  startText: {
    color: buttonVariants.secondary.filled.color,
    fontSize: 20,
    fontWeight: "900",
  },
  hint: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
    textAlign: "center",
  },
  lastRide: {
    alignItems: "center",
    backgroundColor: colors.surfaceOnPage,
    borderRadius: radius.lg,
    flexDirection: "row",
    gap: space.sm,
    justifyContent: "center",
    minHeight: controlSize.sm,
    paddingHorizontal: space.lg,
  },
  lastRideText: {
    color: colors.textOnOrange,
    flexShrink: 1,
    fontSize: 14,
    fontWeight: "800",
  },

  // Recording card
  timerRow: {
    alignItems: "baseline",
    flexDirection: "row",
    gap: space.sm,
    justifyContent: "space-between",
    paddingHorizontal: space.xs,
  },
  timer: {
    color: colors.text,
    fontSize: 42,
    fontWeight: "900",
    letterSpacing: 0.5,
    lineHeight: 46,
  },
  recState: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
  },
  recDot: {
    borderRadius: radius.pill,
    height: 8,
    width: 8,
  },
  recLabel: {
    fontSize: 13,
    fontWeight: "800",
  },
  statRow: {
    flexDirection: "row",
    gap: space.sm,
  },
  stat: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    flex: 1,
    gap: 2,
    minWidth: 0,
    paddingHorizontal: space.md,
    paddingVertical: 10,
  },
  statWarm: {
    backgroundColor: colors.surfaceWarm,
  },
  statLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
  },
  statValue: {
    color: colors.text,
    fontSize: 19,
    fontWeight: "900",
  },
  statAdd: {
    borderColor: colors.border,
    borderRadius: radius.md,
    borderStyle: "dashed",
    borderWidth: 2,
    flex: 1,
    gap: 2,
    minWidth: 0,
    paddingHorizontal: space.md,
    paddingVertical: 8,
  },
  statAddRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 2,
  },
  statAddText: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: "800",
  },
  actionRow: {
    flexDirection: "row",
    gap: space.sm,
  },
  pauseButton: {
    alignItems: "center",
    backgroundColor: buttonVariants.primary.contained.backgroundColor,
    borderColor: buttonVariants.primary.contained.borderColor,
    borderRadius: radius.pill,
    borderWidth: 2,
    flex: 1,
    flexDirection: "row",
    gap: space.sm,
    height: controlSize.lg,
    justifyContent: "center",
  },
  pauseText: {
    color: buttonVariants.primary.contained.color,
    fontSize: 17,
    fontWeight: "900",
  },
  finishButton: {
    alignItems: "center",
    backgroundColor: buttonVariants.danger.filled.backgroundColor,
    borderRadius: radius.pill,
    flex: 1,
    flexDirection: "row",
    gap: space.sm,
    height: controlSize.lg,
    justifyContent: "center",
  },
  finishText: {
    color: buttonVariants.danger.filled.color,
    fontSize: 17,
    fontWeight: "900",
  },
  detailLink: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
  },
  // Muted, not a link colour. This is a way out to a diagnostics page; nothing
  // about a ride in progress should pull the eye away from the timer.
  detailLinkText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "800",
  },

  // Ride sheet
  rideOption: {
    alignItems: "center",
    backgroundColor: colors.surfaceMuted,
    borderColor: "transparent",
    borderRadius: radius.lg,
    borderWidth: 2,
    flexDirection: "row",
    gap: space.md,
    padding: space.md,
  },
  rideOptionSelected: {
    backgroundColor: colors.surfaceWarm,
    borderColor: colors.accent,
  },
  rideOptionIcon: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  rideOptionLabel: {
    color: colors.text,
    flex: 1,
    fontSize: 18,
    fontWeight: "800",
  },

  // Sensor sheet
  sensorPanel: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.lg,
    gap: space.lg,
    padding: space.lg,
  },
  sensorPanelRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: space.md,
  },
  sensorPanelIcon: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  sensorPanelTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "800",
  },
  sensorStatusRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
  },
  sensorStatusDot: {
    borderRadius: radius.pill,
    height: 8,
    width: 8,
  },
  sensorStatusText: {
    color: colors.textMuted,
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
  },
  connectButton: {
    alignItems: "center",
    backgroundColor: buttonVariants.secondary.filled.backgroundColor,
    borderRadius: radius.pill,
    flexDirection: "row",
    gap: space.sm,
    height: controlSize.md,
    justifyContent: "center",
  },
  connectText: {
    color: buttonVariants.secondary.filled.color,
    fontSize: 17,
    fontWeight: "900",
  },
  disconnectButton: {
    alignItems: "center",
    borderColor: buttonVariants.danger.contained.borderColor,
    borderRadius: radius.pill,
    borderWidth: 2,
    height: controlSize.md,
    justifyContent: "center",
  },
  disconnectText: {
    color: buttonVariants.danger.contained.color,
    fontSize: 16,
    fontWeight: "900",
  },
  toggleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: space.md,
    paddingVertical: space.xs,
  },
  toggleTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "800",
  },
  toggleDetail: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 19,
  },
  doneButton: {
    alignItems: "center",
    alignSelf: "flex-end",
    backgroundColor: buttonVariants.primary.contained.backgroundColor,
    borderColor: buttonVariants.primary.contained.borderColor,
    borderRadius: radius.pill,
    borderWidth: 2,
    justifyContent: "center",
    minHeight: controlSize.sm,
    paddingHorizontal: space.xl,
  },
  doneText: {
    color: buttonVariants.primary.contained.color,
    fontSize: 16,
    fontWeight: "900",
  },
});
