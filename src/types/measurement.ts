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