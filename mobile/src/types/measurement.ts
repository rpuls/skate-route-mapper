export type {
  MeasurementSample,
  MeasurementStatus,
  Ride,
  SensorSource,
  VehicleType,
} from "@skate-route-mapper/shared/mobileContracts";

export type { XiaoImuPacket } from "@skate-route-mapper/shared/xiaoBle";

export type ExternalImuPacket = import("@skate-route-mapper/shared/xiaoBle").XiaoImuPacket;

export type ExternalImuDevice = "xiao";
