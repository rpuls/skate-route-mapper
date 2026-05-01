import { create } from "zustand";
import type {
  MeasurementSample,
  MeasurementStatus,
  SensorSource,
  VehicleType,
} from "../types/measurement";

type MeasurementState = {
  vehicleType: VehicleType;
  sensorSource: SensorSource;
  status: MeasurementStatus;
  samples: MeasurementSample[];

  setVehicleType: (vehicleType: VehicleType) => void;
  setSensorSource: (sensorSource: SensorSource) => void;

  startRecording: () => void;
  stopRecording: () => void;
  resetRecording: () => void;

  addSample: (sample: MeasurementSample) => void;
};

export const useMeasurementStore = create<MeasurementState>((set) => ({
  vehicleType: "skates",
  sensorSource: "phone",
  status: "ready",
  samples: [],

  setVehicleType: (vehicleType) => set({ vehicleType }),
  setSensorSource: (sensorSource) => set({ sensorSource }),

  startRecording: () =>
    set({
      status: "recording",
      samples: [],
    }),

  stopRecording: () =>
    set({
      status: "finished",
    }),

  resetRecording: () =>
    set({
      status: "ready",
      samples: [],
    }),

  addSample: (sample) =>
    set((state) => ({
      samples: [...state.samples.slice(-299), sample],
    })),
}));