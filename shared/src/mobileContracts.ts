export const vehicleTypes = ["skates", "skateboard", "longboard"] as const;
export const sensorSources = ["phone", "external"] as const;
export const measurementStatuses = ["idle", "ready", "recording", "paused", "finished"] as const;

export type VehicleType = (typeof vehicleTypes)[number];
export type SensorSource = (typeof sensorSources)[number];
export type MeasurementStatus = (typeof measurementStatuses)[number];

export type MeasurementSample = {
  timestamp: number;
  ax: number;
  ay: number;
  az: number;
  gx: number;
  gy: number;
  gz: number;
  vibrationMagnitude: number;
  latitude: number | null;
  longitude: number | null;
  speed: number | null;
  locationTimestamp?: number | null | undefined;
  locationAccuracy?: number | null | undefined;
  locationAgeMs?: number | null | undefined;
};

export type Ride = {
  id: string;
  startedAt: number;
  endedAt: number | null;
  vehicleType: VehicleType;
  sensorSource: SensorSource;
  sampleCount: number;
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
