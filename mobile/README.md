# Mobile App

The mobile app is an Expo React Native app for recording skating rides with phone sensors, GPS, and later external BLE sensors. It should stay usable outdoors, work offline while recording, and sync raw ride data to the backend when networking is available.

## Responsibilities

The mobile app owns:

- ride recording with phone accelerometer, gyroscope, and GPS
- local ride/sample persistence
- ride replay and basic ride inspection
- future external sensor connection
- future upload/sync to the backend
- future app-user authentication

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
npm run mobile:start
```

Run with Expo Go on a physical device on the same Wi-Fi network:

```bash
npm run mobile:expogo
```

Run through Expo tunnel when LAN discovery is unreliable:

```bash
npm run mobile:tunnel
```

Run explicitly in Expo Go mode when a development build is also installed:

```bash
npm run mobile:tunnel:go
```

Run the browser target for UI/layout checks:

```bash
npm run mobile:web
```

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

## Testing On iPhone

For quick UI and Expo-module testing:

1. Install Expo Go from the App Store.
2. Sign in with the same Expo account used by the CLI.
3. Run `npm run mobile:tunnel` from the repo root.
4. Scan the QR code with the iPhone camera or Expo Go.

Expo Go is the easiest path from Windows because it does not require Xcode.

Use an EAS development build when Expo Go is not enough, especially for custom native modules such as BLE. Physical iPhone development builds require Apple signing through a paid Apple Developer account.

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

- Upload locally recorded rides to the backend.
- Add offline upload queue and retry handling.
- Add app-user sign-up and authentication when the datamodel is ready.
- Add BLE sensor support after hardware is available.
- Add finished-ride stats such as duration, average speed, max speed, and surface-quality summaries.
