import type {
  SyncOperation,
  SyncOperationResult,
} from "@skate-route-mapper/shared/mobileContracts";
import {
  maxRequestsPerSync,
  selectSendableOperations,
  takeRequestBatch,
  toSyncOperation,
  type QueuedOperation,
} from "./syncBatching";

/**
 * Draining the upload queue, with the storage and the network as ports.
 *
 * This is the part that decides what happens to a rider's ride when the
 * network misbehaves, so it is kept free of both `expo-sqlite` and `fetch` and
 * tested directly. `syncService.ts` supplies the real ones.
 */
export type SyncQueuePorts = {
  /** The whole unsent queue, oldest first, including operations still waiting. */
  getQueued: () => QueuedOperation[];
  countPending: () => number;
  send: (operations: SyncOperation[]) => Promise<{ results: SyncOperationResult[] }>;
  markSynced: (results: SyncOperationResult[]) => void;
  markFailed: (operationIds: string[], message: string) => void;
  now: () => number;
};

export type SyncProgress = {
  sentOperations: number;
  totalOperations: number;
};

export type SyncRunResult =
  | { ok: true; synced: number; remaining: number }
  | { ok: false; synced: number; remaining: number; message: string };

/**
 * Push everything the queue is ready to send.
 *
 * Runs as many requests as it takes rather than one fixed batch, so finishing
 * a ride actually finishes the upload. A failure stops the loop rather than
 * pushing on into the same error: whatever broke the first request will
 * usually break the second, and the operations are marked for a later retry
 * instead.
 */
export async function runSyncLoop(
  ports: SyncQueuePorts,
  onProgress?: (progress: SyncProgress) => void
): Promise<SyncRunResult> {
  const totalOperations = ports.countPending();
  let synced = 0;

  for (let request = 0; request < maxRequestsPerSync; request += 1) {
    const sendable = selectSendableOperations(ports.getQueued(), ports.now());

    if (sendable.length === 0) {
      break;
    }

    const batch = takeRequestBatch(sendable);

    try {
      const response = await ports.send(batch.map(toSyncOperation));

      // Only what the backend confirmed is marked sent. An operation it did
      // not mention stays queued and is retried.
      ports.markSynced(response.results);
      synced += response.results.length;
      onProgress?.({ sentOperations: synced, totalOperations });

      if (response.results.length === 0) {
        // Nothing was accepted and nothing failed, so another identical
        // request would loop forever.
        break;
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to sync changes.";

      ports.markFailed(
        batch.map((operation) => operation.operationId),
        message
      );

      return {
        ok: false,
        synced,
        remaining: ports.countPending(),
        message,
      };
    }
  }

  return {
    ok: true,
    synced,
    remaining: ports.countPending(),
  };
}
