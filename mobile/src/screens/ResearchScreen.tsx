import React, { useEffect, useRef, useState } from "react";
import {
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Crypto from "expo-crypto";
import * as Location from "expo-location";
import * as Sharing from "expo-sharing";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { analyzeCapture, encodeRecording, type ResearchStatus } from "@skate-route-mapper/shared/xiaoResearch";
import { colors, radius, shadows, space } from "@skate-route-mapper/shared/design";
import { ScreenHeader } from "../components/AppMenu";
import { useMobileAuth } from "../auth/MobileAuthContext";
import { uploadResearchCapture } from "../api/researchCaptures";
import { getResearchCollections, saveResearchCollection } from "../database/db";
import * as XiaoBle from "../native/XiaoBle";
import type { ResearchTransfer, XiaoBleConnection } from "../native/XiaoBle";
import { saveResearchFiles } from "../research/researchFiles";
import {
  researchCategories,
  type ResearchCategory,
  type ResearchCollection,
  type ResearchLocation,
} from "../types/research";

type Phase = "disconnected" | "connecting" | "ready" | "recording" | "complete" | "transferring" | "saved" | "error";

export default function ResearchScreen() {
  const navigation = useNavigation<any>();
  const { token, user } = useMobileAuth();
  const connection = useRef<XiaoBleConnection | null>(null);
  const transfer = useRef<ResearchTransfer | null>(null);
  const camera = useRef<CameraView | null>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [phase, setPhase] = useState<Phase>(XiaoBle.isXiaoBleSupported() ? "disconnected" : "error");
  const [message, setMessage] = useState(
    XiaoBle.isXiaoBleSupported()
      ? "Connect the XIAO, describe the experiment, then start the board capture."
      : "Research capture requires the iPhone development build; it is unavailable in Expo Go and web."
  );
  const [category, setCategory] = useState<ResearchCategory>("airborne-contact");
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const [durationSeconds, setDurationSeconds] = useState<10 | 30 | 60>(30);
  const [rateHz, setRateHz] = useState<833 | 1666>(1666);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [boardStatus, setBoardStatus] = useState<ResearchStatus | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [startLocation, setStartLocation] = useState<ResearchLocation | null>(null);
  const [progress, setProgress] = useState(0);
  const [collections, setCollections] = useState<ResearchCollection[]>([]);
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  const refreshCollections = React.useCallback(() => setCollections(getResearchCollections()), []);
  useFocusEffect(React.useCallback(() => {
    refreshCollections();
    return () => {
      connection.current?.disconnect().catch(() => undefined);
      connection.current = null;
    };
  }, [refreshCollections]));

  useEffect(() => {
    if (phase !== "recording") return;
    let checking = false;
    const timer = setInterval(async () => {
      if (checking || !connection.current) return;
      checking = true;
      try {
        const status = await connection.current.getResearchStatus();
        setBoardStatus(status);
        if (status.state === 2) {
          setPhase("complete");
          setMessage(`${status.count.toLocaleString()} samples are safe on the board. Retrieve them now.`);
        } else if (status.state === 3) {
          setPhase("complete");
          setMessage(`The board reported capture error ${status.error}. Its partial data can still be retrieved for diagnosis.`);
        }
      } catch {
        setMessage("BLE dropped. The board keeps recording. Reconnect after the capture duration, then retrieve it.");
      } finally {
        checking = false;
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [phase]);

  const connect = async () => {
    setPhase("connecting");
    setMessage("Looking for Skate XIAO IMU...");
    try {
      await connection.current?.disconnect().catch(() => undefined);
      const next = await XiaoBle.connectToXiao();
      connection.current = next;
      const status = await next.getResearchStatus();
      setBoardStatus(status);
      if (status.state === 2 || status.state === 3) {
        setPhase("complete");
        setMessage(`Found retained capture ${status.captureId} with ${status.count.toLocaleString()} samples${status.state === 3 ? ` and error ${status.error}` : ""}.`);
      } else if (status.state === 1) {
        setPhase("recording");
        setMessage("The XIAO is recording on board.");
      } else {
        setPhase("ready");
        setMessage(`${next.deviceName} connected and ready.`);
      }
    } catch (error) {
      connection.current = null;
      setPhase("error");
      setMessage(error instanceof Error ? error.message : "Unable to connect to the XIAO.");
    }
  };

  const takePhoto = async () => {
    if (!cameraPermission?.granted) {
      const result = await requestCameraPermission();
      if (!result.granted) { setMessage("Camera permission is needed for a surface photo."); return; }
    }
    setCameraOpen(true);
  };

  const capturePhoto = async () => {
    const photo = await camera.current?.takePictureAsync({ quality: 0.65 });
    if (photo?.uri) { setPhotoUri(photo.uri); setCameraOpen(false); }
  };

  const readLocation = async (): Promise<ResearchLocation> => {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) throw new Error("Location permission is required for a research collection.");
    const point = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.BestForNavigation });
    return {
      latitude: point.coords.latitude,
      longitude: point.coords.longitude,
      accuracy: point.coords.accuracy,
      altitude: point.coords.altitude,
      speed: point.coords.speed,
      timestamp: point.timestamp,
    };
  };

  const startCapture = async () => {
    if (!connection.current) { await connect(); return; }
    if (!label.trim()) { setMessage("Give this experiment a short label before starting."); return; }
    setMessage("Getting a fresh GPS position...");
    try {
      const location = await readLocation();
      setStartLocation(location);
      transfer.current = null;
      const status = await connection.current.startResearchCapture(durationSeconds, rateHz);
      setBoardStatus(status);
      setStartedAt(Date.now());
      setPhase("recording");
      setMessage(`Recording ${durationSeconds} seconds at ${rateHz} Hz on the XIAO. You may ride now.`);
    } catch (error) {
      setPhase("error");
      setMessage(error instanceof Error ? error.message : "Could not start the capture.");
    }
  };

  const retrieve = async () => {
    if (!connection.current || !boardStatus || ![2, 3].includes(boardStatus.state)) {
      setMessage("Reconnect and confirm the completed capture before retrieving it.");
      return;
    }
    if (!label.trim()) {
      setMessage("Give this experiment a short label before saving the recovered capture.");
      return;
    }
    setPhase("transferring");
    setMessage("Copying the verified high-rate recording from the XIAO. Keep the app open and nearby.");
    try {
      const currentTransfer = transfer.current?.captureId === boardStatus.captureId
        ? transfer.current
        : XiaoBle.createResearchTransfer(boardStatus);
      transfer.current = currentTransfer;
      const completed = await connection.current.retrieveResearchCapture(
        boardStatus,
        currentTransfer,
        (received, total) => setProgress(total ? received / total : 0)
      );
      const recoveredStartLocation = startLocation ?? await readLocation();
      const endLocation = await readLocation().catch(() => null);
      const report = analyzeCapture(boardStatus, completed.raw, completed.summaries);
      const actualDuration = Math.round(boardStatus.target / boardStatus.rateHz) as 10 | 30 | 60;
      const createdAt = Date.now();
      const id = Crypto.randomUUID();
      const fieldMetadata = {
        collectionId: id,
        category,
        label: label.trim(),
        note: note.trim(),
        phoneCaptureRequestedAt: startedAt,
        transferMs: completed.transferMs,
        startLocation: recoveredStartLocation,
        endLocation,
        photoFilename: photoUri ? "surface.jpg" : null,
      };
      const recording = encodeRecording({ ...boardStatus, field: fieldMetadata }, completed.raw, completed.summaries);
      const files = saveResearchFiles({
        id,
        captureId: boardStatus.captureId,
        recording,
        photoUri,
        metadata: { ...fieldMetadata, board: boardStatus, report },
      });
      const collection: ResearchCollection = {
        id,
        captureId: boardStatus.captureId,
        createdAt,
        category,
        label: label.trim(),
        note: note.trim(),
        durationSeconds: actualDuration,
        rateHz: boardStatus.rateHz,
        sampleCount: boardStatus.count,
        recordingUri: files.recordingUri,
        photoUri: files.photoUri,
        startLocation: recoveredStartLocation,
        endLocation,
        transferMs: completed.transferMs,
        report,
        uploadedAt: null,
        serverCaptureId: null,
        uploadError: null,
      };
      saveResearchCollection(collection);
      refreshCollections();
      setPhase("saved");
      setProgress(1);
      setMessage("Capture verified and saved on this iPhone. The original high-rate data is ready to share for analysis.");
    } catch (error) {
      setPhase("complete");
      setMessage(`${error instanceof Error ? error.message : "Transfer failed."} Reconnect and retry; received pages are kept while this screen remains open.`);
    }
  };

  const upload = async (collection: ResearchCollection) => {
    if (!token) {
      setMessage("Sign in before uploading research data to the production server.");
      navigation.navigate("Auth");
      return;
    }
    setUploadingId(collection.id);
    setMessage(`Uploading ${collection.label} and its context photo...`);
    try {
      const response = await uploadResearchCapture(collection, token);
      saveResearchCollection({
        ...collection,
        uploadedAt: Date.now(),
        serverCaptureId: response.researchCaptureId,
        uploadError: null,
      });
      setMessage(`Uploaded ${response.recordingBytes.toLocaleString()} recording bytes${response.photoBytes ? ` and ${response.photoBytes.toLocaleString()} photo bytes` : ""}.`);
    } catch (error) {
      const uploadError = error instanceof Error ? error.message : "Upload failed.";
      saveResearchCollection({ ...collection, uploadError });
      setMessage(`${uploadError} The local files are unchanged; retry when connected.`);
    } finally {
      setUploadingId(null);
      refreshCollections();
    }
  };

  const elapsed = startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : 0;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ScreenHeader title="Research Collections" subtitle="Collect labelled high-rate XIAO data for road-contact and surface experiments." />

        <View style={styles.card}>
          <Text style={styles.title}>XIAO connection</Text>
          <Text style={styles.body}>{message}</Text>
          {boardStatus && <Text style={styles.detail}>Board capture {boardStatus.captureId} · {boardStatus.count.toLocaleString()} / {boardStatus.target.toLocaleString()} samples</Text>}
          {phase === "recording" && <Text style={styles.metric}>{Math.min(elapsed, durationSeconds)} / {durationSeconds} s</Text>}
          {phase === "transferring" && <Text style={styles.metric}>{Math.round(progress * 100)}%</Text>}
          <Pressable onPress={connect} disabled={phase === "connecting" || phase === "transferring"} style={styles.primaryButton}>
            <Text style={styles.primaryText}>{phase === "connecting" ? "Connecting..." : connection.current ? "Reconnect / check board" : "Connect XIAO"}</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.title}>Describe this collection</Text>
          <Text style={styles.label}>Experiment type</Text>
          <View style={styles.chips}>{researchCategories.map((item) => (
            <Pressable key={item.value} onPress={() => setCategory(item.value)} style={[styles.chip, category === item.value && styles.chipSelected]}>
              <Text style={[styles.chipText, category === item.value && styles.chipTextSelected]}>{item.label}</Text>
            </Pressable>
          ))}</View>
          <Text style={styles.label}>Short label</Text>
          <TextInput value={label} onChangeText={setLabel} placeholder="Example: repeated curb hops" placeholderTextColor={colors.textMuted} style={styles.input} />
          <Text style={styles.label}>Notes</Text>
          <TextInput value={note} onChangeText={setNote} multiline placeholder="Surface, wheels, speed, weather, mounting..." placeholderTextColor={colors.textMuted} style={[styles.input, styles.notes]} />

          <Text style={styles.label}>Context photo</Text>
          {cameraOpen ? (
            <View>
              <CameraView ref={camera} style={styles.camera} facing="back" />
              <Pressable onPress={capturePhoto} style={styles.primaryButton}><Text style={styles.primaryText}>Use this view</Text></Pressable>
            </View>
          ) : photoUri ? (
            <Pressable onPress={takePhoto}><Image source={{ uri: photoUri }} style={styles.photo} /><Text style={styles.link}>Retake photo</Text></Pressable>
          ) : (
            <Pressable onPress={takePhoto} style={styles.secondaryButton}><Text style={styles.secondaryText}>Take surface photo</Text></Pressable>
          )}

          <Text style={styles.label}>Capture duration</Text>
          <View style={styles.chips}>{([10, 30, 60] as const).map((value) => (
            <Pressable key={value} onPress={() => setDurationSeconds(value)} style={[styles.chip, durationSeconds === value && styles.chipSelected]}><Text style={[styles.chipText, durationSeconds === value && styles.chipTextSelected]}>{value} s</Text></Pressable>
          ))}</View>
          <Text style={styles.label}>Sample rate</Text>
          <View style={styles.chips}>{([833, 1666] as const).map((value) => (
            <Pressable key={value} onPress={() => setRateHz(value)} style={[styles.chip, rateHz === value && styles.chipSelected]}><Text style={[styles.chipText, rateHz === value && styles.chipTextSelected]}>{value} Hz</Text></Pressable>
          ))}</View>

          {(phase === "ready" || phase === "saved" || phase === "error") && <Pressable onPress={startCapture} style={styles.startButton}><Text style={styles.startText}>Start board capture</Text></Pressable>}
          {phase === "complete" && <Pressable onPress={retrieve} style={styles.startButton}><Text style={styles.startText}>Retrieve and verify capture</Text></Pressable>}
        </View>

        <View style={styles.card}>
          <Text style={styles.title}>Saved on this iPhone</Text>
          <Text style={styles.body}>{user ? `Uploads are linked to ${user.email}.` : "Sign in from the menu to upload captures to the production database."}</Text>
          {collections.length === 0 ? <Text style={styles.body}>No research collections saved yet.</Text> : collections.map((item) => (
            <View key={item.id} style={styles.savedItem}>
              {item.photoUri && <Image source={{ uri: item.photoUri }} style={styles.thumbnail} />}
              <View style={styles.savedCopy}>
                <Text style={styles.savedTitle}>{item.label}</Text>
                <Text style={styles.detail}>{new Date(item.createdAt).toLocaleString()} · {item.sampleCount.toLocaleString()} samples at {item.rateHz} Hz</Text>
                <Pressable onPress={() => Sharing.shareAsync(item.recordingUri)}><Text style={styles.link}>Share .skateresearch file</Text></Pressable>
                <Pressable disabled={uploadingId === item.id} onPress={() => upload(item)}>
                  <Text style={styles.link}>{item.uploadedAt ? `Uploaded ${new Date(item.uploadedAt).toLocaleString()} · upload again` : uploadingId === item.id ? "Uploading..." : item.uploadError ? "Retry server upload" : "Upload to research database"}</Text>
                </Pressable>
                {item.uploadError && <Text style={styles.uploadError}>{item.uploadError}</Text>}
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.page },
  content: { padding: space.lg, paddingBottom: 60, gap: space.lg },
  card: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: space.lg, gap: space.md, ...shadows.tile },
  title: { color: colors.text, fontSize: 22, fontWeight: "900" },
  body: { color: colors.textMuted, fontSize: 15, lineHeight: 22 },
  detail: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  metric: { color: colors.accent, fontSize: 28, fontWeight: "900" },
  label: { color: colors.text, fontSize: 13, fontWeight: "900", marginTop: space.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: { backgroundColor: colors.surfaceMuted, borderColor: colors.surfaceMuted, borderWidth: 2, borderRadius: radius.pill, paddingHorizontal: 13, paddingVertical: 9 },
  chipSelected: { backgroundColor: colors.surfaceWarm, borderColor: colors.accent },
  chipText: { color: colors.text, fontSize: 13, fontWeight: "800" },
  chipTextSelected: { color: colors.accentStrong },
  input: { backgroundColor: colors.surfaceMuted, borderRadius: radius.md, color: colors.text, fontSize: 16, padding: space.md },
  notes: { minHeight: 92, textAlignVertical: "top" },
  primaryButton: { alignItems: "center", backgroundColor: colors.accent, borderRadius: radius.lg, minHeight: 52, justifyContent: "center", paddingHorizontal: space.lg },
  primaryText: { color: colors.textOnOrange, fontSize: 16, fontWeight: "900" },
  secondaryButton: { alignItems: "center", backgroundColor: colors.surfaceWarm, borderRadius: radius.lg, minHeight: 52, justifyContent: "center" },
  secondaryText: { color: colors.accentStrong, fontSize: 15, fontWeight: "900" },
  startButton: { alignItems: "center", backgroundColor: colors.text, borderRadius: radius.lg, minHeight: 58, justifyContent: "center", marginTop: space.md },
  startText: { color: colors.surface, fontSize: 17, fontWeight: "900" },
  camera: { height: 340, borderRadius: radius.lg, overflow: "hidden", marginBottom: space.sm },
  photo: { width: "100%", height: 210, borderRadius: radius.lg },
  link: { color: colors.link, fontSize: 14, fontWeight: "900", paddingVertical: space.sm },
  savedItem: { backgroundColor: colors.surfaceMuted, borderRadius: radius.lg, flexDirection: "row", gap: space.md, padding: space.md },
  thumbnail: { width: 72, height: 72, borderRadius: radius.md },
  savedCopy: { flex: 1 },
  savedTitle: { color: colors.text, fontSize: 16, fontWeight: "900" },
  uploadError: { color: colors.danger, fontSize: 12, lineHeight: 17 },
});
