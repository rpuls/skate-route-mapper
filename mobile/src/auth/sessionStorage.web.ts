import type { MobileAuthResponse } from "@skate-route-mapper/shared/mobileContracts";

const sessionStorageKey = "skate-route-mapper-mobile-auth-session-v1";

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
  const serialized = window.localStorage.getItem(sessionStorageKey);

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
  window.localStorage.setItem(sessionStorageKey, JSON.stringify(session));
}

export async function clearStoredMobileSession() {
  window.localStorage.removeItem(sessionStorageKey);
}
