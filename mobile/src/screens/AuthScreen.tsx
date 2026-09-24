import React, { useEffect, useState } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  buttonVariants,
  colors,
  radius,
  shadows,
  space,
  stateStyles,
} from "@skate-route-mapper/shared/design";
import { loginMobileUser, signupMobileUser } from "../api/mobileAuth";
import { useMobileAuth } from "../auth/MobileAuthContext";
import { Card } from "../components/Card";
import { Icon } from "../components/Icon";
import { Page } from "../components/Page";

type AuthMode = "signup" | "login";

function isValidEmailAddress(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function getFriendlySubmitError(error: unknown) {
  if (!(error instanceof Error)) {
    return "Unable to sign in. Please try again.";
  }

  if (
    error.message === "Failed to fetch" ||
    error.message === "Network request failed"
  ) {
    return "Could not connect. Check your connection and try again.";
  }

  return error.message;
}

export default function AuthScreen() {
  const { hasKnownAccount, isRestoring, setSession, signOut, user } =
    useMobileAuth();
  // Signing up is only the right default the first time. Afterwards the person
  // in front of this form already has an account, and offering them "Create
  // account" first makes their normal case the one that needs a correction.
  const [authMode, setAuthMode] = useState<AuthMode>(
    hasKnownAccount ? "login" : "signup"
  );
  const [modeChosen, setModeChosen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Whether an account exists is read from storage, so it can arrive after the
  // first paint. Until someone picks a tab themselves, follow the answer.
  useEffect(() => {
    if (!modeChosen && hasKnownAccount) {
      setAuthMode("login");
    }
  }, [hasKnownAccount, modeChosen]);

  const actionLabel = authMode === "signup" ? "Create account" : "Sign in";
  const isSignup = authMode === "signup";
  const hasValidPasswordLength = password.length >= 8;
  const passwordsMatch = password === confirmPassword;
  const canSubmit =
    !submitting && (!isSignup || (hasValidPasswordLength && passwordsMatch));
  const webClientId = Platform.OS === "web" ? "web-dev-client" : undefined;

  const handleAuthSubmit = async () => {
    const trimmedEmail = email.trim();

    if (!trimmedEmail) {
      setMessage("Enter your email address.");
      return;
    }

    if (!isValidEmailAddress(trimmedEmail)) {
      setMessage("Enter a valid email address.");
      return;
    }

    if (!password) {
      setMessage("Enter your password.");
      return;
    }

    if (isSignup && !hasValidPasswordLength) {
      setMessage("Use at least 8 characters for your password.");
      return;
    }

    if (isSignup && !confirmPassword) {
      setMessage("Confirm your password.");
      return;
    }

    if (isSignup && !passwordsMatch) {
      setMessage("Passwords do not match.");
      return;
    }

    if (submitting) {
      return;
    }

    setSubmitting(true);
    setMessage(`${actionLabel}...`);

    try {
      const payload = {
        email: trimmedEmail,
        password,
        clientId: webClientId,
        appVersion: "1.0.0",
        deviceModel: Platform.OS === "web" ? "Web browser" : undefined,
      };
      const session = isSignup
        ? await signupMobileUser(payload)
        : await loginMobileUser(payload);

      await setSession(session);
      setPassword("");
      setConfirmPassword("");
      setMessage(`Signed in as ${session.user.email}.`);
    } catch (error) {
      setMessage(getFriendlySubmitError(error));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    setMessage("");
  };

  return (
    <Page
      subtitle="Sign in when you want future recovery and sync. Skating stays local-first."
      title="Account"
    >
      <Card>
        {!user && !isRestoring && (
          <View style={styles.modeTabs}>
            {(hasKnownAccount
              ? (["login", "signup"] as const)
              : (["signup", "login"] as const)
            ).map((mode) => {
              const selected = authMode === mode;

              return (
                <Pressable
                  key={mode}
                  disabled={submitting}
                  onPress={() => {
                    setModeChosen(true);
                    setAuthMode(mode);
                  }}
                  style={[
                    styles.modeButton,
                    selected && styles.modeButtonSelected,
                  ]}
                >
                  <Text
                    style={[
                      styles.modeButtonText,
                      selected && styles.modeButtonTextSelected,
                    ]}
                  >
                    {mode === "signup" ? "Sign up" : "Log in"}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {isRestoring ? (
          <View style={styles.statusPanel}>
            <Text style={styles.statusCopy}>Restoring your session...</Text>
          </View>
        ) : user ? (
          <View style={styles.statusPanel}>
            <Text style={styles.statusTitle}>{user.email}</Text>
            <Text style={styles.statusCopy}>
              Your session is active. Start and saved rides are still available
              from the menu.
            </Text>
            <Pressable onPress={handleSignOut} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>Sign out</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.form}>
            <TextInput
              accessibilityLabel="Email"
              autoCapitalize="none"
              autoComplete="email"
              inputMode="email"
              onChangeText={setEmail}
              placeholder="Email"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              value={email}
            />

            <TextInput
              accessibilityLabel="Password"
              autoCapitalize="none"
              onChangeText={setPassword}
              placeholder="Password"
              placeholderTextColor={colors.textMuted}
              secureTextEntry
              style={styles.input}
              value={password}
            />

            {isSignup && (
              <>
                <TextInput
                  accessibilityLabel="Confirm password"
                  autoCapitalize="none"
                  onChangeText={setConfirmPassword}
                  placeholder="Confirm password"
                  placeholderTextColor={colors.textMuted}
                  secureTextEntry
                  style={styles.input}
                  value={confirmPassword}
                />

                <Text style={styles.passwordHelper}>Minimum 8 characters</Text>
              </>
            )}

            <Pressable
              disabled={!canSubmit}
              onPress={handleAuthSubmit}
              style={[
                styles.primaryButton,
                !canSubmit && styles.buttonDisabled,
              ]}
            >
              <Text style={styles.primaryButtonText}>{actionLabel}</Text>
            </Pressable>
          </View>
        )}

        {message ? <Text style={styles.message}>{message}</Text> : null}
      </Card>

      <View style={styles.infoBand}>
        <View style={styles.infoHeading}>
          <Icon color={colors.accentStrong} name="info" size={20} />
          <Text style={styles.infoTitle}>Your privacy matters</Text>
        </View>
        <Text style={styles.infoCopy}>
          You can use Skate Route Mapper without creating an account. If you
          prefer to stay anonymous, you can still record rides, but account
          features like backup, sync, and recovery will not be available.
        </Text>
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  modeTabs: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 16,
  },
  modeButton: {
    alignItems: "center",
    borderColor: colors.accent,
    borderRadius: radius.pill,
    borderWidth: 2,
    flex: 1,
    minHeight: 44,
    justifyContent: "center",
  },
  modeButtonSelected: {
    backgroundColor: colors.accent,
  },
  modeButtonText: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: "900",
  },
  modeButtonTextSelected: {
    color: colors.textOnOrange,
  },
  form: {
    gap: 10,
  },
  input: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.accent,
    borderRadius: radius.md,
    borderWidth: 2,
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
    minHeight: 50,
    paddingHorizontal: 14,
  },
  passwordHelper: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "600",
    marginTop: -4,
    opacity: 0.72,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: buttonVariants.primary.filled.backgroundColor,
    borderColor: buttonVariants.primary.filled.borderColor,
    borderRadius: radius.lg,
    borderWidth: 2,
    justifyContent: "center",
    minHeight: 50,
  },
  buttonDisabled: {
    ...stateStyles.disabled,
  },
  primaryButtonText: {
    color: buttonVariants.primary.filled.color,
    fontSize: 15,
    fontWeight: "900",
  },
  statusPanel: {
    backgroundColor: colors.surfaceWarm,
    borderRadius: radius.lg,
    gap: 8,
    padding: 14,
  },
  statusTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "900",
  },
  statusCopy: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  secondaryButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    flexDirection: "row",
    gap: space.sm,
    borderColor: buttonVariants.primary.contained.borderColor,
    borderRadius: radius.pill,
    borderWidth: 2,
    justifyContent: "center",
    minHeight: 40,
    paddingHorizontal: 14,
  },
  secondaryButtonText: {
    color: buttonVariants.primary.contained.color,
    fontSize: 13,
    fontWeight: "900",
  },
  message: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 12,
  },
  infoBand: {
    backgroundColor: colors.surfaceWarm,
    borderRadius: radius.xl,
    padding: space.lg,
  },
  infoHeading: {
    alignItems: "center",
    flexDirection: "row",
    gap: space.sm,
    marginBottom: 8,
  },
  infoTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "900",
  },
  infoCopy: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
});
