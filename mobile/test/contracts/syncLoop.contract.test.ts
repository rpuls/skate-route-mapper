import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  SyncOperation,
  SyncOperationResult,
} from "@skate-route-mapper/shared/mobileContracts";
import { runSyncLoop, type SyncQueuePorts } from "../../src/sync/syncLoop.js";
import {
  maxRequestsPerSync,
  operationsPerRequest,
  samplesPerRequest,
  type QueuedOperation,
} from "../../src/sync/syncBatching.js";

function samplesOperation(
  id: string,
  sampleCount = 1,
  rideId = "ride"
): SyncOperation {
  return {
    operationId: id,
    type: "ride.samples",
    createdAt: Number(id.replace(/\D/g, "")) || 0,
    payload: {
      rideId,
      samples: Array.from({ length: sampleCount }, () => ({
        timestamp: 0,
        ax: null,
        ay: null,
        az: null,
        gx: null,
        gy: null,
        gz: null,
        vibrationMagnitude: null,
        latitude: null,
        longitude: null,
        speed: null,
      })),
    },
  };
}

function finishOperation(id: string, rideId = "ride"): SyncOperation {
  return {
    operationId: id,
    type: "ride.finish",
    createdAt: Number(id.replace(/\D/g, "")) || 0,
    payload: { rideId, endedAt: 0 },
  };
}

type QueueDoubleOptions = {
  queued: QueuedOperation[];
  /** Return an error instead of accepting, for the given request index. */
  failOn?: (request: number, batch: SyncOperation[]) => Error | null;
  /** Accept only some of a batch, as a partial server response would. */
  acceptCount?: (batch: SyncOperation[]) => number;
  now?: number;
};

function createQueueDouble(options: QueueDoubleOptions) {
  let queued = [...options.queued];
  const sentBatches: SyncOperation[][] = [];
  const failures: { operationIds: string[]; message: string }[] = [];
  let requests = 0;

  const ports: SyncQueuePorts = {
    getQueued: () => [...queued],
    countPending: () => queued.length,
    now: () => options.now ?? 0,
    send: async (operations) => {
      sentBatches.push(operations);

      const failure = options.failOn?.(requests, operations) ?? null;

      requests += 1;

      if (failure) {
        throw failure;
      }

      const accepted = options.acceptCount
        ? options.acceptCount(operations)
        : operations.length;

      const results: SyncOperationResult[] = operations
        .slice(0, accepted)
        .map((operation) => ({
          operationId: operation.operationId,
          status: "applied" as const,
        }));

      return { results };
    },
    markSynced: (results) => {
      const done = new Set(results.map((result) => result.operationId));

      queued = queued.filter((operation) => !done.has(operation.operationId));
    },
    markFailed: (operationIds, message) => {
      failures.push({ operationIds, message });
    },
  };

  return {
    ports,
    sentBatches,
    failures,
    remaining: () => queued,
  };
}

