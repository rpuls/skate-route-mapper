import { AppState, type AppStateStatus } from "react-native";
import { create } from "zustand";
import {
  XIAO_BLE_DEVICE_NAME,
  type XiaoImuPacket,
} from "@skate-route-mapper/shared/xiaoBle";
import {
  preferenceKeys,
  readBooleanPreference,
  readPreference,
  writeBooleanPreference,
  writePreference,
} from "../storage/preferences";
import { diagnosticsAvailable, flushAppLog, logBle } from "../diagnostics/log";
import * as XiaoBle from "./XiaoBle";
import type { XiaoBleConnection } from "./XiaoBle";

/**
 * One XIAO link for the whole app, and the only thing that decides whether it
 * is up.
 *
 * Both the ride screen and the research lab talk to the same board, so the
 * link lives at module scope rather than in a React tree: opening the lab from
 * a ride must not drop it. That much was already true. What was missing is
 * that nothing ever noticed the link going away. `status` was set to
 * "connected" by a successful connect and only ever left that state when a
 * screen asked for a disconnect, so a board that ran out of battery, went out
 * of range or was switched off while the app was in the background left every
 * screen confidently reporting a sensor that was not there — and every request
 * to it failing with a BLE error the rider could do nothing with.
 *
 * So the link is now watched from three directions, because no one of them
 * sees everything:
 *
 * 1. **The disconnect callback.** The radio tells us the moment GATT drops.
 *    This is the fast path and covers almost every real loss.
 * 2. **The radio state.** Bluetooth being switched off takes every link with
 *    it and makes retrying pointless until it comes back; switching it on
 *    again is the single best moment to retry.
 * 3. **Coming back to the front.** A suspended process is delivered no
 *    callbacks at all, so a link that died overnight is only discoverable by
 *    asking. On every foreground the app asks the radio rather than trusting
 *    what it last wrote down.
 *
 * On top of those, anything about to talk to the board goes through
 * `requireXiaoConnection`, which verifies before handing the link over. A
 * `XiaoBleConnection` object stays perfectly usable after the board it refers
 * to has gone, and that gap is what produced "connected" tiles above failing
 * buttons.
 *
 * Recovery is automatic and bounded: see `reconnectDelaysMs`.
 */

export type XiaoStatus =
  | "unsupported"
  | "disconnected"
  | "connecting"
  | "reconnecting"
  | "connected";

export type XiaoSampleListener = (sample: XiaoImuPacket) => void;

type XiaoConnectionState = {
  status: XiaoStatus;
  /** The remembered board, whether or not it is reachable right now. */
  deviceId: string | null;
  deviceName: string | null;
  /** Plain-language detail for whatever the status currently is. */
  detail: string;
  /** Set when an attempt failed, cleared when one is started. */
  error: string | null;
  /**
   * What the radio itself is refusing, when it is refusing something: no
   * Bluetooth, no permission, no LE hardware. Independent of any one link,
   * and the thing to show first when it is set.
   */
  radioMessage: string | null;
  /**
   * An attempt is in the radio right now, as opposed to waiting out a backoff.
   *
   * The two look the same in `status` and must not feel the same: a button is
   * only worth disabling while something is actually happening. Waiting for
   * the next try is exactly when a rider should be able to say "try now".
   */
  attempting: boolean;
  /** How many recovery attempts have been made since the link was last up. */
  reconnectAttempt: number;
  /** True while a rider-initiated liveness check is in flight. */
  checking: boolean;
  autoConnect: boolean;
  connect: () => Promise<boolean>;
  disconnect: () => Promise<void>;
  /**
   * Ask the radio whether the link is really up, and start recovery if it is
   * not. Resolves to what the radio said, not to what the store believed.
   */
  check: () => Promise<boolean>;
  setAutoConnect: (enabled: boolean) => void;
};

/**
 * How long recovery waits between attempts.
 *
 * The first few are quick, because most losses are a momentary GATT drop that
 * comes straight back. The tail is a minute, because a board that has been
 * gone for a minute is usually switched off or left at home, and a phone in a
 * pocket should not scan for it all afternoon. Once the schedule is exhausted
 * the loop only keeps running while the app is in front; the two events that
 * could change the answer — the app coming back to the front, the radio being
 * switched on — restart it at once and cost nothing while idle.
 */
