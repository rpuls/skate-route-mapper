import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  Pressable,
  StyleSheet,
  Dimensions,
  ScrollView,
  Platform,
  PermissionsAndroid,
} from "react-native";
import { Accelerometer, Gyroscope } from "expo-sensors";
import * as Location from "expo-location";
import { useKeepAwake } from "expo-keep-awake";
import { LineChart } from "react-native-chart-kit";
import { useNavigation } from "@react-navigation/native";
import { useMeasurementStore } from "../store/measurementStore";
import { colors, radius, shadows, space } from "@skate-route-mapper/shared";
import * as BackgroundRecorder from "../native/BackgroundRecorder";
import type { BackgroundRecorderSample } from "../native/BackgroundRecorder";

const SCREEN_WIDTH = Dimensions.get("window").width;
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
  const addSample = useMeasurementStore((state) => state.addSample);
  const addSamples = useMeasurementStore((state) => state.addSamples);
  const stopRecordingInStore = useMeasurementStore((state) => state.stopRecording);
  const canUseAndroidBackgroundRecorder = USE_ANDROID_BACKGROUND_RECORDER;

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

      addSample({
        timestamp: Date.now(),

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
      timestamp: Date.now(),
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
          timeInterval: 2000,
          distanceInterval: 3,
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

  const latestSample = samples[samples.length - 1];
  const visibleSampleCount = canUseAndroidBackgroundRecorder
    ? nativeSampleCount
    : samples.length;
  const visibleLatestSample = canUseAndroidBackgroundRecorder
    ? nativeLatestSample
    : latestSample;

  const chartData = useMemo(() => {
    if (canUseAndroidBackgroundRecorder) {
      return nativeChartData;
    }

    const latest = samples.slice(-40);
    const values = latest.map((sample) => sample.vibrationMagnitude);

    return values.length > 0 ? values : [0];
  }, [canUseAndroidBackgroundRecorder, nativeChartData, samples]);

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
  const gpsStatus =
    latestLocation || nativeLatestSample?.latitude != null ? "OK" : "Waiting";
  const speedText =
    latestLocation?.coords.speed != null
      ? `${latestLocation.coords.speed.toFixed(1)} m/s`
      : nativeLatestSample?.speed != null
      ? `${nativeLatestSample.speed.toFixed(1)} m/s`
      : "-";

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
          <Text style={styles.appName}>skate-route-mapper</Text>
          <Text style={styles.title}>Recording route</Text>
          <Text style={styles.subtitle}>
            Measuring vibration using {sensorSource === "external" ? "the Nesso N1 IMU" : "the phone accelerometer and gyroscope"}.
            Android preview builds can keep recording from the foreground
            service while the phone is locked.
          </Text>
        </View>

        <View style={styles.statusCard}>
          <View>
            <Text style={styles.statusLabel}>Status</Text>
            <Text style={styles.statusValue}>{status}</Text>
          </View>

          <View>
            <Text style={styles.statusLabel}>Samples</Text>
            <Text style={styles.statusValue}>{visibleSampleCount}</Text>
          </View>
        </View>

        <View style={styles.metricGrid}>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Vibration</Text>
            <Text style={styles.metricValue}>
              {visibleLatestSample?.vibrationMagnitude.toFixed(3) ?? "0.000"}
            </Text>
          </View>

          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Avg vibration</Text>
            <Text style={styles.metricValue}>{averageVibration.toFixed(3)}</Text>
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

        <View style={styles.chartCard}>
          <Text style={styles.sectionTitle}>Live vibration graph</Text>

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
                stroke: "#c8def5",
              },
            }}
            bezier
            style={styles.chart}
          />
        </View>

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

        <Pressable onPress={handleStop} style={styles.stopButton}>
          <Text style={styles.stopButtonText}>Stop recording</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
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
