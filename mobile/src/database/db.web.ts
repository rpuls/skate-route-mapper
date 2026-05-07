import type { MeasurementSample, Ride, SensorSource, VehicleType } from "../types/measurement";

type StoredSample = MeasurementSample & {
  rideId: string;
};

type DatabaseSnapshot = {
  rides: Ride[];
  samples: StoredSample[];
};

const storageKey = "skate-route-mapper-web-db";

let snapshot: DatabaseSnapshot = {
  rides: [],
  samples: [],
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
  writeSnapshot();
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
    };
  } catch {
    return snapshot;
  }
}

function writeSnapshot() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(storageKey, JSON.stringify(snapshot));
}
