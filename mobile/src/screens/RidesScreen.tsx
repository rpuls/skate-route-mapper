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
import { getPendingChangeCount, getRides } from "../database/db";
import type { Ride } from "../types/measurement";
//For debugging
import { getLatestRideWithSamples } from "../database/db";
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

export default function RidesScreen() {
  const navigation = useNavigation<any>();
  const { token } = useMobileAuth();
  const [rides, setRides] = useState<Ride[]>([]);
  const [pendingChangeCount, setPendingChangeCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");

  const refreshLocalState = useCallback(() => {
    setRides(getRides());
    setPendingChangeCount(getPendingChangeCount());
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshLocalState();
      
      //For debugging
      const debugRows = getLatestRideWithSamples(20);
      console.log("LATEST GPS SAMPLES", JSON.stringify(debugRows, null, 2));
    }, [refreshLocalState])
  );

  const handleSync = async () => {
    if (syncing) {
      return;
    }

    setSyncing(true);
    setSyncMessage("Syncing...");

    const result = await syncPendingChanges({ token });

    refreshLocalState();

    if (result.ok) {
      setSyncMessage(
        result.synced === 0
          ? "Everything is already synced."
          : `Synced ${result.synced} pending change${result.synced === 1 ? "" : "s"}.`
      );
    } else if (result.reason === "missing-auth-token") {
      setSyncMessage("Sign in before syncing saved rides.");
    } else {
      setSyncMessage(result.message);
    }

    setSyncing(false);
  };

  const canSync = pendingChangeCount > 0 && !syncing;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <ScreenHeader
          title="Saved Rides"
          subtitle="Local rides stored on this device."
        />

        <View style={styles.syncPanel}>
          <View>
            <Text style={styles.syncCount}>{pendingChangeCount}</Text>
            <Text style={styles.syncLabel}>pending sync changes</Text>
          </View>

          <Pressable
            disabled={!canSync}
            onPress={handleSync}
            style={[styles.syncButton, !canSync && styles.buttonDisabled]}
          >
            <Text style={styles.syncButtonText}>
              {syncing ? "Syncing" : "Sync"}
            </Text>
          </Pressable>
        </View>

        {syncMessage ? <Text style={styles.syncMessage}>{syncMessage}</Text> : null}

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
              <View>
                <Text style={styles.rideTitle}>
                  {dayjs(item.startedAt).format("DD MMM YYYY - HH:mm")}
                </Text>
                <Text style={styles.rideMeta}>
                  {item.vehicleType} - {item.sensorSource}
                </Text>
              </View>

              <View style={styles.rideStats}>
                <Text style={styles.sampleCount}>{item.sampleCount}</Text>
                <Text style={styles.sampleLabel}>samples</Text>
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
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    ...shadows.tile,
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
