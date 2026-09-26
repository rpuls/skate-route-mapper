import { NativeModules, PermissionsAndroid, Platform } from "react-native";
import {
  BleManager,
  State,
  type Device,
  type Subscription,
} from "react-native-ble-plx";
import {
  XIAO_BLE_CONFIG_CHARACTERISTIC_UUID,
  XIAO_BLE_DEVICE_NAME,
  XIAO_BLE_IMU_CHARACTERISTIC_UUID,
  XIAO_BLE_SERVICE_UUID,
  parseXiaoImuPacket,
  type XiaoImuPacket,
} from "@skate-route-mapper/shared/xiaoBle";
import {
  OP,
  parseStatus,
  startArgument,
  type ResearchStatus,
} from "@skate-route-mapper/shared/xiaoResearch";
import {
  imuStreamKind,
  parseStreamFrame,
  STREAM_ID,
  XIAO_STREAM_DATA_UUID,
  type StreamResponse,
} from "@skate-route-mapper/shared/xiaoStream";
import { describeBleError, logBle } from "../diagnostics/log";
import { base64ToBytes, bytesToBase64 } from "./stream/base64";
import {
  createCommandChannel,
  type CommandAttemptEvent,
  type CommandChannel,
} from "./stream/commandChannel";
import {
  createStreamReader,
  type StreamReader,
  type StreamReaderOptions,
} from "./stream/streamReader";

/**
 * True while a research retrieval is running.
 *
 * Read by the RSSI sampler in `xiaoConnection`, which stands down for the
 * duration. A retrieval is hundreds of request/response round trips and its
 * wall-clock time is the number every capture so far has been scored by, so
 * slipping an extra GATT operation into the middle of it would make the next
 * ride's figures incomparable with the ones already uploaded.
 */
let transferBusy = false;

export function isXiaoTransferBusy() {
  return transferBusy;
}

export type ResearchTransfer = {
  captureId: number;
  raw: Uint8Array;
  summaries: Uint8Array;
  rawReceived: number;
  summariesReceived: number;
  transferMs: number;
};

export type XiaoBleConnection = {
  deviceId: string;
  deviceName: string;
  /**
   * Ask the radio whether this link is still up.
   *
   * A `XiaoBleConnection` is a JavaScript object and stays perfectly usable
   * after the board it refers to has gone: turning the sensor off does not
   * reach in and delete it. Anything that is about to talk to the board should
   * ask first, because the alternative is a screen that says "connected" while
   * every request fails.
   */
  isAlive: () => Promise<boolean>;
  /**
   * The signal strength of the last packet the phone heard from this board.
   *
   * Local to the phone's controller rather than a round trip to the board, so
   * it costs almost nothing, and it is the one measurement that separates a
   * link starved of signal from one dropped for some other reason. A link that
   * dies at -95 dBm was out of range; one that dies at -60 dBm was not, and
   * the antenna is not what needs changing.
   */
  readRssi: () => Promise<number | null>;
  /** What ATT_MTU the link settled on. On iOS this is negotiated for us. */
  mtu: number;
  disconnect: () => Promise<void>;
  setSampleInterval: (intervalMs: number) => Promise<void>;
  getResearchStatus: () => Promise<ResearchStatus>;
  startResearchCapture: (seconds: 10 | 30 | 60, rateHz: 833 | 1666) => Promise<ResearchStatus>;
  retrieveResearchCapture: (
    status: ResearchStatus,
    transfer: ResearchTransfer,
    onProgress?: (received: number, total: number) => void
  ) => Promise<ResearchTransfer>;
  /**
   * Read one of the board's streams.
   *
   * The only way anything in the app should take continuous or bulk data off
   * the board. The reader handles ordering, repair and loss reporting; the
   * caller supplies a `StreamKind` saying what the records mean and a function
   * that stores them. A new sort of board data needs nothing added here.
   */
  readStream: <TRecord>(
    options: Omit<StreamReaderOptions<TRecord>, "channel">
  ) => StreamReader;
};

