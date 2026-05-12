import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Dimensions,
  SafeAreaView,
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { LineChart } from "react-native-chart-kit";
import dayjs from "dayjs";

import { getRide, getSamplesForRide } from "../database/db";
import RideRouteMap from "../components/RideRouteMap";
import { colors, radius, shadows, space } from "@skate-route-mapper/shared/design";
import type { MeasurementSample } from "../types/measurement";

type RouteParams = {
  rideId: string;
};

const MAX_TRUSTED_LOCATION_AGE_MS = 2500;
const MAX_TRUSTED_LOCATION_ACCURACY_METERS = 25;
const PLAYBACK_TICK_MS = 100;
const CHART_SAMPLE_WINDOW = 40;
const PLAYBACK_SPEEDS = [1, 2, 4] as const;
const SCREEN_WIDTH = Dimensions.get("window").width;

type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

export default function RideDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute();
  const { rideId } = route.params as RouteParams;

  const [playbackIndex, setPlaybackIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<PlaybackSpeed>(1);
  const playbackTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const ride = useMemo(() => getRide(rideId), [rideId]);
  const samples = useMemo(() => getSamplesForRide(rideId), [rideId]);

  const trustedGeoSamples = useMemo(
    () =>
      samples.filter(
        (sample) => isTrustedGeoSample(sample)
      ),
    [samples]
  );

  const coordinates = useMemo(
    () =>
      trustedGeoSamples.map((sample) => ({
        latitude: sample.latitude as number,
        longitude: sample.longitude as number,
      })),
    [trustedGeoSamples]
  );

  const visibleCoordinates = useMemo(() => {
    if (samples.length === 0) return [];

    return samples
      .slice(0, playbackIndex + 1)
      .filter((sample) => isTrustedGeoSample(sample))
      .map((sample) => ({
        latitude: sample.latitude as number,
        longitude: sample.longitude as number,
      }));
  }, [samples, playbackIndex]);

  const currentSample = samples[playbackIndex];
  const currentCoordinate = visibleCoordinates[visibleCoordinates.length - 1];
  const timelineProgress =
    samples.length > 1 ? (playbackIndex / (samples.length - 1)) * 100 : 0;

  const totalDurationMs = useMemo(() => {
    if (samples.length < 2) return 0;

    return Math.max(
      0,
      samples[samples.length - 1].timestamp - samples[0].timestamp
    );
  }, [samples]);

  const elapsedMs = useMemo(() => {
    if (!currentSample || samples.length === 0) return 0;

    return Math.max(0, currentSample.timestamp - samples[0].timestamp);
  }, [currentSample, samples]);

  const chartData = useMemo(() => {
    const startIndex = Math.max(0, playbackIndex - CHART_SAMPLE_WINDOW + 1);
    const values = samples
      .slice(startIndex, playbackIndex + 1)
      .map((sample) => sample.vibrationMagnitude);

    return values.length > 0 ? values : [0];
  }, [samples, playbackIndex]);

  const averageVibration = useMemo(() => {
    if (samples.length === 0) return 0;

    const total = samples.reduce(
      (sum, sample) => sum + sample.vibrationMagnitude,
      0
    );

    return total / samples.length;
  }, [samples]);

  const maxVibration = useMemo(() => {
    if (samples.length === 0) return 0;

    return Math.max(...samples.map((sample) => sample.vibrationMagnitude));
  }, [samples]);

  const initialRegion = useMemo(() => {
    const first = coordinates[0];

    return {
      latitude: first?.latitude ?? 55.6761,
      longitude: first?.longitude ?? 12.5683,
      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    };
  }, [coordinates]);

  useEffect(() => {
    setPlaybackIndex(0);
    setIsPlaying(false);
  }, [rideId]);

  useEffect(() => {
    if (!isPlaying || samples.length < 2) {
      if (playbackTimerRef.current) {
        clearInterval(playbackTimerRef.current);
        playbackTimerRef.current = null;
      }
      return;
    }

    playbackTimerRef.current = setInterval(() => {
      setPlaybackIndex((currentIndex) => {
        const current = samples[currentIndex];

        if (!current || currentIndex >= samples.length - 1) {
          setIsPlaying(false);
          return samples.length - 1;
        }

        const targetTimestamp = current.timestamp + PLAYBACK_TICK_MS * playbackSpeed;
        const nextIndex = samples.findIndex(
          (sample, sampleIndex) =>
            sampleIndex > currentIndex && sample.timestamp >= targetTimestamp
        );

        if (nextIndex === -1) {
          setIsPlaying(false);
          return samples.length - 1;
        }

        return nextIndex;
      });
    }, PLAYBACK_TICK_MS);

    return () => {
      if (playbackTimerRef.current) {
        clearInterval(playbackTimerRef.current);
        playbackTimerRef.current = null;
      }
    };
  }, [isPlaying, playbackSpeed, samples]);

  const handleTogglePlayback = () => {
    if (samples.length === 0) return;

    if (playbackIndex >= samples.length - 1) {
      setPlaybackIndex(0);
    }

    setIsPlaying((value) => !value);
  };

  const handleResetPlayback = () => {
    setIsPlaying(false);
    setPlaybackIndex(0);
  };

  if (!ride) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.container}>
          <Pressable onPress={() => navigation.goBack()}>
            <Text style={styles.backText}>Back</Text>
          </Pressable>
          <Text style={styles.title}>Ride not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()}>
            <Text style={styles.backText}>Back</Text>
          </Pressable>

          <Text style={styles.title}>Ride details</Text>
          <Text style={styles.subtitle}>
            {dayjs(ride.startedAt).format("DD MMM YYYY - HH:mm")}
          </Text>
        </View>

        <View style={styles.mapCard}>
          <RideRouteMap
            currentCoordinate={currentCoordinate}
            currentMarkerDescription={`Vibration: ${
              currentSample?.vibrationMagnitude.toFixed(3) ?? "-"
            }`}
            currentMarkerTitle={formatDuration(elapsedMs)}
            initialRegion={initialRegion}
            startCoordinate={coordinates[0]}
            visibleCoordinates={visibleCoordinates}
          />

          <View style={styles.replayPanel}>
            <View style={styles.replayHeader}>
              <Text style={styles.replayTitle}>Route replay</Text>
              <Text style={styles.replayTime}>
                {formatDuration(elapsedMs)} / {formatDuration(totalDurationMs)}
              </Text>
            </View>

            <View style={styles.timelineTrack}>
              <View
                style={[
                  styles.timelineFill,
                  {
                    width: `${timelineProgress}%` as `${number}%`,
                  },
                ]}
              />
            </View>

            <View style={styles.playbackControls}>
              <Pressable
                onPress={handleTogglePlayback}
                style={[
                  styles.controlButton,
                  samples.length === 0 && styles.disabledButton,
                ]}
                disabled={samples.length === 0}
              >
                <Text style={styles.primaryControlText}>
                  {isPlaying ? "Pause" : "Play"}
                </Text>
              </Pressable>

              <Pressable
                onPress={handleResetPlayback}
                style={styles.controlButtonSecondary}
              >
                <Text style={styles.secondaryControlText}>Reset</Text>
              </Pressable>

              <View style={styles.speedControls}>
                {PLAYBACK_SPEEDS.map((speed) => (
                  <Pressable
                    key={speed}
                    onPress={() => setPlaybackSpeed(speed)}
                    style={[
                      styles.speedButton,
                      playbackSpeed === speed && styles.speedButtonSelected,
                    ]}
                  >
                    <Text
                      style={[
                        styles.speedButtonText,
                        playbackSpeed === speed && styles.speedButtonTextSelected,
                      ]}
                    >
                      {speed}x
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <View style={styles.replayStats}>
              <Text style={styles.replayText}>
                Vibration:{" "}
                <Text style={styles.replayValue}>
                  {currentSample?.vibrationMagnitude.toFixed(3) ?? "-"}
                </Text>
              </Text>

              <Text style={styles.replayText}>
                Speed:{" "}
                <Text style={styles.replayValue}>
                  {currentSample?.speed != null
                    ? `${currentSample.speed.toFixed(1)} m/s`
                    : "-"}
                </Text>
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.chartCard}>
          <Text style={styles.sectionTitle}>Vibration replay</Text>

          <LineChart
            data={{
              labels: [],
              datasets: [{ data: chartData }],
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
                stroke: colors.border,
              },
            }}
            bezier
            style={styles.chart}
          />
        </View>

        <View style={styles.metricGrid}>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Samples</Text>
            <Text style={styles.metricValue}>{samples.length}</Text>
          </View>

          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Trusted GPS</Text>
            <Text style={styles.metricValue}>{coordinates.length}</Text>
          </View>
        </View>

        <View style={styles.metricGrid}>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Avg vibration</Text>
            <Text style={styles.metricValue}>{averageVibration.toFixed(3)}</Text>
          </View>

          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Max vibration</Text>
            <Text style={styles.metricValue}>{maxVibration.toFixed(3)}</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Ride info</Text>

          <Text style={styles.infoText}>Vehicle: {ride.vehicleType}</Text>
          <Text style={styles.infoText}>Sensor: {ride.sensorSource}</Text>
          <Text style={styles.infoText}>
            Started: {dayjs(ride.startedAt).format("HH:mm:ss")}
          </Text>
          <Text style={styles.infoText}>
            Ended:{" "}
            {ride.endedAt ? dayjs(ride.endedAt).format("HH:mm:ss") : "Not finished"}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function isTrustedGeoSample(sample: MeasurementSample) {
  return (
    sample.latitude !== null &&
    sample.longitude !== null &&
    sample.locationAgeMs != null &&
    sample.locationAgeMs <= MAX_TRUSTED_LOCATION_AGE_MS &&
    sample.locationAccuracy != null &&
    sample.locationAccuracy <= MAX_TRUSTED_LOCATION_ACCURACY_METERS
  );
}

function formatDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${padTimePart(minutes)}:${padTimePart(seconds)}`;
  }

  return `${padTimePart(minutes)}:${padTimePart(seconds)}`;
}

function padTimePart(value: number) {
  return value.toString().padStart(2, "0");
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.page,
  },
  scroll: {
    flex: 1,
  },
  container: {
    flex: 1,
    padding: 20,
  },
  content: {
    padding: 20,
    paddingBottom: 48,
    gap: 18,
  },
  header: {
    marginTop: 16,
  },
  backText: {
    color: colors.textOnOrange,
    fontSize: 15,
    fontWeight: "800",
    marginBottom: 18,
  },
  title: {
    color: colors.textOnOrange,
    fontSize: 34,
    fontWeight: "900",
    marginBottom: 8,
  },
  subtitle: {
    color: colors.textOnOrange,
    fontSize: 16,
    opacity: 0.82,
  },
  mapCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    overflow: "hidden",
    ...shadows.tile,
  },
  replayPanel: {
    padding: space.lg,
    backgroundColor: colors.surface,
  },
  replayHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 8,
  },
  replayTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "900",
  },
  replayTime: {
    color: colors.accent,
    fontSize: 16,
    fontWeight: "900",
  },
  timelineTrack: {
    height: 10,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.pill,
    overflow: "hidden",
    marginBottom: 14,
  },
  timelineFill: {
    height: "100%",
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
  },
  playbackControls: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  controlButton: {
    minHeight: 42,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: radius.lg,
    paddingHorizontal: space.lg,
  },
  controlButtonSecondary: {
    minHeight: 42,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.surfaceWarm,
    borderRadius: radius.lg,
    paddingHorizontal: space.lg,
  },
  disabledButton: {
    opacity: 0.5,
  },
  primaryControlText: {
    color: colors.textOnOrange,
    fontSize: 15,
    fontWeight: "900",
  },
  secondaryControlText: {
    color: colors.accent,
    fontSize: 15,
    fontWeight: "900",
  },
  speedControls: {
    flexDirection: "row",
    gap: 6,
  },
  speedButton: {
    minHeight: 36,
    minWidth: 42,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.lg,
  },
  speedButtonSelected: {
    backgroundColor: colors.accent,
  },
  speedButtonText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "900",
  },
  speedButtonTextSelected: {
    color: colors.textOnOrange,
  },
  replayStats: {
    marginTop: 12,
    gap: 4,
  },
  replayText: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: "700",
  },
  replayValue: {
    color: colors.text,
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
    fontWeight: "900",
    marginBottom: 12,
  },
  chart: {
    borderRadius: radius.lg,
    marginLeft: -12,
  },
  infoText: {
    color: colors.textMuted,
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 8,
  },
});
