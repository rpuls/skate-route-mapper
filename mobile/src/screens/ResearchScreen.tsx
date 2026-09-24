import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  analyzeCapture,
  encodeRecording,
  type ResearchStatus,
} from "@skate-route-mapper/shared/xiaoResearch";
import {
  formatSpeedKmh,
  usableSpeed,
} from "@skate-route-mapper/shared/rideTracking";
import {
  buttonVariants,
  colors,
  controlSize,
  radius,
  shadows,
  space,
  stateStyles,
} from "@skate-route-mapper/shared/design";
import { Card, CollapsibleCard } from "../components/Card";
import { Icon } from "../components/Icon";
import { Page } from "../components/Page";
import { useMobileAuth } from "../auth/MobileAuthContext";
import { uploadResearchCapture } from "../api/researchCaptures";
import { getResearchCollections, saveResearchCollection } from "../database/db";
import * as XiaoBle from "../native/XiaoBle";
import type { ResearchTransfer } from "../native/XiaoBle";
import {
  getXiaoConnection,
  requireXiaoConnection,
  useXiaoConnection,
} from "../native/xiaoConnection";
import {
  describeTrackSpeed,
  noteCaptureId,
  startCaptureTrack,
  stopCaptureTrack,
  takeCaptureTrack,
  useCaptureTrack,
} from "../research/captureTrack";
import { saveResearchFiles } from "../research/researchFiles";
import {
  researchCategories,
  type ResearchCategory,
  type ResearchCollection,
  type ResearchLocation,
} from "../types/research";

/**
 * The research lab, laid out around the one thing that is happening.
 *
 * The screen has four jobs — connect a board, describe an experiment, run a
 * capture, keep the results — and only one of them is ever live. Showing all
 * four expanded pushed the capture controls off the bottom of the phone, so
 * the countdown and the transfer percentage, the two numbers a capture is
 * actually judged by, ran where nobody could see them.
 *
 * So each section shrinks to a line once it has been answered. Connection
 * becomes a pill. The experiment description becomes its own summary. The
 * library stays shut until asked for. What remains on screen is the capture,
 * which is the part that changes.
 */

type CapturePhase =
  | "idle"
  | "recording"
  | "complete"
  | "transferring"
  | "saved"
  | "error";

const durations = [10, 30, 60] as const;
const rates = [833, 1666] as const;

