export type {
  MeasurementSample,
  MeasurementStatus,
  Ride,
  RideFinishPayload,
  RideMetricsPayload,
  RideSamplesPayload,
  RideStartPayload,
  SensorSource,
  VehicleType,
} from "./mobileContracts.js";

export {
  maxOperationsPerSyncRequest,
  maxSamplesPerSyncOperation,
  measurementStatuses,
  sensorSources,
  vehicleTypes,
} from "./mobileContracts.js";

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
