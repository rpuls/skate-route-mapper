import { Platform } from "react-native";
import * as Device from "expo-device";
import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { create } from "zustand";
import {
  bleLevelFor,
  type BleLogEvent,
  type LogEntry,
  type LogLevel,
  type LogSource,
} from "./logEvents";

export {
  describeBleError,
  describeLogEntry,
  formatLogSize,
  type BleErrorDetail,
  type BleLogEvent,
  type LogEntry,
  type LogLevel,
  type LogSource,
} from "./logEvents";

/**
 * The app's log: what happened, kept on disk, bounded.
 *
 * It started as a BLE diagnostic and is deliberately not one any more. A log
 * is worth having for its own sake — a sync that failed at eleven at night, a
 * background location task that stopped, a board that dropped mid-capture —
 * and the alternative was `console.warn`, which goes to a Metro console that
 * is not attached when any of that actually happens.
 *
 * Three rules keep it from becoming a liability:
 *
 * 1. **It is bounded.** Two files, `maxFileBytes` each, rolled over rather
 *    than appended to forever, and anything older than `maxAgeDays` is deleted
 *    on the next launch. A log nobody can lose control of is one nobody has to
 *    think about.
 * 2. **Writing is cheap.** Entries are batched, never awaited, and never
 *    throw. It is called from BLE callbacks and from inside a retrieval loop,
 *    and neither can afford to care whether the disk worked.
 * 3. **Reading it is a developer's job.** Export is gated on `__DEV__` — see
 *    `diagnosticsAvailable` — because a share sheet full of NDJSON is not
 *    something to put in front of a rider.
 *
 * The file is NDJSON, one entry per line, flat rather than nested, so it reads
 * well and greps well.
 */

/**
 * Whether the diagnostics UI should exist in this build.
 *
 * `__DEV__` is true in the development build `npm run iphone:build` produces
 * and false in the `preview` and `production` EAS profiles, which is exactly
 * the line wanted: the log is always written, and only a developer build
 * offers to hand it over.
 */
export const diagnosticsAvailable = __DEV__;

const logDirectoryName = "diagnostics";
const currentFileName = "app-log.ndjson";
const previousFileName = "app-log-previous.ndjson";

/**
 * How large the live file grows before it is rolled over.
 *
 * Two files are kept, so the ceiling on disk is twice this. A long ride with
 * signal sampling and a research retrieval costs a few hundred kilobytes, so
 * this holds several sessions without ever being something a phone notices.
 */
const maxFileBytes = 2_000_000;

/**
 * How long a log file is kept at all.
 *
 * Rotation bounds the size; this bounds the age, for the phone that goes a
 * month between rides and would otherwise open its log on a session nobody
 * remembers. Checked once per launch, against the file's own modified time.
 */
const maxAgeDays = 14;

/**
 * How long entries sit in memory before they reach the file.
 *
 * Entries arrive during a transfer at a few per second, so writing each one as
 * it happens would put the flash in the middle of the path being measured.
 * Batching keeps the observer out of the way of what it observes.
 */
const flushIntervalMs = 4_000;
const flushQueueLength = 200;

/** How many entries the screens can show without reading the file back. */
const recentLimit = 60;

type AppLogState = {
  /** Entries written since launch. Enough for a screen to show it is working. */
  count: number;
  /** Bytes on disk at the last flush, across both files. */
  bytes: number;
  recent: LogEntry[];
};

export const useAppLog = create<AppLogState>(() => ({
  count: 0,
  bytes: 0,
  recent: [],
}));

let queue: LogEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let started = false;

/**
 * Record one entry.
 *
 * Never throws and never awaits. In a development build it also reaches the
 * console, because a developer with Metro attached should not have to export a
 * file to see a warning that just happened.
 */
export function logEvent(
  level: LogLevel,
  source: LogSource,
  event: string,
  fields: Record<string, unknown> = {}
) {
  const entry: LogEntry = { t: Date.now(), level, source, event, ...fields };

  queue.push(entry);

  const state = useAppLog.getState();

  useAppLog.setState({
    count: state.count + 1,
    recent: [entry, ...state.recent].slice(0, recentLimit),
  });

  if (__DEV__ && (level === "warn" || level === "error")) {
    console.warn(`[${source}] ${event}`, fields);
  }

  if (queue.length >= flushQueueLength) {
    flushAppLog();
    return;
  }

  if (flushTimer === null) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushAppLog();
    }, flushIntervalMs);
  }
}

/** The three ordinary shorthands. `debug` is for anything written in bulk. */
export const logInfo = (source: LogSource, event: string, fields?: Record<string, unknown>) =>
  logEvent("info", source, event, fields);

export const logWarn = (source: LogSource, event: string, fields?: Record<string, unknown>) =>
  logEvent("warn", source, event, fields);

export const logDebug = (source: LogSource, event: string, fields?: Record<string, unknown>) =>
  logEvent("debug", source, event, fields);

/**
 * Record a BLE event, keeping its shape.
 *
 * The BLE vocabulary is typed rather than free text because its entries are
 * counted and compared — how many drops, at what signal strength, how long a
 * page took. `bleLevelFor` decides what is routine: signal samples and page
 * timings are bulk, a dropped link is not.
 */
export function logBle(event: BleLogEvent) {
  const { kind, ...fields } = event;

  logEvent(bleLevelFor(event), "ble", kind, fields);
}

