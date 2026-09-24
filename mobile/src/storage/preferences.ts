import Storage from "expo-sqlite/kv-store";

/**
 * Small, non-critical choices that should survive a restart.
 *
 * Rides and captures belong in SQLite, where they are queried and synced. This
 * is for the handful of values that only decide what the UI opens on: which
 * board you ride, whether the sensor should reconnect itself, whether this
 * phone has ever had an account. Losing any of them costs one tap, so the API
 * never throws and a read that fails is simply "not set yet".
 */

export { preferenceKeys } from "./preferenceKeys";

export async function readPreference(key: string): Promise<string | null> {
  try {
    return await Storage.getItemAsync(key);
  } catch {
    return null;
  }
}

export async function writePreference(key: string, value: string): Promise<void> {
  try {
    await Storage.setItemAsync(key, value);
  } catch {
    // A preference that will not save is not worth failing an action over.
  }
}

export async function readBooleanPreference(key: string, fallback: boolean) {
  const stored = await readPreference(key);

  if (stored === null) {
    return fallback;
  }

  return stored === "true";
}

export async function writeBooleanPreference(key: string, value: boolean) {
  await writePreference(key, value ? "true" : "false");
}
