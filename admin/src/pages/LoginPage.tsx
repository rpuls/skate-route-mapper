import { Alert, Box, Button, Paper, Stack, TextField, Typography } from "@mui/material";
import LoginIcon from "@mui/icons-material/Login";
import { space } from "@skate-route-mapper/shared/design";
import { useState } from "react";
import type { FormEvent } from "react";
import { loginAdmin } from "../api/adminApi";
import { storeSession } from "../session/sessionStore";
import { px, surfaceSx } from "../theme/adminTheme";
import type { AdminSession } from "../types";

export function LoginPage({ onLogin }: { onLogin: (session: AdminSession) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const session = await loginAdmin(email, password);
      storeSession(session);
      setPassword("");
      onLogin(session);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Login failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Box
      sx={{
        alignItems: "center",
        display: "grid",
        minHeight: "100vh",
        p: px(space.xl),
      }}
    >
      <Paper
        component="form"
        elevation={0}
        onSubmit={handleSubmit}
        sx={{
          ...surfaceSx({ shadow: true }),
          justifySelf: "center",
          maxWidth: 430,
          width: "100%",
        }}
      >
        <Stack spacing={2.5}>
          <Box>
            <Typography color="primary" variant="overline">
              Skate Route Mapper
            </Typography>
            <Typography variant="h2">Admin sign in</Typography>
            <Typography color="text.secondary" sx={{ mt: 1 }}>
              Use the initial admin account or a later created admin user.
            </Typography>
          </Box>

          <TextField
            autoComplete="email"
            label="Email"
            onChange={(event) => setEmail(event.target.value)}
            required
            type="email"
            value={email}
          />
          <TextField
            autoComplete="current-password"
            label="Password"
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />

          {error ? <Alert severity="error">{error}</Alert> : null}

          <Button disabled={isSubmitting} startIcon={<LoginIcon />} type="submit" variant="contained">
            {isSubmitting ? "Signing in..." : "Sign in"}
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
}