const reconnectDelaysMs = [1_000, 2_000, 5_000, 10_000, 20_000, 30_000, 60_000];

let connection: XiaoBleConnection | null = null;
let connecting: Promise<boolean> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
/**
 * Whether the rider wants a link at all.
 *
 * Set by a connect, cleared by a disconnect. Nothing reconnects a board that
 * was deliberately dropped, and nothing reconnects one that was never paired.
 */
let wantConnection = false;
let radioReady = false;
/**
 * The stream rate a caller last asked for.
 *
 * A reconnected board is a fresh board: it comes up at its own default rate
 * and knows nothing about the ride in progress. Remembering the request here,
 * where the link lives, is what stops a mid-ride drop from silently halving
 * the surface data for the rest of the route.
 */
let desiredSampleIntervalMs: number | null = null;
let stopRadioWatch: (() => void) | null = null;
let appStateSubscription: { remove: () => void } | null = null;
let appActive = AppState.currentState === "active";
let rssiTimer: ReturnType<typeof setInterval> | null = null;

/**
 * How often the link's signal strength is written down.
 *
 * Two seconds is fine enough to see a rider skate out of range and back and
 * coarse enough that an hour of riding costs a few tens of kilobytes. The read
 * is answered by the phone's own controller rather than the board, so it does
 * not compete with the sample stream — but it is still a GATT operation in
 * `react-native-ble-plx`'s queue, which is why it stands down entirely while a
 * research retrieval is running.
 *
 * Unlike the rest of the log this is an active probe rather than a record of
 * something that happened, so it only runs in a development build. A shipped
 * app has no way to hand the log over and no reason to spend the radio on it.
 */
const rssiIntervalMs = 2_000;

const sampleListeners = new Set<XiaoSampleListener>();

const supported = XiaoBle.isXiaoBleSupported();

const unsupportedDetail =
  "Needs the native development build; unavailable on web and in Expo Go.";

function fanOutSample(sample: XiaoImuPacket) {
  sampleListeners.forEach((listener) => listener(sample));
}

export const useXiaoConnection = create<XiaoConnectionState>((set) => ({
  status: supported ? "disconnected" : "unsupported",
  deviceId: null,
  deviceName: null,
  detail: supported ? "Not connected" : unsupportedDetail,
  error: null,
  radioMessage: null,
  attempting: false,
  reconnectAttempt: 0,
  checking: false,
  autoConnect: true,

  connect: () => openConnection("manual"),

  disconnect: async () => {
    wantConnection = false;
    resetReconnect();
    stopRssiSampling();

    const current = connection;
    connection = null;

    logBle({ kind: "note", text: "rider disconnected" });

    set({
      status: supported ? "disconnected" : "unsupported",
      detail: supported ? "Not connected" : unsupportedDetail,
      error: null,
      reconnectAttempt: 0,
    });

    // An attempt still in the radio cannot be recalled, but it can be
    // disowned: `wantConnection` is false now, and `openConnection` drops
    // whatever it comes back with rather than handing the rider a link they
    // just refused.
    set({ attempting: false });

    await current?.disconnect().catch(() => undefined);
  },

  check: async () => {
    if (!supported) {
      return false;
    }

    set({ checking: true });

    try {
      return await verifyLink();
    } finally {
      set({ checking: false });
    }
  },

  setAutoConnect: (enabled) => {
    set({ autoConnect: enabled });
    void writeBooleanPreference(preferenceKeys.autoConnectXiao, enabled);

    // The switch governs recovery as well as launch, so turning it off has to
    // stop a retry loop that is already running. Leaving one going behind a
    // switch that says it is off is the kind of thing that makes a setting
    // feel broken.
    if (!enabled) {
      resetReconnect();

      if (useXiaoConnection.getState().status === "reconnecting") {
        set({ status: "disconnected", detail: "Not connected" });
      }
    }
  },
}));

