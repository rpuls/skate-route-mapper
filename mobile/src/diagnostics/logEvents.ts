/**
 * What a log entry is, and how to read one.
 *
 * Kept apart from the store so the native log and its web stand-in describe the
 * same thing, and so the vocabulary can be read on its own: this file is the
 * closest thing an exported log has to a schema.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Which part of the app an entry came from.
 *
 * A flat, short list on purpose. The point of a source is to let a reader
 * ignore two thirds of a file in one filter, and a taxonomy with twenty
 * branches does not do that better than one with five.
 */
export type LogSource = "app" | "ble" | "ride" | "sync" | "research";

/**
 * One line of the log, as written to disk.
 *
 * `event` is a short stable slug rather than a sentence, so entries of the same
 * kind can be counted and compared. Anything that varies goes in the remaining
 * fields, which are spread in flat rather than nested under a `data` key —
 * flat NDJSON is what greps and reads well.
 */
export type LogEntry = {
  t: number;
  level: LogLevel;
  source: LogSource;
  event: string;
  [field: string]: unknown;
};

export type BleErrorDetail = {
  message: string;
  errorCode: number | null;
  attErrorCode: number | null;
  iosErrorCode: number | null;
  androidErrorCode: number | null;
  reason: string | null;
  /** The iOS code said in words, when it is one we know. */
  meaning: string | null;
};

export type BleLogEvent =
  /** Written once per app launch, so a file can be read without the phone. */
  | { kind: "session"; platform: string; model: string | null; osVersion: string | null }
  | { kind: "radio"; ready: boolean; message: string | null }
  | { kind: "app"; state: string }
  | {
      kind: "connect";
      phase: "start" | "ok" | "fail" | "abandoned";
      mode: "manual" | "auto";
      /** Straight to a remembered id, or a scan for the advertisement. */
      path: "id" | "scan" | null;
      ms?: number;
      deviceId?: string | null;
      deviceName?: string | null;
      /** What ATT_MTU the link ended up with. iOS decides this, not us. */
      mtu?: number;
      error?: BleErrorDetail;
    }
  /** The link went down on its own. `upMs` is how long it had been up. */
  | { kind: "down"; upMs: number | null; error: BleErrorDetail | null }
  | { kind: "retry"; attempt: number; delayMs: number }
  | { kind: "verify"; alive: boolean; ms: number }
  | { kind: "rssi"; dbm: number }
  | { kind: "rssiFail"; error: BleErrorDetail }
  /** One research request, including the ones that had to be retried. */
  | {
      kind: "req";
      op: number;
      attempt: number;
      ms: number;
      /** Response reads issued before the board answered this request. */
      polls: number;
      ok: boolean;
      error?: BleErrorDetail;
    }
  /** A retrieval as a whole, so a transfer can be scored without arithmetic. */
  | {
      kind: "transfer";
      phase: "start" | "end";
      captureId: number;
      pages?: number;
      ms?: number;
      ok?: boolean;
      error?: BleErrorDetail;
    }
  /** The board's own counters, taken from a status read the app already did. */
  | {
      kind: "board";
      state: number;
      count: number;
      overruns: number;
      busErrors: number;
      clipped: number;
      freeHeap: number;
    }
  /** The live IMU stream stopped arriving for longer than it should have. */
  | { kind: "gap"; ms: number; lastSequence: number | null }
  /**
   * How the live stream is doing over a window.
   *
   * The board numbers every packet it sends, so comparing how far the sequence
   * moved with how many packets actually arrived measures notification loss
   * directly — which is the thing that quietly costs a ride its surface data
   * without ever showing up as a disconnect.
   */
  | {
      kind: "stream";
      windowMs: number;
      packets: number;
      sequenceAdvance: number;
      lostPercent: number;
    }
  | { kind: "streamError"; error: BleErrorDetail }
  /** Free text, so a screen can mark what the rider was doing. */
  | { kind: "note"; text: string };

/**
 * The iOS side of a `BleError`, in words.
 *
 * Two of these decide the question the BLE logging exists to answer, and they
 * are opposites. `ConnectionTimeout` is the supervision timer expiring: the
 * phone stopped hearing the board, which is range, body-blocking or
 * interference. `PeripheralDisconnected` is the board itself ending the link:
 * a reset, a brown-out, firmware. Both used to arrive as `error.message`,
 * which distinguishes neither.
 */
const iosErrorMeanings: Record<number, string> = {
  0: "Unknown",
  1: "InvalidParameters",
  2: "InvalidHandle",
  3: "NotConnected",
  4: "OutOfSpace",
  5: "OperationCancelled",
  6: "ConnectionTimeout (radio stopped hearing the board)",
  7: "PeripheralDisconnected (the board dropped the link)",
  8: "UuidNotAllowed",
  9: "AlreadyAdvertising",
  10: "ConnectionFailed",
  11: "ConnectionLimitReached",
  12: "UnknownDevice",
};

