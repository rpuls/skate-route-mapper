import { create } from "zustand";
import * as Crypto from "expo-crypto";
import type {
  MeasurementSample,
  MeasurementStatus,
  NessoImuPacket,
  SensorSource,
  VehicleType,
} from "../types/measurement";
import {
  createRide,
  finishRide,
  insertSample,
  insertSamples,
} from "../database/db";

const SAMPLE_BATCH_SIZE = 500;

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
  addSamples: (samples: MeasurementSample[]) => Promise<void>;
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

  addSamples: async (samples) => {
    if (samples.length === 0) {
      return;
    }

    const rideId = get().currentRideId;

    if (rideId) {
      for (let index = 0; index < samples.length; index += SAMPLE_BATCH_SIZE) {
        insertSamples(rideId, samples.slice(index, index + SAMPLE_BATCH_SIZE));
        await yieldToUi();
      }
    }

    set((state) => ({
      samples: [...state.samples, ...samples].slice(-300),
    }));
  },
}));

function yieldToUi() {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}
