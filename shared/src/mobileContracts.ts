export const vehicleTypes = ["skates", "skateboard", "longboard"] as const;
export const sensorSources = ["phone", "external"] as const;
export const measurementStatuses = ["idle", "ready", "recording", "paused", "finished"] as const;

export type VehicleType = (typeof vehicleTypes)[number];
export type SensorSource = (typeof sensorSources)[number];
export type MeasurementStatus = (typeof measurementStatuses)[number];

/**
 * How many samples one `ride.samples` operation may carry.
 *
 * The phone buffers samples and flushes them in batches; the backend rejects a
 * batch larger than this. Both sides read the same constant so a flush can
 * never be sized past what the API will take.
 */
export const maxSamplesPerSyncOperation = 1000;

/** How many operations one `POST /v1/mobile/sync` request may carry. */
export const maxOperationsPerSyncRequest = 100;

// A GPS-only ride has no IMU data: the phone tracks the route and the external
// XIAO board owns vibration, so every motion field can legitimately be null.
export type MeasurementSample = {
  timestamp: number;
  ax: number | null;
  ay: number | null;
  az: number | null;
  gx: number | null;
  gy: number | null;
  gz: number | null;
  vibrationMagnitude: number | null;
  latitude: number | null;
  longitude: number | null;
  speed: number | null;
  locationTimestamp?: number | null | undefined;
  locationAccuracy?: number | null | undefined;
  locationAgeMs?: number | null | undefined;
};

/**
 * What a ride covered, stored alongside the ride so a list of rides never has
 * to walk the sample table.
 *
 * The phone computes these live while recording. The backend recomputes them
 * from the synced samples, using the same shared code, so the server's copy
 * does not depend on trusting the client.
 */
export type RideMetricsPayload = {
  distanceMeters: number;
  movingSeconds: number;
  maxSpeedMps: number;
};

export type Ride = {
  id: string;
  startedAt: number;
  endedAt: number | null;
  vehicleType: VehicleType;
  sensorSource: SensorSource;
  sampleCount: number;
  distanceMeters: number;
  movingSeconds: number;
  maxSpeedMps: number;
  acceptedFixCount: number;
  rejectedFixCount: number;
};

export type RideStartPayload = {
  rideId: string;
  startedAt: number;
  vehicleType: VehicleType;
  sensorSource: SensorSource;
  clientId?: string | undefined;
  appVersion?: string | undefined;
  deviceModel?: string | undefined;
};

export type RideSamplesPayload = {
  samples: MeasurementSample[];
};

export type RideFinishPayload = {
  endedAt: number;
  metrics?: RideMetricsPayload | undefined;
};

export type SyncOperation =
  | {
      operationId: string;
      type: "ride.start";
      createdAt: number;
      payload: RideStartPayload;
    }
  | {
      operationId: string;
      type: "ride.samples";
      createdAt: number;
      payload: {
        rideId: string;
        samples: MeasurementSample[];
      };
    }
  | {
      operationId: string;
      type: "ride.finish";
      createdAt: number;
      payload: {
        rideId: string;
        endedAt: number;
        metrics?: RideMetricsPayload | undefined;
      };
    };

export type SyncRequest = {
  operations: SyncOperation[];
  since?: number | null | undefined;
};

export type SyncOperationResult = {
  operationId: string;
  status: "applied" | "duplicate";
};

export type SyncResponse = {
  ok: true;
  results: SyncOperationResult[];
  serverTime: number;
  serverChanges: [];
};

export type MobileDeviceIdentity = {
  clientId?: string | undefined;
  deviceModel?: string | undefined;
  appVersion?: string | undefined;
};

export type MobileSignupPayload = MobileDeviceIdentity & {
  email: string;
  password: string;
  name?: string | undefined;
};

export type MobileLoginPayload = MobileDeviceIdentity & {
  email: string;
  password: string;
};

export type CurrentMobileUser = {
  id: string;
  email: string;
  name: string | null;
};

export type MobileAuthResponse = {
  ok: true;
  token: string;
  expiresAt: string;
  user: CurrentMobileUser;
  deviceId: string | null;
};