type ConnectOptions = {
  timeoutMs?: number;
  /**
   * A board this phone has linked to before, connected to by id rather than
   * found by scanning. Falls back to a scan when the id is stale or the board
   * is not where it was left.
   */
  deviceId?: string | null;
  /**
   * Whether a rider asked for this link or recovery did.
   *
   * Carried only so the log can tell them apart. A run of automatic attempts
   * reads as a link that keeps failing; the same count of manual ones reads as
   * a rider who kept pressing the button, and those are different problems.
   */
  mode?: "manual" | "auto";
  onSample?: (sample: XiaoImuPacket) => void;
  /**
   * The link went down on its own: out of range, board switched off, radio
   * turned off, GATT dropped by the OS. Called at most once, and never for a
   * `disconnect()` the app asked for.
   */
  onDisconnect?: (reason: string | null) => void;
};

let manager: BleManager | null = null;

function hasNativeBleModule() {
  return NativeModules.BlePlx != null;
}

function getManager() {
  if (!hasNativeBleModule()) {
    throw new Error(
      "XIAO BLE requires a development/native build with react-native-ble-plx included. Expo Go cannot connect to BLE sensors."
    );
  }

  if (!manager) {
    manager = new BleManager();
  }

  return manager;
}

export function isXiaoBleSupported() {
  return (Platform.OS === "android" || Platform.OS === "ios") && hasNativeBleModule();
}

export async function requestXiaoBlePermissions() {
  if (Platform.OS !== "android") {
    return true;
  }

  if (Number(Platform.Version) >= 31) {
    const results = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    ]);

    return (
      results[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] ===
        PermissionsAndroid.RESULTS.GRANTED &&
      results[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] ===
        PermissionsAndroid.RESULTS.GRANTED
    );
  }

  const result = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
  );

  return result === PermissionsAndroid.RESULTS.GRANTED;
}

/**
 * What a radio state that is not `PoweredOn` should tell the rider.
 *
 * These are the states that will not fix themselves, so each one ends the
 * attempt with something actionable rather than leaving it to time out.
 * `Unknown` and `Resetting` are deliberately absent: both are transient, so
 * they are waited out rather than reported. See `waitForPoweredOnAdapter`.
 */
const adapterStateMessages: Partial<Record<State, string>> = {
  [State.PoweredOff]: "Bluetooth is off. Turn it on and try again.",
  [State.Unauthorized]:
    "Skate Route Mapper is not allowed to use Bluetooth. Enable it in Settings.",
  [State.Unsupported]: "This device has no Bluetooth LE radio.",
};

/**
 * Wait for the radio before scanning.
 *
 * `new BleManager()` returns before the native adapter has reported anything,
 * so its state starts as `Unknown` and a scan started in that window is
 * rejected outright with "BluetoothLE is in unknown state". That is why the
 * first tap on Connect used to fail and the second one worked: by then the
 * adapter had powered on by itself.
 *
 * `Unknown` is a not-yet, not a no, so it is waited out rather than reported.
 * On iOS it is also the state while the system Bluetooth permission dialog is
 * open, which is why the wait is generous — the rider may be reading it.
 */
async function waitForPoweredOnAdapter(manager: BleManager, timeoutMs = 10000) {
  if ((await manager.state()) === State.PoweredOn) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    let subscription: Subscription | null = null;
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      subscription?.remove();
      if (error) reject(error);
      else resolve();
    };

    const timer = setTimeout(
      () => finish(new Error("Bluetooth did not become ready. Try again.")),
      timeoutMs
    );

    // `true` re-emits the current state, closing the gap between the check
    // above and this subscription: a radio that powered on in between would
    // otherwise be waited on for a change that had already happened.
    subscription = manager.onStateChange((next) => {
      if (next === State.PoweredOn) {
        finish();
        return;
      }

      const message = adapterStateMessages[next];

      if (message) {
        finish(new Error(message));
      }
    }, true);
  });
}

/**
 * Watch the radio itself, not a particular link.
 *
 * The adapter has opinions that outlive any one connection: Bluetooth being
 * switched off takes every link with it, and no amount of retrying helps until
 * it comes back. A caller that knows the radio state can say "Bluetooth is
 * off" instead of "could not find the sensor", and can retry at the one moment
 * worth retrying at.
 *
 * `Unknown` and `Resetting` report as not-ready with no message: they are a
 * not-yet rather than a no, and putting them on screen would flash a scary
 * sentence during normal start-up.
 */
export type XiaoRadioState = {
  ready: boolean;
  message: string | null;
};

