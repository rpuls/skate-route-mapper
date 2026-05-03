import { useEffect, useState } from "react";
import type { FormEvent } from "react";

const sessionStorageKey = "skate-route-mapper-admin-session";
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

type AdminSession = {
  token: string;
  expiresAt: string;
  adminUser: {
    id: string;
    email: string;
    role: string;
  };
};

export default function App() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [session, setSession] = useState<AdminSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const storedSession = window.localStorage.getItem(sessionStorageKey);

    if (!storedSession) {
      return;
    }

    try {
      const parsedSession = JSON.parse(storedSession) as AdminSession;

      if (new Date(parsedSession.expiresAt) > new Date()) {
        setSession(parsedSession);
      } else {
        window.localStorage.removeItem(sessionStorageKey);
      }
    } catch {
      window.localStorage.removeItem(sessionStorageKey);
    }
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch(`${apiBaseUrl}/v1/admin/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          password,
        }),
      });

      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.message ?? "Login failed");
      }

      const nextSession = body as AdminSession;
      window.localStorage.setItem(sessionStorageKey, JSON.stringify(nextSession));
      setSession(nextSession);
      setPassword("");
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Login failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleLogout() {
    window.localStorage.removeItem(sessionStorageKey);
    setSession(null);
  }

  return (
    <main className="page">
      <header className="topbar">
        <div>
          <p className="eyebrow">Skate Route Mapper</p>
          <h1>Admin Dashboard</h1>
        </div>
        {session ? (
          <button className="ghostButton" type="button" onClick={handleLogout}>
            Sign out
          </button>
        ) : null}
      </header>

      {session ? (
        <section className="workspace">
          <div>
            <h2>Signed in</h2>
            <p>
              {session.adminUser.email} has an active {session.adminUser.role} session.
            </p>
          </div>
          <div className="statusGrid">
            <article>
              <span>Session expires</span>
              <strong>{new Date(session.expiresAt).toLocaleString()}</strong>
            </article>
            <article>
              <span>API</span>
              <strong>{apiBaseUrl}</strong>
            </article>
          </div>
        </section>
      ) : (
        <section className="loginShell">
          <form className="loginPanel" onSubmit={handleSubmit}>
            <div>
              <h2>Admin sign in</h2>
              <p>Use the initial Railway admin account or a later created admin user.</p>
            </div>

            <label>
              Email
              <input
                autoComplete="email"
                inputMode="email"
                name="email"
                onChange={(event) => setEmail(event.target.value)}
                required
                type="email"
                value={email}
              />
            </label>

            <label>
              Password
              <input
                autoComplete="current-password"
                name="password"
                onChange={(event) => setPassword(event.target.value)}
                required
                type="password"
                value={password}
              />
            </label>

            {error ? <p className="formError">{error}</p> : null}

            <button className="primaryButton" disabled={isSubmitting} type="submit">
              {isSubmitting ? "Signing in..." : "Sign in"}
            </button>
          </form>
        </section>
      )}
    </main>
  );
}