/**
 * Everything an error knows, not just the sentence it prints.
 *
 * Accepts `unknown` because the BLE path catches from several libraries, and a
 * logging call must never be the thing that throws.
 */
export function describeBleError(error: unknown): BleErrorDetail {
  const candidate = error as Record<string, unknown> | null;
  const numberOrNull = (value: unknown) =>
    typeof value === "number" ? value : null;
  const iosErrorCode = numberOrNull(candidate?.iosErrorCode);

  return {
    message:
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "Unknown error",
    errorCode: numberOrNull(candidate?.errorCode),
    attErrorCode: numberOrNull(candidate?.attErrorCode),
    iosErrorCode,
    androidErrorCode: numberOrNull(candidate?.androidErrorCode),
    reason: typeof candidate?.reason === "string" ? candidate.reason : null,
    meaning: iosErrorCode === null ? null : iosErrorMeanings[iosErrorCode] ?? null,
  };
}

/**
 * Which BLE events are routine and which are worth a reader's attention.
 *
 * Signal samples and per-page timings are the bulk of a file and are only
 * interesting in aggregate, so they are `debug`. A dropped link or a failed
 * request is what someone opens the log to find.
 */
export function bleLevelFor(event: BleLogEvent): LogLevel {
  switch (event.kind) {
    case "rssi":
    case "req":
    case "board":
    case "verify":
      return "debug";
    case "down":
    case "streamError":
    case "rssiFail":
      return "warn";
    case "gap":
      return "warn";
    case "connect":
      return event.phase === "fail" ? "warn" : "info";
    case "transfer":
      return event.ok === false ? "warn" : "info";
    default:
      return "info";
  }
}

/** One line per entry, for the live list on the sensor sheet. */
export function describeLogEntry(entry: LogEntry) {
  const at = new Date(entry.t).toISOString().slice(11, 19);
  const field = (name: string) => entry[name];

  if (entry.source !== "ble") {
    const detail = field("message");

    return `${at}  ${entry.source.padEnd(8)} ${entry.event}${
      typeof detail === "string" ? ` — ${detail}` : ""
    }`;
  }

  const error = field("error") as BleErrorDetail | null | undefined;
  const reason = error?.meaning ?? error?.message;

  switch (entry.event) {
    case "session":
      return `${at}  session  ${field("model") ?? "phone"} ${field("osVersion") ?? ""}`.trim();
    case "radio":
      return `${at}  radio    ${field("ready") ? "ready" : field("message") ?? "not ready"}`;
    case "app":
      return `${at}  app      ${field("state")}`;
    case "connect":
      return `${at}  connect  ${field("phase")}${field("path") ? ` via ${field("path")}` : ""}${
        field("ms") === undefined ? "" : ` ${field("ms")} ms`
      }${field("mtu") === undefined ? "" : ` mtu ${field("mtu")}`}${
        reason ? ` — ${reason}` : ""
      }`;
    case "down": {
      const upMs = field("upMs");

      return `${at}  DOWN     after ${
        typeof upMs === "number" ? Math.round(upMs / 1000) : "?"
      } s — ${reason ?? "no reason given"}`;
    }
    case "retry":
      return `${at}  retry    attempt ${field("attempt")} in ${field("delayMs")} ms`;
    case "verify":
      return `${at}  verify   ${field("alive") ? "alive" : "gone"} ${field("ms")} ms`;
    case "rssi":
      return `${at}  rssi     ${field("dbm")} dBm`;
    case "rssiFail":
      return `${at}  rssi     failed — ${error?.message}`;
    case "req":
      return `${at}  req      op ${field("op")} try ${field("attempt")} ${field("ms")} ms ${field(
        "polls"
      )} polls ${field("ok") ? "ok" : `failed — ${error?.message ?? "?"}`}`;
    case "transfer": {
      const ms = field("ms");

      return `${at}  transfer ${field("phase")}${
        typeof ms === "number" ? ` ${Math.round(ms / 1000)} s` : ""
      }${field("pages") === undefined ? "" : ` ${field("pages")} pages`}${
        field("ok") === false ? " FAILED" : ""
      }`;
    }
    case "board":
      return `${at}  board    state ${field("state")} overruns ${field("overruns")} bus ${field(
        "busErrors"
      )} heap ${field("freeHeap")}`;
    case "gap":
      return `${at}  GAP      ${field("ms")} ms with no samples`;
    case "stream":
      return `${at}  stream   ${field("packets")} packets, ${field("lostPercent")}% lost`;
    case "streamError":
      return `${at}  stream   ${error?.message}`;
    case "note":
      return `${at}  note     ${field("text")}`;
    default:
      return `${at}  ble      ${entry.event}`;
  }
}

/** How much of the log is on disk, for a screen to show. */
export function formatLogSize(bytes: number) {
  return bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${Math.round(bytes / 1024)} kB`
      : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