/** Whether an automatic attempt is allowed right now. */
function shouldReconnect() {
  const state = useXiaoConnection.getState();

  return (
    supported &&
    wantConnection &&
    state.autoConnect &&
    radioReady &&
    state.deviceId !== null
  );
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function resetReconnect() {
  clearReconnectTimer();
  reconnectAttempt = 0;
}

function scheduleReconnect() {
  if (reconnectTimer || connecting || !shouldReconnect()) {
    return;
  }

  const exhausted = reconnectAttempt >= reconnectDelaysMs.length;

  // Parked rather than given up: `handleForeground` and the radio watch both
  // reset the counter and try again, which is when the answer could differ.
  if (exhausted && !appActive) {
    useXiaoConnection.setState({
      status: "disconnected",
      detail: "Sensor not found. Tap to connect.",
    });
    return;
  }

  const delay =
    reconnectDelaysMs[Math.min(reconnectAttempt, reconnectDelaysMs.length - 1)];

  reconnectAttempt += 1;

  logBle({ kind: "retry", attempt: reconnectAttempt, delayMs: delay });

  const { deviceName } = useXiaoConnection.getState();

  useXiaoConnection.setState({
    status: "reconnecting",
    detail: `Lost ${deviceName ?? XIAO_BLE_DEVICE_NAME}. Trying again...`,
    attempting: false,
    reconnectAttempt,
  });

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void openConnection("auto");
  }, delay);
}

/**
 * The link is down, and it was not the app that dropped it.
 *
 * Every path that discovers a loss — the radio callback, a failed liveness
 * check, Bluetooth being switched off — ends here, so there is one place that
 * decides what the screens are told and whether to go looking again.
 *
 * `detail` is copy for a rider, so the native disconnect message does not come
 * through here: "Device 0C:1A:… was disconnected" is a log line, not something
 * to put under a sensor tile. Callers that have one log it and pass null.
 */
function handleLinkDown(detail: string | null) {
  const wasUp =
    connection !== null || useXiaoConnection.getState().status === "connected";

  connection = null;
  stopRssiSampling();

  if (!wasUp) {
    return;
  }

  // The radio callback logs its own `down` with the reason code. This covers
  // the paths that discover a loss by asking — a failed liveness check, the
  // radio being switched off — which have no error to report but are still the
  // moment the link stopped being usable.
  logBle({ kind: "note", text: `link down: ${detail ?? "no detail"}` });

  const { deviceName } = useXiaoConnection.getState();

  useXiaoConnection.setState({
    status: "disconnected",
    detail: detail ?? `${deviceName ?? XIAO_BLE_DEVICE_NAME} disconnected.`,
    error: null,
  });

  scheduleReconnect();
}

/**
 * Sample the link's signal strength for as long as it is up.
 *
 * Started wherever the store is told the link is connected and stopped
 * wherever it is told the link is gone, so the sampler cannot outlive the
 * thing it measures. A reading is skipped rather than queued while a research
 * retrieval is in flight: the retrieval's wall-clock time is the figure every
 * capture so far has been scored by, and slowing it would make the next
 * ride's numbers incomparable with the ones already uploaded.
 */
function startRssiSampling() {
  if (rssiTimer !== null || !diagnosticsAvailable) {
    return;
  }

  let reading = false;

  rssiTimer = setInterval(async () => {
    const current = connection;

    if (!current || reading || XiaoBle.isXiaoTransferBusy()) {
      return;
    }

    reading = true;

    try {
      const dbm = await current.readRssi();

      if (dbm !== null) {
        logBle({ kind: "rssi", dbm });
      }
    } finally {
      reading = false;
    }
  }, rssiIntervalMs);
}

function stopRssiSampling() {
  if (rssiTimer !== null) {
    clearInterval(rssiTimer);
    rssiTimer = null;
  }
}

function markConnected(next: XiaoBleConnection) {
  reconnectAttempt = 0;
  startRssiSampling();

  useXiaoConnection.setState({
    status: "connected",
    deviceId: next.deviceId,
    deviceName: next.deviceName,
    detail: `${next.deviceName} connected`,
    error: null,
    attempting: false,
    reconnectAttempt: 0,
  });
}

/**
 * Remember the board so the next link is a reconnect rather than a search.
 *
 * `xiaoEverConnected` still gates auto-connect on a fresh install: scanning
 * asks for Bluetooth permission, and a first launch should not open with a
 * dialog about hardware the person may not own.
 */
async function rememberBoard(next: XiaoBleConnection) {
  await Promise.all([
    writeBooleanPreference(preferenceKeys.xiaoEverConnected, true),
    writePreference(preferenceKeys.xiaoDeviceId, next.deviceId),
    writePreference(preferenceKeys.xiaoDeviceName, next.deviceName),
  ]);
}

