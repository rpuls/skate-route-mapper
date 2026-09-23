import { useEffect, useState } from "react";
import { AdminShell } from "./components/layout/AdminShell";
import { DashboardPage } from "./pages/DashboardPage";
import { EntityManagementPage } from "./pages/EntityManagementPage";
import { LoginPage } from "./pages/LoginPage";
import { HardwareBenchPage } from "./pages/HardwareBenchPage";
import { clearStoredSession, readStoredSession } from "./session/sessionStore";
import type { AdminSession, AdminView } from "./types";

function viewTitle(view: AdminView) {
  if (view === "entities") return "Entity management";
  if (view === "hardware") return "Hardware bench";
  return "Dashboard";
}

export default function App() {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [activeView, setActiveView] = useState<AdminView>("dashboard");

  useEffect(() => {
    setSession(readStoredSession());
  }, []);

  function handleLogout() {
    clearStoredSession();
    setSession(null);
    setActiveView("dashboard");
  }

  if (!session) {
    return <LoginPage onLogin={setSession} />;
  }

  return (
    <AdminShell
      activeView={activeView}
      onLogout={handleLogout}
      onNavigate={setActiveView}
      session={session}
      title={viewTitle(activeView)}
    >
      {activeView === "entities" && <EntityManagementPage session={session} />}
      {activeView === "hardware" && <HardwareBenchPage />}
      {activeView === "dashboard" && <DashboardPage onNavigate={setActiveView} session={session} />}
    </AdminShell>
  );
}
