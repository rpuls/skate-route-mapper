import { postSyncOperations } from "../api/sync";
import {
  getPendingChanges,
  markPendingChangesFailed,
  markPendingChangesSynced,
} from "../database/db";

const DEFAULT_SYNC_BATCH_SIZE = 50;

export async function syncPendingChanges(params: {
  token: string | null;
  limit?: number;
}) {
  if (!params.token) {
    return {
      ok: false,
      reason: "missing-auth-token",
      synced: 0,
    } as const;
  }

  const pendingChanges = getPendingChanges(
    params.limit ?? DEFAULT_SYNC_BATCH_SIZE
  );

  if (pendingChanges.length === 0) {
    return {
      ok: true,
      synced: 0,
    } as const;
  }

  try {
    const response = await postSyncOperations({
      token: params.token,
      operations: pendingChanges,
    });

    markPendingChangesSynced(response.results);

    return {
      ok: true,
      synced: response.results.length,
    } as const;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to sync changes.";

    markPendingChangesFailed(
      pendingChanges.map((change) => change.operationId),
      message
    );

    return {
      ok: false,
      reason: "request-failed",
      synced: 0,
      message,
    } as const;
  }
}
