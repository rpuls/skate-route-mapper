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
 * The app log on web: in memory, and going nowhere.
 *
 * `npm run dev:web` has no document directory to write to and no share sheet
 * to hand a file to. The store still exists so the diagnostics UI renders and
 * can be laid out, and the export refuses honestly rather than throwing a
 * file-system error from a platform that has neither.
 */

const recentLimit = 60;

export const diagnosticsAvailable = __DEV__;

type AppLogState = {
  count: number;
  bytes: number;
  recent: LogEntry[];
};

export const useAppLog = create<AppLogState>(() => ({
  count: 0,
  bytes: 0,
  recent: [],
}));

export function logEvent(
  level: LogLevel,
  source: LogSource,
  event: string,
  fields: Record<string, unknown> = {}
) {
  const entry: LogEntry = { t: Date.now(), level, source, event, ...fields };
  const state = useAppLog.getState();

  useAppLog.setState({
    count: state.count + 1,
    recent: [entry, ...state.recent].slice(0, recentLimit),
  });

  if (__DEV__ && (level === "warn" || level === "error")) {
    console.warn(`[${source}] ${event}`, fields);
  }
}

export const logInfo = (source: LogSource, event: string, fields?: Record<string, unknown>) =>
  logEvent("info", source, event, fields);

export const logWarn = (source: LogSource, event: string, fields?: Record<string, unknown>) =>
  logEvent("warn", source, event, fields);

export const logDebug = (source: LogSource, event: string, fields?: Record<string, unknown>) =>
  logEvent("debug", source, event, fields);

export function logBle(event: BleLogEvent) {
  const { kind, ...fields } = event;

  logEvent(bleLevelFor(event), "ble", kind, fields);
}

export function startAppLog() {
  // Nothing to expire and nothing to stamp: web never opens a link.
}

export function flushAppLog() {
  // Nowhere to flush to.
}

export async function exportAppLog(): Promise<string> {
  throw new Error("The app log can only be exported from the native app.");
}

export function clearAppLog() {
  useAppLog.setState({ count: 0, bytes: 0, recent: [] });
}
