# Skate Route Mapper

Skate Route Mapper is an Expo React Native app for recording skating routes and measuring how smooth or rough the surface feels while riding. It uses the phone's accelerometer, gyroscope, and GPS to collect vibration and location samples, stores each ride locally in SQLite, and lets you replay saved routes on a map.

The project is aimed at mapping route quality for inline skates, skateboards, and longboards, where small changes in pavement can matter a lot.

## Features

- Record rides using phone sensors.
- Capture accelerometer and gyroscope readings at roughly 5 Hz.
- Track GPS position and speed while recording.
- Calculate a simple vibration magnitude from accelerometer data.
- Store rides and sensor samples locally with Expo SQLite.
- View saved rides ordered by newest first.
- Replay a route on a map with a progress slider.
- Show ride statistics including sample count, GPS point count, average vibration, and max vibration.
- Choose the ride type: inline skates, skateboard, or longboard.

External sensor support is represented in the UI, but it is currently disabled and marked as a future feature.

## Tech Stack

- Expo SDK 54
- React Native 0.81
- React 19
- TypeScript
- React Navigation native stack
- Zustand for recording state
- Expo SQLite for local persistence
- Expo Sensors for accelerometer and gyroscope data
- Expo Location for GPS tracking
- React Native Maps for route display
- React Native Chart Kit for the live vibration chart

## How It Works

1. The app starts in `App.tsx` and calls `initDatabase()` to create the local SQLite tables if they do not exist.
2. On the home screen, the user selects a vehicle type and starts a route scan.
3. Starting a scan creates a new ride row in SQLite and moves the app to the recording screen.
4. The recording screen listens to accelerometer and gyroscope updates, watches the user's GPS position, and inserts each sample into SQLite.
5. Stopping the recording updates the ride with an end time and final sample count.
6. Saved rides can be opened from the ride list and replayed on a map.

## Data Model

The local database has two main tables:

- `rides`: one row per recorded route, including start/end time, vehicle type, sensor source, and sample count.
- `samples`: time-series measurements for a ride, including accelerometer axes, gyroscope axes, vibration magnitude, latitude, longitude, and speed.

The current vibration value is calculated as:

```text
sqrt(ax^2 + ay^2 + az^2)
```

This is a simple magnitude score rather than a calibrated road-quality index.

## Getting Started

### Prerequisites

- Node.js
- npm
- Expo-compatible Android or iOS environment
- A physical device is recommended because the app depends on motion sensors and GPS

### Install Dependencies

```bash
npm install
```

### Run the App

Start the Expo development server:

```bash
npm start
```

Run on Android:

```bash
npm run android
```

Run on iOS:

```bash
npm run ios
```

Run on web:

```bash
npm run web
```

The web target may be useful for basic UI checks, but the main recording workflow is designed for a mobile device with accelerometer, gyroscope, and location support.

## Permissions

The app requests foreground location permission when the recording screen opens. If permission is denied, sensor recording can still continue, but samples will not include GPS coordinates or speed.

Motion sensor access is provided through Expo Sensors.

## Available Scripts

```bash
npm start       # Start Expo
npm run android # Start Expo for Android
npm run ios     # Start Expo for iOS
npm run web     # Start Expo for web
```

There are currently no configured lint, test, or build scripts in `package.json`.

## Current Limitations

- External BLE sensor recording is not implemented yet.
- Ride data is stored only on the local device.
- There is no export, sync, or sharing flow yet.
- There is no ride deletion or editing UI.
- The vibration metric is raw and not calibrated against a known surface-quality scale.
- The recording screen keeps only the latest 300 samples in UI state, while all samples are still written to SQLite.

## Development Notes

- `src/database/db.ts` contains the SQLite schema and query helpers.
- `src/store/measurementStore.ts` owns the active ride state and writes samples through the database helpers.
- `src/screens/RecordingScreen.tsx` is where live sensor and location subscriptions are started.
- `src/screens/RideDetailScreen.tsx` filters samples with GPS coordinates and draws the replay polyline.

If you add support for external sensors, the natural integration point is the `SensorSource` type and the recording flow in `RecordingScreen.tsx`.
