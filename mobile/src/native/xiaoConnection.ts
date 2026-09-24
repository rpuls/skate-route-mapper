import { create } from "zustand";
import {
  XIAO_BLE_DEVICE_NAME,
  type XiaoImuPacket,
} from "@skate-route-mapper/shared/xiaoBle";
import {
  preferenceKeys,
  readBooleanPreference,
  writeBooleanPreference,
} from "../storage/preferences";
import * as XiaoBle from "./XiaoBle";
import type { XiaoBleConnection } from "./XiaoBle";

/**
 * One XIAO connection for the whole app.
 *
 * Both the ride screen and the research lab talk to the same board, and both
 * used to own a private `useRef` connection that they tore down on blur. That
 * made "connected" a property of whichever screen you were looking at: opening
 * the research lab from a ride dropped the link and asked you to pair again,
 * and the lab could never show a board that was already in your hand.
 *
 * A BLE link is a property of the phone, not of a React tree, so it lives at
 * module scope. Screens read the status and ask for a connect or a disconnect;
 * nothing unmounts the radio.
 */

export type XiaoStatus =
  | "unsupported"
  | "disconnected"
  | "connecting"
  | "connected";

export type XiaoSampleListener = (sample: XiaoImuPacket) => void;

type XiaoConnectionState = {
  status: XiaoStatus;
  deviceName: string | null;
  /** Plain-language detail for whatever the status currently is. */
  detail: string;
  /** Set when a connect attempt failed, cleared when one is started. */
  error: string | null;
  autoConnect: boolean;
  connect: () => Promise<boolean>;
  disconnect: () => Promise<void>;
  setAutoConnect: (enabled: boolean) => void;
};

let connection: XiaoBleConnection | null = null;
let connecting: Promise<boolean> | null = null;
const sampleListeners = new Set<XiaoSampleListener>();

const supported = XiaoBle.isXiaoBleSupported();

function fanOutSample(sample: XiaoImuPacket) {
  sampleListeners.forEach((listener) => listener(sample));
}

export const useXiaoConnection = create<XiaoConnectionState>((set, get) => ({
  status: supported ? "disconnected" : "unsupported",
  deviceName: null,
  detail: supported
    ? "Not connected"
    : "Needs the native development build; unavailable on web and in Expo Go.",
  error: null,
  autoConnect: true,

  connect: async () => {
    if (!supported) {
      set({ error: "XIAO BLE needs the native development build." });
      return false;
    }

    if (get().status === "connected" && connection) {
      return true;
    }

    // Two screens can ask at once — the ride screen on mount and an
    // auto-connect on launch. Scanning twice finds the same board and leaves
    // one of the two links orphaned, so the second caller waits for the first.
    if (connecting) {
      return connecting;
    }

    set({
      status: "connecting",
      detail: `Searching for ${XIAO_BLE_DEVICE_NAME}...`,
      error: null,
    });

    connecting = (async () => {
      try {
        const next = await XiaoBle.connectToXiao({ onSample: fanOutSample });

        connection = next;
        void writeBooleanPreference(preferenceKeys.xiaoEverConnected, true);
        set({
          status: "connected",
          deviceName: next.deviceName,
          detail: `${next.deviceName} connected`,
          error: null,
        });

        return true;
      } catch (error) {
        connection = null;
        const message =
          error instanceof Error ? error.message : "Unable to connect to the XIAO.";

        set({
          status: "disconnected",
          deviceName: null,
          detail: "Not connected",
          error: message,
        });

        return false;
      } finally {
        connecting = null;
      }
    })();

    return connecting;
  },

  disconnect: async () => {
    const current = connection;
    connection = null;

    set({
      status: supported ? "disconnected" : "unsupported",
      deviceName: null,
      detail: supported ? "Not connected" : get().detail,
      error: null,
    });

    await current?.disconnect().catch(() => undefined);
  },

  setAutoConnect: (enabled) => {
    set({ autoConnect: enabled });
    void writeBooleanPreference(preferenceKeys.autoConnectXiao, enabled);
  },
}));

/**
 * The live connection, for callers that need the board's own protocol.
 *
 * Research capture control and page transfer are conversations with the
 * firmware rather than app state, so they go straight to the connection object
 * instead of being mirrored into the store.
 */
export function getXiaoConnection() {
  return connection;
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
 * needs and costs battery on both ends.
 */
export async function setXiaoSampleInterval(intervalMs: number) {
  await connection?.setSampleInterval(intervalMs).catch(() => undefined);
}

/**
 * Restore the auto-connect preference and act on it.
 *
 * Called once from the app root. A rider who has clipped the sensor to their
 * board should not have to tell the app about it again every launch, but the
 * attempt is silent: a failure leaves the screen showing "not connected",
 * which is the honest and already-designed state.
 *
 * It only runs once a board has actually been paired here. Scanning asks for
 * Bluetooth permission, and a first launch that opens with a dialog about
 * hardware the person may not own is a worse greeting than one tap later.
 */
export async function restoreXiaoAutoConnect() {
  const [autoConnect, everConnected] = await Promise.all([
    readBooleanPreference(preferenceKeys.autoConnectXiao, true),
    readBooleanPreference(preferenceKeys.xiaoEverConnected, false),
  ]);

  useXiaoConnection.setState({ autoConnect });

  if (autoConnect && everConnected && supported) {
    await useXiaoConnection.getState().connect();
  }
}
