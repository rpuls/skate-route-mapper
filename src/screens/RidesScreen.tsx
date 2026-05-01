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
            <Text style={styles.backText}>← Back</Text>
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
                  {dayjs(item.startedAt).format("DD MMM YYYY · HH:mm")}
                </Text>
                <Text style={styles.rideMeta}>
                  {item.vehicleType} · {item.sensorSource}
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
    backgroundColor: "#101418",
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
    color: "#7dd3fc",
    fontSize: 15,
    fontWeight: "800",
    marginBottom: 18,
  },
  title: {
    color: "#f8fafc",
    fontSize: 34,
    fontWeight: "900",
    marginBottom: 8,
  },
  subtitle: {
    color: "#94a3b8",
    fontSize: 16,
  },
  listContent: {
    gap: 12,
    paddingBottom: 48,
  },
  rideCard: {
    backgroundColor: "#18212b",
    borderRadius: 22,
    padding: 16,
    borderWidth: 1,
    borderColor: "#263241",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  rideTitle: {
    color: "#f8fafc",
    fontSize: 17,
    fontWeight: "800",
    marginBottom: 6,
  },
  rideMeta: {
    color: "#94a3b8",
    fontSize: 14,
    fontWeight: "600",
  },
  rideStats: {
    alignItems: "flex-end",
  },
  sampleCount: {
    color: "#7dd3fc",
    fontSize: 22,
    fontWeight: "900",
  },
  sampleLabel: {
    color: "#64748b",
    fontSize: 12,
    fontWeight: "700",
  },
  emptyCard: {
    backgroundColor: "#18212b",
    borderRadius: 22,
    padding: 20,
    borderWidth: 1,
    borderColor: "#263241",
  },
  emptyTitle: {
    color: "#f8fafc",
    fontSize: 20,
    fontWeight: "900",
    marginBottom: 8,
  },
  emptyText: {
    color: "#94a3b8",
    fontSize: 15,
    lineHeight: 21,
  },
});