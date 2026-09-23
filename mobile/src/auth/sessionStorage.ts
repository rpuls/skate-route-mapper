import Storage from "expo-sqlite/kv-store";
import type { MobileAuthResponse } from "@skate-route-mapper/shared/mobileContracts";

const sessionStorageKey = "mobile-auth-session-v1";

function isStoredSession(value: unknown): value is MobileAuthResponse {
  if (!value || typeof value !== "object") {
    return false;
  }

  const session = value as Partial<MobileAuthResponse>;
  return (
    session.ok === true &&
    typeof session.token === "string" &&
    typeof session.expiresAt === "string" &&
    Boolean(session.user) &&
    typeof session.user?.id === "string" &&
    typeof session.user?.email === "string"
  );
}

export async function loadStoredMobileSession() {
  const serialized = await Storage.getItemAsync(sessionStorageKey);

  if (!serialized) {
    return null;
  }

  try {
    const session: unknown = JSON.parse(serialized);
    return isStoredSession(session) ? session : null;
  } catch {
    return null;
  }
}

export async function saveStoredMobileSession(session: MobileAuthResponse) {
  await Storage.setItemAsync(sessionStorageKey, JSON.stringify(session));
}

export async function clearStoredMobileSession() {
  await Storage.removeItemAsync(sessionStorageKey);
}
