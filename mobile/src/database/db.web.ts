import type {
  RideMetricsPayload,
  SyncOperation,
  SyncOperationResult,
} from "@skate-route-mapper/shared/mobileContracts";
import {
  createRideProgress,
  parseRideProgress,
  type RideProgress,
} from "@skate-route-mapper/shared/rideTracking";
import type { MeasurementSample, Ride, SensorSource, VehicleType } from "../types/measurement";
import type { ActiveRecording } from "../recording/rideRecorder";
import type { ResearchCollection } from "../types/research";

type StoredSample = MeasurementSample & {
  rideId: string;
};

export type PendingChange = SyncOperation & {
  attempts: number;
  lastError: string | null;
  nextAttemptAt: number;
};

// Where a recording in flight can be picked up again. Background location
// arrives outside React, and on a cold start after the OS killed the app there
// is no component to ask, so the active ride lives in the database. The shape
// belongs to the recorder, which is what reads it back.
export type { ActiveRecording };

type StoredPendingChange = PendingChange & {
  syncedAt: number | null;
};

type DatabaseSnapshot = {
  rides: Ride[];
  samples: StoredSample[];
  pendingChanges: StoredPendingChange[];
  researchCollections: ResearchCollection[];
  rideProgress: Record<string, RideProgress>;
  activeRecording: ActiveRecording | null;
};

const storageKey = "skate-route-mapper-web-db";

function emptySnapshot(): DatabaseSnapshot {
  return {
    rides: [],
    samples: [],
    pendingChanges: [],
    researchCollections: [],
    rideProgress: {},
    activeRecording: null,
  };
}

let snapshot: DatabaseSnapshot = emptySnapshot();

// Mirrors the native adapter: callable from anywhere, free after the first.
let initialized = false;

export function initDatabase() {
  if (initialized) {
    return;
  }

  snapshot = readSnapshot();
  initialized = true;
}

export function createRide(params: {
  id: string;
  startedAt: number;
  vehicleType: VehicleType;
  sensorSource: SensorSource;
}) {
  snapshot.rides = [
    {
      id: params.id,
      startedAt: params.startedAt,
      endedAt: null,
      vehicleType: params.vehicleType,
      sensorSource: params.sensorSource,
      sampleCount: 0,
      distanceMeters: 0,
      movingSeconds: 0,
      maxSpeedMps: 0,
      acceptedFixCount: 0,
      rejectedFixCount: 0,
    },
    ...snapshot.rides,
  ];
  enqueuePendingChange({
    type: "ride.start",
    createdAt: Date.now(),
    payload: {
      rideId: params.id,
      startedAt: params.startedAt,
      vehicleType: params.vehicleType,
      sensorSource: params.sensorSource,
    },
  });
  writeSnapshot();
}

export function finishRide(
  rideId: string,
  endedAt: number,
  metrics?: RideMetricsPayload | undefined
) {
  const sampleCount = snapshot.samples.filter((sample) => sample.rideId === rideId).length;

  snapshot.rides = snapshot.rides.map((ride) =>
    ride.id === rideId
      ? {
          ...ride,
          endedAt,
          sampleCount,
        }
      : ride
  );
  enqueuePendingChange({
    type: "ride.finish",
    createdAt: Date.now(),
    payload: metrics ? { rideId, endedAt, metrics } : { rideId, endedAt },
  });
  writeSnapshot();
}

export function insertSamples(rideId: string, samples: MeasurementSample[]) {
  if (samples.length === 0) {
    return;
  }

  snapshot.samples = [
    ...snapshot.samples,
    ...samples.map((sample) => ({
      ...sample,
      rideId,
    })),
  ];
  enqueueSamplesPendingChange(rideId, samples);
  writeSnapshot();
}

export function setActiveRecording(recording: ActiveRecording) {
  snapshot.activeRecording = recording;
  writeSnapshot();
}

export function getActiveRecording(): ActiveRecording | null {
  return snapshot.activeRecording;
}

export function clearActiveRecording() {
  snapshot.activeRecording = null;
  writeSnapshot();
}

export function getRideProgress(rideId: string): RideProgress {
  const stored = snapshot.rideProgress[rideId];

  return stored ? parseRideProgress(stored) : createRideProgress();
}

export function saveRideProgress(rideId: string, progress: RideProgress) {
  snapshot.rideProgress = {
    ...snapshot.rideProgress,
    [rideId]: progress,
  };
  snapshot.rides = snapshot.rides.map((ride) =>
    ride.id === rideId
      ? {
          ...ride,
          distanceMeters: progress.distanceMeters,
          movingSeconds: progress.movingSeconds,
          maxSpeedMps: progress.maxSpeedMps,
          acceptedFixCount: progress.acceptedFixCount,
          rejectedFixCount: progress.rejectedFixCount,
        }
      : ride
  );
  writeSnapshot();
}

function enqueueSamplesPendingChange(rideId: string, samples: MeasurementSample[]) {
  enqueuePendingChange({
    type: "ride.samples",
    createdAt: Date.now(),
    payload: {
      rideId,
      samples,
    },
  });
}