export default function ResearchScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { token, user } = useMobileAuth();
  const xiao = useXiaoConnection();
  const track = useCaptureTrack();

  const transfer = useRef<ResearchTransfer | null>(null);
  const camera = useRef<CameraView | null>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const [phase, setPhase] = useState<CapturePhase>("idle");
  const [message, setMessage] = useState("");
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
  const [now, setNow] = useState(() => Date.now());

  const [setupOpen, setSetupOpen] = useState(true);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [connectionOpen, setConnectionOpen] = useState(false);

  const connected = xiao.status === "connected";
  const refreshCollections = useCallback(
    () => setCollections(getResearchCollections()),
    []
  );

  // The board keeps its own state across app screens now, so arriving here
  // means asking what it is already doing rather than assuming it is idle.
  //
  // It goes through `requireXiaoConnection` because the link may have died
  // while this screen was not looking. Asking a board that is no longer there
  // used to fail with a raw BLE error under a pill that still said
  // "connected"; now the check is what discovers the loss, and the connection
  // module puts the screen into reconnecting by itself.
  const readBoard = useCallback(async (announceIdle = false) => {
    const connection = await requireXiaoConnection();

    if (!connection) {
      setMessage("The sensor is not reachable. Reconnect it and try again.");
      return false;
    }

    try {
      const status = await connection.getResearchStatus();

      setBoardStatus(status);

      if (status.state === 2 || status.state === 3) {
        setPhase("complete");
        setMessage(
          `Found a finished capture on the board: ${status.count.toLocaleString()} samples${
            status.state === 3 ? ` with error ${status.error}` : ""
          }. Retrieve it before starting another.`
        );
      } else if (status.state === 1) {
        setPhase("recording");
        setMessage("The board is already recording.");
      } else if (announceIdle) {
        // An idle board is the common answer and used to produce no visible
        // change at all, which made the check look like a dead button. It is
        // only announced when someone asked: a screen that opens by saying
        // "idle and ready" has answered a question nobody put.
        setPhase("idle");
        setMessage("The board answered. It is idle and ready to record.");
      }

      return true;
    } catch {
      setMessage("Connected, but the board did not answer a status request.");
      return false;
    }
  }, []);

  // What the pill's check does: confirm the radio still has the board, then
  // ask the board what it is doing. Both halves report, and the button stays
  // busy until they have.
  const [checkingBoard, setCheckingBoard] = useState(false);

  const checkBoard = useCallback(async () => {
    if (checkingBoard) {
      return;
    }

    setCheckingBoard(true);
    setMessage("Checking the board...");

    try {
      await readBoard(true);
    } finally {
      setCheckingBoard(false);
    }
  }, [checkingBoard, readBoard]);

  useFocusEffect(
    useCallback(() => {
      refreshCollections();

      // Only worth asking when there is supposed to be a board. Arriving with
      // nothing paired is the ordinary case, not a failure to report.
      if (useXiaoConnection.getState().status === "connected") {
        void readBoard();
      }
      // The connection is owned by `xiaoConnection`, not by this screen, so
      // leaving the lab no longer drops the board. That is the point: coming
      // back, or arriving from a ride, finds it still in hand.
    }, [readBoard, refreshCollections])
  );

  // The board's recording and the phone's GPS log have to end together. The
  // transfer that follows can run for minutes with the rider standing still,
  // and fixes from it would flatten every speed figure the capture is judged
  // by.
  //
  // Only the end states close it, never "idle". This screen can remount with
  // its phase reset while a capture is still running on the board — walking to
  // the ride screen and back does exactly that — and the log outlives that on
  // purpose. Its own timer closes the window if nothing here ever does.
  useEffect(() => {
    if (
      phase === "complete" ||
      phase === "transferring" ||
      phase === "saved" ||
      phase === "error"
    ) {
      stopCaptureTrack();
    }
  }, [phase]);

  useEffect(() => {
    if (phase !== "recording" && phase !== "transferring") {
      return;
    }

    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== "recording") {
      return;
    }

    let checking = false;
    const timer = setInterval(async () => {
      const connection = getXiaoConnection();

      if (checking) {
        return;
      }

      // A capture outlives the link: the board keeps recording to its own
      // flash whether or not the phone is listening. Saying so is the point —
      // the rider should keep riding rather than stop to fix Bluetooth.
      if (!connection) {
        setMessage(
          "The sensor dropped off, but the board is still recording. It reconnects by itself; retrieve the capture when it is back."
        );
        return;
      }

      checking = true;

      try {
        const status = await connection.getResearchStatus();

        setBoardStatus(status);

        if (status.state === 2) {
          setPhase("complete");
          setMessage(
            `${status.count.toLocaleString()} samples are safe on the board. Retrieve them now.`
          );
        } else if (status.state === 3) {
          setPhase("complete");
          setMessage(
            `The board reported capture error ${status.error}. Its partial data can still be retrieved for diagnosis.`
          );
        }
      } catch {
        setMessage(
          "BLE dropped. The board keeps recording. Reconnect after the capture duration, then retrieve it."
        );
      } finally {
        checking = false;
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [phase]);

  const takePhoto = async () => {
    if (!cameraPermission?.granted) {
      const result = await requestCameraPermission();

      if (!result.granted) {
        setMessage("Camera permission is needed for a surface photo.");
        return;
      }
    }

    setCameraOpen(true);
  };

  const capturePhoto = async () => {
    const photo = await camera.current?.takePictureAsync({ quality: 0.65 });

    if (photo?.uri) {
      setPhotoUri(photo.uri);
      setCameraOpen(false);
    }
  };

  const readLocation = async (): Promise<ResearchLocation> => {
    const permission = await Location.requestForegroundPermissionsAsync();

    if (!permission.granted) {
      throw new Error("Location permission is required for a research collection.");
    }

    const point = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.BestForNavigation,
    });

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
    // Verified, not assumed. A capture started against a link that has quietly
    // gone is the failure this screen was reported for: the pill said
    // connected and Start answered with a BLE error.
    const connection = await requireXiaoConnection();

    if (!connection) {
      setMessage(
        "The sensor is not reachable. Reconnect it from the pill above, then start."
      );
      return;
    }

    if (!label.trim()) {
      setSetupOpen(true);
      setMessage("Give this experiment a short label before starting.");
      return;
    }

    setMessage("Getting a fresh GPS position...");

    try {
      const location = await readLocation();

      setStartLocation(location);
      transfer.current = null;

      // Before the board is told to start, so the first fix is already in hand
      // when sampling begins. A capture with no track is still worth having, so
      // a refusal here is reported by the log rather than thrown.
      await startCaptureTrack(durationSeconds);

      const status = await connection.startResearchCapture(durationSeconds, rateHz);

      noteCaptureId(status.captureId);
      setBoardStatus(status);
      setStartedAt(Date.now());
      setNow(Date.now());
      setPhase("recording");
      // The description has been answered; the capture has not. Folding it
      // away is what keeps the countdown on screen.
      setSetupOpen(false);
      setLibraryOpen(false);
      setMessage(
        `Recording ${durationSeconds} s at ${rateHz} Hz on the board. Ride now — keep the phone with you and the screen on this page, it is logging your speed.`
      );
    } catch (error) {
      stopCaptureTrack();
      setPhase("error");
      setMessage(error instanceof Error ? error.message : "Could not start the capture.");
    }
  };

  const retrieve = async () => {
    const connection = await requireXiaoConnection();

    if (!connection || !boardStatus || ![2, 3].includes(boardStatus.state)) {
      setMessage("Reconnect and confirm the completed capture before retrieving it.");
      return;
    }

    if (!label.trim()) {
      setSetupOpen(true);
      setMessage("Give this experiment a short label before saving the recovered capture.");
      return;
    }

    setPhase("transferring");
    setMessage("Copying the verified recording from the board. Keep the app open and nearby.");

    try {
      const currentTransfer =
        transfer.current?.captureId === boardStatus.captureId
          ? transfer.current
          : XiaoBle.createResearchTransfer(boardStatus);

      transfer.current = currentTransfer;

      const completed = await connection.retrieveResearchCapture(
        boardStatus,
        currentTransfer,
        (received, total) => setProgress(total ? received / total : 0)
      );

      // Closed already by the phase change, but a retrieval can also be reached
      // from a board that was found finished on arrival, so it is closed here
      // too rather than assumed.
      stopCaptureTrack();

      const captureTrack = takeCaptureTrack(boardStatus.captureId);
      const recoveredStartLocation = startLocation ?? (await readLocation());
      const endLocation = await readLocation().catch(() => null);
      const report = analyzeCapture(boardStatus, completed.raw, completed.summaries);
      const actualDuration = Math.round(
        boardStatus.target / boardStatus.rateHz
      ) as 10 | 30 | 60;
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
        track: captureTrack,
        photoFilename: photoUri ? "surface.jpg" : null,
      };
      const recording = encodeRecording(
        { ...boardStatus, field: fieldMetadata },
        completed.raw,
        completed.summaries
      );
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
        track: captureTrack,
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
      setLibraryOpen(true);
      setMessage(
        `Capture verified and saved on this phone. ${describeTrackSpeed(
          captureTrack?.speed
        )}. The original high-rate data is ready to share for analysis.`
      );
    } catch (error) {
      setPhase("complete");
      setMessage(
        `${
          error instanceof Error ? error.message : "Transfer failed."
        } Reconnect and retry; received pages are kept while this screen stays open.`
      );
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
      setMessage(
        `Uploaded ${response.recordingBytes.toLocaleString()} recording bytes${
          response.photoBytes ? ` and ${response.photoBytes.toLocaleString()} photo bytes` : ""
        }.`
      );
    } catch (error) {
      const uploadError = error instanceof Error ? error.message : "Upload failed.";

      saveResearchCollection({ ...collection, uploadError });
      setMessage(`${uploadError} The local files are unchanged; retry when connected.`);
    } finally {
      setUploadingId(null);
      refreshCollections();
    }
  };

  const busyConnecting =
    xiao.status === "connecting" || xiao.status === "reconnecting";
  const elapsed = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
  const remaining = Math.max(0, durationSeconds - elapsed);
  const categoryLabel =
    researchCategories.find((item) => item.value === category)?.label ?? "";
  const setupSummary = `${categoryLabel} · ${durationSeconds} s · ${rateHz} Hz${
    label.trim() ? ` · ${label.trim()}` : " · unlabelled"
  }`;

  return (
    <Page
      subtitle="Collect labelled high-rate XIAO data for road-contact and surface experiments."
      title="Research lab"
    >
      {connected ? (
        <ConnectedPill
          checking={checkingBoard || xiao.checking}
          deviceName={xiao.deviceName}
          onCheck={() => void checkBoard()}
          onDisconnect={() => void xiao.disconnect()}
          onToggle={() => setConnectionOpen((open) => !open)}
          open={connectionOpen}
        />
      ) : (
        <Card>
          <Text style={styles.title}>
            {busyConnecting ? "Getting the board back" : "Connect the board"}
          </Text>
          <Text style={styles.body}>
            {xiao.status === "unsupported"
              ? "Research capture needs the native development build; it is unavailable in Expo Go and on web."
              : busyConnecting
                ? xiao.detail
                : xiao.radioMessage ??
                  xiao.error ??
                  "Pair the XIAO first. Everything below needs the board in hand."}
          </Text>

          <Pressable
            accessibilityRole="button"
            disabled={xiao.attempting || xiao.status === "unsupported"}
            onPress={() => void xiao.connect()}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.pressed,
              (xiao.attempting || xiao.status === "unsupported") &&
                stateStyles.disabled,
            ]}
          >
            {xiao.attempting ? (
              <ActivityIndicator color={colors.textOnOrange} size="small" />
            ) : (
              <Icon color={colors.textOnOrange} name="bluetooth" size={20} />
            )}
            <Text style={styles.primaryText}>
              {xiao.attempting
                ? xiao.status === "reconnecting"
                  ? "Reconnecting..."
                  : "Connecting..."
                : xiao.status === "reconnecting"
                  ? "Try now"
                  : "Connect XIAO"}
            </Text>
          </Pressable>
        </Card>
      )}

      <CollapsibleCard
        onToggle={() => setSetupOpen((open) => !open)}
        open={setupOpen}
        summary={setupSummary}
        title="Describe this collection"
      >
        <Text style={styles.label}>Experiment type</Text>
        <View style={styles.chips}>
          {researchCategories.map((item) => (
            <Chip
              key={item.value}
              label={item.label}
              onPress={() => setCategory(item.value)}
              selected={category === item.value}
            />
          ))}
        </View>

        <Text style={styles.label}>Short label</Text>
        <TextInput
          onChangeText={setLabel}
          placeholder="Example: repeated curb hops"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          value={label}
        />

        <Text style={styles.label}>Notes</Text>
        <TextInput
          multiline
          onChangeText={setNote}
          placeholder="Surface, wheels, speed, weather, mounting..."
          placeholderTextColor={colors.textMuted}
          style={[styles.input, styles.notes]}
          value={note}
        />

        <Text style={styles.label}>Context photo</Text>
        {photoUri ? (
          <Pressable accessibilityRole="button" onPress={takePhoto}>
            <Image source={{ uri: photoUri }} style={styles.photo} />
            <Text style={styles.link}>Retake photo</Text>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            onPress={takePhoto}
            style={styles.secondaryButton}
          >
            <Icon color={colors.accentStrong} name="camera" size={20} />
            <Text style={styles.secondaryText}>Take surface photo</Text>
          </Pressable>
        )}

        <Text style={styles.label}>Capture duration</Text>
        <View style={styles.chips}>
          {durations.map((value) => (
            <Chip
              key={value}
              label={`${value} s`}
              onPress={() => setDurationSeconds(value)}
              selected={durationSeconds === value}
            />
          ))}
        </View>

        <Text style={styles.label}>Sample rate</Text>
        <View style={styles.chips}>
          {rates.map((value) => (
            <Chip
              key={value}
              label={`${value} Hz`}
              onPress={() => setRateHz(value)}
              selected={rateHz === value}
            />
          ))}
        </View>
      </CollapsibleCard>

      <Card>
        <View style={styles.captureHeader}>
          <Text style={styles.title}>Board capture</Text>
          {phase === "recording" ? (
            <View style={styles.liveBadge}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>Live</Text>
            </View>
          ) : null}
        </View>

        {phase === "recording" ? (
          <>
            <Text style={styles.metric}>{remaining} s left</Text>
            <ProgressBar value={durationSeconds ? elapsed / durationSeconds : 0} />
          </>
        ) : null}

        {/*
          Speed follows the GPS log rather than the phase, because the two can
          disagree: a capture whose board stopped answering leaves the screen
          saying "recording" long after the window closed, and a stale live
          read-out there would be read as a live one.
        */}
        {track.logging ? (
          <View style={styles.speedRow}>
            <Icon color={colors.accent} name="myLocation" size={18} />
            <Text style={styles.speedValue}>
              {formatSpeedKmh(usableSpeed(track.latestSpeedMps))}
            </Text>
            <Text style={styles.detail}>
              {track.fixCount} GPS fix{track.fixCount === 1 ? "" : "es"}
              {track.latestAccuracyMeters === null
                ? ""
                : ` · ${Math.round(track.latestAccuracyMeters)} m`}
            </Text>
          </View>
        ) : track.summary ? (
          <Text style={styles.detail}>
            Over the capture: {describeTrackSpeed(track.summary)}
          </Text>
        ) : null}

        {track.error ? <Text style={styles.uploadError}>{track.error}</Text> : null}

        {phase === "transferring" ? (
          <>
            <Text style={styles.metric}>{Math.round(progress * 100)}%</Text>
            <ProgressBar value={progress} />
          </>
        ) : null}

        {message ? <Text style={styles.body}>{message}</Text> : null}

        {boardStatus ? (
          <Text style={styles.detail}>
            Board capture {boardStatus.captureId} · {boardStatus.count.toLocaleString()} /{" "}
            {boardStatus.target.toLocaleString()} samples
          </Text>
        ) : null}

        {phase === "complete" ? (
          <Pressable
            accessibilityRole="button"
            onPress={retrieve}
            style={styles.primaryButton}
          >
            <Icon color={colors.textOnOrange} name="upload" size={20} />
            <Text style={styles.primaryText}>Retrieve and verify capture</Text>
          </Pressable>
        ) : phase === "recording" || phase === "transferring" ? null : (
          <Pressable
            accessibilityRole="button"
            disabled={!connected}
            onPress={startCapture}
            style={[styles.primaryButton, !connected && stateStyles.disabled]}
          >
            <Icon color={colors.textOnOrange} name="play" size={20} />
            <Text style={styles.primaryText}>
              {connected ? "Start board capture" : "Connect the board first"}
            </Text>
          </Pressable>
        )}
      </Card>

      <CollapsibleCard
        onToggle={() => setLibraryOpen((open) => !open)}
        open={libraryOpen}
        summary={
          collections.length === 0
            ? "Nothing saved yet"
            : `${collections.length} collection${collections.length === 1 ? "" : "s"} on this phone`
        }
        title="Saved collections"
        trailing={
          collections.length > 0 ? (
            <View style={styles.count}>
              <Text style={styles.countText}>{collections.length}</Text>
            </View>
          ) : null
        }
      >
        <Text style={styles.body}>
          {user
            ? `Uploads are linked to ${user.email}.`
            : "Sign in from the menu to upload captures to the production database."}
        </Text>

        {collections.length === 0 ? (
          <Text style={styles.body}>No research collections saved yet.</Text>
        ) : (
          collections.map((item) => (
            <View key={item.id} style={styles.savedItem}>
              {item.photoUri ? (
                <Image source={{ uri: item.photoUri }} style={styles.thumbnail} />
              ) : null}

              <View style={styles.savedCopy}>
                <Text style={styles.savedTitle}>{item.label}</Text>
                <Text style={styles.detail}>
                  {new Date(item.createdAt).toLocaleString()} ·{" "}
                  {item.sampleCount.toLocaleString()} samples at {item.rateHz} Hz
                </Text>
                <Text style={styles.detail}>{describeTrackSpeed(item.track?.speed)}</Text>

                <Pressable
                  accessibilityRole="button"
                  onPress={() => Sharing.shareAsync(item.recordingUri)}
                  style={styles.linkRow}
                >
                  <Icon color={colors.link} name="share" size={16} />
                  <Text style={styles.link}>Share .skateresearch file</Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  disabled={uploadingId === item.id}
                  onPress={() => upload(item)}
                >
                  <Text style={styles.link}>
                    {item.uploadedAt
                      ? `Uploaded ${new Date(item.uploadedAt).toLocaleString()} · upload again`
                      : uploadingId === item.id
                      ? "Uploading..."
                      : item.uploadError
                      ? "Retry server upload"
                      : "Upload to research database"}
                  </Text>
                </Pressable>

                {item.uploadError ? (
                  <Text style={styles.uploadError}>{item.uploadError}</Text>
                ) : null}
              </View>
            </View>
          ))
        )}
      </CollapsibleCard>

      <Modal animationType="slide" onRequestClose={() => setCameraOpen(false)} visible={cameraOpen}>
        <View style={styles.cameraRoot}>
          <CameraView facing="back" ref={camera} style={StyleSheet.absoluteFill} />

          <View style={[styles.cameraBar, { paddingBottom: space.xl + insets.bottom }]}>
            <Pressable
              accessibilityLabel="Cancel"
              accessibilityRole="button"
              onPress={() => setCameraOpen(false)}
              style={styles.cameraCancel}
            >
              <Icon color={colors.textOnOrange} name="close" size={24} />
            </Pressable>

            <Pressable
              accessibilityLabel="Take photo"
              accessibilityRole="button"
              onPress={capturePhoto}
              style={styles.shutter}
            >
              <View style={styles.shutterInner} />
            </Pressable>

            <View style={styles.cameraCancel} />
          </View>
        </View>
      </Modal>
    </Page>
  );
}

