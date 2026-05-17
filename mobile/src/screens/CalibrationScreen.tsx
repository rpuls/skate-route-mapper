import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  Pressable,
  Switch,
  View,
} from "react-native";
import { colors, radius, shadows, space, stateStyles } from "@skate-route-mapper/shared/design";
import type { ExperimentalCapturePayload } from "@skate-route-mapper/shared/mobileContracts";
import { useMobileAuth } from "../auth/MobileAuthContext";
import { uploadExperimentalCapture } from "../api/experimentalCaptures";
import { ScreenHeader } from "../components/AppMenu";
import { useMeasurementStore } from "../store/measurementStore";
import type { NessoFeatureFrame } from "../types/measurement";

const CAPTURE_DURATION_MS = 10000;
const roughnessLevels = [1, 2, 3, 4, 5, 6] as const;

type CaptureFrame = NessoFeatureFrame & {
  capturedAt: number;
};

export default function CalibrationScreen() {
  const { token } = useMobileAuth();
  const latestFrame = useMeasurementStore((state) => state.latestExternalFeatureFrame);
  const externalSensorConnected = useMeasurementStore(
    (state) => state.externalSensorConnected
  );
  const externalFeatureFrameCount = useMeasurementStore(
    (state) => state.externalFeatureFrameCount
  );
  const externalSensorConnection = useMeasurementStore(
    (state) => state.externalSensorConnection
  );
  const latestRawBurstStatus = useMeasurementStore(
    (state) => state.latestRawBurstStatus
  );
  const rawBurstSamples = useMeasurementStore((state) => state.rawBurstSamples);
  const clearRawBurstCapture = useMeasurementStore(
    (state) => state.clearRawBurstCapture
  );

  const [notes, setNotes] = useState("");
  const [subjectiveRoughnessLevel, setSubjectiveRoughnessLevel] =
    useState<number | null>(null);
  const [highDataRate, setHighDataRate] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [captureStartedAt, setCaptureStartedAt] = useState<number | null>(null);
  const [captureEndedAt, setCaptureEndedAt] = useState<number | null>(null);
  const [frames, setFrames] = useState<CaptureFrame[]>([]);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const lastSequenceRef = useRef<number | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canCapture =
    externalSensorConnected &&
    !capturing &&
    (highDataRate ? externalSensorConnection != null : latestFrame != null);
  const capturedSampleCount = highDataRate ? rawBurstSamples.length : frames.length;
  const canUpload =
    Boolean(token) && capturedSampleCount > 0 && !capturing && !uploading;
  const progress = useMemo(() => {
    if (!capturing || captureStartedAt == null) {
      return capturedSampleCount > 0 ? 1 : 0;
    }

    return Math.min(1, (Date.now() - captureStartedAt) / CAPTURE_DURATION_MS);
  }, [capturedSampleCount, captureStartedAt, capturing]);

  useEffect(() => {
    if (!capturing || highDataRate || !latestFrame) {
      return;
    }

    if (lastSequenceRef.current === latestFrame.sequence) {
      return;
    }

    lastSequenceRef.current = latestFrame.sequence;
    setFrames((currentFrames) => [
      ...currentFrames,
      {
        ...latestFrame,
        capturedAt: Date.now(),
      },
    ]);
  }, [capturing, highDataRate, latestFrame]);

  useEffect(() => {
    if (!capturing || !highDataRate || !latestRawBurstStatus) {
      return;
    }

    if (latestRawBurstStatus.status === "transferComplete") {
      setCapturing(false);
      setCaptureEndedAt(Date.now());
      setMessage(`Hi-fi capture received: ${rawBurstSamples.length} raw samples.`);
    }

    if (
      latestRawBurstStatus.status === "overflow" ||
      latestRawBurstStatus.status === "error"
    ) {
      setCapturing(false);
      setCaptureEndedAt(Date.now());
      setMessage(
        `Hi-fi capture ${latestRawBurstStatus.status}: ${latestRawBurstStatus.sampleCount} samples.`
      );
    }
  }, [capturing, highDataRate, latestRawBurstStatus, rawBurstSamples.length]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const startCapture = async () => {
    if (!canCapture) {
      return;
    }

    const now = Date.now();
    lastSequenceRef.current = null;
    setFrames([]);
    clearRawBurstCapture();
    setCaptureStartedAt(now);
    setCaptureEndedAt(null);
    setCapturing(true);
    setMessage(
      highDataRate
        ? "Capturing hi-fi data on Nesso, then transferring..."
        : "Capturing 10 seconds..."
    );

    if (highDataRate) {
      try {
        await externalSensorConnection?.startRawBurstCapture(CAPTURE_DURATION_MS);
      } catch (error) {
        setCapturing(false);
        setMessage(
          error instanceof Error ? error.message : "Unable to start hi-fi capture."
        );
      }
      return;
    }

    timeoutRef.current = setTimeout(() => {
      setCapturing(false);
      setCaptureEndedAt(Date.now());
      setMessage("Received. Add a note, then upload.");
    }, CAPTURE_DURATION_MS);
  };

  const uploadCapture = async () => {
    if (!token || capturedSampleCount === 0) {
      setMessage(token ? "Capture data first." : "Sign in before uploading captures.");
      return;
    }

    const startedAt =
      captureStartedAt ?? frames[0]?.capturedAt ?? rawBurstSamples[0]?.offsetUs ?? Date.now();
    const endedAt = captureEndedAt ?? frames[frames.length - 1]?.capturedAt ?? Date.now();
    const capture: ExperimentalCapturePayload = {
      payload: {
        label:
          subjectiveRoughnessLevel == null
            ? highDataRate
              ? "Hi-fi calibration capture"
              : "Calibration capture"
            : highDataRate
            ? `Hi-fi calibration capture level ${subjectiveRoughnessLevel}`
            : `Calibration capture level ${subjectiveRoughnessLevel}`,
        notes: notes.trim() || null,
        source: "nesso-gate-a",
        captureType: highDataRate ? "raw_burst_ble_packets" : "feature_frames_5hz",
        durationMs: Math.max(0, endedAt - startedAt),
        sampleCount: capturedSampleCount,
        firmwareLabel: "calibration v3",
        requestedDurationMs: CAPTURE_DURATION_MS,
        appCaptureVersion: highDataRate ? 2 : 1,
        externalFeatureFrameCount,
        subjectiveRoughnessLevel,
        ...(highDataRate
          ? {
              rawBurst: {
                status: latestRawBurstStatus,
                encoding: "decoded-json-with-original-ble-packet-base64",
                packetSizeBytes: 20,
                samples: rawBurstSamples,
              },
            }
          : {
              frames,
            }),
      },
    };

    setUploading(true);
    setMessage("Uploading...");

    try {
      const response = await uploadExperimentalCapture({
        token,
        capture,
      });
      setMessage(`Uploaded capture ${response.captureId}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to upload capture.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader
          title="Calibration"
          subtitle="Collect short Nesso captures for signal experiments."
        />

        <View style={[styles.statusCard, !externalSensorConnected && styles.ghosted]}>
          <Text style={styles.statusLabel}>Nesso Gate A</Text>
          <Text style={styles.statusValue}>
            {externalSensorConnected ? "Connected" : "Connect Nesso first"}
          </Text>
          <Text style={styles.statusMeta}>
            {highDataRate && latestRawBurstStatus
              ? `Hi-fi ${latestRawBurstStatus.status}, ${rawBurstSamples.length} samples`
              : latestFrame
              ? `Latest frame #${latestFrame.sequence}, level ${latestFrame.roughnessLevel}`
              : "Waiting for feature frames"}
          </Text>
        </View>

        <View style={styles.card}>
          <View style={styles.toggleRow}>
            <View style={styles.toggleCopy}>
              <Text style={styles.sectionTitle}>High data rate</Text>
              <Text style={styles.detailText}>
                Capture raw IMU on Nesso first, then transfer it after the
                window.
              </Text>
            </View>
            <Switch
              disabled={capturing}
              onValueChange={setHighDataRate}
              thumbColor={highDataRate ? colors.accent : colors.surface}
              trackColor={{ false: colors.surfaceMuted, true: colors.surfaceWarm }}
              value={highDataRate}
            />
          </View>

          <View style={styles.captureHeader}>
            <View>
              <Text style={styles.sectionTitle}>10 second capture</Text>
              <Text style={styles.detailText}>
                {highDataRate
                  ? "Hi-fi mode stores decoded raw BLE packets in the same experimental upload lane."
                  : "Current mode stores received Gate A feature frames."}
              </Text>
            </View>
            <Text style={styles.frameCount}>{capturedSampleCount}</Text>
          </View>

          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
          </View>

          <View style={styles.buttonRow}>
            <Pressable
              disabled={!canCapture}
              onPress={startCapture}
              style={[styles.primaryButton, !canCapture && styles.buttonDisabled]}
            >
              <Text style={styles.primaryButtonText}>
                {capturing ? "Capturing" : "Start"}
              </Text>
            </Pressable>

            <Pressable
              disabled={!canUpload}
              onPress={uploadCapture}
              style={[styles.secondaryButton, !canUpload && styles.buttonDisabled]}
            >
              <Text style={styles.secondaryButtonText}>
                {uploading ? "Uploading" : "Upload"}
              </Text>
            </Pressable>
          </View>

          {message ? <Text style={styles.message}>{message}</Text> : null}
        </View>

        <View style={[styles.card, capturedSampleCount === 0 && styles.ghosted]}>
          <Text style={styles.sectionTitle}>After capture</Text>
          <Text style={styles.detailText}>
            Add notes and an optional subjective rating once the capture is
            received.
          </Text>

          <TextInput
            multiline
            editable={capturedSampleCount > 0}
            onChangeText={setNotes}
            placeholder="Notes, e.g. skate on smooth road"
            placeholderTextColor={colors.textMuted}
            style={[styles.input, styles.notesInput]}
            value={notes}
          />

          <Text style={styles.fieldLabel}>Roughness feeling</Text>
          <View style={styles.levelGrid}>
            {roughnessLevels.map((level) => {
              const selected = subjectiveRoughnessLevel === level;

              return (
                <Pressable
                  disabled={capturedSampleCount === 0}
                  key={level}
                  onPress={() =>
                    setSubjectiveRoughnessLevel((currentLevel) =>
                      currentLevel === level ? null : level
                    )
                  }
                  style={[styles.levelButton, selected && styles.levelButtonSelected]}
                >
                  <Text
                    style={[
                      styles.levelButtonText,
                      selected && styles.levelButtonTextSelected,
                    ]}
                  >
                    {level}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.detailText}>
            Optional subjective rating: 1 is excellent, 6 is unskatable.
          </Text>
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
  scroll: {
    flex: 1,
  },
  content: {
    gap: 18,
    padding: 20,
    paddingBottom: 48,
  },
  statusCard: {
    backgroundColor: colors.surfaceWarm,
    borderRadius: radius.xl,
    padding: space.lg,
    ...shadows.tile,
  },
  ghosted: {
    opacity: 0.55,
  },
  statusLabel: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "800",
    marginBottom: 6,
  },
  statusValue: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "900",
  },
  statusMeta: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "700",
    marginTop: 6,
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
    fontWeight: "900",
    marginBottom: 12,
  },
  levelGrid: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
    marginBottom: 12,
  },
  fieldLabel: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "900",
    marginTop: 16,
  },
  levelButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceMuted,
    borderColor: "transparent",
    borderRadius: radius.pill,
    borderWidth: 2,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  levelButtonSelected: {
    backgroundColor: colors.surfaceWarm,
    borderColor: colors.accent,
  },
  levelButtonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "900",
  },
  levelButtonTextSelected: {
    color: colors.accent,
  },
  input: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.accent,
    borderRadius: radius.lg,
    borderWidth: 2,
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  notesInput: {
    minHeight: 96,
    textAlignVertical: "top",
  },
  captureHeader: {
    flexDirection: "row",
    gap: 16,
    justifyContent: "space-between",
  },
  toggleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 16,
    justifyContent: "space-between",
    marginBottom: 18,
  },
  toggleCopy: {
    flex: 1,
  },
  detailText: {
    color: colors.textMuted,
    flexShrink: 1,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 19,
  },
  frameCount: {
    color: colors.accent,
    fontSize: 28,
    fontWeight: "900",
  },
  progressTrack: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.pill,
    height: 14,
    marginTop: 16,
    overflow: "hidden",
  },
  progressFill: {
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    height: "100%",
  },
  buttonRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 16,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: radius.lg,
    flex: 1,
    minHeight: 50,
    justifyContent: "center",
  },
  primaryButtonText: {
    color: colors.textOnOrange,
    fontSize: 16,
    fontWeight: "900",
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceWarm,
    borderColor: colors.accent,
    borderRadius: radius.lg,
    borderWidth: 2,
    flex: 1,
    minHeight: 50,
    justifyContent: "center",
  },
  secondaryButtonText: {
    color: colors.accent,
    fontSize: 16,
    fontWeight: "900",
  },
  buttonDisabled: {
    ...stateStyles.disabled,
  },
  message: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 19,
    marginTop: 12,
  },
});
