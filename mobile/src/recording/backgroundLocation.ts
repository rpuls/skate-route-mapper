import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { logWarn } from "../diagnostics/log";
import type { LocationFix } from "@skate-route-mapper/shared/rideTracking";
import { colors } from "@skate-route-mapper/shared/design";
import { getActiveRecording, initDatabase } from "../database/db";
import { rideRecorder } from "./recorder";

/**
 * Background route recording, on both platforms, through one registered task.
 *
 * A tracker that stops when the screen locks is not a tracker.
 * `Location.watchPositionAsync` only runs while a component is mounted and the
 * app is in front, which is why recording used to die on lock. A TaskManager
 * task keeps receiving fixes with the app backgrounded, and — on Android —
 * `expo-location` raises the foreground service the OS requires, so the
 * hand-written Kotlin service is no longer what keeps recording alive.
 *
 * This needs a native rebuild, not a reload: the iOS background modes and the
 * always-on location permission are build-time configuration.
 */
export const rideLocationTaskName = "skate-route-mapper.ride-location";

type LocationTaskPayload = {
  locations?: Location.LocationObject[];
};

export function locationFixFromLocation(location: Location.LocationObject): LocationFix {
  return {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    timestamp: location.timestamp,
    accuracy: location.coords.accuracy ?? null,
    speed: location.coords.speed ?? null,
  };
}

// Defined at module scope. The OS can deliver locations to a cold-started app
// with nothing mounted, and a task that is not defined by then is dropped.
TaskManager.defineTask<LocationTaskPayload>(
  rideLocationTaskName,
  async ({ data, error }) => {
    if (error) {
      logWarn("ride", "locationTaskError", { message: error.message });
      return;
    }

    const locations = data?.locations ?? [];

    if (locations.length === 0) {
      return;
    }

    // The task can run before the app has mounted anything, so the schema is
    // made ready here rather than assumed.
    initDatabase();

    if (!getActiveRecording()) {
      // Nothing is recording, so the task is running on a leftover registration.
      await stopBackgroundLocationUpdates();
      return;
    }

    rideRecorder.recordLocationFixes(locations.map(locationFixFromLocation));
  }
);

export type LocationPermissionState = {
  foreground: boolean;
  background: boolean;
  /** True when the OS can keep sending fixes with the app in the background. */
  canRecordInBackground: boolean;
  message: string | null;
};

/**
 * Ask for location permission, foreground first.
 *
 * iOS will not grant "always" before "when in use", and refuses a second
 * prompt if the first was denied, so the two are requested in order and the
 * background half is allowed to fail: a rider who says no still gets a ride
 * recorded while the app is open.
 */
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

  const backgroundAvailable = await Location.isBackgroundLocationAvailableAsync();

  if (!backgroundAvailable) {
    return {
      foreground: true,
      background: false,
      canRecordInBackground: false,
      message: "Background location is unavailable, so recording stops when the app closes.",
    };
  }

  const background = await Location.requestBackgroundPermissionsAsync();

  if (background.status !== "granted") {
    return {
      foreground: true,
      background: false,
      canRecordInBackground: false,
      message:
        "Allow location “always” to keep recording with the screen locked.",
    };
  }

  return {
    foreground: true,
    background: true,
    canRecordInBackground: true,
    message: null,
  };
}

/**
 * Two seconds or three metres, whichever comes first.
 *
 * Skating covers roughly eight metres in two seconds, so the distance filter
 * is what suppresses updates at a standstill while the time filter keeps the
 * route detailed enough to segment later.
 */
const locationUpdateOptions: Location.LocationTaskOptions = {
  accuracy: Location.Accuracy.BestForNavigation,
  timeInterval: 2000,
  distanceInterval: 3,
  // iOS pauses updates on its own when it thinks you have stopped, and does
  // not reliably resume. A rider waiting at a crossing is not a finished ride.
  pausesUpdatesAutomatically: false,
  activityType: Location.ActivityType.Fitness,
  showsBackgroundLocationIndicator: true,
  foregroundService: {
    notificationTitle: "Recording your skate",
    notificationBody: "Route and speed are being recorded.",
    notificationColor: colors.accent,
  },
};

export async function startBackgroundLocationUpdates() {
  const alreadyRunning = await Location.hasStartedLocationUpdatesAsync(
    rideLocationTaskName
  );

  if (alreadyRunning) {
    await Location.stopLocationUpdatesAsync(rideLocationTaskName);
  }

  await Location.startLocationUpdatesAsync(rideLocationTaskName, locationUpdateOptions);
}

export async function stopBackgroundLocationUpdates() {
  try {
    const running = await Location.hasStartedLocationUpdatesAsync(rideLocationTaskName);

    if (running) {
      await Location.stopLocationUpdatesAsync(rideLocationTaskName);
    }
  } catch (error) {
    logWarn("ride", "stopLocationUpdatesFailed", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function isBackgroundLocationRunning() {
  try {
    return await Location.hasStartedLocationUpdatesAsync(rideLocationTaskName);
  } catch {
    return false;
  }
}
