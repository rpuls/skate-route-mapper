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