/**
 * The connection, once it is made.
 *
 * A connected board is a fact, not a task, so it gets a line rather than a
 * tile. The actions behind it — re-reading board state, dropping the link —
 * are rare enough to be one tap away.
 */
function ConnectedPill({
  checking,
  deviceName,
  onCheck,
  onDisconnect,
  onToggle,
  open,
}: {
  checking: boolean;
  deviceName: string | null;
  onCheck: () => void;
  onDisconnect: () => void;
  onToggle: () => void;
  open: boolean;
}) {
  return (
    <View style={styles.pillWrap}>
      <Pressable
        accessibilityRole="button"
        onPress={onToggle}
        style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
      >
        <View style={styles.pillIcon}>
          <Icon color={colors.accent} name="sensors" size={20} />
          <View style={styles.pillDot} />
        </View>

        <Text style={styles.pillText} numberOfLines={1}>
          {deviceName ?? "XIAO"} connected
        </Text>

        <Icon color={colors.textMuted} name={open ? "expandLess" : "expandMore"} size={20} />
      </Pressable>

      {open ? (
        <View style={styles.pillActions}>
          <Pressable
            accessibilityRole="button"
            disabled={checking}
            onPress={onCheck}
            style={({ pressed }) => [
              styles.pillAction,
              pressed && styles.pressed,
              checking && stateStyles.disabled,
            ]}
          >
            {checking ? (
              <ActivityIndicator color={colors.accent} size="small" />
            ) : (
              <Icon color={colors.accent} name="refresh" size={18} />
            )}
            <Text style={styles.pillActionText}>
              {checking ? "Checking..." : "Check board"}
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={onDisconnect}
            style={({ pressed }) => [styles.pillAction, pressed && styles.pressed]}
          >
            <Icon color={colors.danger} name="close" size={18} />
            <Text style={[styles.pillActionText, { color: colors.danger }]}>
              Disconnect
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function Chip({
  label,
  onPress,
  selected,
}: {
  label: string;
  onPress: () => void;
  selected: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

function ProgressBar({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(1, value));

  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${clamped * 100}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.75,
  },
  title: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "900",
  },
  body: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
  },
  detail: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
  },
  metric: {
    color: colors.accent,
    fontSize: 32,
    fontWeight: "900",
  },
  label: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "900",
    marginTop: space.xs,
  },

  // Connected pill
  pillWrap: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: space.md,
    ...shadows.tile,
  },
  pill: {
    alignItems: "center",
    flexDirection: "row",
    gap: space.md,
    minHeight: controlSize.md,
  },
  pillIcon: {
    alignItems: "center",
    backgroundColor: colors.surfaceWarm,
    borderRadius: radius.sm,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  pillDot: {
    backgroundColor: colors.success,
    borderColor: colors.surface,
    borderRadius: radius.pill,
    borderWidth: 2,
    height: 12,
    position: "absolute",
    right: -3,
    top: -3,
    width: 12,
  },
  pillText: {
    color: colors.text,
    flex: 1,
    fontSize: 15,
    fontWeight: "800",
  },
  pillActions: {
    borderTopColor: colors.surfaceMuted,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: space.lg,
    paddingVertical: space.sm,
  },
  pillAction: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    minHeight: controlSize.xs,
  },
  pillActionText: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: "900",
  },

  // Capture
  captureHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: space.md,
    justifyContent: "space-between",
  },
  liveBadge: {
    alignItems: "center",
    backgroundColor: colors.surfaceWarm,
    borderRadius: radius.pill,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: space.md,
    paddingVertical: 5,
  },
  liveDot: {
    backgroundColor: colors.danger,
    borderRadius: radius.pill,
    height: 8,
    width: 8,
  },
  liveText: {
    color: colors.accentStrong,
    fontSize: 12,
    fontWeight: "900",
  },
  speedRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: space.sm,
  },
  speedValue: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "900",
  },
  progressTrack: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.pill,
    height: 8,
    overflow: "hidden",
  },
  progressFill: {
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    height: "100%",
  },

  // Controls
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.sm,
  },
  chip: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.surfaceMuted,
    borderRadius: radius.pill,
    borderWidth: 2,
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  chipSelected: {
    backgroundColor: colors.surfaceWarm,
    borderColor: colors.accent,
  },
  chipText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "800",
  },
  chipTextSelected: {
    color: colors.accentStrong,
  },
  input: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    color: colors.text,
    fontSize: 16,
    minHeight: controlSize.md,
    padding: space.md,
  },
  notes: {
    minHeight: 92,
    textAlignVertical: "top",
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: buttonVariants.secondary.filled.backgroundColor,
    borderRadius: radius.lg,
    flexDirection: "row",
    gap: space.sm,
    justifyContent: "center",
    minHeight: controlSize.md,
    paddingHorizontal: space.lg,
  },
  primaryText: {
    color: buttonVariants.secondary.filled.color,
    fontSize: 16,
    fontWeight: "900",
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: buttonVariants.primary.contained.backgroundColor,
    borderColor: buttonVariants.primary.contained.borderColor,
    borderRadius: radius.lg,
    borderWidth: 2,
    flexDirection: "row",
    gap: space.sm,
    justifyContent: "center",
    minHeight: controlSize.md,
  },
  secondaryText: {
    color: buttonVariants.primary.contained.color,
    fontSize: 15,
    fontWeight: "900",
  },
  photo: {
    borderRadius: radius.lg,
    height: 180,
    width: "100%",
  },
  link: {
    color: colors.link,
    fontSize: 14,
    fontWeight: "900",
    paddingVertical: space.sm,
  },
  linkRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
  },

  // Library
  count: {
    alignItems: "center",
    backgroundColor: colors.surfaceWarm,
    borderRadius: radius.pill,
    height: 28,
    justifyContent: "center",
    minWidth: 28,
    paddingHorizontal: space.sm,
  },
  countText: {
    color: colors.accentStrong,
    fontSize: 13,
    fontWeight: "900",
  },
  savedItem: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.lg,
    flexDirection: "row",
    gap: space.md,
    padding: space.md,
  },
  thumbnail: {
    borderRadius: radius.sm,
    height: 72,
    width: 72,
  },
  savedCopy: {
    flex: 1,
    minWidth: 0,
  },
  savedTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "900",
  },
  uploadError: {
    color: colors.danger,
    fontSize: 12,
    lineHeight: 17,
  },

  // Camera
  cameraRoot: {
    backgroundColor: colors.text,
    flex: 1,
  },
  cameraBar: {
    alignItems: "center",
    bottom: 0,
    flexDirection: "row",
    justifyContent: "space-between",
    left: 0,
    paddingHorizontal: space.xl,
    position: "absolute",
    right: 0,
  },
  cameraCancel: {
    alignItems: "center",
    height: 56,
    justifyContent: "center",
    width: 56,
  },
  shutter: {
    alignItems: "center",
    borderColor: colors.surface,
    borderRadius: radius.pill,
    borderWidth: 4,
    height: 76,
    justifyContent: "center",
    width: 76,
  },
  shutterInner: {
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    height: 60,
    width: 60,
  },
});
