import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  Platform,
  PermissionsAndroid,
} from "react-native";
import { Accelerometer, Gyroscope } from "expo-sensors";
import * as Location from "expo-location";
import { useKeepAwake } from "expo-keep-awake";
import { useNavigation } from "@react-navigation/native";
import { useMeasurementStore } from "../store/measurementStore";
import { colors, radius, shadows, space } from "@skate-route-mapper/shared/design";
import * as BackgroundRecorder from "../native/BackgroundRecorder";
import type { BackgroundRecorderSample } from "../native/BackgroundRecorder";
import type { NessoFeatureFrame } from "../types/measurement";

const USE_ANDROID_BACKGROUND_RECORDER =
  Platform.OS === "android" && BackgroundRecorder.isAvailable();

type AccelData = {
  x: number;
  y: number;
  z: number;
};

type GyroData = {
  x: number;
  y: number;
  z: number;
};

type ContactState = "grounded" | "airborne" | "unknown";

const MIN_TRACKING_SPEED_KMH = 5;
const LOCATION_STALE_MS = 5000;

async function requestAndroidRecordingPermissions(sensorSource: "phone" | "external") {
  if (Platform.OS !== "android") {
    return true;
  }

  const permissions = [
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
  ];

  if (Number(Platform.Version) >= 33) {
    permissions.push(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  }

  if (sensorSource === "external" && Number(Platform.Version) >= 31) {
    permissions.push(
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT
    );
  }

  const results = await PermissionsAndroid.requestMultiple(permissions);
  const hasForegroundLocation =
    results[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] ===
      PermissionsAndroid.RESULTS.GRANTED ||
    results[PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION] ===
      PermissionsAndroid.RESULTS.GRANTED;

  if (!hasForegroundLocation) {
    console.log("Location permission not granted");
  }

  const hasBluetooth =
    sensorSource === "phone" ||
    Number(Platform.Version) < 31 ||
    (results[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] ===
      PermissionsAndroid.RESULTS.GRANTED &&
      results[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] ===
        PermissionsAndroid.RESULTS.GRANTED);

  if (!hasBluetooth) {
    console.log("Bluetooth permission not granted");
  }

  return hasForegroundLocation && hasBluetooth;
}

export default function RecordingScreen() {
  useKeepAwake();

  const navigation = useNavigation();

  const currentRideId = useMeasurementStore((state) => state.currentRideId);
  const sensorSource = useMeasurementStore((state) => state.sensorSource);
  const status = useMeasurementStore((state) => state.status);
  const samples = useMeasurementStore((state) => state.samples);
  const latestExternalImuSample = useMeasurementStore(
    (state) => state.latestExternalImuSample
  );
  const latestExternalFeatureFrame = useMeasurementStore(
    (state) => state.latestExternalFeatureFrame
  );
  const externalFeatureFrameCount = useMeasurementStore(
    (state) => state.externalFeatureFrameCount
  );
  const addSample = useMeasurementStore((state) => state.addSample);
  const addSamples = useMeasurementStore((state) => state.addSamples);
  const stopRecordingInStore = useMeasurementStore((state) => state.stopRecording);
  const canUseAndroidBackgroundRecorder =
    USE_ANDROID_BACKGROUND_RECORDER && sensorSource === "phone";

  const [accel, setAccel] = useState<AccelData>({ x: 0, y: 0, z: 0 });
  const [gyro, setGyro] = useState<GyroData>({ x: 0, y: 0, z: 0 });
  const [latestLocation, setLatestLocation] =
    useState<Location.LocationObject | null>(null);
  const [nativeSampleCount, setNativeSampleCount] = useState(0);
  const [nativeLatestSample, setNativeLatestSample] =
    useState<BackgroundRecorderSample | null>(null);
  const [nativeChartData, setNativeChartData] = useState<number[]>([0]);

  const latestGyro = useRef<GyroData>({ x: 0, y: 0, z: 0 });
  const latestLocationRef = useRef<Location.LocationObject | null>(null);

  useEffect(() => {
    if (canUseAndroidBackgroundRecorder) {
      console.log("BackgroundRecorder native mode active; skipping JS sensors");
      return;
    }

    if (sensorSource === "external") {
      console.log("External IMU mode active; skipping phone motion sensors");
      return;
    }

    console.log("BackgroundRecorder unavailable; using JS sensor fallback");
    Accelerometer.setUpdateInterval(200); // 5 hz
    Gyroscope.setUpdateInterval(200);

    const gyroSubscription = Gyroscope.addListener((data) => {
      latestGyro.current = data;
      setGyro(data);
    });

    const accelSubscription = Accelerometer.addListener((data) => {
      setAccel(data);

      const g = latestGyro.current;
      const loc = latestLocationRef.current;

      const vibrationMagnitude = Math.sqrt(
        data.x * data.x + data.y * data.y + data.z * data.z
      );
      const timestamp = Date.now();

      addSample({
        timestamp,

        ax: data.x,
        ay: data.y,
        az: data.z,

        gx: g.x,
        gy: g.y,
        gz: g.z,

        vibrationMagnitude,

        latitude: loc?.coords.latitude ?? null,
        longitude: loc?.coords.longitude ?? null,
        speed: loc?.coords.speed ?? null,
        locationTimestamp: loc?.timestamp ?? null,
        locationAccuracy: loc?.coords.accuracy ?? null,
        locationAgeMs: loc ? Math.max(0, timestamp - loc.timestamp) : null,
      });
    });

    return () => {
      accelSubscription.remove();
      gyroSubscription.remove();
    };
  }, [addSample, canUseAndroidBackgroundRecorder, sensorSource]);

  useEffect(() => {
    if (canUseAndroidBackgroundRecorder || sensorSource !== "external") {
      return;
    }

    if (!latestExternalImuSample) {
      return;
    }

    const loc = latestLocationRef.current;
    const vibrationMagnitude = Math.sqrt(
      latestExternalImuSample.ax * latestExternalImuSample.ax +
        latestExternalImuSample.ay * latestExternalImuSample.ay +
        latestExternalImuSample.az * latestExternalImuSample.az
    );
    const timestamp = Date.now();

    setAccel({
      x: latestExternalImuSample.ax,
      y: latestExternalImuSample.ay,
      z: latestExternalImuSample.az,
    });
    setGyro({
      x: latestExternalImuSample.gx,
      y: latestExternalImuSample.gy,
      z: latestExternalImuSample.gz,
    });

    addSample({
      timestamp,
      ax: latestExternalImuSample.ax,
      ay: latestExternalImuSample.ay,
      az: latestExternalImuSample.az,
      gx: latestExternalImuSample.gx,
      gy: latestExternalImuSample.gy,
      gz: latestExternalImuSample.gz,
      vibrationMagnitude,
      latitude: loc?.coords.latitude ?? null,
      longitude: loc?.coords.longitude ?? null,
      speed: loc?.coords.speed ?? null,
      locationTimestamp: loc?.timestamp ?? null,
      locationAccuracy: loc?.coords.accuracy ?? null,
      locationAgeMs: loc ? Math.max(0, timestamp - loc.timestamp) : null,
    });
  }, [
    addSample,
    canUseAndroidBackgroundRecorder,
    latestExternalImuSample,
    sensorSource,
  ]);

  useEffect(() => {
    if (canUseAndroidBackgroundRecorder) {
      console.log("BackgroundRecorder native mode active; skipping JS location");
      return;
    }

    let subscription: Location.LocationSubscription | null = null;

    async function startLocation() {
      const { status } = await Location.requestForegroundPermissionsAsync();

      if (status !== "granted") {
        console.log("Location permission not granted");
        return;
      }

      subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 1000,
          distanceInterval: 1,
        },
        (location) => {
          latestLocationRef.current = location;
          setLatestLocation(location);
        }
      );
    }

    startLocation();

    return () => {
      subscription?.remove();
    };
  }, [canUseAndroidBackgroundRecorder]);

  useEffect(() => {
    if (!canUseAndroidBackgroundRecorder || !currentRideId) {
      return;
    }

    const rideId = currentRideId;
    let mounted = true;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    async function startNativeRecording() {
      const canRecord = await requestAndroidRecordingPermissions(sensorSource);

      if (!canRecord || !mounted) {
        return;
      }

      await BackgroundRecorder.startRecording(rideId, 200, sensorSource);

      pollTimer = setInterval(async () => {
        const nativeStatus = await BackgroundRecorder.getStatus();

        if (!mounted) {
          return;
        }

        setNativeSampleCount(nativeStatus.sampleCount);

        if (nativeStatus.latestSample) {
          const sample = nativeStatus.latestSample;
          setNativeLatestSample(sample);
          setAccel({ x: sample.ax, y: sample.ay, z: sample.az });
          setGyro({ x: sample.gx, y: sample.gy, z: sample.gz });
          setNativeChartData((values) => {
            const nextValues = [...values, sample.vibrationMagnitude];
            return nextValues.slice(-40);
          });
        }
      }, 1000);
    }

    startNativeRecording();

    return () => {
      mounted = false;
      if (pollTimer) {
        clearInterval(pollTimer);
      }
    };
  }, [canUseAndroidBackgroundRecorder, currentRideId, sensorSource]);

  const visibleSampleCount = canUseAndroidBackgroundRecorder
    ? nativeSampleCount
    : sensorSource === "external"
    ? externalFeatureFrameCount
    : samples.length;
  const countLabel = sensorSource === "external" ? "Frames" : "Samples";
  const averageVibration = useMemo(() => {
    if (canUseAndroidBackgroundRecorder) {
      const visibleValues = nativeChartData.filter((value) => value > 0);

      if (visibleValues.length === 0) return 0;

      const total = visibleValues.reduce((sum, value) => sum + value, 0);
      return total / visibleValues.length;
    }

    if (samples.length === 0) return 0;

    const latest = samples.slice(-40);
    const total = latest.reduce(
      (sum, sample) => sum + sample.vibrationMagnitude,
      0
    );

    return total / latest.length;
  }, [canUseAndroidBackgroundRecorder, nativeChartData, samples]);
  const qualityLevel = latestExternalFeatureFrame?.roughnessLevel ?? getFallbackQualityLevel(averageVibration);
  const qualityLabel = latestExternalFeatureFrame
    ? getRoughnessLabel(latestExternalFeatureFrame.roughnessLevel)
    : getRoughnessLabel(qualityLevel);
  const qualityConfidence = latestExternalFeatureFrame?.confidence ?? 0.35;
  const qualityDetail = latestExternalFeatureFrame
    ? `${latestExternalFeatureFrame.rawSampleCount} onboard samples in ${latestExternalFeatureFrame.windowMs}ms`
    : "Estimated from low-rate phone samples";
  const gpsStatus =
    latestLocation || nativeLatestSample?.latitude != null ? "OK" : "Waiting";
  const speedKmh = getFreshSpeedKmh(latestLocation, nativeLatestSample);
  const speedText = speedKmh == null ? "-" : `${speedKmh.toFixed(1)} km/h`;
  const trackingStatus =
    speedKmh == null
      ? "Waiting"
      : speedKmh >= MIN_TRACKING_SPEED_KMH
      ? "Skating"
      : "Paused";
  const contactState = getContactState(latestExternalFeatureFrame, speedKmh);
  const contactLabel = getContactLabel(contactState);

  const handleStop = async () => {
    if (canUseAndroidBackgroundRecorder && currentRideId) {
      await BackgroundRecorder.stopRecording();
      const nativeSamples = await BackgroundRecorder.readSamples(currentRideId);
      await addSamples(nativeSamples);
      await BackgroundRecorder.clearSamples(currentRideId);
    }

    stopRecordingInStore();
    navigation.goBack();
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.appName}>Skate Route Mapper</Text>
          <Text style={styles.title}>Recording route</Text>
          <Text style={styles.subtitle}>
            Measuring vibration using {sensorSource === "external" ? "the Nesso N1 IMU" : "the phone accelerometer and gyroscope"}.
            {sensorSource === "external"
              ? " Nesso feature-frame rides stay in the foreground while Gate A is tested."
              : " Android preview builds can keep recording from the foreground service while the phone is locked."}
          </Text>
        </View>

        <View style={styles.statusCard}>
          <View>
            <Text style={styles.statusLabel}>Status</Text>
            <Text style={styles.statusValue}>{status}</Text>
          </View>

          <View>
            <Text style={styles.statusLabel}>{countLabel}</Text>
            <Text style={styles.statusValue}>{visibleSampleCount}</Text>
          </View>
        </View>

        <View style={styles.metricGrid}>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Surface quality</Text>
            <Text style={styles.metricValue}>
              {qualityLabel}
            </Text>
          </View>

          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Confidence</Text>
            <Text style={styles.metricValue}>{Math.round(qualityConfidence * 100)}%</Text>
          </View>
        </View>

        <View style={styles.metricGrid}>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>GPS</Text>
            <Text style={styles.metricValue}>{gpsStatus}</Text>
          </View>

          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Speed</Text>
            <Text style={styles.metricValue}>{speedText}</Text>
          </View>
        </View>

        <View style={styles.metricGrid}>
          <View
            style={[
              styles.metricCard,
              styles.contactCard,
              getContactCardStyle(contactState),
            ]}
          >
            <Text style={[styles.metricLabel, styles.contactLabel]}>
              Skate contact
            </Text>
            <Text style={[styles.metricValue, styles.contactValue]}>
              {contactLabel}
            </Text>
          </View>

          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Tracking</Text>
            <Text style={styles.metricValue}>{trackingStatus}</Text>
          </View>
        </View>

        <View style={styles.qualityCard}>
          <View style={styles.qualityHeader}>
            <Text style={styles.sectionTitle}>Live surface quality</Text>
            <Text style={styles.qualityBadge}>Level {qualityLevel}</Text>
          </View>

          <View style={styles.qualityScale}>
            {[1, 2, 3, 4, 5, 6].map((level) => (
              <View
                key={level}
                style={[
                  styles.qualityStep,
                  level <= qualityLevel && styles.qualityStepActive,
                  level === qualityLevel && styles.qualityStepCurrent,
                ]}
              />
            ))}
          </View>

          <Text style={styles.qualityDetail}>{qualityDetail}</Text>
        </View>

        {sensorSource === "external" ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Feature frame</Text>

            <View style={styles.axisRow}>
              <Text style={styles.axisLabel}>Accel RMS</Text>
              <Text style={styles.axisValue}>
                {latestExternalFeatureFrame?.accelRms.toFixed(3) ?? "-"}
              </Text>
            </View>

            <View style={styles.axisRow}>
              <Text style={styles.axisLabel}>Peak to peak</Text>
              <Text style={styles.axisValue}>
                {latestExternalFeatureFrame?.accelPeakToPeak.toFixed(3) ?? "-"}
              </Text>
            </View>

            <View style={styles.axisRow}>
              <Text style={styles.axisLabel}>Onboard samples</Text>
              <Text style={styles.axisValue}>
                {latestExternalFeatureFrame?.rawSampleCount ?? "-"}
              </Text>
            </View>
          </View>
        ) : (
          <>
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Accelerometer</Text>

              <View style={styles.axisRow}>
                <Text style={styles.axisLabel}>X</Text>
                <Text style={styles.axisValue}>{accel.x.toFixed(4)}</Text>
              </View>

              <View style={styles.axisRow}>
                <Text style={styles.axisLabel}>Y</Text>
                <Text style={styles.axisValue}>{accel.y.toFixed(4)}</Text>
              </View>

              <View style={styles.axisRow}>
                <Text style={styles.axisLabel}>Z</Text>
                <Text style={styles.axisValue}>{accel.z.toFixed(4)}</Text>
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Gyroscope</Text>

              <View style={styles.axisRow}>
                <Text style={styles.axisLabel}>X</Text>
                <Text style={styles.axisValue}>{gyro.x.toFixed(4)}</Text>
              </View>

              <View style={styles.axisRow}>
                <Text style={styles.axisLabel}>Y</Text>
                <Text style={styles.axisValue}>{gyro.y.toFixed(4)}</Text>
              </View>

              <View style={styles.axisRow}>
                <Text style={styles.axisLabel}>Z</Text>
                <Text style={styles.axisValue}>{gyro.z.toFixed(4)}</Text>
              </View>
            </View>
          </>
        )}

        <Pressable onPress={handleStop} style={styles.stopButton}>
          <Text style={styles.stopButtonText}>Stop recording</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function getFallbackQualityLevel(vibrationMagnitude: number): 1 | 2 | 3 | 4 | 5 | 6 {
  if (vibrationMagnitude < 1.02) return 1;
  if (vibrationMagnitude < 1.08) return 2;
  if (vibrationMagnitude < 1.16) return 3;
  if (vibrationMagnitude < 1.28) return 4;
  if (vibrationMagnitude < 1.45) return 5;
  return 6;
}

