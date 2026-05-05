import { sessionStorageKey } from "../config";
import type { AdminSession } from "../types";

export function readStoredSession() {
  const storedSession = window.localStorage.getItem(sessionStorageKey);

  if (!storedSession) {
    return null;
  }

  try {
    const parsedSession = JSON.parse(storedSession) as AdminSession;

    if (new Date(parsedSession.expiresAt) > new Date()) {
      return parsedSession;
    }
  } catch {
    // Fall through to cleanup below.
  }

  window.localStorage.removeItem(sessionStorageKey);
  return null;
}

export function storeSession(session: AdminSession) {
  window.localStorage.setItem(sessionStorageKey, JSON.stringify(session));
}

export function clearStoredSession() {
  window.localStorage.removeItem(sessionStorageKey);
}
