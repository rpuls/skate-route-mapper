# Mobile App

The mobile app is an Expo React Native app for recording skating rides with phone sensors, GPS, and later external BLE sensors. It should stay usable outdoors, work offline while recording, and sync raw ride data to the backend when networking is available.

## Responsibilities

The mobile app owns:

- ride recording with phone accelerometer, gyroscope, and GPS
- Nesso N1 firmware/protocol scaffolding for external accelerometer and
  gyroscope over BLE, with GPS still supplied by the phone
- local ride/sample persistence
- ride replay and basic ride inspection
- future external sensor connection
- optional app-user authentication
- upload/sync to the backend through a local pending-change queue

The mobile app should not own:

- advanced surface-scoring algorithms
- long-term analytics
- heavy route-planning logic
- server-side deduplication or trust decisions

Those belong in the API/backend pipeline.

## Run Locally

Install dependencies from the repo root:

```bash
npm install
```

Start the Expo dev server:

```bash
npm run dev:mobile
```

Run with Expo Go on a physical iPhone through Expo tunnel:

```bash
npm run dev:iphone
```

Run with Expo Go on a physical device on the same Wi-Fi network:

```bash
npm run start --workspace @skate-route-mapper/mobile -- --lan --go
```

Run the browser target for UI/layout checks:

```bash
npm run dev:web
```

Mobile API calls use `EXPO_PUBLIC_API_BASE_URL`. The default development and
EAS build configuration points to:

```text
https://skate-route-mapper-api.up.railway.app
```

Override this only when intentionally testing against a local API. A physical
phone cannot reach a desktop API through `localhost`.

## Android Background Recording Builds

Android background recording uses a native foreground service for GPS,
accelerometer, and gyroscope samples. It is not available in Expo Go.

Install/update dependencies before building:

```bash
npm install
```

Create an installable Android preview APK from `mobile/`:

```bash
cd mobile
eas build --platform android --profile preview
```

The `preview` profile uses internal distribution and produces an APK so it can
be installed directly on an Android device for locked-phone testing.

The recorder requests foreground location, background location, notification,
and foreground-service permissions. Android may still require allowing location
"all the time" and disabling aggressive battery optimization for long tests on
some devices.

When external sensor mode is enabled, keep the phone as the GPS source. The
foreground service should swap only the accelerometer and gyroscope source to
the Nesso BLE stream, then persist the same `MeasurementSample` shape.

## Nesso N1 BLE IMU

There are currently two Nesso firmware paths:

- `../firmware/nesso-n1/` is the legacy raw IMU stream.
- `../firmware/nesso-n1-new/` is the isolated Gate A feature-frame prototype.

The current mobile foreground pairing flow targets the Gate A firmware,
advertised as `Skate Nesso N1 Gate A`. That firmware sends compact BLE feature
frames at about `5Hz` instead of raw per-sample IMU packets. GPS and camera
ownership stay in the mobile app.

The shared BLE UUIDs and binary packet parser live in
`../shared/src/nessoBle.ts`. For the Gate A prototype, the parser exposes the
high-pass vibration fields as `accelRms` and `accelPeakToPeak` to keep the BLE
packet shape stable while calibration is still moving.

The recording screen includes a Gate A contact indicator for field testing:

- `Asphalt` uses a grey tile and means the current feature frame looks like
  skate-ground contact.
- `Sky` uses a blue tile and means the current feature frame looks airborne.
- `Check` means the frame is between the first-pass thresholds.

This tile is only a diagnostic indicator for now. Do not filter out airborne
frames until real rides show the detector is reliable. The tile stays in
`Check` below `5km/h` because stopped/starting motion is not useful road-surface
data.

The Calibration screen is enabled when Nesso Gate A is connected. It currently
captures `10s` of received Gate A feature frames, lets the tester add notes and
an optional subjective `1-6` roughness feeling, and uploads the result to
`POST /v1/mobile/experimental-captures`.
That backend endpoint stores generic JSON on purpose so this experimental data
shape can change while firmware raw-burst capture is still being designed.

Gate A status:

