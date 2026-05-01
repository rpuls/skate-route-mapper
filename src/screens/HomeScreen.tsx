import React from "react";
import {
  SafeAreaView,
  View,
  Text,
  Pressable,
  StyleSheet,
  StatusBar,
  ScrollView,
} from "react-native";
import { useMeasurementStore } from "../store/measurementStore";
import type { SensorSource, VehicleType } from "../types/measurement";
import { useNavigation } from "@react-navigation/native";

const vehicleOptions: { label: string; value: VehicleType }[] = [
  { label: "Inline skates", value: "skates" },
  { label: "Skateboard", value: "skateboard" },
  { label: "Longboard", value: "longboard" },
];

const sensorOptions: { label: string; value: SensorSource; description: string }[] = [
  {
    label: "Phone sensors",
    value: "phone",
    description: "Use accelerometer, gyroscope, GPS and camera from this phone.",
  },
  {
    label: "External sensor",
    value: "external",
    description: "Coming later: connect BLE sensors like ADXL355/Nesso.",
  },
];

export default function HomeScreen() {
  const {
    vehicleType,
    sensorSource,
    status,
    setVehicleType,
    setSensorSource,
    startRecording,
  } = useMeasurementStore();

  const canStart = sensorSource === "phone";

  const navigation = useNavigation<any>();

  return (
    <SafeAreaView style={styles.safeArea}>
    <StatusBar barStyle="light-content" />

    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <Text style={styles.appName}>skate-route-mapper</Text>
        <Text style={styles.title}>Map smooth skating routes</Text>
        <Text style={styles.subtitle}>
          Use your phone to measure vibration, GPS and road surface quality while skating.
        </Text>
      </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Ride type</Text>

          <View style={styles.optionGrid}>
            {vehicleOptions.map((option) => {
              const selected = option.value === vehicleType;

              return (
                <Pressable
                  key={option.value}
                  onPress={() => setVehicleType(option.value)}
                  style={[styles.optionButton, selected && styles.optionButtonSelected]}
                >
                  <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Sensor source</Text>

          {sensorOptions.map((option) => {
            const selected = option.value === sensorSource;
            const disabled = option.value === "external";

            return (
              <Pressable
                key={option.value}
                onPress={() => !disabled && setSensorSource(option.value)}
                style={[
                  styles.sensorCard,
                  selected && styles.sensorCardSelected,
                  disabled && styles.sensorCardDisabled,
                ]}
              >
                <View>
                  <Text style={[styles.sensorTitle, selected && styles.sensorTitleSelected]}>
                    {option.label}
                  </Text>
                  <Text style={styles.sensorDescription}>{option.description}</Text>
                </View>

                {selected && <Text style={styles.badge}>Selected</Text>}
                {disabled && <Text style={styles.badgeMuted}>Soon</Text>}
              </Pressable>
            );
          })}
        </View>

        <View style={styles.footer}>
        <Pressable
          disabled={!canStart}
          onPress={() => {
            startRecording();
            navigation.navigate("Recording");
          }}
          style={[styles.startButton, !canStart && styles.startButtonDisabled]}
        >
          <Text style={styles.startButtonText}>Start route scan</Text>
        </Pressable>

        <Text style={styles.statusText}>Status: {status}</Text>
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
  container: {
    flex: 1,
    padding: 20,
    gap: 18,
  },
  header: {
    marginTop: 16,
    marginBottom: 8,
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
    fontWeight: "700",
    marginBottom: 12,
  },
  optionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  optionButton: {
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: "#101820",
    borderWidth: 1,
    borderColor: "#334155",
  },
  optionButtonSelected: {
    backgroundColor: "#0ea5e9",
    borderColor: "#38bdf8",
  },
  optionText: {
    color: "#cbd5e1",
    fontSize: 14,
    fontWeight: "700",
  },
  optionTextSelected: {
    color: "#ffffff",
  },
  sensorCard: {
    padding: 14,
    borderRadius: 18,
    backgroundColor: "#101820",
    borderWidth: 1,
    borderColor: "#334155",
    marginBottom: 10,
    gap: 10,
  },
  sensorCardSelected: {
    borderColor: "#38bdf8",
  },
  sensorCardDisabled: {
    opacity: 0.55,
  },
  sensorTitle: {
    color: "#e2e8f0",
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 4,
  },
  sensorTitleSelected: {
    color: "#7dd3fc",
  },
  sensorDescription: {
    color: "#94a3b8",
    fontSize: 13,
    lineHeight: 18,
  },
  badge: {
    alignSelf: "flex-start",
    color: "#082f49",
    backgroundColor: "#7dd3fc",
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    fontSize: 12,
    fontWeight: "800",
  },
  badgeMuted: {
    alignSelf: "flex-start",
    color: "#cbd5e1",
    backgroundColor: "#334155",
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    fontSize: 12,
    fontWeight: "800",
  },
  footer: {
    gap: 12,
  },
  startButton: {
    backgroundColor: "#0ea5e9",
    paddingVertical: 17,
    borderRadius: 20,
    alignItems: "center",
  },
  startButtonDisabled: {
    backgroundColor: "#334155",
  },
  startButtonText: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "800",
  },
  statusText: {
    color: "#64748b",
    textAlign: "center",
    fontSize: 13,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 48,
    gap: 18,
  },
});
