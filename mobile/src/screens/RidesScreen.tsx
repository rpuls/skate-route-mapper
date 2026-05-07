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
import { getRides } from "../database/db";
import type { Ride } from "../types/measurement";
//For debugging
import { getLatestRideWithSamples } from "../database/db";
import { colors, radius, shadows, space } from "@skate-route-mapper/shared/design";

export default function RidesScreen() {
  const navigation = useNavigation<any>();
  const [rides, setRides] = useState<Ride[]>([]);

  useFocusEffect(
    useCallback(() => {
      setRides(getRides());
      
      //For debugging
      const debugRows = getLatestRideWithSamples(20);
      console.log("LATEST GPS SAMPLES", JSON.stringify(debugRows, null, 2));
    }, [])
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()}>
            <Text style={styles.backText}>Back</Text>
          </Pressable>

          <Text style={styles.title}>Saved rides</Text>
          <Text style={styles.subtitle}>
            Local rides stored on this phone.
          </Text>
        </View>

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
  header: {
    marginTop: 16,
    marginBottom: 18,
  },
  backText: {
    color: colors.textOnOrange,
    fontSize: 15,
    fontWeight: "800",
    marginBottom: 18,
  },
  title: {
    color: colors.textOnOrange,
    fontSize: 34,
    fontWeight: "900",
    marginBottom: 8,
  },
  subtitle: {
    color: colors.textOnOrange,
    fontSize: 16,
    opacity: 0.82,
  },
  listContent: {
    gap: 12,
    paddingBottom: 48,
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