export function subscribeToRadioState(
  listener: (state: XiaoRadioState) => void
): () => void {
  if (!isXiaoBleSupported()) {
    listener({ ready: false, message: null });
    return () => undefined;
  }

  // `true` re-emits the current state, so a caller never has to ask separately
  // where the radio is right now.
  const subscription = getManager().onStateChange((next) => {
    listener({
      ready: next === State.PoweredOn,
      message: adapterStateMessages[next] ?? null,
    });
  }, true);

  return () => subscription.remove();
}

/**
 * Find the board by listening for its advertisement.
 *
 * Only used when the id is unknown or stale. A scan is the slow path: it costs
 * up to `timeoutMs` and keeps the radio busy for the whole of it.
 */
function scanForXiao(bleManager: BleManager, timeoutMs: number): Promise<Device> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (error: Error | null, device?: Device) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      bleManager.stopDeviceScan();
      if (error) reject(error);
      else resolve(device as Device);
    };

    const timeout = setTimeout(
      () => finish(new Error(`Could not find ${XIAO_BLE_DEVICE_NAME}.`)),
      timeoutMs
    );

    bleManager.startDeviceScan(
      [XIAO_BLE_SERVICE_UUID],
      { allowDuplicates: false },
      (error, device) => {
        if (error) {
          finish(error);
          return;
        }

        if (!device) {
          return;
        }

        const names = [device.name, device.localName].filter(Boolean).join(" ");
        const advertisedServiceUuids = device.serviceUUIDs ?? [];
        const isXiao =
          names.includes("XIAO") ||
          names.includes("Skate") ||
          advertisedServiceUuids.some(
            (uuid) => uuid.toLowerCase() === XIAO_BLE_SERVICE_UUID
          );

        if (isXiao) {
          finish(null, device);
        }
      }
    );
  });
}

/**
 * Turn a connected device into the board's protocol.
 *
 * Both routes in — the id that was remembered and the scan it falls back to —
 * end here, so service discovery, the MTU bump, the sample stream and the
 * disconnect watch are set up once rather than once per route.
 */