- `calibration v2` firmware is the current test build.
- smooth hand movement is now barely detected in indoor testing.
- low vibration no longer immediately maxes out the `1-6` level scale.
- semi-rough indoor vibration reaches roughly level `3-4`.
- real asphalt, paving stones, and unskatable surfaces still need outdoor
  calibration before the levels are product-ready.

Home screen pairing uses `react-native-ble-plx` for a foreground connection
preview. Gate A feature-frame rides currently stay in the foreground while this
signal work is being validated; do not build backend/product storage on top of
the feature frames until `docs/vibration-roughness-plan.md` marks the signal
gate as passed.

BLE pairing is not available in Expo Go. After changing BLE dependencies or
Expo native config, rebuild the iOS development app so the `react-native-ble-plx`
native module and Bluetooth permission strings are compiled into the app.

## Testing On iPhone

For quick UI and Expo-module testing:

1. Install Expo Go from the App Store.
2. Sign in with the same Expo account used by the CLI.
3. Run `npm run dev:iphone` from the repo root.
4. Scan the QR code with the iPhone camera or Expo Go.

Expo Go is the easiest path from Windows because it does not require Xcode.

Use an EAS development build when Expo Go is not enough, especially for custom native modules such as BLE. Physical iPhone development builds require Apple signing through a paid Apple Developer account. Rebuild the development app after native dependency or config-plugin changes; reloading JavaScript is not enough for BLE module changes.

The repo already has `mobile/eas.json` with a `development` profile. When ready for a development build, run from `mobile/`:

```bash
npx expo install expo-dev-client
eas build --platform ios --profile development
```

## Web Target

The web target exists mainly for layout and design work. It is not a full replacement for device testing.

Current web fallbacks:

- `mobile/src/database/db.web.ts` uses `localStorage` instead of `expo-sqlite`.
- `mobile/src/components/RideRouteMap.web.tsx` avoids `react-native-maps` and shows a route preview fallback.
- `mobile/src/setupFonts.web.ts` loads the web font CSS.

Expected limitations on web:

- phone sensors may not behave like a physical device
- GPS and permissions differ from native
- native map behavior is replaced by a simple fallback
- BLE testing requires a native build/device path

## iOS Background Recording

iOS does not offer the same general-purpose foreground service model as
Android. Keep iOS on foreground phone-sensor recording for now. Background GPS
can be added later with iOS background location modes, but continuous
accelerometer and gyroscope recording while locked is much more restricted.

The iOS native config enables `bluetooth-central` so a physical iPhone build can
test whether the Nesso BLE connection survives backgrounding. This does not make
iOS equivalent to Android foreground services: the app must still be tested on a
real iPhone, and long-running background BLE behavior depends on iOS state,
permissions, battery policy, and whether the system keeps the app eligible for
central-manager restoration.

## Design System

The design source of truth lives in `shared/src/design.ts` and is documented in `docs/design-guide.md`.

Mobile screens should import design tokens from `@skate-route-mapper/shared` rather than inventing local colors, radii, shadows, or button styles.

Current visual direction:

- sporty orange background
- white primary tiles
- faint blue or warm fills for subtle containers
- large rounded corners with nested-radius logic
- Open Sans typography
- predefined button variants only

## Key Files

- `App.tsx`: app startup and database initialization
- `src/navigation/AppNavigator.tsx`: stack navigation
- `src/store/measurementStore.ts`: ride lifecycle state
- `src/database/db.ts`: native SQLite storage
- `src/database/db.web.ts`: browser storage fallback
- `src/screens/HomeScreen.tsx`: ride setup
- `src/screens/RecordingScreen.tsx`: live sensor recording
- `src/screens/RidesScreen.tsx`: saved ride list
- `src/screens/RideDetailScreen.tsx`: ride replay/details

## Roadmap

- Improve sync retries, status visibility, and historical ride recovery.
- Continue Gate A Nesso feature-frame calibration on real surfaces before
  promoting it to production ride storage.
- Add finished-ride stats such as duration, average speed, max speed, and surface-quality summaries.
