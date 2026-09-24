import {
  maxOperationsPerSyncRequest,
  type SyncOperation,
} from "@skate-route-mapper/shared/mobileContracts";

/**
 * How much of the upload queue one request carries.
 *
 * Kept apart from the sync service so the sizing rules can be tested without a
 * database or a server. The rules matter more than they look: batching samples
 * made each queued operation large, and an operation count alone stopped being
 * a useful measure of request size.
 */

/**
 * Operations per request.
 *
 * Well under the contract's ceiling of 100, because the real limit is bytes,
 * not operations: 100 full sample operations would be several megabytes.
 */
export const operationsPerRequest = Math.min(25, maxOperationsPerSyncRequest);

/**
 * Samples per request.
 *
 * Roughly 400 KB of JSON, which fits inside a default 1 MB body limit even if
 * the API is ever run without the larger limit the sync route asks for.
 */
export const samplesPerRequest = 2000;

/** Stop after this many round trips so one sync cannot run forever. */
export const maxRequestsPerSync = 40;

export function sampleCountOf(operation: SyncOperation) {
  return operation.type === "ride.samples" ? operation.payload.samples.length : 0;
}

export function rideIdOf(operation: SyncOperation) {
  return operation.payload.rideId;
}

/**
 * Strip the bookkeeping a queued operation carries locally.
 *
 * `attempts`, `lastError` and `nextAttemptAt` are the phone's business. The
 * backend ignores them, and sending them would put local retry state on the
 * wire for no reason.
 */
export function toSyncOperation(operation: QueuedOperation): SyncOperation {
  switch (operation.type) {
    case "ride.start":
      return {
        operationId: operation.operationId,
        type: "ride.start",
        createdAt: operation.createdAt,
        payload: operation.payload,
      };
    case "ride.samples":
      return {
        operationId: operation.operationId,
        type: "ride.samples",
        createdAt: operation.createdAt,
        payload: operation.payload,
      };
    case "ride.finish":
      return {
        operationId: operation.operationId,
        type: "ride.finish",
        createdAt: operation.createdAt,
        payload: operation.payload,
      };
  }
}

export type QueuedOperation = SyncOperation & {
  /** When this operation may next be sent. Zero means immediately. */
  nextAttemptAt: number;
};

/**
 * Which queued operations may be sent right now.
 *
 * An operation waiting out a backoff is skipped, and so is everything queued
 * behind it *for the same ride*. That second rule is what keeps a ride whole:
 * the backend refuses samples for a finished ride, so if a stuck sample batch
 * let its own `ride.finish` overtake it, the tail of that ride would be
 * rejected for good rather than merely delayed.
 *
 * Operations for other rides are unaffected, so one bad batch cannot hold up
 * every other ride on the phone.
 */
export function selectSendableOperations<T extends QueuedOperation>(
  queued: readonly T[],
  now: number
): T[] {
  const blockedRides = new Set<string>();
  const sendable: T[] = [];

  for (const operation of queued) {
    const rideId = rideIdOf(operation);

    if (operation.nextAttemptAt > now) {
      blockedRides.add(rideId);
      continue;
    }

    if (blockedRides.has(rideId)) {
      continue;
    }

    sendable.push(operation);
  }

  return sendable;
}

/**
 * Take as much of the queue as one request should carry.
 *
 * Order is preserved and never rearranged: the backend refuses samples for a
 * finished ride, so a `ride.finish` that overtook its own samples would strand
 * the end of the ride.
 *
 * Always returns at least one operation for a non-empty queue, even when that
 * operation alone is over the sample budget. It has to be sent eventually, and
 * the contract already caps it at 1,000 samples.
 */
export function takeRequestBatch<T extends SyncOperation>(pending: readonly T[]): T[] {
  const batch: T[] = [];
  let samples = 0;

  for (const operation of pending) {
    if (batch.length >= operationsPerRequest) {
      break;
    }

    const operationSamples = sampleCountOf(operation);

    if (batch.length > 0 && samples + operationSamples > samplesPerRequest) {
      break;
    }

    batch.push(operation);
    samples += operationSamples;
  }

  return batch;
}