async function attachToDevice(
  bleManager: BleManager,
  connectedDevice: Device,
  options: ConnectOptions
): Promise<XiaoBleConnection> {
  let readyDevice = await connectedDevice.discoverAllServicesAndCharacteristics();

  if (Platform.OS === "android") {
    try {
      readyDevice = await readyDevice.requestMTU(517);
    } catch {
      // The protocol also works with a smaller negotiated MTU, using more pages.
    }
  }

  // One channel per connection. The board answers on a single characteristic,
  // so a research transfer and a ride repair running at once would read each
  // other's answers; the channel makes them take turns.
  const channel: CommandChannel = createCommandChannel(readyDevice, {
    onAttempt: logStreamRequest,
  });

  /**
   * A research request, in the shape the capture code already expects.
   *
   * The retry loop, the response polling and the framing all moved to the
   * channel, which every stream shares. What is left is the part specific to a
   * capture: that a page must belong to the capture it was asked for.
   */
  const researchRequest = async (op: number, captureId = 0, arg = 0) => {
    const response = await channel.request({
      op,
      streamId: captureId,
      arg,
      // START changes what the board is doing. A retry after a timeout could
      // begin a second capture over the one already running.
      attempts: op === OP.START ? 1 : 3,
    });

    if (
      (op === OP.RAW || op === OP.SUMMARIES) &&
      (response.streamId !== captureId || response.offset !== arg)
    ) {
      throw new Error("Research page identity mismatch");
    }

    return asResearchResponse(response);
  };

  const sampleSubscription = readyDevice.monitorCharacteristicForService(
    XIAO_BLE_SERVICE_UUID,
    XIAO_BLE_IMU_CHARACTERISTIC_UUID,
    (error, characteristic) => {
      if (error) {
        logBle({ kind: "streamError", error: describeBleError(error) });
        return;
      }

      if (!characteristic?.value || !options.onSample) {
        return;
      }

      options.onSample(parseXiaoImuPacket(base64ToBytes(characteristic.value)));
    }
  );

  const readers = new Set<StreamReader>();

  /**
   * Framed records from the board.
   *
   * Subscribing here is also what tells the board to use the stream path: it
   * serves the original IMU characteristic while nobody is listening to this
   * one, so a board running older firmware, and the admin hardware bench, are
   * unaffected. If this characteristic does not exist the monitor reports an
   * error once and the legacy subscription above carries on alone.
   */
  const frameSubscription = readyDevice.monitorCharacteristicForService(
    XIAO_BLE_SERVICE_UUID,
    XIAO_STREAM_DATA_UUID,
    (error, characteristic) => {
      if (error) {
        logBle({ kind: "note", text: `stream frames unavailable: ${error.message}` });
        return;
      }

      if (!characteristic?.value) {
        return;
      }

      const frame = parseStreamFrame(base64ToBytes(characteristic.value));

      if (!frame) {
        return;
      }

      for (const reader of readers) {
        reader.offerFrame(frame);
      }

      // The live preview reads the same records, so a screen showing the board
      // works the same whichever path the firmware is using.
      if (options.onSample && frame.streamId === STREAM_ID.RIDE_IMU) {
        options.onSample(imuStreamKind.decode(frame.record, frame.seq));
      }
    }
  );

  // `closed` is what tells a deliberate disconnect apart from a board that
  // vanished. Both arrive as the same native callback, and only one of them
  // should send the app looking for the sensor again.
  let closed = false;
  let disconnectSubscription: Subscription | null = null;
  const linkOpenedAt = Date.now();

  const teardown = () => {
    closed = true;
    disconnectSubscription?.remove();
    disconnectSubscription = null;
    sampleSubscription.remove();
    frameSubscription.remove();

    // A reader left running would keep polling a device that has gone.
    for (const reader of readers) {
      reader.stop();
    }

    readers.clear();
  };

  disconnectSubscription = readyDevice.onDisconnected((error) => {
    if (closed) {
      return;
    }

    teardown();

    // The whole error, not the sentence it prints. `iosErrorCode` is what
    // separates the supervision timer expiring — the phone stopped hearing the
    // board — from the board ending the link itself, and the two point at
    // completely different fixes.
    logBle({
      kind: "down",
      upMs: Date.now() - linkOpenedAt,
      error: error ? describeBleError(error) : null,
    });

    options.onDisconnect?.(error ? error.message : null);
  });

  return {
    deviceId: readyDevice.id,
    deviceName: readyDevice.name ?? readyDevice.localName ?? XIAO_BLE_DEVICE_NAME,
    mtu: readyDevice.mtu,
    readRssi: async () => {
      try {
        return (await readyDevice.readRSSI()).rssi;
      } catch (error) {
        logBle({ kind: "rssiFail", error: describeBleError(error) });
        return null;
      }
    },
    isAlive: () =>
      bleManager.isDeviceConnected(readyDevice.id).catch(() => false),
    readStream: (readerOptions) => {
      const reader = createStreamReader({ ...readerOptions, channel });
      const stop = reader.stop;

      readers.add(reader);

      return {
        ...reader,
        stop: () => {
          readers.delete(reader);
          stop();
        },
      };
    },
    disconnect: async () => {
      teardown();
      await bleManager.cancelDeviceConnection(readyDevice.id).catch(() => undefined);
    },
    setSampleInterval: async (intervalMs: number) => {
      await readyDevice.writeCharacteristicWithResponseForService(
        XIAO_BLE_SERVICE_UUID,
        XIAO_BLE_CONFIG_CHARACTERISTIC_UUID,
        uint16ToBase64(intervalMs)
      );
    },
    getResearchStatus: async () => parseStatus(await researchRequest(OP.STATUS)),
    startResearchCapture: async (seconds, rateHz) =>
      parseStatus(await researchRequest(OP.START, 0, startArgument(seconds, rateHz))),
    retrieveResearchCapture: async (status, transfer, onProgress) => {
      if (transfer.captureId !== status.captureId) {
        throw new Error("The partial transfer belongs to another capture.");
      }
      const total = status.count * status.rawStride + status.windows * 24;
      const notify = () => onProgress?.(
        transfer.rawReceived * status.rawStride + transfer.summariesReceived * 24,
        total
      );

      const attemptStartedAt = Date.now();
      const pagesRemaining =
        Math.ceil((status.count - transfer.rawReceived) / 64) +
        Math.ceil((status.windows - transfer.summariesReceived) / 16);

      transferBusy = true;
      logBle({
        kind: "transfer",
        phase: "start",
        captureId: status.captureId,
        pages: pagesRemaining,
      });

      try {
        while (transfer.rawReceived < status.count) {
          const response = await researchRequest(OP.RAW, status.captureId, transfer.rawReceived);
          if (!response.count || response.payload.length !== response.count * status.rawStride ||
              transfer.rawReceived + response.count > status.count) {
            throw new Error("Invalid raw research page");
          }
          transfer.raw.set(response.payload, transfer.rawReceived * status.rawStride);
          transfer.rawReceived += response.count;
          notify();
        }
        while (transfer.summariesReceived < status.windows) {
          const response = await researchRequest(OP.SUMMARIES, status.captureId, transfer.summariesReceived);
          if (!response.count || response.payload.length !== response.count * 24 ||
              transfer.summariesReceived + response.count > status.windows) {
            throw new Error("Invalid summary research page");
          }
          transfer.summaries.set(response.payload, transfer.summariesReceived * 24);
          transfer.summariesReceived += response.count;
          notify();
        }
        logBle({
          kind: "transfer",
          phase: "end",
          captureId: status.captureId,
          pages: pagesRemaining,
          ms: Date.now() - attemptStartedAt,
          ok: true,
        });
        return transfer;
      } catch (error) {
        // A retrieval that gave up part way is the event worth having: it says
        // how far it got before the link failed, which a completed transfer
        // never can.
        logBle({
          kind: "transfer",
          phase: "end",
          captureId: status.captureId,
          pages:
            pagesRemaining -
            Math.ceil((status.count - transfer.rawReceived) / 64) -
            Math.ceil((status.windows - transfer.summariesReceived) / 16),
          ms: Date.now() - attemptStartedAt,
          ok: false,
          error: describeBleError(error),
        });
        throw error;
      } finally {
        transferBusy = false;
        transfer.transferMs += Date.now() - attemptStartedAt;
      }
    },
  };
}

