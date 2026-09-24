import React, { useEffect, useMemo, useState } from "react";
import { Dimensions, StyleSheet, Text, View } from "react-native";
import { LineChart } from "react-native-chart-kit";
import {
  formatDistance,
  formatDuration,
  formatSpeedKmh,
  usableSpeed,
  type LocationFixRejection,
} from "@skate-route-mapper/shared/rideTracking";
import {
  colors,
  radius,
  shadows,
  space,
} from "@skate-route-mapper/shared/design";
import { Page } from "../components/Page";
import {
  recordedSeconds,
  useMeasurementStore,
} from "../store/measurementStore";

const SCREEN_WIDTH = Dimensions.get("window").width;
const VIBRATION_WINDOW = 40;

/**
 * Why the last fix was thrown away.
 *
 * A route that stops growing is alarming, and "waiting for a better fix" is a
 * very different problem from "recording has stopped". The filter already
 * names its reasons, so the screen can say which one it is.
 */
const rejectionLabels: Record<LocationFixRejection, string> = {
  "out-of-range": "Ignored a fix with impossible coordinates",
  "missing-accuracy": "Ignored a fix with no accuracy",
  "poor-accuracy": "Waiting for a more precise fix",
  "provider-downgrade": "Ignored a network fix after a satellite one",
  "accuracy-downgrade": "Ignored a sudden drop in accuracy",
  "implied-teleport": "Ignored a fix that jumped impossibly far",
  "out-of-order": "Ignored a fix that arrived late",
};

/**
 * The live detail behind a ride.
 *
 * The ride screen answers "how far, how fast, is it running". This answers
 * "should I trust it": fix accuracy, how many fixes were kept, why the last
 * one was dropped, and what the board is reading. It is a read-only view on
 * purpose — the ride is started and finished in exactly one place, and a
 * second stop button in a diagnostics screen is how a rider ends up with two
 * half-rides.
 */