async function openConnection(mode: "manual" | "auto"): Promise<boolean> {
  if (!supported) {
    useXiaoConnection.setState({
      error: "XIAO BLE needs the native development build.",
    });
    return false;
  }

  wantConnection = true;
  clearReconnectTimer();
  ensureWatches();

  if (mode === "manual") {
    reconnectAttempt = 0;
  }

  // Two screens can ask at once — the ride screen on mount and an auto-connect
  // on launch. Scanning twice finds the same board and leaves one of the two
  // links orphaned, so the second caller waits for the first.
  if (connecting) {
    return connecting;
  }

  if (connection) {
    if (await connection.isAlive()) {
      markConnected(connection);
      return true;
    }

    handleLinkDown(null);
    // `handleLinkDown` queues recovery, which this call is about to be.
    clearReconnectTimer();
  }

  const { deviceId, deviceName } = useXiaoConnection.getState();

  useXiaoConnection.setState({
    status: mode === "auto" ? "reconnecting" : "connecting",
    detail: deviceId
      ? `Reconnecting to ${deviceName ?? XIAO_BLE_DEVICE_NAME}...`
      : `Searching for ${XIAO_BLE_DEVICE_NAME}...`,
    error: null,
    attempting: true,
  });

  connecting = (async () => {
    try {
      const next = await XiaoBle.connectToXiao({
        deviceId,
        mode,
        onSample: fanOutSample,
        onDisconnect: () => handleLinkDown(null),
      });

      // The rider pressed Disconnect while this attempt was in the radio.
      if (!wantConnection) {
        logBle({ kind: "connect", phase: "abandoned", mode, path: null });
        await next.disconnect().catch(() => undefined);
        return false;
      }

      connection = next;
      markConnected(next);
      void rememberBoard(next);

      // The board can drop between `connectToXiao` resolving and this line —
      // a sensor switched off the instant it pairs, a link the OS refuses to
      // keep. Its disconnect callback would have fired against a store that
      // had not yet been told there was a link, found nothing to take down,
      // and left "connected" standing over nothing. One question to the radio
      // closes that window.
      if (!(await next.isAlive())) {
        handleLinkDown(null);
        return false;
      }

      if (desiredSampleIntervalMs !== null) {
        await next.setSampleInterval(desiredSampleIntervalMs).catch(() => undefined);
      }

      return true;
    } catch (error) {
      connection = null;

      const message =
        error instanceof Error ? error.message : "Unable to connect to the XIAO.";

      useXiaoConnection.setState({
        status: "disconnected",
        detail: message,
        error: message,
      });

      return false;
    } finally {
      connecting = null;
      useXiaoConnection.setState({ attempting: false });
    }
  })();

  const connected = await connecting;

  // Only a board this phone has met before is chased. A first pairing that
  // failed is reported and left alone: the rider is looking at the screen, and
  // a scan loop for hardware that may not be switched on is a battery bill
  // with nothing to show for it.
  if (!connected) {
    scheduleReconnect();
  }

  return connected;
}

/**
 * Ask the radio, not the store, whether the link is up.
 *
 * Used by the rider's own "check" action, by every foreground, and before any
 * request to the board.
 */
async function verifyLink(): Promise<boolean> {
  if (!supported) {
    return false;
  }

  const current = connection;
  const startedAt = Date.now();

  if (current && (await current.isAlive())) {
    logBle({ kind: "verify", alive: true, ms: Date.now() - startedAt });
    markConnected(current);
    return true;
  }

  if (current || useXiaoConnection.getState().status === "connected") {
    logBle({ kind: "verify", alive: false, ms: Date.now() - startedAt });
    handleLinkDown("The sensor is not answering.");
  }

  return false;
}

function handleForeground() {
  if (!supported) {
    return;
  }

  if (connection || useXiaoConnection.getState().status === "connected") {
    void verifyLink();
    return;
  }

  // Parked recovery starts over on the assumption that being away is exactly
  // when the rider switched the board back on.
  if (shouldReconnect() && !connecting) {
    resetReconnect();
    void openConnection("auto");
  }
}

/**
 * Start the two long-lived watches.
 *
 * Called from the first connect and from the launch restore, never at import:
 * `new BleManager()` starts the native BLE stack, and a phone whose owner has
 * no sensor should never be asked to.
 */