export async function connectToXiao(
  options: ConnectOptions = {}
): Promise<XiaoBleConnection> {
  const startedAt = Date.now();
  const canScan = await requestXiaoBlePermissions();

  if (!canScan) {
    throw new Error("Bluetooth permission was not granted.");
  }

  const bleManager = getManager();

  await waitForPoweredOnAdapter(bleManager);

  // Timed from here rather than from the top of the call. Waiting for the
  // adapter can legitimately take ten seconds on a cold start or while the
  // rider reads a permission dialog, and folding that into the connect time
  // would make every first attempt of a session look like a struggling link.
  const attemptStartedAt = Date.now();
  const sinceAttempt = () => Date.now() - attemptStartedAt;

  logBle({
    kind: "note",
    text: `radio ready after ${attemptStartedAt - startedAt} ms`,
  });

  const timeoutMs = options.timeoutMs ?? 15000;

  // The board this phone last rode with is tried by id first. It is the
  // overwhelmingly common case — the sensor stays clipped to the deck — and it
  // comes back in about a second instead of waiting out a scan. A stale id (a
  // reinstall renumbers every peripheral on iOS) or a board that is genuinely
  // elsewhere falls through to the scan below.
  if (options.deviceId) {
    // Which of the two routes a link came in by, and how long it took, is the
    // difference between "the board was where we left it" and "we had to go
    // looking". A run of scans where ids used to work is itself a symptom.
    logBle({
      kind: "connect",
      phase: "start",
      mode: options.mode ?? "manual",
      path: "id",
      deviceId: options.deviceId,
    });

    const known = await bleManager
      .connectToDevice(options.deviceId, {
        autoConnect: false,
        timeout: Math.min(timeoutMs, 8000),
      })
      .catch((error: unknown) => {
        logBle({
          kind: "connect",
          phase: "fail",
          mode: options.mode ?? "manual",
          path: "id",
          ms: sinceAttempt(),
          deviceId: options.deviceId,
          error: describeBleError(error),
        });

        return null;
      });

    if (known) {
      try {
        return logAttached(
          await attachToDevice(bleManager, known, options),
          options,
          "id",
          attemptStartedAt
        );
      } catch (error) {
        // Connected, then failed to become usable: service discovery, the
        // notification subscription. Logged so the id path never leaves a
        // "start" line with nothing after it, and rethrown because that is
        // what this function did before.
        logBle({
          kind: "connect",
          phase: "fail",
          mode: options.mode ?? "manual",
          path: "id",
          ms: sinceAttempt(),
          deviceId: options.deviceId,
          error: describeBleError(error),
        });

        throw error;
      }
    }
  }

  logBle({
    kind: "connect",
    phase: "start",
    mode: options.mode ?? "manual",
    path: "scan",
    deviceId: options.deviceId ?? null,
  });

  try {
    const found = await scanForXiao(bleManager, timeoutMs);
    const connected = await found.connect({ autoConnect: false });

    return logAttached(
      await attachToDevice(bleManager, connected, options),
      options,
      "scan",
      attemptStartedAt
    );
  } catch (error) {
    logBle({
      kind: "connect",
      phase: "fail",
      mode: options.mode ?? "manual",
      path: "scan",
      ms: sinceAttempt(),
      error: describeBleError(error),
    });

    throw error;
  }
}

