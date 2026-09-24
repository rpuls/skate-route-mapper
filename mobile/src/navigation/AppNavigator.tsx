import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import {
  SafeAreaProvider,
  initialWindowMetrics,
} from "react-native-safe-area-context";

import StartRideScreen from "../screens/StartRideScreen";
import RecordingScreen from "../screens/RecordingScreen";
import RidesScreen from "../screens/RidesScreen";
import RideDetailScreen from "../screens/RideDetailScreen";
import AuthScreen from "../screens/AuthScreen";
import ResearchScreen from "../screens/ResearchScreen";
import { colors } from "@skate-route-mapper/shared/design";
import { MobileAuthProvider } from "../auth/MobileAuthContext";

export type RootStackParamList = {
  StartRide: undefined;
  Recording: undefined;
  Rides: undefined;
  Auth: undefined;
  Research: undefined;
  RideDetail: {
    rideId: string;
  };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function AppNavigator() {
  return (
    // Every screen reads the real safe-area insets through `Page`, so the
    // provider has to sit above the navigator rather than being left to the
    // compatibility shim inside it. `initialWindowMetrics` gives it the insets
    // synchronously: without them the first frame lays out as if there were no
    // notch and no home indicator, and every page visibly reflows.
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <MobileAuthProvider>
        <NavigationContainer>
          <Stack.Navigator
            screenOptions={{
              headerShown: false,
              contentStyle: {
                backgroundColor: colors.page,
              },
            }}
          >
            <Stack.Screen name="StartRide" component={StartRideScreen} />
            <Stack.Screen name="Recording" component={RecordingScreen} />
            <Stack.Screen name="Rides" component={RidesScreen} />
            <Stack.Screen name="Auth" component={AuthScreen} />
            <Stack.Screen name="Research" component={ResearchScreen} />
            <Stack.Screen name="RideDetail" component={RideDetailScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </MobileAuthProvider>
    </SafeAreaProvider>
  );
}