export default function RecordingScreen() {
  const status = useMeasurementStore((state) => state.status);
  const sensorSource = useMeasurementStore((state) => state.sensorSource);
  const recording = useMeasurementStore((state) => state.recording);
  const permissionMessage = useMeasurementStore(
    (state) => state.permissionMessage
  );
  const latestExternalImuSample = useMeasurementStore(
    (state) => state.latestExternalImuSample
  );
  const pausedAt = useMeasurementStore((state) => state.pausedAt);
  const pausedMs = useMeasurementStore((state) => state.pausedMs);

  const [nowMs, setNowMs] = useState(() => Date.now());
  const [vibrationWindow, setVibrationWindow] = useState<number[]>([0]);

  // The elapsed clock has to keep moving between fixes, which arrive every
  // couple of seconds at best.
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!latestExternalImuSample) {
      return;
    }

    const magnitude = Math.hypot(
      latestExternalImuSample.ax,
      latestExternalImuSample.ay,
      latestExternalImuSample.az
    );

    setVibrationWindow((values) =>
      [...values, magnitude].slice(-VIBRATION_WINDOW)
    );
  }, [latestExternalImuSample]);

  const metrics = recording?.metrics ?? null;
  const elapsedSeconds = recordedSeconds(
    { recording, pausedAt, pausedMs },
    nowMs
  );
  const currentSpeed = usableSpeed(recording?.lastFix?.speed ?? null);
  const accuracy = recording?.lastFix?.accuracy ?? null;
  const fixAgeSeconds =
    recording?.lastFix != null
      ? Math.max(0, (nowMs - recording.lastFix.timestamp) / 1000)
      : null;

  const gpsState = useMemo(() => {
    if (!recording?.lastFix) {
      return { label: "Searching", detail: "No usable fix yet" };
    }

    if (fixAgeSeconds !== null && fixAgeSeconds > 15) {
      return {
        label: "Stale",
        detail: `Last fix ${Math.round(fixAgeSeconds)} s ago`,
      };
    }

    return {
      label: accuracy === null ? "OK" : `${Math.round(accuracy)} m`,
      detail: `${metrics?.acceptedFixCount ?? 0} kept · ${metrics?.rejectedFixCount ?? 0} dropped`,
    };
  }, [accuracy, fixAgeSeconds, metrics, recording?.lastFix]);

  const averageVibration = useMemo(() => {
    const readings = vibrationWindow.filter((value) => value > 0);

    if (readings.length === 0) {
      return 0;
    }

    return readings.reduce((sum, value) => sum + value, 0) / readings.length;
  }, [vibrationWindow]);

  return (
    <Page
      back
      subtitle={
        sensorSource === "external"
          ? "Route from this phone, pavement vibration from the XIAO board. Recording continues with the screen locked."
          : "Route, distance and speed from this phone. Recording continues with the screen locked."
      }
      title="Live detail"
    >
      {permissionMessage ? (
        <View style={styles.noticeCard}>
          <Text style={styles.noticeText}>{permissionMessage}</Text>
        </View>
      ) : null}

      <View style={styles.heroCard}>
        <Text style={styles.heroLabel}>Elapsed</Text>
        <Text style={styles.heroValue}>{formatDuration(elapsedSeconds)}</Text>
        <Text style={styles.heroMeta}>
          {formatDuration(metrics?.movingSeconds ?? 0)} moving · status {status}
        </Text>
      </View>

      <View style={styles.metricGrid}>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>Distance</Text>
          <Text style={styles.metricValue}>
            {formatDistance(metrics?.distanceMeters ?? 0)}
          </Text>
        </View>

        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>Speed</Text>
          <Text style={styles.metricValue}>{formatSpeedKmh(currentSpeed)}</Text>
        </View>
      </View>

      <View style={styles.metricGrid}>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>Average</Text>
          <Text style={styles.metricValue}>
            {formatSpeedKmh(metrics?.avgSpeedMps ?? 0)}
          </Text>
        </View>

        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>Max</Text>
          <Text style={styles.metricValue}>
            {formatSpeedKmh(metrics?.maxSpeedMps ?? 0)}
          </Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>GPS</Text>

        <View style={styles.axisRow}>
          <Text style={styles.axisLabel}>Accuracy</Text>
          <Text style={styles.axisValue}>{gpsState.label}</Text>
        </View>

        <View style={styles.axisRow}>
          <Text style={styles.axisLabel}>Fixes</Text>
          <Text style={styles.axisValue}>{gpsState.detail}</Text>
        </View>

        {recording?.lastRejection ? (
          <Text style={styles.hintText}>
            {rejectionLabels[recording.lastRejection]}
          </Text>
        ) : null}
      </View>

      {sensorSource === "external" ? (
        <>
          <View style={styles.metricGrid}>
            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>Vibration</Text>
              <Text style={styles.metricValue}>
                {(vibrationWindow[vibrationWindow.length - 1] ?? 0).toFixed(3)}
              </Text>
            </View>

            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>Avg vibration</Text>
              <Text style={styles.metricValue}>
                {averageVibration.toFixed(3)}
              </Text>
            </View>
          </View>

          <View style={styles.chartCard}>
            <Text style={styles.sectionTitle}>Live vibration graph</Text>

            <LineChart
              data={{
                labels: [],
                datasets: [{ data: vibrationWindow }],
              }}
              width={SCREEN_WIDTH - 56}
              height={220}
              withDots={false}
              withInnerLines
              withOuterLines={false}
              withVerticalLabels={false}
              withHorizontalLabels
              chartConfig={{
                backgroundGradientFrom: colors.surfaceMuted,
                backgroundGradientTo: colors.surfaceMuted,
                decimalPlaces: 2,
                color: () => colors.accent,
                labelColor: () => colors.textMuted,
                propsForBackgroundLines: {
                  stroke: "#c8def5",
                },
              }}
              bezier
              style={styles.chart}
            />
          </View>
        </>
      ) : null}

      {recording ? null : (
        <View style={styles.noticeCard}>
          <Text style={styles.noticeText}>
            No ride is being recorded. Start one from the ride screen.
          </Text>
        </View>
      )}
    </Page>
  );
}

const styles = StyleSheet.create({
  noticeCard: {
    backgroundColor: colors.surfaceWarm,
    borderRadius: radius.lg,
    padding: space.lg,
  },
  noticeText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
  },
  heroCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: space.xl,
    ...shadows.tile,
  },
  heroLabel: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "800",
    marginBottom: 6,
  },
  heroValue: {
    color: colors.text,
    fontSize: 52,
    fontWeight: "900",
    lineHeight: 58,
  },
  heroMeta: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: "700",
    marginTop: 6,
  },
  metricGrid: {
    flexDirection: "row",
    gap: 12,
  },
  metricCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: space.lg,
    ...shadows.tile,
  },
  metricLabel: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 8,
  },
  metricValue: {
    color: colors.accent,
    fontSize: 24,
    fontWeight: "900",
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: space.lg,
    ...shadows.tile,
  },
  chartCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: space.lg,
    overflow: "hidden",
    ...shadows.tile,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "800",
    marginBottom: 12,
  },
  chart: {
    borderRadius: radius.lg,
    marginLeft: -12,
  },
  axisRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceMuted,
  },
  axisLabel: {
    color: colors.textMuted,
    fontSize: 15,
    fontWeight: "700",
  },
  axisValue: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "800",
  },
  hintText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "700",
    marginTop: 10,
  },
});
