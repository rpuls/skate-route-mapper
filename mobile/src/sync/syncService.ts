import { postSyncOperations } from "../api/sync";
import {
  getPendingChangeSummary,
  getQueuedChanges,
  markPendingChangesFailed,
  markPendingChangesSynced,
} from "../database/db";
import { nextAttemptAt } from "./backoff";
import { runSyncLoop, type SyncProgress, type SyncQueuePorts } from "./syncLoop";

export type { SyncProgress } from "./syncLoop";

export type SyncOutcome =
  | { ok: true; synced: number; remaining: number }
  | {
      ok: false;
      reason: "missing-auth-token" | "request-failed";
      synced: number;
      remaining: number;
      message: string;
    };

/**
 * Wire the upload queue to the device database and the API.
 *
 * The loop itself lives in `syncLoop.ts`, without either, so the behaviour
 * that decides whether a rider keeps their ride can be tested.
 */
export async function syncPendingChanges(params: {
  token: string | null;
  onProgress?: (progress: SyncProgress) => void;
}): Promise<SyncOutcome> {
  if (!params.token) {
    return {
      ok: false,
      reason: "missing-auth-token",
      synced: 0,
      remaining: getPendingChangeSummary().pending,
      message: "Sign in to upload saved rides.",
    };
  }

  const token = params.token;
  const ports: SyncQueuePorts = {
    getQueued: () => getQueuedChanges(),
    countPending: () => getPendingChangeSummary().pending,
    send: (operations) => postSyncOperations({ token, operations }),
    markSynced: markPendingChangesSynced,
    markFailed: (operationIds, message) =>
      markPendingChangesFailed(operationIds, message, (attempts) =>
        nextAttemptAt(attempts)
      ),
    now: Date.now,
  };

  const result = await runSyncLoop(ports, params.onProgress);

  if (result.ok) {
    return result;
  }

  return {
    ...result,
    reason: "request-failed",
  };
}
