import React, { useEffect, useRef, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  Pressable,
  StyleSheet,
  StatusBar,
  ScrollView,
  Platform,
} from "react-native";
import { useMeasurementStore } from "../store/measurementStore";
import type { SensorSource, VehicleType } from "../types/measurement";
import { useNavigation } from "@react-navigation/native";
import {
  NESSO_BLE_DEVICE_NAME,
  type NessoImuPacket,
  buttonVariants,
  colors,
  radius,
  shadows,
  space,
} from "@skate-route-mapper/shared";
import * as NessoBle from "../native/NessoBle";
import type { NessoBleConnection } from "../native/NessoBle";
import * as BackgroundRecorder from "../native/BackgroundRecorder";

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
    label: "Nesso N1 + phone GPS",
    value: "external",
    description: `${NESSO_BLE_DEVICE_NAME} supplies accelerometer and gyroscope. GPS and camera stay on this phone.`,
  },
];

export default function HomeScreen() {
  const {
    vehicleType,
    sensorSource,
    status,
    setVehicleType,
    setSensorSource,
    setLatestExternalImuSample,
    startRecording,
  } = useMeasurementStore();

  const [nessoStatus, setNessoStatus] = useState<
    "idle" | "scanning" | "connected" | "error" | "unsupported"
  >(NessoBle.isNessoBleSupported() ? "idle" : "unsupported");
  const [nessoMessage, setNessoMessage] = useState(
    NessoBle.isNessoBleSupported()
      ? "Ready to pair with the Nesso N1."
      : "BLE sensor pairing requires a native mobile build."
  );
  const [latestNessoSample, setLatestNessoSample] =
    useState<NessoImuPacket | null>(null);
  const nessoConnection = useRef<NessoBleConnection | null>(null);

  const hasNessoConnection = nessoStatus === "connected";
  const canStart = sensorSource === "phone" || hasNessoConnection;

  const navigation = useNavigation<any>();

  useEffect(() => {
    return () => {
      nessoConnection.current?.disconnect();
      setLatestExternalImuSample(null);
    };
  }, [setLatestExternalImuSample]);

  const handleConnectNesso = async () => {
    if (nessoStatus === "connected") {
      await nessoConnection.current?.disconnect();
      nessoConnection.current = null;
      setLatestNessoSample(null);
      setLatestExternalImuSample(null);
      setNessoStatus("idle");
      setNessoMessage("Ready to pair with the Nesso N1.");
      setSensorSource("phone");
      return;
    }

    setNessoStatus("scanning");
    setNessoMessage(`Searching for ${NESSO_BLE_DEVICE_NAME}...`);

    try {
      const connection = await NessoBle.connectToNesso({
        onSample: (sample) => {
          setLatestNessoSample(sample);
          setLatestExternalImuSample(sample);
        },
      });
      await connection.setSampleInterval(200); //5 hz

      nessoConnection.current = connection;
      setNessoStatus("connected");
      setNessoMessage(`${connection.deviceName} connected. GPS remains on this phone.`);
      setSensorSource("external");
    } catch (error) {
      nessoConnection.current = null;
      setNessoStatus("error");
      setNessoMessage(error instanceof Error ? error.message : "Unable to connect.");
      setSensorSource("phone");
    }
  };

  const handleStartRecording = async () => {
    if (
      sensorSource === "external" &&
      Platform.OS === "android" &&
      BackgroundRecorder.isAvailable()
    ) {
      await nessoConnection.current?.disconnect();
      nessoConnection.current = null;
      setNessoMessage(
        "Nesso N1 will reconnect through the Android recording service."
      );
    }

    startRecording();
    navigation.navigate("Recording");
  };

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

          <View style={styles.blePanel}>
            <View style={styles.bleCopy}>
              <Text style={styles.sensorTitle}>External IMU</Text>
              <Text style={styles.sensorDescription}>
                Connect the Nesso N1 for accelerometer and gyroscope data. Route GPS and camera stay on this phone.
              </Text>
              <Text style={styles.bleStatus}>{nessoMessage}</Text>
              {latestNessoSample && (
                <Text style={styles.bleMeta}>
                  Live sample #{latestNessoSample.sequence}: {latestNessoSample.ax.toFixed(3)}g
                </Text>
              )}
            </View>

            <Pressable
              disabled={nessoStatus === "unsupported" || nessoStatus === "scanning"}
              onPress={handleConnectNesso}
              style={[
                styles.bleButton,
                nessoStatus === "connected" && styles.bleButtonConnected,
                (nessoStatus === "unsupported" || nessoStatus === "scanning") &&
                  styles.bleButtonDisabled,
              ]}
            >
              <Text style={styles.bleButtonText}>
                {nessoStatus === "connected"
                  ? "Disconnect"
                  : nessoStatus === "scanning"
                  ? "Pairing..."
                  : "Connect Nesso N1"}
              </Text>
            </Pressable>
          </View>

          {sensorOptions.map((option) => {
            const selected = option.value === sensorSource;
            const disabled = option.value === "external" && !hasNessoConnection;

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
                {disabled && <Text style={styles.badgeMuted}>Pair first</Text>}
              </Pressable>
            );
          })}
        </View>

        <View style={styles.footer}>
        <Pressable
          disabled={!canStart}
          onPress={handleStartRecording}
          style={[styles.startButton, !canStart && styles.startButtonDisabled]}
        >
          <Text style={styles.startButtonText}>Start route scan</Text>
        </Pressable>

        <Pressable
          onPress={() => navigation.navigate("Rides")}
          style={styles.secondaryButton}
        >
          <Text style={styles.secondaryButtonText}>View saved rides</Text>
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
    backgroundColor: colors.page,
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
    color: colors.textOnOrange,
    fontSize: 15,
    fontWeight: "800",
    marginBottom: 12,
    opacity: 0.82,
  },
  title: {
    color: colors.textOnOrange,
    fontSize: 34,
    fontWeight: "900",
    lineHeight: 39,
    marginBottom: 10,
  },
  subtitle: {
    color: colors.textOnOrange,
    fontSize: 16,
    lineHeight: 23,
    opacity: 0.82,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: space.lg,
    ...shadows.tile,
  },
  sectionTitle: {
    color: colors.text,
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
    borderRadius: radius.pill,
    backgroundColor: "transparent",
    borderWidth: 2,
    borderColor: colors.accent,
  },
  optionButtonSelected: {
    backgroundColor: colors.accent,
  },
  optionText: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: "700",
  },
  optionTextSelected: {
    color: colors.textOnOrange,
  },
  sensorCard: {
    padding: 14,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 2,
    borderColor: "transparent",
    marginBottom: 10,
    gap: 10,
  },
  sensorCardSelected: {
    backgroundColor: colors.surfaceWarm,
    borderColor: colors.accent,
  },
  sensorCardDisabled: {
    opacity: 0.55,
  },
  sensorTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 4,
  },
  sensorTitleSelected: {
    color: colors.text,
  },
  sensorDescription: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  blePanel: {
    padding: 14,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceMuted,
    marginBottom: 12,
    gap: 12,
  },
  bleCopy: {
    gap: 4,
  },
  bleStatus: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
  },
  bleMeta: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  bleButton: {
    alignSelf: "flex-start",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: buttonVariants.primary.filled.backgroundColor,
  },
  bleButtonConnected: {
    backgroundColor: colors.text,
  },
  bleButtonDisabled: {
    backgroundColor: colors.textMuted,
  },
  bleButtonText: {
    color: buttonVariants.primary.filled.color,
    fontSize: 13,
    fontWeight: "800",
  },
  badge: {
    alignSelf: "flex-start",
    color: colors.text,
    backgroundColor: colors.surface,
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    fontSize: 12,
    fontWeight: "800",
  },
  badgeMuted: {
    alignSelf: "flex-start",
    color: colors.textMuted,
    backgroundColor: colors.surface,
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    fontSize: 12,
    fontWeight: "800",
  },
  footer: {
    gap: 12,
  },
  startButton: {
    backgroundColor: buttonVariants.primary.filled.backgroundColor,
    paddingVertical: 17,
    borderRadius: radius.lg,
    alignItems: "center",
    borderWidth: 2,
    borderColor: buttonVariants.primary.filled.borderColor,
  },
  startButtonDisabled: {
    backgroundColor: colors.textMuted,
  },
  startButtonText: {
    color: buttonVariants.primary.filled.color,
    fontSize: 17,
    fontWeight: "800",
  },
  statusText: {
    color: colors.textOnOrange,
    textAlign: "center",
    fontSize: 13,
    opacity: 0.8,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 48,
    gap: 18,
  },
  secondaryButton: {
    backgroundColor: buttonVariants.secondary.contained.backgroundColor,
    paddingVertical: 15,
    borderRadius: radius.lg,
    alignItems: "center",
    borderWidth: 2,
    borderColor: buttonVariants.secondary.contained.borderColor,
  },
  secondaryButtonText: {
    color: buttonVariants.secondary.contained.color,
    fontSize: 16,
    fontWeight: "800",
  },
});
