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
  buttonVariants,
  colors,
  radius,
  shadows,
  space,
  stateStyles,
} from "@skate-route-mapper/shared/design";
import {
  NESSO_GATE_A_BLE_DEVICE_NAME,
  type NessoFeatureFrame,
  type NessoImuPacket,
} from "@skate-route-mapper/shared/nessoBle";
import * as NessoBle from "../native/NessoBle";
import type { NessoBleConnection } from "../native/NessoBle";
import * as BackgroundRecorder from "../native/BackgroundRecorder";
import { ScreenHeader } from "../components/AppMenu";

type NessoStatus = "idle" | "scanning" | "connected" | "error" | "unsupported";

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
    description: `${NESSO_GATE_A_BLE_DEVICE_NAME} supplies compact surface-quality frames. GPS and camera stay on this phone.`,
  },
];

export default function HomeScreen() {
  const {
    vehicleType,
    sensorSource,
    status,
    setVehicleType,
    setSensorSource,
    setLatestExternalFeatureFrame,
    setLatestExternalImuSample,
    setExternalSensorConnected,
    startRecording,
  } = useMeasurementStore();

  const [nessoStatus, setNessoStatus] = useState<NessoStatus>(
    NessoBle.isNessoBleSupported() ? "idle" : "unsupported"
  );
  const [nessoMessage, setNessoMessage] = useState(
    NessoBle.isNessoBleSupported()
      ? "Ready to pair with the Nesso Gate A firmware."
      : "BLE sensor pairing requires a native mobile build."
  );
  const [latestNessoSample, setLatestNessoSample] =
    useState<NessoImuPacket | null>(null);
  const [latestNessoFeatureFrame, setLatestNessoFeatureFrame] =
    useState<NessoFeatureFrame | null>(null);
  const nessoConnection = useRef<NessoBleConnection | null>(null);

  const hasNessoConnection = nessoStatus === "connected";
  const canStart = sensorSource === "phone" || hasNessoConnection;
  const nessoSignalStrength =
    nessoStatus === "connected" ? 4 : nessoStatus === "scanning" ? 2 : 0;
  const nessoVisualLabel = getNessoVisualLabel(nessoStatus);
  const latestNessoMagnitude = latestNessoSample
    ? Math.sqrt(
        latestNessoSample.ax * latestNessoSample.ax +
          latestNessoSample.ay * latestNessoSample.ay +
          latestNessoSample.az * latestNessoSample.az
      )
    : null;
  const nessoQualityLabel = latestNessoFeatureFrame
    ? getRoughnessLabel(latestNessoFeatureFrame.roughnessLevel)
    : latestNessoMagnitude != null
    ? "Raw preview"
    : "-";

  const navigation = useNavigation<any>();

  useEffect(() => {
    return () => {
      nessoConnection.current?.disconnect();
      setLatestExternalImuSample(null);
      setLatestExternalFeatureFrame(null);
      setExternalSensorConnected(false);
    };
  }, [
    setExternalSensorConnected,
    setLatestExternalFeatureFrame,
    setLatestExternalImuSample,
  ]);

  const handleConnectNesso = async () => {
    if (nessoStatus === "connected") {
      await nessoConnection.current?.disconnect();
      nessoConnection.current = null;
      setLatestNessoSample(null);
      setLatestNessoFeatureFrame(null);
      setLatestExternalImuSample(null);
      setLatestExternalFeatureFrame(null);
      setExternalSensorConnected(false);
      setNessoStatus("idle");
      setNessoMessage("Ready to pair with the Nesso Gate A firmware.");
      setSensorSource("phone");
      return;
    }

    setNessoStatus("scanning");
    setNessoMessage(`Searching for ${NESSO_GATE_A_BLE_DEVICE_NAME}...`);

    try {
      const connection = await NessoBle.connectToNesso({
        onSample: (sample) => {
          setLatestNessoSample(sample);
          setLatestExternalImuSample(sample);
          setNessoMessage("Raw packet received; flash the Gate A firmware for quality frames.");
        },
        onFeatureFrame: (frame) => {
          setLatestNessoFeatureFrame(frame);
          setLatestExternalFeatureFrame(frame);
          setNessoMessage(
            `Feature frame #${frame.sequence}: ${frame.rawSampleCount} samples, ${Math.round(
              frame.confidence * 100
            )}% confidence.`
          );
        },
        onError: (message) => {
          setNessoMessage(`Nesso packet error: ${message}`);
        },
      });
      await connection.setSampleInterval(200); //5 hz

      nessoConnection.current = connection;
      setNessoStatus("connected");
      setExternalSensorConnected(true);
      setNessoMessage(`${connection.deviceName} connected. GPS remains on this phone.`);
      setSensorSource("external");
    } catch (error) {
      nessoConnection.current = null;
      setNessoStatus("error");
      setExternalSensorConnected(false);
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
      setNessoMessage(
        "Nesso N1 stays linked here for compact quality frames."
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
      <ScreenHeader
        title="Map a New Ride"
        subtitle="Set up your ride and begin measuring road vibration. No account required."
      />

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
            <View style={styles.bleHero}>
              <View style={styles.imuLogo}>
                <View
                  style={[
                    styles.imuLogoCore,
                    nessoStatus === "connected" && styles.imuLogoCoreConnected,
                    nessoStatus === "scanning" && styles.imuLogoCoreScanning,
                    nessoStatus === "error" && styles.imuLogoCoreError,
                  ]}
                >
                  <Text style={styles.imuLogoText}>N1</Text>
                </View>
                <View style={styles.imuDeck} />
                <View style={styles.imuWheelLeft} />
                <View style={styles.imuWheelRight} />
              </View>

              <View style={styles.bleCopy}>
                <View style={styles.bleTitleRow}>
                  <View>
                    <Text style={styles.sensorTitle}>Skate IMU</Text>
                    <Text style={styles.bleName}>Nesso Gate A feature module</Text>
                  </View>

                  <View style={[styles.statusPill, getNessoPillStyle(nessoStatus)]}>
                    <View style={[styles.statusDot, getNessoDotStyle(nessoStatus)]} />
                    <Text style={styles.statusPillText}>{nessoVisualLabel}</Text>
                  </View>
                </View>

                <Text style={styles.sensorDescription}>
                  Connect the Nesso N1 for compact surface-quality frames. Route GPS and camera stay on this phone.
                </Text>
                <Text style={styles.bleStatus}>{nessoMessage}</Text>
              </View>
            </View>

            <View style={styles.bleTelemetry}>
              <View style={styles.telemetryItem}>
                <Text style={styles.telemetryLabel}>Signal</Text>
                <SignalBars level={nessoSignalStrength} />
              </View>

              <View style={styles.telemetryItem}>
                <Text style={styles.telemetryLabel}>Quality</Text>
                <Text style={styles.telemetryValue}>
                  {nessoQualityLabel}
                </Text>
              </View>

              <View style={styles.telemetryItem}>
                <Text style={styles.telemetryLabel}>Window</Text>
                <Text style={styles.telemetryValue}>
                  {latestNessoFeatureFrame
                    ? `${latestNessoFeatureFrame.windowMs}ms`
                    : latestNessoMagnitude != null
                    ? `${latestNessoMagnitude.toFixed(2)}g`
                    : "-"}
                </Text>
              </View>
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

        <Text style={styles.statusText}>Status: {status}</Text>
      </View>
    </ScrollView>
  </SafeAreaView>
);
}

function SignalBars({ level }: { level: number }) {
  return (
    <View style={styles.signalBars}>
      {[1, 2, 3, 4].map((bar) => (
        <View
          key={bar}
          style={[
            styles.signalBar,
            getSignalBarStyle(bar),
            bar <= level && styles.signalBarActive,
          ]}
        />
      ))}
    </View>
  );
}

function getNessoVisualLabel(status: NessoStatus) {
  switch (status) {
    case "connected":
      return "Linked";
    case "scanning":
      return "Booting";
    case "error":
      return "Check";
    case "unsupported":
      return "Native only";
    default:
      return "Ready";
  }
}

function getNessoPillStyle(status: NessoStatus) {
  switch (status) {
    case "connected":
      return styles.statusPillConnected;
    case "scanning":
      return styles.statusPillScanning;
    case "error":
      return styles.statusPillError;
    default:
      return styles.statusPillIdle;
  }
}

function getNessoDotStyle(status: NessoStatus) {
  switch (status) {
    case "connected":
      return styles.statusDotConnected;
    case "scanning":
      return styles.statusDotScanning;
    case "error":
      return styles.statusDotError;
    default:
      return styles.statusDotIdle;
  }
}

function getSignalBarStyle(bar: number) {
  switch (bar) {
    case 1:
      return styles.signalBar1;
    case 2:
      return styles.signalBar2;
    case 3:
      return styles.signalBar3;
    default:
      return styles.signalBar4;
  }
}

function getRoughnessLabel(level: NessoFeatureFrame["roughnessLevel"]) {
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

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.page,
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
  bleHero: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  imuLogo: {
    width: 82,
    height: 72,
    alignItems: "center",
    justifyContent: "center",
  },
  imuLogoCore: {
    width: 48,
    height: 48,
    borderRadius: radius.lg,
    backgroundColor: colors.text,
    alignItems: "center",
    justifyContent: "center",
    transform: [{ rotate: "-8deg" }],
  },
  imuLogoCoreConnected: {
    backgroundColor: colors.success,
  },
  imuLogoCoreScanning: {
    backgroundColor: colors.accent,
  },
  imuLogoCoreError: {
    backgroundColor: colors.danger,
  },
  imuLogoText: {
    color: colors.textOnOrange,
    fontSize: 16,
    fontWeight: "900",
  },
  imuDeck: {
    position: "absolute",
    bottom: 10,
    width: 68,
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.text,
  },
  imuWheelLeft: {
    position: "absolute",
    bottom: 4,
    left: 19,
    width: 10,
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  imuWheelRight: {
    position: "absolute",
    bottom: 4,
    right: 19,
    width: 10,
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  bleCopy: {
    flex: 1,
    gap: 5,
  },
  bleTitleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },
  bleName: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
  },
  bleStatus: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  statusPillIdle: {
    backgroundColor: colors.surface,
  },
  statusPillConnected: {
    backgroundColor: colors.surfaceWarm,
  },
  statusPillScanning: {
    backgroundColor: colors.surfaceWarm,
  },
  statusPillError: {
    backgroundColor: colors.surfaceWarm,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
  },
  statusDotIdle: {
    backgroundColor: colors.textMuted,
  },
  statusDotConnected: {
    backgroundColor: colors.success,
  },
  statusDotScanning: {
    backgroundColor: colors.accent,
  },
  statusDotError: {
    backgroundColor: colors.danger,
  },
  statusPillText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: "900",
  },
  bleTelemetry: {
    flexDirection: "row",
    gap: 8,
  },
  telemetryItem: {
    flex: 1,
    minHeight: 54,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingVertical: 8,
    paddingHorizontal: 10,
    justifyContent: "space-between",
  },
  telemetryLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "800",
  },
  telemetryValue: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "900",
  },
  signalBars: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 3,
    height: 20,
  },
  signalBar: {
    width: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
  },
  signalBar1: {
    height: 6,
  },
  signalBar2: {
    height: 10,
  },
  signalBar3: {
    height: 14,
  },
  signalBar4: {
    height: 18,
  },
  signalBarActive: {
    backgroundColor: colors.success,
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
    ...stateStyles.disabled,
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
});
