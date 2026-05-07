import { create } from "zustand";
import * as Crypto from "expo-crypto";
import type {
  MeasurementSample,
  MeasurementStatus,
  NessoImuPacket,
  SensorSource,
  VehicleType,
} from "../types/measurement";
import { createRide, finishRide, insertSample } from "../database/db";

type MeasurementState = {
  currentRideId: string | null;
  vehicleType: VehicleType;
  sensorSource: SensorSource;
  status: MeasurementStatus;
  samples: MeasurementSample[];
  latestExternalImuSample: NessoImuPacket | null;

  setVehicleType: (vehicleType: VehicleType) => void;
  setSensorSource: (sensorSource: SensorSource) => void;
  setLatestExternalImuSample: (sample: NessoImuPacket | null) => void;

  startRecording: () => string;
  stopRecording: () => void;
  resetRecording: () => void;

  addSample: (sample: MeasurementSample) => void;
};

export const useMeasurementStore = create<MeasurementState>((set, get) => ({
  currentRideId: null,
  vehicleType: "skates",
  sensorSource: "phone",
  status: "ready",
  samples: [],
  latestExternalImuSample: null,

  setVehicleType: (vehicleType) => set({ vehicleType }),
  setSensorSource: (sensorSource) => set({ sensorSource }),
  setLatestExternalImuSample: (sample) => set({ latestExternalImuSample: sample }),

  startRecording: () => {
    const rideId = Crypto.randomUUID();

    createRide({
      id: rideId,
      startedAt: Date.now(),
      vehicleType: get().vehicleType,
      sensorSource: get().sensorSource,
    });

    set({
      currentRideId: rideId,
      status: "recording",
      samples: [],
    });

    return rideId;
  },

  stopRecording: () => {
    const rideId = get().currentRideId;

    if (rideId) {
      finishRide(rideId, Date.now());
    }

    set({
      status: "finished",
      currentRideId: null,
    });
  },

  resetRecording: () =>
    set({
      status: "ready",
      samples: [],
      currentRideId: null,
    }),

  addSample: (sample) => {
    const rideId = get().currentRideId;

    if (rideId) {
      insertSample(rideId, sample);
    }

    set((state) => ({
      samples: [...state.samples.slice(-299), sample],
    }));
  },
}));
