import React, { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import {
  borderWidth,
  buttonVariants,
  colors,
  controlSize,
  radius,
  space,
  stateStyles,
  typography,
} from "@skate-route-mapper/shared/design";
import {
  clearAppLog,
  describeLogEntry,
  diagnosticsAvailable,
  exportAppLog,
  formatLogSize,
  useAppLog,
} from "../diagnostics/log";
import { Icon } from "./Icon";

/**
 * The app log, and a way to get it off the phone.
 *
 * Developer-only by construction: it renders nothing unless
 * `diagnosticsAvailable` is true, which is `__DEV__`, which is true in the
 * build `npm run iphone:build` produces and false in the `preview` and
 * `production` EAS profiles. A rider never meets it. The log itself is written
 * in every build — it is only handing the file over that is a developer's job.
 *
 * It is deliberately plain. It is a diagnostic surface, not a feature, and the
 * moment it stops earning its place it should go.
 */
export function DiagnosticsLog({ compact = false }: { compact?: boolean }) {
  const log = useAppLog();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const latestRssi = log.recent.find(
    (entry) => entry.source === "ble" && entry.event === "rssi"
  );
  const drops = log.recent.filter(
    (entry) => entry.source === "ble" && entry.event === "down"
  ).length;
  const problems = log.recent.filter(
    (entry) => entry.level === "warn" || entry.level === "error"
  ).length;

  const share = async () => {
    setBusy(true);
    setMessage(null);

    try {
      await exportAppLog();
      setMessage("Shared. Send it over and it can be read off the phone.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "The log could not be shared."
      );
    } finally {
      setBusy(false);
    }
  };

  // Not a conditional render at the call site but a refusal here, so there is
  // one rule rather than one per screen that shows it.
  if (!diagnosticsAvailable) {
    return null;
  }

  return (
    <View style={styles.panel}>
      <View style={styles.headline}>
        <Text style={styles.title}>App log</Text>
        <Text numberOfLines={1} style={styles.summary}>
          {log.count === 0
            ? "Nothing recorded yet"
            : `${log.count} event${log.count === 1 ? "" : "s"} · ${formatLogSize(
                log.bytes
              )}`}
        </Text>
      </View>

      {/* What is worth reading without opening the file. Signal strength says
          whether the link has room to spare, and the two counts say whether
          anything went wrong while nobody was watching the screen. They wrap
          rather than truncate: this panel sits in containers of varying
          width. */}
      <View style={styles.stats}>
        <Text style={styles.stat}>
          {typeof latestRssi?.dbm === "number"
            ? `${latestRssi.dbm} dBm`
            : "No signal reading"}
        </Text>
        <Text style={styles.stat}>
          {drops === 0 ? "No recent drops" : `${drops} recent drop${drops === 1 ? "" : "s"}`}
        </Text>
        <Text style={styles.stat}>
          {problems === 0 ? "No warnings" : `${problems} warning${problems === 1 ? "" : "s"}`}
        </Text>
      </View>

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          disabled={busy || log.count === 0}
          onPress={() => void share()}
          style={({ pressed }) => [
            styles.shareButton,
            pressed && styles.pressed,
            (busy || log.count === 0) && stateStyles.disabled,
          ]}
        >
          {busy ? (
            <ActivityIndicator color={colors.textOnOrange} size="small" />
          ) : (
            <Icon color={colors.textOnOrange} name="share" size={18} />
          )}
          <Text numberOfLines={1} style={styles.shareText}>
            {busy ? "Sharing..." : "Share log"}
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => {
            clearAppLog();
            setMessage("Cleared. The next ride starts on a clean log.");
          }}
          style={({ pressed }) => [styles.clearButton, pressed && styles.pressed]}
        >
          <Text style={styles.clearText}>Clear</Text>
        </Pressable>
      </View>

      {message ? <Text style={styles.message}>{message}</Text> : null}

      {compact ? null : (
        <>
          <Pressable
            accessibilityRole="button"
            onPress={() => setExpanded((open) => !open)}
            style={({ pressed }) => [styles.peek, pressed && styles.pressed]}
          >
            <Text style={styles.peekText}>
              {expanded ? "Hide recent events" : "Show recent events"}
            </Text>
            <Icon
              color={colors.accent}
              name={expanded ? "expandLess" : "expandMore"}
              size={18}
            />
          </Pressable>

          {expanded ? (
            <View style={styles.events}>
              {log.recent.length === 0 ? (
                <Text style={styles.eventLine}>
                  Nothing yet. It fills in as the app runs.
                </Text>
              ) : (
                log.recent.slice(0, 20).map((entry, index) => (
                  <Text key={`${entry.t}-${index}`} numberOfLines={2} style={styles.eventLine}>
                    {describeLogEntry(entry)}
                  </Text>
                ))
              )}
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    gap: space.sm,
    padding: space.md,
    // It sits inside cards and sheets of varying width, so it takes what it is
    // given rather than sizing to its content. Without this the stats row can
    // push the panel wider than the card holding it.
    alignSelf: "stretch",
    width: "100%",
  },
  headline: {
    gap: space.xxs,
  },
  title: {
    color: colors.text,
    fontSize: typography.sizes.small,
    fontWeight: typography.weights.bold,
  },
  summary: {
    color: colors.textMuted,
    fontSize: typography.sizes.caption,
  },
  stats: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: space.md,
    rowGap: space.xxs,
  },
  stat: {
    color: colors.textMuted,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.medium,
  },
  actions: {
    alignItems: "center",
    flexDirection: "row",
    gap: space.sm,
  },
  shareButton: {
    alignItems: "center",
    backgroundColor: buttonVariants.secondary.filled.backgroundColor,
    borderRadius: radius.pill,
    flexDirection: "row",
    flexGrow: 1,
    flexShrink: 1,
    gap: space.sm,
    height: controlSize.sm,
    justifyContent: "center",
    minWidth: 0,
    paddingHorizontal: space.md,
  },
  shareText: {
    color: buttonVariants.secondary.filled.color,
    fontSize: typography.sizes.small,
    fontWeight: typography.weights.bold,
  },
  clearButton: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: radius.pill,
    borderWidth: borderWidth.thin,
    flexShrink: 0,
    height: controlSize.sm,
    justifyContent: "center",
    paddingHorizontal: space.md,
  },
  clearText: {
    color: colors.textMuted,
    fontSize: typography.sizes.small,
    fontWeight: typography.weights.medium,
  },
  message: {
    color: colors.textMuted,
    fontSize: typography.sizes.caption,
  },
  peek: {
    alignItems: "center",
    flexDirection: "row",
    gap: space.xs,
  },
  peekText: {
    color: colors.accent,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.medium,
  },
  events: {
    backgroundColor: colors.surface,
    borderRadius: radius.xs,
    gap: space.xxs,
    padding: space.sm,
  },
  eventLine: {
    color: colors.textMuted,
    fontSize: typography.sizes.caption - 1,
  },
  pressed: {
    opacity: 0.82,
  },
});
