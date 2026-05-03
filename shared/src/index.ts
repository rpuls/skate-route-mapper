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

export {
  brandColors,
  buttonVariants,
  colors,
  componentStyles,
  layout,
  nestedRadius,
  radius,
  shadows,
  skateDesign,
  space,
  typography,
} from "./design";