/**
 * Note the phone and the build once per launch, and drop anything stale.
 *
 * A log that leaves the phone has to say which phone it came from: an iOS
 * version is the difference between a 185-byte ATT_MTU and a larger one, and
 * that alone changes how many round trips a 408-byte research page costs.
 */
export function startAppLog() {
  if (started) {
    return;
  }

  started = true;

  expireOldLogs();

  logEvent("info", "app", "session", {
    platform: `${Platform.OS} ${String(Platform.Version)}`,
    model: Device.modelName ?? null,
    osVersion: Device.osVersion ?? null,
    dev: __DEV__,
  });
}

function logDirectory() {
  const directory = new Directory(Paths.document, logDirectoryName);

  directory.create({ idempotent: true, intermediates: true });

  return directory;
}

/** Delete log files older than `maxAgeDays`. Once per launch is enough. */
function expireOldLogs() {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;

  try {
    const directory = logDirectory();

    for (const name of [currentFileName, previousFileName]) {
      const file = new File(directory, name);

      if (file.exists && (file.info().modificationTime ?? Date.now()) < cutoff) {
        file.delete();
      }
    }
  } catch {
    // Nothing to expire, or nothing readable. Not worth failing a launch over.
  }
}

/**
 * Append the queue to the live file, rolling it over when it gets large.
 *
 * Synchronous on purpose: `expo-file-system`'s file handle is, and a flush that
 * returned a promise would need its own queue to stop two of them interleaving
 * halfway through a line.
 */
export function flushAppLog() {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  if (queue.length === 0) {
    return;
  }

  const pending = queue;
  queue = [];

  try {
    const directory = logDirectory();
    const current = new File(directory, currentFileName);

    if (!current.exists) {
      current.create({ overwrite: false, intermediates: true });
    }

    // Rolling over keeps one full previous session next to the live one, so a
    // developer who exports a day late still has the ride in the file.
    if ((current.info().size ?? 0) >= maxFileBytes) {
      const previous = new File(directory, previousFileName);

      if (previous.exists) {
        previous.delete();
      }

      current.rename(previousFileName);

      const replacement = new File(directory, currentFileName);
      replacement.create({ overwrite: true, intermediates: true });
      replacement.write(serialize(pending));
      noteSize(directory);

      return;
    }

    const handle = current.open();

    try {
      handle.offset = handle.size ?? 0;
      handle.writeBytes(encodeUtf8(serialize(pending)));
    } finally {
      handle.close();
    }

    noteSize(directory);
  } catch {
    // A log that breaks the app it is recording is worse than no log. The
    // entries are dropped rather than retried: the in-memory tail is still on
    // screen, and the next flush starts clean.
  }
}

function noteSize(directory: Directory) {
  const sizeOf = (name: string) => {
    const file = new File(directory, name);

    return file.exists ? file.info().size ?? 0 : 0;
  };

  useAppLog.setState({
    bytes: sizeOf(currentFileName) + sizeOf(previousFileName),
  });
}

function serialize(entries: readonly LogEntry[]) {
  return entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
}

/**
 * UTF-8 bytes without `TextEncoder`.
 *
 * Hermes has one, but the log carries free text, and a hand-rolled encoder is
 * a few lines against a dependency on an engine detail.
 */
function encodeUtf8(value: string) {
  const bytes: number[] = [];

  for (let index = 0; index < value.length; index += 1) {
    let code = value.charCodeAt(index);

    if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const low = value.charCodeAt(index + 1);

      if (low >= 0xdc00 && low <= 0xdfff) {
        code = (code - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000;
        index += 1;
      }
    }

    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      );
    }
  }

  return new Uint8Array(bytes);
}

/**
 * Hand the whole log out through the share sheet.
 *
 * Both files go into one export, oldest first, because a reader wants one
 * timeline and `shareAsync` takes one file. The export is rebuilt each time
 * rather than kept, so it can never be the stale copy. `shareAsync` presents a
 * `UIActivityViewController` over a real file URL, so "Save to Files" is one
 * of the destinations and a mounted network share can be written to directly.
 */
export async function exportAppLog() {
  if (!diagnosticsAvailable) {
    throw new Error("The log can only be exported from a development build.");
  }

  flushAppLog();

  const directory = logDirectory();
  const parts = [previousFileName, currentFileName]
    .map((name) => new File(directory, name))
    .filter((file) => file.exists)
    .map((file) => file.textSync());

  if (parts.join("").length === 0) {
    throw new Error("Nothing has been logged yet.");
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const exported = new File(directory, `skate-app-log-${stamp}.ndjson`);

  exported.create({ overwrite: true, intermediates: true });
  exported.write(parts.join(""));

  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("Sharing is unavailable on this device.");
  }

  await Sharing.shareAsync(exported.uri, {
    mimeType: "application/x-ndjson",
    dialogTitle: "App log",
    UTI: "public.plain-text",
  });

  return exported.uri;
}

/** Start again, for when a developer is about to repeat an experiment cleanly. */
export function clearAppLog() {
  queue = [];

  try {
    const directory = logDirectory();

    for (const entry of directory.list()) {
      if (entry instanceof File) {
        entry.delete();
      }
    }
  } catch {
    // Nothing to clear.
  }

  useAppLog.setState({ count: 0, bytes: 0, recent: [] });
  started = false;
  startAppLog();
}
