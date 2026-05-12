import React, { createContext, useContext, useMemo, useState } from "react";
import type {
  CurrentMobileUser,
  MobileAuthResponse,
} from "@skate-route-mapper/shared/mobileContracts";

type MobileAuthContextValue = {
  token: string | null;
  user: CurrentMobileUser | null;
  setSession: (session: MobileAuthResponse) => void;
  signOut: () => void;
};

const MobileAuthContext = createContext<MobileAuthContextValue | null>(null);

export function MobileAuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<CurrentMobileUser | null>(null);

  const value = useMemo<MobileAuthContextValue>(
    () => ({
      token,
      user,
      setSession: (session) => {
        setToken(session.token);
        setUser(session.user);
      },
      signOut: () => {
        setToken(null);
        setUser(null);
      },
    }),
    [token, user]
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
