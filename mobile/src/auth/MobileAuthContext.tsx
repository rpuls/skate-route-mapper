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
  setSession: (session: MobileAuthResponse) => Promise<void>;
  signOut: () => Promise<void>;
};

const MobileAuthContext = createContext<MobileAuthContextValue | null>(null);

export function MobileAuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<CurrentMobileUser | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);
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
        const session = await loadStoredMobileSession();
        const expiresAt = session ? new Date(session.expiresAt).getTime() : Number.NaN;
        if (!session || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
          await clearStoredMobileSession();
          return;
        }

        if (active) {
          setToken(session.token);
          setUser(session.user);
        }

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
      setSession: async (session) => {
        await saveStoredMobileSession(session);
        setToken(session.token);
        setUser(session.user);
      },
      signOut: async () => {
        await clearStoredMobileSession();
        setToken(null);
        setUser(null);
      },
    }),
    [isRestoring, token, user]
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