function getRoughnessLabel(level: 1 | 2 | 3 | 4 | 5 | 6) {
  switch (level) {
    case 1:
      return "Excellent";
    case 2:
      return "Good";
    case 3:
      return "Okay";
    case 4:
      return "Rough";
    case 5:
      return "Very rough";
    case 6:
      return "Unskatable";
  }
}

function getFreshSpeedKmh(
  latestLocation: Location.LocationObject | null,
  nativeLatestSample: BackgroundRecorderSample | null
) {
  const now = Date.now();
  const locationAgeMs = latestLocation ? now - latestLocation.timestamp : Infinity;

  if (
    latestLocation?.coords.speed != null &&
    latestLocation.coords.speed >= 0 &&
    locationAgeMs <= LOCATION_STALE_MS
  ) {
    return latestLocation.coords.speed * 3.6;
  }

  if (nativeLatestSample?.speed != null && nativeLatestSample.speed >= 0) {
    return nativeLatestSample.speed * 3.6;
  }

  return null;
}

function getContactState(
  frame: NessoFeatureFrame | null,
  speedKmh: number | null
): ContactState {
  if (speedKmh == null || speedKmh < MIN_TRACKING_SPEED_KMH) {
    return "unknown";
  }

  if (!frame) return "unknown";

  if (frame.accelRms >= 0.035 || frame.accelPeakToPeak >= 0.12) {
    return "grounded";
  }

  if (frame.accelRms <= 0.018 && frame.accelPeakToPeak <= 0.07) {
    return "airborne";
  }

  return "unknown";
}