/**
 * Note a link that came up, and what it came up as.
 *
 * `mtu` is the detail worth having on the first line of a session: iOS
 * negotiates it without being asked, and a 408-byte research response needs
 * more ATT round trips below 185 than above it. A slow retrieval with a small
 * MTU is arithmetic; a slow retrieval with a large one is a link problem.
 */
function logAttached(
  connection: XiaoBleConnection,
  options: ConnectOptions,
  path: "id" | "scan",
  startedAt: number
) {
  logBle({
    kind: "connect",
    phase: "ok",
    mode: options.mode ?? "manual",
    path,
    ms: Date.now() - startedAt,
    deviceId: connection.deviceId,
    deviceName: connection.deviceName,
    mtu: connection.mtu,
  });

  return connection;
}

/**
 * A request that took longer than this is worth a line of its own.
 *
 * The fastest retrieval on record averaged about 190 ms a page, so this is a
 * little over twice the good case: fast enough to catch a link that is
 * struggling, slow enough not to call the normal case an anomaly.
 */
const slowRequestMs = 400;

/** One in this many ordinary requests is kept, to establish what normal is. */
const requestSampleEvery = 32;

let streamRequestCount = 0;

/**
 * Record a board request, thinned so a transfer does not drown the log.
 *
 * A 30-second capture is around 790 pages, and a ride repairs holes for as
 * long as the ride lasts. Writing every one would cost about 100 kB per
 * capture and re-render anything watching the log several times a second, and
 * most of those lines would say the same thing. Every failure is kept, every
 * slow request is kept, and one in `requestSampleEvery` of the rest is kept so
 * the ordinary case still has a measured distribution rather than an assumed
 * one.
 */
function logStreamRequest(event: CommandAttemptEvent) {
  streamRequestCount += 1;

  if (
    event.ok &&
    event.ms < slowRequestMs &&
    streamRequestCount % requestSampleEvery !== 0
  ) {
    return;
  }

  logBle({
    kind: "req",
    op: event.op,
    attempt: event.attempt,
    ms: event.ms,
    polls: event.polls,
    ok: event.ok,
    ...(event.streamId === 0 ? {} : { streamId: event.streamId }),
    ...(event.flags === undefined || event.flags === 0 ? {} : { flags: event.flags }),
    ...(event.error === undefined ? {} : { error: describeBleError(event.error) }),
  });
}

/**
 * The stream response in the shape the research capture code reads.
 *
 * The two differ only in what the fields are called: a capture id is a stream
 * id, and a record count is a page count. Adapting here keeps one wire format
 * without rewriting the capture and upload path around new names.
 */
function asResearchResponse(response: StreamResponse) {
  return {
    op: response.op,
    request: response.request,
    flags: response.flags,
    captureId: response.streamId,
    offset: response.offset,
    count: response.records,
    payload: response.payload,
  };
}

export function createResearchTransfer(status: ResearchStatus): ResearchTransfer {
  return {
    captureId: status.captureId,
    raw: new Uint8Array(status.count * status.rawStride),
    summaries: new Uint8Array(status.windows * 24),
    rawReceived: 0,
    summariesReceived: 0,
    transferMs: 0,
  };
}

/** The board's sample interval, as the two little-endian bytes it expects. */
function uint16ToBase64(value: number) {
  const clamped = Math.max(10, Math.min(1000, Math.round(value)));

  return bytesToBase64(new Uint8Array([clamped & 0xff, (clamped >> 8) & 0xff]));
}
