import { AppState, type AppStateStatus } from "react-native";
import { getPendingChangeSummary } from "../database/db";
import { rideRecorder } from "../recording/recorder";
import { syncPendingChanges, type SyncOutcome } from "./syncService";

/**
 * Uploads without anyone pressing a button.
 *
 * Sync used to happen only when a rider opened the rides screen and tapped
 * "Sync", which means a recorded ride could sit on the phone indefinitely.
 * Three things now trigger an upload: finishing a ride, bringing the app back
 * to the front, and a slow timer while the app is open, which is what
 * eventually picks a ride up again after a spell with no signal.
 *
 * There is no connectivity listener: that would mean adding a native module
 * for a trigger the retry timer already covers, at the cost of another build.
 */
const retryIntervalMs = 60_000;

type AutoSyncState = {
  getToken: () => string | null;
  onResult?: ((outcome: SyncOutcome) => void) | undefined;
};

let state: AutoSyncState | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let appStateSubscription: { remove: () => void } | null = null;
let inFlight: Promise<SyncOutcome | null> | null = null;

/**
 * Run a sync unless one is already running.
 *
 * Several triggers can fire at once — finishing a ride in the foreground also
 * changes app state — and two overlapping syncs would send the same operations
 * twice. The server would deduplicate them, but the phone should not ask.
 */
export function requestSync(reason: string): Promise<SyncOutcome | null> {
  if (inFlight) {
    return inFlight;
  }

  const current = state;

  if (!current) {
    return Promise.resolve(null);
  }

  const token = current.getToken();

  if (!token) {
    return Promise.resolve(null);
  }

  if (getPendingChangeSummary().due === 0) {
    return Promise.resolve(null);
  }

  inFlight = syncPendingChanges({ token })
    .then((outcome) => {
      if (!outcome.ok) {
        console.warn(`Auto sync (${reason}) failed: ${outcome.message}`);
      }

      current.onResult?.(outcome);

      return outcome;
    })
    .catch((error: unknown) => {
      console.warn(
        `Auto sync (${reason}) threw`,
        error instanceof Error ? error.message : error
      );

      return null;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

function handleAppStateChange(status: AppStateStatus) {
  if (status === "active") {
    void requestSync("app-foreground");
    return;
  }

  // Going to the background is the last safe moment to write buffered samples:
  // the OS may not give the app another turn before it is suspended.
  rideRecorder.flush();
}

export function startAutoSync(options: AutoSyncState) {
  stopAutoSync();
  state = options;

  appStateSubscription = AppState.addEventListener("change", handleAppStateChange);
  timer = setInterval(() => {
    void requestSync("retry-timer");
  }, retryIntervalMs);

  void requestSync("app-start");
}

export function stopAutoSync() {
  appStateSubscription?.remove();
  appStateSubscription = null;

  if (timer) {
    clearInterval(timer);
    timer = null;
  }

  state = null;
}
