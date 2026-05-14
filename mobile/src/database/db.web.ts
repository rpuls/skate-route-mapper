import type {
  SyncOperation,
  SyncOperationResult,
} from "@skate-route-mapper/shared/mobileContracts";
import type { MeasurementSample, Ride, SensorSource, VehicleType } from "../types/measurement";

type StoredSample = MeasurementSample & {
  rideId: string;
};

export type PendingChange = SyncOperation & {
  attempts: number;
  lastError: string | null;
};

type DatabaseSnapshot = {
  rides: Ride[];
  samples: StoredSample[];
  pendingChanges: Array<PendingChange & { syncedAt: number | null }>;
};

const storageKey = "skate-route-mapper-web-db";

let snapshot: DatabaseSnapshot = {
  rides: [],
  samples: [],
  pendingChanges: [],
};

export function initDatabase() {
  snapshot = readSnapshot();
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

export function finishRide(rideId: string, endedAt: number) {
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
    payload: {
      rideId,
      endedAt,
    },
  });
  writeSnapshot();
}

export function insertSample(rideId: string, sample: MeasurementSample) {
  snapshot.samples = [
    ...snapshot.samples,
    {
      ...sample,
      rideId,
    },
  ];
  enqueueSamplesPendingChange(rideId, [sample]);
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
    } as PendingChange & { syncedAt: number | null },
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

export function getPendingChanges(limit = 50): PendingChange[] {
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

export function markPendingChangesFailed(operationIds: string[], error: string) {
  const operationIdSet = new Set(operationIds);

  snapshot.pendingChanges = snapshot.pendingChanges.map((change) =>
    operationIdSet.has(change.operationId) && change.syncedAt === null
      ? {
          ...change,
          attempts: change.attempts + 1,
          lastError: error,
        }
      : change
  );
  writeSnapshot();
}

export function getPendingChangeCount() {
  return snapshot.pendingChanges.filter((change) => change.syncedAt === null)
    .length;
}

export function getLatestSamples(limit = 20) {
  return [...snapshot.samples]
    .sort((left, right) => right.timestamp - left.timestamp)
    .slice(0, limit);
}

export function getLatestRideWithSamples(limit = 20) {
  return [...snapshot.samples]
    .sort((left, right) => right.timestamp - left.timestamp)
    .slice(0, limit)
    .map((sample) => {
      const ride = getRide(sample.rideId);

      return {
        rideId: sample.rideId,
        startedAt: ride?.startedAt ?? null,
        endedAt: ride?.endedAt ?? null,
        vehicleType: ride?.vehicleType ?? null,
        timestamp: sample.timestamp,
        vibrationMagnitude: sample.vibrationMagnitude,
        latitude: sample.latitude,
        longitude: sample.longitude,
        speed: sample.speed,
      };
    });
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
        ? parsed.pendingChanges
        : [],
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
