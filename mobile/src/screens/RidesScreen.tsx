import React, { useCallback, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  StyleSheet,
  Pressable,
  FlatList,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import dayjs from "dayjs";
import {
  formatDistance,
  formatDuration,
  formatSpeedKmh,
} from "@skate-route-mapper/shared/rideTracking";
import {
  getPendingChangeSummary,
  getPendingRideIds,
  getRides,
} from "../database/db";
import type { Ride } from "../types/measurement";
import {
  buttonVariants,
  colors,
  radius,
  shadows,
  space,
  stateStyles,
} from "@skate-route-mapper/shared/design";
import { ScreenHeader } from "../components/AppMenu";
import { useMobileAuth } from "../auth/MobileAuthContext";
import { syncPendingChanges } from "../sync/syncService";

type PendingSummary = ReturnType<typeof getPendingChangeSummary>;

const emptySummary: PendingSummary = {
  pending: 0,
  due: 0,
  failing: 0,
  nextAttemptAt: null,
  lastError: null,
};

export default function RidesScreen() {
  const navigation = useNavigation<any>();
  const { token } = useMobileAuth();
  const [rides, setRides] = useState<Ride[]>([]);
  const [summary, setSummary] = useState<PendingSummary>(emptySummary);
  const [pendingRideIds, setPendingRideIds] = useState<Set<string>>(new Set());
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");

  const refreshLocalState = useCallback(() => {
    setRides(getRides());
    setSummary(getPendingChangeSummary());
    setPendingRideIds(new Set(getPendingRideIds()));
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshLocalState();
    }, [refreshLocalState])
  );

  const handleSync = async () => {
    if (syncing) {
      return;
    }

    setSyncing(true);
    setSyncMessage("Uploading...");

    // A ride is many operations now that samples are batched, so the count
    // climbing is the only sign that a long upload is working.
    const result = await syncPendingChanges({
      token,
      onProgress: ({ sentOperations, totalOperations }) => {
        setSyncMessage(`Uploaded ${sentOperations} of ${totalOperations} changes...`);
      },
    });

    refreshLocalState();

    if (result.ok) {
      setSyncMessage(
        result.synced === 0
          ? "Everything is already uploaded."
          : `Uploaded ${result.synced} change${result.synced === 1 ? "" : "s"}.`
      );
    } else if (result.reason === "missing-auth-token") {
      setSyncMessage("Sign in before uploading saved rides.");
    } else {
      setSyncMessage(result.message);
    }

    setSyncing(false);
  };

  const canSync = summary.due > 0 && !syncing;
  const waitingMessage =
    summary.due === 0 && summary.pending > 0 && summary.nextAttemptAt !== null
      ? `Retrying in ${formatDuration(
          Math.max(0, (summary.nextAttemptAt - Date.now()) / 1000)
        )}`
      : null;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <ScreenHeader
          title="Saved Rides"
          subtitle="Local rides stored on this device."
        />

        <View style={styles.syncPanel}>
          <View>
            <Text style={styles.syncCount}>{summary.pending}</Text>
            <Text style={styles.syncLabel}>
              {summary.failing > 0
                ? `pending · ${summary.failing} retrying`
                : "pending uploads"}
            </Text>
          </View>

          <Pressable
            disabled={!canSync}
            onPress={handleSync}
            style={[styles.syncButton, !canSync && styles.buttonDisabled]}
          >
            <Text style={styles.syncButtonText}>
              {syncing ? "Uploading" : "Upload"}
            </Text>
          </Pressable>
        </View>

        {syncMessage ? <Text style={styles.syncMessage}>{syncMessage}</Text> : null}
        {waitingMessage ? (
          <Text style={styles.syncMessage}>{waitingMessage}</Text>
        ) : null}

        <FlatList
          data={rides}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No rides yet</Text>
              <Text style={styles.emptyText}>
                Start a route scan to save your first skating ride.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              style={styles.rideCard}
              onPress={() =>
                navigation.navigate("RideDetail", {
                  rideId: item.id,
                })
              }
            >
              <View style={styles.rideHeader}>
                <View>
                  <Text style={styles.rideTitle}>
                    {dayjs(item.startedAt).format("DD MMM YYYY - HH:mm")}
                  </Text>
                  <Text style={styles.rideMeta}>
                    {item.vehicleType} - {item.sensorSource}
                  </Text>
                </View>

                <View style={styles.rideStats}>
                  <Text style={styles.sampleCount}>
                    {formatDistance(item.distanceMeters)}
                  </Text>
                  <Text style={styles.sampleLabel}>
                    {formatDuration(item.movingSeconds)} moving
                  </Text>
                </View>
              </View>

              {pendingRideIds.has(item.id) ? (
                <Text style={styles.pendingTag}>Waiting to upload</Text>
              ) : null}

              <View style={styles.rideFooter}>
                <Text style={styles.footerMetric}>
                  Avg{" "}
                  {formatSpeedKmh(
                    item.movingSeconds > 0
                      ? item.distanceMeters / item.movingSeconds
                      : 0
                  )}
                </Text>
                <Text style={styles.footerMetric}>
                  Max {formatSpeedKmh(item.maxSpeedMps)}
                </Text>
                <Text style={styles.footerMetric}>{item.sampleCount} samples</Text>
              </View>
            </Pressable>
          )}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.page,
  },
  container: {
    flex: 1,
    padding: 20,
  },
  listContent: {
    gap: 12,
    paddingBottom: 48,
  },
  syncPanel: {
    alignItems: "center",
    backgroundColor: colors.surfaceWarm,
    borderRadius: radius.xl,
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
    padding: space.lg,
  },
  syncCount: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "900",
  },
  syncLabel: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "800",
    marginTop: 2,
  },
  syncButton: {
    alignItems: "center",
    backgroundColor: buttonVariants.primary.filled.backgroundColor,
    borderColor: buttonVariants.primary.filled.borderColor,
    borderRadius: radius.lg,
    borderWidth: 2,
    justifyContent: "center",
    minHeight: 44,
    minWidth: 96,
    paddingHorizontal: space.lg,
  },
  syncButtonText: {
    color: buttonVariants.primary.filled.color,
    fontSize: 14,
    fontWeight: "900",
  },
  buttonDisabled: {
    ...stateStyles.disabled,
  },
  syncMessage: {
    color: colors.textOnOrange,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
    marginBottom: 10,
    opacity: 0.88,
  },
  rideCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: space.lg,
    gap: space.md,
    ...shadows.tile,
  },
  rideHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  rideTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "800",
    marginBottom: 6,
  },
  rideMeta: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: "600",
  },
  rideStats: {
    alignItems: "flex-end",
  },
  sampleCount: {
    color: colors.accent,
    fontSize: 22,
    fontWeight: "900",
  },
  sampleLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
  },
  pendingTag: {
    color: colors.accentStrong,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  rideFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.lg,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  footerMetric: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "800",
  },
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: 20,
    ...shadows.tile,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "900",
    marginBottom: 8,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 21,
  },
});
