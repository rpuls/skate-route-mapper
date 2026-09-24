import "react-native-gesture-handler";
import { useEffect } from "react";
import AppNavigator from "./src/navigation/AppNavigator";
import { initDatabase } from "./src/database/db";
// Imported for its side effect: the background location task must be defined
// before the OS can deliver a fix, which can happen before anything renders.
import "./src/recording/backgroundLocation";
import { restoreXiaoAutoConnect } from "./src/native/xiaoConnection";
import {
  hydrateMeasurementStore,
  useMeasurementStore,
} from "./src/store/measurementStore";

// At module scope, not in an effect. React runs child effects before parent
// effects, so the auth provider's auto-sync would otherwise query the database
// before `App` had created it.
initDatabase();

export default function App() {
  useEffect(() => {
    // A ride can outlive the app: the OS may kill a backgrounded process and
    // restart it for the next location update. If one is still open, pick it
    // back up rather than leaving it recording with nothing watching.
    void useMeasurementStore.getState().resumeRecording();

    // Remembered state — ride type, the last ride's figures, whether to
    // reconnect the board — is restored here so a screen never paints a wrong
    // default first.
    void hydrateMeasurementStore();
    void restoreXiaoAutoConnect();
  }, []);

  return <AppNavigator />;
}