function enqueuePendingChange(operation: Omit<SyncOperation, "operationId">) {
  snapshot.pendingChanges = [
    ...snapshot.pendingChanges,
    {
      ...operation,
      operationId: createLocalOperationId(),
      attempts: 0,
      lastError: null,
      syncedAt: null,
      nextAttemptAt: 0,
    } as StoredPendingChange,
  ];
}

export function getRides(): Ride[] {
  return [...snapshot.rides].sort((left, right) => right.startedAt - left.startedAt);
}

export function getRide(rideId: string): Ride | null {
  return snapshot.rides.find((ride) => ride.id === rideId) ?? null;
}

export function getSamplesForRide(rideId: string): MeasurementSample[] {
  return snapshot.samples
    .filter((sample) => sample.rideId === rideId)
    .sort((left, right) => left.timestamp - right.timestamp)
    .map(({ rideId: _rideId, ...sample }) => sample);
}

export function getQueuedChanges(limit = 200): PendingChange[] {
  return snapshot.pendingChanges
    .filter((change) => change.syncedAt === null)
    .sort((left, right) => left.createdAt - right.createdAt)
    .slice(0, limit)
    .map(({ syncedAt: _syncedAt, ...change }) => change);
}

export function markPendingChangesSynced(results: SyncOperationResult[]) {
  const syncedAt = Date.now();
  const operationIds = new Set(results.map((result) => result.operationId));

  snapshot.pendingChanges = snapshot.pendingChanges.map((change) =>
    operationIds.has(change.operationId)
      ? {
          ...change,
          syncedAt,
          lastError: null,
        }
      : change
  );
  writeSnapshot();
}

export function markPendingChangesFailed(
  operationIds: string[],
  error: string,
  retryAt: (attempts: number) => number
) {
  const operationIdSet = new Set(operationIds);

  snapshot.pendingChanges = snapshot.pendingChanges.map((change) => {
    if (!operationIdSet.has(change.operationId) || change.syncedAt !== null) {
      return change;
    }

    const attempts = change.attempts + 1;

    return {
      ...change,
      attempts,
      lastError: error,
      nextAttemptAt: retryAt(attempts),
    };
  });
  writeSnapshot();
}

export function getPendingChangeCount() {
  return snapshot.pendingChanges.filter((change) => change.syncedAt === null)
    .length;
}

export function getPendingRideIds(): string[] {
  return [
    ...new Set(
      snapshot.pendingChanges
        .filter((change) => change.syncedAt === null)
        .map((change) => change.payload.rideId)
    ),
  ];
}

export function getPendingChangeSummary(now = Date.now()) {
  const unsynced = snapshot.pendingChanges.filter((change) => change.syncedAt === null);
  const waiting = unsynced
    .filter((change) => change.nextAttemptAt > now)
    .map((change) => change.nextAttemptAt);
  const lastError =
    [...unsynced]
      .sort((left, right) => left.createdAt - right.createdAt)
      .map((change) => change.lastError)
      .filter((value) => value !== null)
      .pop() ?? null;

  return {
    pending: unsynced.length,
    due: unsynced.filter((change) => change.nextAttemptAt <= now).length,
    failing: unsynced.filter((change) => change.attempts > 0).length,
    nextAttemptAt: waiting.length > 0 ? Math.min(...waiting) : null,
    lastError,
  };
}

export function saveResearchCollection(collection: ResearchCollection) {
  snapshot.researchCollections = [
    collection,
    ...snapshot.researchCollections.filter((item) => item.id !== collection.id),
  ];
  writeSnapshot();
}

export function getResearchCollections(): ResearchCollection[] {
  return [...snapshot.researchCollections].sort((left, right) => right.createdAt - left.createdAt);
}

function readSnapshot(): DatabaseSnapshot {
  if (typeof window === "undefined") {
    return snapshot;
  }

  const stored = window.localStorage.getItem(storageKey);

  if (!stored) {
    return snapshot;
  }

  try {
    const parsed = JSON.parse(stored) as Partial<DatabaseSnapshot>;

    return {
      rides: Array.isArray(parsed.rides) ? parsed.rides : [],
      samples: Array.isArray(parsed.samples) ? parsed.samples : [],
      pendingChanges: Array.isArray(parsed.pendingChanges)
        ? parsed.pendingChanges.map((change) => ({
            ...change,
            nextAttemptAt: change.nextAttemptAt ?? 0,
          }))
        : [],
      researchCollections: Array.isArray(parsed.researchCollections)
        ? parsed.researchCollections
        : [],
      rideProgress:
        parsed.rideProgress && typeof parsed.rideProgress === "object"
          ? parsed.rideProgress
          : {},
      activeRecording: parsed.activeRecording ?? null,
    };
  } catch {
    return snapshot;
  }
}

function createLocalOperationId() {
  const randomValue = Math.random().toString(36).slice(2);

  return `op_${Date.now()}_${randomValue}`;
}

function writeSnapshot() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(storageKey, JSON.stringify(snapshot));
}

/** Reset the in-memory database. Only used by tests. */
export function resetDatabaseForTests() {
  snapshot = emptySnapshot();
  initialized = false;
}