function getContactLabel(state: ContactState) {
  switch (state) {
    case "grounded":
      return "Asphalt";
    case "airborne":
      return "Sky";
    default:
      return "Check";
  }
}

function getContactCardStyle(state: ContactState) {
  switch (state) {
    case "grounded":
      return styles.contactCardGrounded;
    case "airborne":
      return styles.contactCardAirborne;
    default:
      return styles.contactCardUnknown;
  }
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.page,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: 20,
    paddingBottom: 48,
    gap: 18,
  },
  header: {
    marginTop: 16,
  },
  appName: {
    color: colors.textOnOrange,
    fontSize: 15,
    fontWeight: "800",
    marginBottom: 12,
    opacity: 0.82,
  },
  title: {
    color: colors.textOnOrange,
    fontSize: 34,
    fontWeight: "800",
    lineHeight: 39,
    marginBottom: 10,
  },
  subtitle: {
    color: colors.textOnOrange,
    fontSize: 16,
    lineHeight: 23,
    opacity: 0.82,
  },
  statusCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: space.lg,
    flexDirection: "row",
    justifyContent: "space-between",
    ...shadows.tile,
  },
  statusLabel: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 6,
  },
  statusValue: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "800",
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
  contactCard: {
    minHeight: 88,
  },
  contactCardGrounded: {
    backgroundColor: colors.textMuted,
  },
  contactCardAirborne: {
    backgroundColor: colors.link,
  },
  contactCardUnknown: {
    backgroundColor: colors.accent,
  },
  contactLabel: {
    color: colors.textOnOrange,
  },
  contactValue: {
    color: colors.textOnOrange,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: space.lg,
    ...shadows.tile,
  },
  qualityCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: space.lg,
    ...shadows.tile,
  },
  qualityHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  qualityBadge: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "900",
    backgroundColor: colors.surfaceWarm,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  qualityScale: {
    flexDirection: "row",
    gap: 7,
    marginTop: 6,
    marginBottom: 12,
  },
  qualityStep: {
    flex: 1,
    height: 18,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
  },
  qualityStepActive: {
    backgroundColor: colors.accent,
  },
  qualityStepCurrent: {
    borderWidth: 2,
    borderColor: colors.text,
  },
  qualityDetail: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "700",
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "800",
    marginBottom: 12,
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
  stopButton: {
    backgroundColor: colors.danger,
    paddingVertical: 17,
    borderRadius: radius.lg,
    alignItems: "center",
  },
  stopButtonText: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "800",
  },
});
