import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  CurrentMobileUser,
  MobileAuthResponse,
} from "@skate-route-mapper/shared/mobileContracts";
import {
  getCurrentMobileUser,
  InvalidMobileSessionError,
} from "../api/mobileAuth";
import {
  preferenceKeys,
  readBooleanPreference,
  writeBooleanPreference,
} from "../storage/preferences";
import { startAutoSync, stopAutoSync } from "../sync/autoSync";
import {
  clearStoredMobileSession,
  loadStoredMobileSession,
  saveStoredMobileSession,
} from "./sessionStorage";

type MobileAuthContextValue = {
  token: string | null;
  user: CurrentMobileUser | null;
  isRestoring: boolean;
  /**
   * Whether an account has ever been used on this phone.
   *
   * Signing out does not clear it. A returning user who signed out still has
   * an account, and the auth screen should open on the form they need rather
   * than on the one that tells them their email is already taken.
   */
  hasKnownAccount: boolean;
  setSession: (session: MobileAuthResponse) => Promise<void>;
  signOut: () => Promise<void>;
};

const MobileAuthContext = createContext<MobileAuthContextValue | null>(null);

export function MobileAuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<CurrentMobileUser | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);
  const [hasKnownAccount, setHasKnownAccount] = useState(false);
  // Auto sync reads the token when it runs rather than capturing it, so a
  // sign-in or sign-out does not have to restart the scheduler.
  const tokenRef = useRef<string | null>(null);

  tokenRef.current = token;

  useEffect(() => {
    startAutoSync({ getToken: () => tokenRef.current });

    return () => {
      stopAutoSync();
    };
  }, []);

  useEffect(() => {
    let active = true;

    async function restoreSession() {
      try {
        const known = await readBooleanPreference(preferenceKeys.accountKnown, false);

        if (active && known) {
          setHasKnownAccount(true);
        }

        const session = await loadStoredMobileSession();
        const expiresAt = session ? new Date(session.expiresAt).getTime() : Number.NaN;
        if (!session || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
          await clearStoredMobileSession();
          return;
        }

        if (active) {
          setToken(session.token);
          setUser(session.user);
          setHasKnownAccount(true);
        }

        // A stored session proves an account exists even if the flag predates
        // this build or was never written.
        void writeBooleanPreference(preferenceKeys.accountKnown, true);

        try {
          const currentUser = await getCurrentMobileUser(session.token);
          if (active) {
            setUser(currentUser);
          }
        } catch (error) {
          if (error instanceof InvalidMobileSessionError) {
            await clearStoredMobileSession();
            if (active) {
              setToken(null);
              setUser(null);
            }
          }
        }
      } catch {
        // A storage failure must not prevent local-first use of the app.
      } finally {
        if (active) {
          setIsRestoring(false);
        }
      }
    }

    void restoreSession();
    return () => {
      active = false;
    };
  }, []);

  const value = useMemo<MobileAuthContextValue>(
    () => ({
      token,
      user,
      isRestoring,
      hasKnownAccount,
      setSession: async (session) => {
        await saveStoredMobileSession(session);
        await writeBooleanPreference(preferenceKeys.accountKnown, true);
        setToken(session.token);
        setUser(session.user);
        setHasKnownAccount(true);
      },
      signOut: async () => {
        await clearStoredMobileSession();
        setToken(null);
        setUser(null);
      },
    }),
    [hasKnownAccount, isRestoring, token, user]
  );

  return (
    <MobileAuthContext.Provider value={value}>
      {children}
    </MobileAuthContext.Provider>
  );
}

export function useMobileAuth() {
  const context = useContext(MobileAuthContext);

  if (!context) {
    throw new Error("useMobileAuth must be used inside MobileAuthProvider");
  }

  return context;
}
