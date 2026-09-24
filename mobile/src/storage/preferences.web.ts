/**
 * Web fallback for `preferences.ts`.
 *
 * `expo-sqlite/kv-store` has no browser implementation, and `npm run dev:web`
 * is where the layouts are checked, so the same choices have to stick across a
 * reload there too. `localStorage` is the browser's equivalent and is just as
 * safe to lose.
 */

export { preferenceKeys } from "./preferenceKeys";

export async function readPreference(key: string): Promise<string | null> {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export async function writePreference(key: string, value: string): Promise<void> {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private browsing and full quotas both throw here. Neither is worth
    // failing the action the preference was a side effect of.
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
