import * as Location from "expo-location";
import type { LocationFix } from "@skate-route-mapper/shared/rideTracking";
import { getActiveRecording, initDatabase } from "../database/db";
import { rideRecorder } from "./recorder";

/**
 * Web fallback for background route recording.
 *
 * `expo-task-manager` has no web implementation and
 * `Location.startLocationUpdatesAsync` throws in a browser, so the web target
 * watches position from the page instead. A browser tab cannot record with the
 * screen off, which is fine: `npm run dev:web` exists for layout checks, and
 * real recording behaviour has to be tested on a device anyway.
 */
export const rideLocationTaskName = "skate-route-mapper.ride-location";

export function locationFixFromLocation(location: Location.LocationObject): LocationFix {
  return {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    timestamp: location.timestamp,
    accuracy: location.coords.accuracy ?? null,
    speed: location.coords.speed ?? null,
  };
}

export type LocationPermissionState = {
  foreground: boolean;
  background: boolean;
  canRecordInBackground: boolean;
  message: string | null;
};

export async function requestLocationPermissions(): Promise<LocationPermissionState> {
  const foreground = await Location.requestForegroundPermissionsAsync();

  if (foreground.status !== "granted") {
    return {
      foreground: false,
      background: false,
      canRecordInBackground: false,
      message: "Location permission is needed to record a route.",
    };
  }

  return {
    foreground: true,
    background: false,
    canRecordInBackground: false,
    message: "The browser preview only records while this tab is open.",
  };
}

let subscription: Location.LocationSubscription | null = null;

export async function startBackgroundLocationUpdates() {
  await stopBackgroundLocationUpdates();

  subscription = await Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.BestForNavigation,
      timeInterval: 2000,
      distanceInterval: 3,
    },
    (location) => {
      initDatabase();

      if (!getActiveRecording()) {
        void stopBackgroundLocationUpdates();
        return;
      }

      rideRecorder.recordLocationFixes([locationFixFromLocation(location)]);
    }
  );
}

export async function stopBackgroundLocationUpdates() {
  subscription?.remove();
  subscription = null;
}

export async function isBackgroundLocationRunning() {
  return subscription !== null;
}
