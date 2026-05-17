import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import HomeScreen from "../screens/HomeScreen";
import RecordingScreen from "../screens/RecordingScreen";
import RidesScreen from "../screens/RidesScreen";
import RideDetailScreen from "../screens/RideDetailScreen";
import AuthScreen from "../screens/AuthScreen";
import CalibrationScreen from "../screens/CalibrationScreen";
import { colors } from "@skate-route-mapper/shared/design";
import { MobileAuthProvider } from "../auth/MobileAuthContext";

export type RootStackParamList = {
  Home: undefined;
  Recording: undefined;
  Rides: undefined;
  Auth: undefined;
  Calibration: undefined;
  RideDetail: {
    rideId: string;
  };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function AppNavigator() {
  return (
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
          <Stack.Screen name="Home" component={HomeScreen} />
          <Stack.Screen name="Recording" component={RecordingScreen} />
          <Stack.Screen name="Rides" component={RidesScreen} />
          <Stack.Screen name="Auth" component={AuthScreen} />
          <Stack.Screen name="Calibration" component={CalibrationScreen} />
          <Stack.Screen name="RideDetail" component={RideDetailScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </MobileAuthProvider>
  );
}