describe("sync loop", () => {
  it("keeps sending until the queue is empty", async () => {
    const queued: QueuedOperation[] = Array.from(
      { length: operationsPerRequest * 3 },
      (_unused, index) => ({
        ...samplesOperation(`op-${index}`),
        nextAttemptAt: 0,
      })
    );
    const double = createQueueDouble({ queued });

    const result = await runSyncLoop(double.ports);

    assert.equal(result.ok, true);
    assert.equal(result.synced, queued.length);
    assert.equal(result.remaining, 0);
    assert.equal(double.sentBatches.length, 3);
  });

  it("reports progress against the size the queue started at", async () => {
    const queued: QueuedOperation[] = Array.from(
      { length: operationsPerRequest * 2 },
      (_unused, index) => ({
        ...samplesOperation(`op-${index}`),
        nextAttemptAt: 0,
      })
    );
    const double = createQueueDouble({ queued });
    const progress: { sentOperations: number; totalOperations: number }[] = [];

    await runSyncLoop(double.ports, (update) => progress.push(update));

    assert.deepEqual(progress, [
      { sentOperations: operationsPerRequest, totalOperations: queued.length },
      { sentOperations: queued.length, totalOperations: queued.length },
    ]);
  });

  it("stops at the first failure instead of pushing on into it", async () => {
    const queued: QueuedOperation[] = Array.from({ length: 60 }, (_unused, index) => ({
      ...samplesOperation(`op-${index}`),
      nextAttemptAt: 0,
    }));
    const double = createQueueDouble({
      queued,
      failOn: (request) => (request === 1 ? new Error("Network request failed") : null),
    });

    const result = await runSyncLoop(double.ports);

    assert.equal(result.ok, false);
    assert.equal(double.sentBatches.length, 2);
    assert.equal(result.synced, operationsPerRequest);
    assert.equal(
      result.ok === false ? result.message : null,
      "Network request failed"
    );
  });

  it("marks exactly the failed batch for retry", async () => {
    const queued: QueuedOperation[] = Array.from({ length: 40 }, (_unused, index) => ({
      ...samplesOperation(`op-${index}`),
      nextAttemptAt: 0,
    }));
    const double = createQueueDouble({
      queued,
      failOn: (request) => (request === 0 ? new Error("offline") : null),
    });

    await runSyncLoop(double.ports);

    assert.equal(double.failures.length, 1);
    assert.equal(double.failures[0]?.operationIds.length, operationsPerRequest);
    assert.deepEqual(
      double.failures[0]?.operationIds,
      double.sentBatches[0]?.map((operation) => operation.operationId)
    );
  });

  it("leaves an operation the backend did not confirm in the queue", async () => {
    const queued: QueuedOperation[] = Array.from({ length: 4 }, (_unused, index) => ({
      ...samplesOperation(`op-${index}`),
      nextAttemptAt: 0,
    }));
    const double = createQueueDouble({
      queued,
      // The first request is half-applied, as a server that ran out of time
      // mid-transaction would report.
      acceptCount: (batch) => (double.sentBatches.length === 1 ? 2 : batch.length),
    });

    const result = await runSyncLoop(double.ports);

    assert.equal(result.ok, true);
    assert.equal(result.remaining, 0);
    assert.equal(double.sentBatches.length, 2);
    assert.equal(double.sentBatches[1]?.length, 2);
  });

  it("gives up rather than looping when the backend accepts nothing", async () => {
    const double = createQueueDouble({
      queued: [{ ...samplesOperation("op-0"), nextAttemptAt: 0 }],
      acceptCount: () => 0,
    });

    const result = await runSyncLoop(double.ports);

    assert.equal(result.ok, true);
    assert.equal(result.synced, 0);
    assert.equal(result.remaining, 1);
    assert.equal(double.sentBatches.length, 1);
  });

  it("caps how many requests one run may make", async () => {
    // Each request accepts one operation, so an uncapped loop would run
    // thousands of times.
    const double = createQueueDouble({
      queued: Array.from({ length: maxRequestsPerSync * 3 }, (_unused, index) => ({
        ...samplesOperation(`op-${index}`),
        nextAttemptAt: 0,
      })),
      acceptCount: () => 1,
    });

    const result = await runSyncLoop(double.ports);

    assert.equal(double.sentBatches.length, maxRequestsPerSync);
    assert.equal(result.ok, true);
    assert.equal(result.synced, maxRequestsPerSync);
    assert.ok(result.remaining > 0);
  });

  it("sends nothing when everything queued is waiting out a retry", async () => {
    const double = createQueueDouble({
      queued: [{ ...samplesOperation("op-0"), nextAttemptAt: 5_000 }],
      now: 0,
    });

    const result = await runSyncLoop(double.ports);

    assert.equal(double.sentBatches.length, 0);
    assert.equal(result.ok, true);
    assert.equal(result.synced, 0);
    assert.equal(result.remaining, 1);
  });

  it("does not let a ride's finish overtake its own waiting samples", async () => {
    const double = createQueueDouble({
      queued: [
        { ...samplesOperation("op-1", 1, "ride-a"), nextAttemptAt: 60_000 },
        { ...finishOperation("op-2", "ride-a"), nextAttemptAt: 0 },
        { ...samplesOperation("op-3", 1, "ride-b"), nextAttemptAt: 0 },
        { ...finishOperation("op-4", "ride-b"), nextAttemptAt: 0 },
      ],
      now: 0,
    });

    const result = await runSyncLoop(double.ports);

    assert.equal(result.ok, true);
    assert.deepEqual(
      double.sentBatches[0]?.map((operation) => operation.operationId),
      ["op-3", "op-4"]
    );
    assert.deepEqual(
      double.remaining().map((operation) => operation.operationId),
      ["op-1", "op-2"]
    );
  });

  it("keeps a request inside the sample budget", async () => {
    const double = createQueueDouble({
      queued: Array.from({ length: 4 }, (_unused, index) => ({
        ...samplesOperation(`op-${index}`, 900),
        nextAttemptAt: 0,
      })),
    });

    await runSyncLoop(double.ports);

    double.sentBatches.forEach((batch) => {
      const samples = batch.reduce(
        (total, operation) =>
          total + (operation.type === "ride.samples" ? operation.payload.samples.length : 0),
        0
      );

      assert.ok(
        samples <= samplesPerRequest,
        `a request carried ${samples} samples, over the ${samplesPerRequest} budget`
      );
    });
  });

  it("does not put local retry bookkeeping on the wire", async () => {
    // What the queue actually holds: the operation plus its retry state.
    const stored: QueuedOperation = Object.assign(
      { ...samplesOperation("op-0"), nextAttemptAt: 0 },
      { attempts: 3, lastError: "offline" }
    );
    const double = createQueueDouble({ queued: [stored] });

    await runSyncLoop(double.ports);

    assert.deepEqual(
      Object.keys(double.sentBatches[0]?.[0] ?? {}).sort(),
      ["createdAt", "operationId", "payload", "type"]
    );
  });

  it("does nothing at all for an empty queue", async () => {
    const double = createQueueDouble({ queued: [] });

    const result = await runSyncLoop(double.ports);

    assert.equal(double.sentBatches.length, 0);
    assert.deepEqual(result, { ok: true, synced: 0, remaining: 0 });
  });
});
