import React, { useMemo, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import MapView, { Polyline, Marker } from "react-native-maps";
import Slider from "@react-native-community/slider";
import dayjs from "dayjs";

import { getRide, getSamplesForRide } from "../database/db";

type RouteParams = {
  rideId: string;
};

export default function RideDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute();
  const { rideId } = route.params as RouteParams;

  const [progress, setProgress] = useState(0);

  const ride = useMemo(() => getRide(rideId), [rideId]);
  const samples = useMemo(() => getSamplesForRide(rideId), [rideId]);

  const geoSamples = useMemo(
    () =>
      samples.filter(
        (sample) => sample.latitude !== null && sample.longitude !== null
      ),
    [samples]
  );

  const coordinates = useMemo(
    () =>
      geoSamples.map((sample) => ({
        latitude: sample.latitude as number,
        longitude: sample.longitude as number,
      })),
    [geoSamples]
  );

  const currentIndex = useMemo(() => {
    if (geoSamples.length === 0) return 0;

    return Math.min(
      geoSamples.length - 1,
      Math.round((progress / 100) * (geoSamples.length - 1))
    );
  }, [geoSamples.length, progress]);

  const visibleCoordinates = useMemo(() => {
    if (coordinates.length === 0) return [];

    return coordinates.slice(0, currentIndex + 1);
  }, [coordinates, currentIndex]);

  const currentSample = geoSamples[currentIndex];
  const currentCoordinate = coordinates[currentIndex];

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

  if (!ride) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.container}>
          <Pressable onPress={() => navigation.goBack()}>
            <Text style={styles.backText}>← Back</Text>
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
            <Text style={styles.backText}>← Back</Text>
          </Pressable>

          <Text style={styles.title}>Ride details</Text>
          <Text style={styles.subtitle}>
            {dayjs(ride.startedAt).format("DD MMM YYYY · HH:mm")}
          </Text>
        </View>

        <View style={styles.mapCard}>
          <MapView style={styles.map} initialRegion={initialRegion}>
            {visibleCoordinates.length > 1 && (
              <Polyline coordinates={visibleCoordinates} strokeWidth={5} />
            )}

            {coordinates[0] && <Marker coordinate={coordinates[0]} title="Start" />}

            {currentCoordinate && (
              <Marker
                coordinate={currentCoordinate}
                title={`${Math.round(progress)}%`}
                description={`Vibration: ${
                  currentSample?.vibrationMagnitude.toFixed(3) ?? "-"
                }`}
              />
            )}
          </MapView>

          <View style={styles.sliderPanel}>
            <View style={styles.sliderHeader}>
              <Text style={styles.sliderTitle}>Route replay</Text>
              <Text style={styles.sliderPercent}>{Math.round(progress)}%</Text>
            </View>

            <Slider
              minimumValue={0}
              maximumValue={100}
              step={1}
              value={progress}
              onValueChange={setProgress}
              minimumTrackTintColor="#38bdf8"
              maximumTrackTintColor="#334155"
              thumbTintColor="#7dd3fc"
            />

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

        <View style={styles.metricGrid}>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Samples</Text>
            <Text style={styles.metricValue}>{samples.length}</Text>
          </View>

          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>GPS points</Text>
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

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#101418",
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
    color: "#7dd3fc",
    fontSize: 15,
    fontWeight: "800",
    marginBottom: 18,
  },
  title: {
    color: "#f8fafc",
    fontSize: 34,
    fontWeight: "900",
    marginBottom: 8,
  },
  subtitle: {
    color: "#94a3b8",
    fontSize: 16,
  },
  mapCard: {
    backgroundColor: "#18212b",
    borderRadius: 22,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#263241",
  },
  map: {
    height: 320,
    width: "100%",
  },
  sliderPanel: {
    padding: 16,
    backgroundColor: "#18212b",
  },
  sliderHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  sliderTitle: {
    color: "#f8fafc",
    fontSize: 16,
    fontWeight: "900",
  },
  sliderPercent: {
    color: "#7dd3fc",
    fontSize: 16,
    fontWeight: "900",
  },
  replayStats: {
    marginTop: 8,
    gap: 4,
  },
  replayText: {
    color: "#94a3b8",
    fontSize: 14,
    fontWeight: "700",
  },
  replayValue: {
    color: "#f8fafc",
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
  sectionTitle: {
    color: "#f8fafc",
    fontSize: 17,
    fontWeight: "900",
    marginBottom: 12,
  },
  infoText: {
    color: "#cbd5e1",
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 8,
  },
});