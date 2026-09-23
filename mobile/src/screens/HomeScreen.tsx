import React, { useEffect, useRef, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { colors, radius, shadows, space } from "@skate-route-mapper/shared/design";
import { XIAO_BLE_DEVICE_NAME, type XiaoImuPacket } from "@skate-route-mapper/shared/xiaoBle";
import { ScreenHeader } from "../components/AppMenu";
import * as XiaoBle from "../native/XiaoBle";
import type { XiaoBleConnection } from "../native/XiaoBle";
import { useMeasurementStore } from "../store/measurementStore";
import type { SensorSource, VehicleType } from "../types/measurement";

type XiaoStatus = "idle" | "scanning" | "connected" | "error" | "unsupported";

const vehicleOptions: { label: string; value: VehicleType }[] = [
  { label: "Inline skates", value: "skates" },
  { label: "Skateboard", value: "skateboard" },
  { label: "Longboard", value: "longboard" },
];

const sensorOptions: { label: string; value: SensorSource; description: string }[] = [
  { label: "Phone sensors", value: "phone", description: "Use this phone for motion and GPS." },
  { label: "XIAO + phone GPS", value: "external", description: "Use the XIAO live BLE preview with GPS from this phone." },
];

export default function HomeScreen() {
  const navigation = useNavigation<any>();
  const {
    vehicleType, sensorSource, status, setVehicleType, setSensorSource,
    setExternalImuDevice, setLatestExternalImuSample, startRecording,
  } = useMeasurementStore();
  const [xiaoStatus, setXiaoStatus] = useState<XiaoStatus>(XiaoBle.isXiaoBleSupported() ? "idle" : "unsupported");
  const [message, setMessage] = useState(XiaoBle.isXiaoBleSupported() ? "Ready to connect." : "BLE needs the native iPhone development build.");
  const [latest, setLatest] = useState<XiaoImuPacket | null>(null);
  const connection = useRef<XiaoBleConnection | null>(null);

  useEffect(() => () => {
    connection.current?.disconnect().catch(() => undefined);
    setExternalImuDevice(null);
    setLatestExternalImuSample(null);
  }, [setExternalImuDevice, setLatestExternalImuSample]);

  useEffect(() => navigation.addListener("blur", () => {
    const state = navigation.getState();
    const activeRoute = state.routes[state.index]?.name;
    if (activeRoute !== "Recording") {
      connection.current?.disconnect().catch(() => undefined);
      connection.current = null;
      setLatestExternalImuSample(null);
      setExternalImuDevice(null);
      setSensorSource("phone");
      setXiaoStatus(XiaoBle.isXiaoBleSupported() ? "idle" : "unsupported");
    }
  }), [navigation, setExternalImuDevice, setLatestExternalImuSample, setSensorSource]);

  const connect = async () => {
    if (xiaoStatus === "connected") {
      await connection.current?.disconnect().catch(() => undefined);
      connection.current = null;
      setLatest(null);
      setLatestExternalImuSample(null);
      setExternalImuDevice(null);
      setSensorSource("phone");
      setXiaoStatus("idle");
      setMessage("Ready to connect.");
      return;
    }
    setXiaoStatus("scanning");
    setMessage(`Searching for ${XIAO_BLE_DEVICE_NAME}...`);
    try {
      const next = await XiaoBle.connectToXiao({ onSample: (sample) => {
        setLatest(sample);
        setLatestExternalImuSample(sample);
      }});
      await next.setSampleInterval(50);
      connection.current = next;
      setExternalImuDevice("xiao");
      setSensorSource("external");
      setXiaoStatus("connected");
      setMessage(`${next.deviceName} connected.`);
    } catch (error) {
      setXiaoStatus("error");
      setMessage(error instanceof Error ? error.message : "Unable to connect.");
    }
  };

  const openResearch = async () => {
    await connection.current?.disconnect().catch(() => undefined);
    connection.current = null;
    setLatestExternalImuSample(null);
    setExternalImuDevice(null);
    setSensorSource("phone");
    setXiaoStatus(XiaoBle.isXiaoBleSupported() ? "idle" : "unsupported");
    navigation.navigate("Research");
  };

  const canStart = sensorSource === "phone" || xiaoStatus === "connected";
  const magnitude = latest ? Math.hypot(latest.ax, latest.ay, latest.az) : null;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenHeader title="Map a New Ride" subtitle="Record a route, or collect labelled high-rate sensor data for algorithm research." />

        <Pressable onPress={openResearch} style={styles.researchCard}>
          <Text style={styles.eyebrow}>XIAO FIELD RESEARCH</Text>
          <Text style={styles.researchTitle}>Collect high-rate training data</Text>
          <Text style={styles.researchBody}>Start a 10–60 second board capture, attach a surface photo, GPS location and notes, then retrieve the verified file.</Text>
          <Text style={styles.researchLink}>Open research collections →</Text>
        </Pressable>

        <View style={styles.card}>
          <Text style={styles.title}>Ride type</Text>
          <View style={styles.chips}>{vehicleOptions.map((option) => (
            <Pressable key={option.value} onPress={() => setVehicleType(option.value)} style={[styles.chip, vehicleType === option.value && styles.chipSelected]}>
              <Text style={[styles.chipText, vehicleType === option.value && styles.chipTextSelected]}>{option.label}</Text>
            </Pressable>
          ))}</View>
        </View>

        <View style={styles.card}>
          <Text style={styles.title}>Normal ride sensor</Text>
          <View style={styles.devicePanel}>
            <Text style={styles.deviceName}>XIAO ESP32S3 + LSM6DSOX</Text>
            <Text style={styles.body}>{message}</Text>
            {latest && <Text style={styles.metric}>Sample #{latest.sequence} · {magnitude?.toFixed(2)} g</Text>}
            <Pressable disabled={xiaoStatus === "scanning" || xiaoStatus === "unsupported"} onPress={connect} style={styles.primaryButton}>
              <Text style={styles.primaryText}>{xiaoStatus === "connected" ? "Disconnect XIAO" : xiaoStatus === "scanning" ? "Connecting..." : "Connect XIAO"}</Text>
            </Pressable>
          </View>
          {sensorOptions.map((option) => {
            const disabled = option.value === "external" && xiaoStatus !== "connected";
            const selected = option.value === sensorSource;
            return <Pressable key={option.value} disabled={disabled} onPress={() => setSensorSource(option.value)} style={[styles.sensorOption, selected && styles.sensorSelected, disabled && styles.disabled]}>
              <Text style={styles.sensorTitle}>{option.label}</Text><Text style={styles.body}>{option.description}</Text>
            </Pressable>;
          })}
        </View>

        <Pressable disabled={!canStart} onPress={() => { startRecording(); navigation.navigate("Recording"); }} style={[styles.startButton, !canStart && styles.disabled]}>
          <Text style={styles.startText}>Start route scan</Text>
        </Pressable>
        <Text style={styles.status}>Status: {status}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.page },
  content: { padding: space.lg, paddingBottom: 60, gap: space.lg },
  card: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: space.lg, gap: space.md, ...shadows.tile },
  researchCard: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: space.xl, gap: space.sm, ...shadows.tile },
  eyebrow: { color: colors.accent, fontSize: 12, fontWeight: "900", letterSpacing: 1.2 },
  researchTitle: { color: colors.text, fontSize: 25, fontWeight: "900", lineHeight: 30 },
  researchBody: { color: colors.textMuted, fontSize: 15, lineHeight: 22 },
  researchLink: { color: colors.link, fontSize: 15, fontWeight: "900", marginTop: space.sm },
  title: { color: colors.text, fontSize: 21, fontWeight: "900" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: { backgroundColor: colors.surfaceMuted, borderColor: colors.surfaceMuted, borderRadius: radius.pill, borderWidth: 2, paddingHorizontal: 14, paddingVertical: 10 },
  chipSelected: { backgroundColor: colors.surfaceWarm, borderColor: colors.accent },
  chipText: { color: colors.text, fontSize: 14, fontWeight: "800" },
  chipTextSelected: { color: colors.accentStrong },
  devicePanel: { backgroundColor: colors.surfaceMuted, borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  deviceName: { color: colors.text, fontSize: 17, fontWeight: "900" },
  body: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  metric: { color: colors.text, fontSize: 14, fontWeight: "800" },
  primaryButton: { alignItems: "center", backgroundColor: colors.accent, borderRadius: radius.lg, justifyContent: "center", minHeight: 50, marginTop: space.sm },
  primaryText: { color: colors.textOnOrange, fontSize: 15, fontWeight: "900" },
  sensorOption: { backgroundColor: colors.surfaceMuted, borderColor: colors.surfaceMuted, borderRadius: radius.lg, borderWidth: 2, padding: space.lg, gap: space.xs },
  sensorSelected: { backgroundColor: colors.surfaceWarm, borderColor: colors.accent },
  sensorTitle: { color: colors.text, fontSize: 16, fontWeight: "900" },
  startButton: { alignItems: "center", backgroundColor: colors.text, borderRadius: radius.lg, justifyContent: "center", minHeight: 60, ...shadows.tile },
  startText: { color: colors.surface, fontSize: 18, fontWeight: "900" },
  disabled: { opacity: 0.45 },
  status: { color: colors.textOnOrange, fontSize: 13, textAlign: "center", fontWeight: "800" },
});
