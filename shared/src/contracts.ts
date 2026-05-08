export type VehicleType = "skates" | "skateboard" | "longboard";
export type SensorSource = "phone" | "external";
export type MeasurementStatus = "idle" | "ready" | "recording" | "paused" | "finished";

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

export type AdminUserSummary = {
  id: string;
  email: string;
  name: string | null;
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminUserCreatePayload = {
  email: string;
  password: string;
  name?: string | undefined;
  active?: boolean | undefined;
};

export type AdminUserUpdatePayload = {
  email?: string | undefined;
  password?: string | undefined;
  name?: string | null | undefined;
  active?: boolean | undefined;
};
