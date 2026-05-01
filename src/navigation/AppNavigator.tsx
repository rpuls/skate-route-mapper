import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import HomeScreen from "../screens/HomeScreen";
import RecordingScreen from "../screens/RecordingScreen";
import RidesScreen from "../screens/RidesScreen";
import RideDetailScreen from "../screens/RideDetailScreen";

export type RootStackParamList = {
  Home: undefined;
  Recording: undefined;
  Rides: undefined;
  RideDetail: {
    rideId: string;
  };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function AppNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          contentStyle: {
            backgroundColor: "#101418",
          },
        }}
      >
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="Recording" component={RecordingScreen} />
        <Stack.Screen name="Rides" component={RidesScreen} />
        <Stack.Screen name="RideDetail" component={RideDetailScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}