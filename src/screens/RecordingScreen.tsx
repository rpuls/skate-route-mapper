import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  Pressable,
  StyleSheet,
  Dimensions,
  ScrollView,
} from "react-native";
import { Accelerometer, Gyroscope } from "expo-sensors";
import * as Location from "expo-location";
import { LineChart } from "react-native-chart-kit";
import { useNavigation } from "@react-navigation/native";
import { useMeasurementStore } from "../store/measurementStore";

const SCREEN_WIDTH = Dimensions.get("window").width;

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

export default function RecordingScreen() {
  const navigation = useNavigation();

  const status = useMeasurementStore((state) => state.status);
  const samples = useMeasurementStore((state) => state.samples);
  const addSample = useMeasurementStore((state) => state.addSample);
  const stopRecording = useMeasurementStore((state) => state.stopRecording);

  const [accel, setAccel] = useState<AccelData>({ x: 0, y: 0, z: 0 });
  const [gyro, setGyro] = useState<GyroData>({ x: 0, y: 0, z: 0 });
  const [latestLocation, setLatestLocation] =
    useState<Location.LocationObject | null>(null);

  const latestGyro = useRef<GyroData>({ x: 0, y: 0, z: 0 });
  const latestLocationRef = useRef<Location.LocationObject | null>(null);

  useEffect(() => {
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
  }, [addSample]);

  useEffect(() => {
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
          timeInterval: 2000, //Updates gps loc. every 2 sec.
          distanceInterval: 3, // or when moved around for 3 meters
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
  }, []);

  const latestSample = samples[samples.length - 1];

  const chartData = useMemo(() => {
    const latest = samples.slice(-40);
    const values = latest.map((sample) => sample.vibrationMagnitude);

    return values.length > 0 ? values : [0];
  }, [samples]);

  const averageVibration = useMemo(() => {
    if (samples.length === 0) return 0;

    const latest = samples.slice(-40);
    const total = latest.reduce(
      (sum, sample) => sum + sample.vibrationMagnitude,
      0
    );

    return total / latest.length;
  }, [samples]);

  const handleStop = () => {
    stopRecording();
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
            Measuring vibration using the phone accelerometer and gyroscope.
          </Text>
        </View>

        <View style={styles.statusCard}>
          <View>
            <Text style={styles.statusLabel}>Status</Text>
            <Text style={styles.statusValue}>{status}</Text>
          </View>

          <View>
            <Text style={styles.statusLabel}>Samples</Text>
            <Text style={styles.statusValue}>{samples.length}</Text>
          </View>
        </View>

        <View style={styles.metricGrid}>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Vibration</Text>
            <Text style={styles.metricValue}>
              {latestSample?.vibrationMagnitude.toFixed(3) ?? "0.000"}
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
            <Text style={styles.metricValue}>
              {latestLocation ? "OK" : "Waiting"}
            </Text>
          </View>

          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Speed</Text>
            <Text style={styles.metricValue}>
              {latestLocation?.coords.speed != null
                ? `${latestLocation.coords.speed.toFixed(1)} m/s`
                : "-"}
            </Text>
          </View>
        </View>

        <View style={styles.chartCard}>
          <Text style={styles.sectionTitle}>Live vibration graph</Text>

          <LineChart
            data={{
              labels: [],
              datasets: [
                {
                  data: chartData,
                },
              ],
            }}
            width={SCREEN_WIDTH - 56}
            height={220}
            withDots={false}
            withInnerLines
            withOuterLines={false}
            withVerticalLabels={false}
            withHorizontalLabels
            chartConfig={{
              backgroundGradientFrom: "#18212b",
              backgroundGradientTo: "#18212b",
              decimalPlaces: 2,
              color: () => "#38bdf8",
              labelColor: () => "#94a3b8",
              propsForBackgroundLines: {
                stroke: "#334155",
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
    backgroundColor: "#101418",
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
    color: "#7dd3fc",
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 12,
    letterSpacing: 0.5,
  },
  title: {
    color: "#f8fafc",
    fontSize: 34,
    fontWeight: "800",
    lineHeight: 39,
    marginBottom: 10,
  },
  subtitle: {
    color: "#94a3b8",
    fontSize: 16,
    lineHeight: 23,
  },
  statusCard: {
    backgroundColor: "#18212b",
    borderRadius: 22,
    padding: 18,
    borderWidth: 1,
    borderColor: "#263241",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  statusLabel: {
    color: "#94a3b8",
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 6,
  },
  statusValue: {
    color: "#f8fafc",
    fontSize: 20,
    fontWeight: "800",
  },
  metricGrid: {
    flexDirection: "row",
    gap: 12,
  },
  metricCard: {
    flex: 1,
    backgroundColor: "#18212b",
    borderRadius: 22,
    padding: 16,
    borderWidth: 1,
    borderColor: "#263241",
  },
  metricLabel: {
    color: "#94a3b8",
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 8,
  },
  metricValue: {
    color: "#7dd3fc",
    fontSize: 24,
    fontWeight: "900",
  },
  card: {
    backgroundColor: "#18212b",
    borderRadius: 22,
    padding: 16,
    borderWidth: 1,
    borderColor: "#263241",
  },
  chartCard: {
    backgroundColor: "#18212b",
    borderRadius: 22,
    padding: 16,
    borderWidth: 1,
    borderColor: "#263241",
    overflow: "hidden",
  },
  sectionTitle: {
    color: "#f8fafc",
    fontSize: 17,
    fontWeight: "800",
    marginBottom: 12,
  },
  chart: {
    borderRadius: 16,
    marginLeft: -12,
  },
  axisRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#263241",
  },
  axisLabel: {
    color: "#94a3b8",
    fontSize: 15,
    fontWeight: "700",
  },
  axisValue: {
    color: "#f8fafc",
    fontSize: 15,
    fontWeight: "800",
  },
  stopButton: {
    backgroundColor: "#ef4444",
    paddingVertical: 17,
    borderRadius: 20,
    alignItems: "center",
  },
  stopButtonText: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "800",
  },
});