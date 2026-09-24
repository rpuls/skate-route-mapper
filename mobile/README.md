# Mobile App

The Expo React Native app records ordinary rides and controls labelled XIAO
high-rate research captures. Ride and research data are stored locally first.

## Route recording

A ride keeps recording with the screen locked, on both platforms, through one
registered `expo-location` background task. It writes GPS fixes to SQLite
without a component being mounted, which is the point: the OS can background or
even restart the app mid-ride.

- `src/recording/backgroundLocation.ts` registers the task and asks for
  permission. Foreground permission comes first, then background: iOS will not
  grant "always" before "when in use". A rider who refuses the second prompt
  still gets a ride recorded while the app is open, and the recording screen
  says so.
- `src/recording/rideRecorder.ts` owns the recording: which ride is active, what
  it has covered, and which samples are waiting to be written. It reads that
  from storage rather than remembering it, so a fix delivered to a cold-started
  app is still recorded. Storage arrives as a port, so the lifecycle can be
  tested without a device; `src/recording/recorder.ts` wires the real one.
- `../shared/src/rideTracking.ts` decides which fixes to keep and turns them
  into distance, moving time and speed. See `../docs/ride-tracking.md`.
- `src/recording/sampleBuffer.ts` batches samples so a long ride does not queue
  one upload operation per sample.
- `src/sync/autoSync.ts` uploads the queue on ride finish, on app foreground,
  and on a retry timer. `src/sync/syncLoop.ts` holds the drain loop itself,
  with storage and the network as ports so its failure behaviour is tested.

`sensorSource: "phone"` is a GPS-only ride. The phone's own accelerometer is no
longer recorded: it is too slow and too dependent on where the phone is
carried, and pavement vibration is the XIAO board's job.

**Background recording is build-time configuration.** The iOS background mode
and the always-on location permission live in `app.json`, so picking this up
needs `npm run iphone:build`, not just a reload.

## Research collections

`Research Collections` is the field-data workflow for the XIAO ESP32S3 and
LSM6DSOX prototype. A collection stores:

- a category and short label
- free-form notes about the surface, wheels, speed, mounting, or weather
- a context photo
- start and end phone GPS fixes
- the requested duration and measured board sample rate
- the original verified `.skateresearch` recording
- the board validation report and BLE transfer time

The XIAO records the 833 or 1,666 Hz samples into its own RAM for 10, 30, or 60
seconds. Live BLE reliability does not affect the recording. After completion,
the iPhone retrieves pages, verifies the raw and summary CRCs, checks summary
coverage against the raw samples, and writes the file to app document storage.
The screen keeps partial transfer pages in memory so an interrupted transfer can
be retried while that screen remains open. Keep the XIAO powered until the file
is saved; starting a new capture replaces the previous board capture.

Saved files can be exported through the iOS share sheet. The collection metadata
is embedded in the `.skateresearch` header and is also written beside the file
as `metadata.json`. Photos remain separate as `surface.jpg`.

Signed-in users can press **Upload to research database** on a saved collection.
The app sends the original recording, validation/GPS metadata, and optional
photo to production. Failed uploads leave local files intact and can be retried.
Uploaded rows appear under **Research Captures** in the admin dashboard; select
a row to download its recording or photo for laptop analysis.

The mobile API defaults to
`https://skate-route-mapper-api.up.railway.app`. Override it for local API work
with `EXPO_PUBLIC_API_BASE_URL`. Login sessions are stored in the app's local
SQLite key-value storage and restored for up to the server's 30-day lifetime.

## iOS

The BLE workflow uses the custom **Skate Route Mapper** development app, not
Expo Go. Run all commands below from the repository root.

### Run the installed app

This is the normal command:

```bash
npm run iphone
```

Keep the terminal open. Keep the laptop and iPhone on the same Wi-Fi, then open
Skate Route Mapper or scan Metro's QR code with the iPhone Camera.

### Register a new iPhone (only once per device)

First check whether the phone is already registered:

```bash
npm run iphone:devices
```

If it is listed, do nothing. If it is a different, unlisted iPhone, register it:

```bash
npm run iphone:register
```

Do not register a phone again for later builds.

### Build and run on a registered device

Build after registering a new phone, on the first installation, or after native
dependencies, permissions, Expo configuration, or the Expo SDK change:

```bash
npm run iphone:build
```

Open the resulting EAS link on the iPhone and install it. Then run:

```bash
npm run iphone
```

JavaScript, TypeScript, UI, and API changes only require `npm run iphone`; they
do not require another build.

### First use on a new computer

```bash
npm install
npx eas-cli login
```

### LAN fallback

If LAN cannot connect, try:

```bash
npm run iphone:tunnel
```

The tunnel depends on Ngrok and may be unavailable.

## Other development targets

Run a web layout check with:

```bash
npm run dev:web
```

The web target uses localStorage and native-component fallbacks. It cannot use
the XIAO BLE research workflow.

Web route recording falls back to `Location.watchPositionAsync`, because
`expo-task-manager` has no web implementation. A browser tab cannot record with
the screen off; use a device for anything beyond layout.

On Android, `expo-location` raises the foreground service the OS requires for
background location. The hand-written service in `modules/background-recorder/`
is no longer used by the app, and its fix filter has been ported to
`../shared/src/rideTracking.ts`. The module is still in the tree pending the
Android developer's decision — see `../docs/development-plan.md`.

The XIAO research workflow uses the same board-first capture design on both
platforms.

## Key files

- `src/screens/ResearchScreen.tsx`: field capture, metadata, transfer and export
- `src/native/XiaoBle.ts`: XIAO live and research BLE protocols
- `src/research/researchFiles.ts`: durable recording/photo/metadata files
- `src/database/db.ts`: ride and research-collection indexes
- `src/screens/HomeScreen.tsx`: normal ride setup and research entry point
- `src/screens/RecordingScreen.tsx`: live ride figures and GPS state
- `src/recording/backgroundLocation.ts`: background location task and permissions
- `src/recording/rideRecorder.ts`: active ride, running totals, sample buffer
- `src/recording/recorder.ts`: the app's single recorder, wired to the database
- `src/sync/syncLoop.ts`: the upload drain loop, over ports
- `src/sync/syncBatching.ts`: request sizing and per-ride ordering
- `src/sync/backoff.ts`: how long a failed operation waits
- `src/sync/autoSync.ts`: automatic upload triggers
- `../shared/src/xiaoResearch.mjs`: recording validation and file codec

## Validation

After mobile changes, run from the repo root:

```bash
npm run contracts:test
npm run dev:web
```

BLE, camera permissions, GPS, physical capture, interrupted transfer recovery,
and sharing must also be checked on the signed iPhone development build.

For route recording specifically, check on a device:

- recording continues with the screen locked, and for a walk around the block
- the recorded distance is close to a known course
- the background permission prompt appears and is honoured
- a XIAO ride still pairs vibration readings with position
- the ride uploads itself after you press stop