function ensureWatches() {
  if (!supported) {
    return;
  }

  if (!appStateSubscription) {
    appStateSubscription = AppState.addEventListener(
      "change",
      (next: AppStateStatus) => {
        appActive = next === "active";

        logBle({ kind: "app", state: next });

        // A backgrounded app is where a log is most likely to be lost: iOS can
        // reclaim the process without warning, and anything still queued in
        // memory goes with it. This is the last reliable moment to write.
        if (!appActive) {
          flushAppLog();
        }

        if (appActive) {
          handleForeground();
        }
      }
    );
  }

  if (!stopRadioWatch) {
    stopRadioWatch = XiaoBle.subscribeToRadioState((state) => {
      const wasReady = radioReady;
      radioReady = state.ready;

      logBle({ kind: "radio", ready: state.ready, message: state.message });

      useXiaoConnection.setState({ radioMessage: state.message });

      if (!state.ready) {
        // A radio that is off has already taken the link with it, whether or
        // not a disconnect callback arrives. `shouldReconnect` is false while
        // it is off, so this reports the loss without starting a retry loop
        // that could not succeed.
        clearReconnectTimer();
        handleLinkDown(state.message);

        // A loop that was already running has just become pointless. Saying
        // why beats a "trying again" that cannot try.
        if (state.message && useXiaoConnection.getState().status === "reconnecting") {
          useXiaoConnection.setState({
            status: "disconnected",
            detail: state.message,
          });
        }

        return;
      }

      if (!wasReady && !connection && shouldReconnect() && !connecting) {
        resetReconnect();
        void openConnection("auto");
      }
    });
  }
}

/**
 * The live connection, for callers that need the board's own protocol.
 *
 * Synchronous and unverified: use it for a poll that runs every second and can
 * simply fail, and `requireXiaoConnection` for anything a rider pressed.
 */
export function getXiaoConnection() {
  return connection;
}

/**
 * The live connection, once the radio has confirmed it is still there.
 *
 * Anything a rider initiated should come through here. The alternative is the
 * failure this module exists to remove: a tile that says the board is
 * connected sitting above a button that answers with a BLE error.
 */
export async function requireXiaoConnection(): Promise<XiaoBleConnection | null> {
  return (await verifyLink()) ? connection : null;
}

export function isXiaoSupported() {
  return supported;
}

/** Listen to the live IMU stream. Returns the unsubscribe. */
export function subscribeToXiaoSamples(listener: XiaoSampleListener) {
  sampleListeners.add(listener);

  return () => {
    sampleListeners.delete(listener);
  };
}

/**
 * Set how often the board streams while a ride is being recorded.
 *
 * Left alone the board streams at its own default, which is more than a route
 * needs and costs battery on both ends. The rate is remembered and re-applied
 * to every link made afterwards, because a board that reconnects mid-ride
 * comes back at its own default and would otherwise quietly change what the
 * rest of the route was measured at.
 */
export async function setXiaoSampleInterval(intervalMs: number) {
  desiredSampleIntervalMs = intervalMs;

  await connection?.setSampleInterval(intervalMs).catch(() => undefined);
}

/** Let the board go back to its own rate once no ride needs a fixed one. */
export function clearXiaoSampleInterval() {
  desiredSampleIntervalMs = null;
}

/**
 * Restore what was remembered about the board and act on it.
 *
 * Called once from the app root. A rider who has clipped the sensor to their
 * board should not have to tell the app about it again every launch, but the
 * attempt is silent: a failure leaves the screen showing "not connected",
 * which is the honest and already-designed state.
 */
export async function restoreXiaoAutoConnect() {
  const [autoConnect, everConnected, deviceId, deviceName] = await Promise.all([
    readBooleanPreference(preferenceKeys.autoConnectXiao, true),
    readBooleanPreference(preferenceKeys.xiaoEverConnected, false),
    readPreference(preferenceKeys.xiaoDeviceId),
    readPreference(preferenceKeys.xiaoDeviceName),
  ]);

  useXiaoConnection.setState({ autoConnect, deviceId, deviceName });

  if (!supported || !everConnected) {
    return;
  }

  // The watches run from launch once a board has been paired here, so the
  // sensor sheet can say "Bluetooth is off" before anyone taps Connect, and so
  // switching Bluetooth on is enough to bring the board back.
  ensureWatches();

  if (!autoConnect) {
    return;
  }

  wantConnection = true;
  await openConnection("auto");
}
