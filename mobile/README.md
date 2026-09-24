# Mobile App

The Expo React Native app records ordinary rides and controls labelled XIAO
high-rate research captures. Ride and research data are stored locally first.

## Screens and navigation

Every screen is rendered by `src/components/Page.tsx`. The only standard chrome
is the page title and the drawer button, sharing the top line: the title flexes
and wraps, the button never shrinks. Everything else on a screen is its own
content. See "Page Framework" in `../docs/design-guide.md` for the rules this
enforces and why.

A screen that brings its own scroll view passes `padded={false}` and spreads
`scrollContentInsets` into that view's content container — an inset scroll view
clips the drop shadow off every card it holds. See "Shadows are never clipped"
in the design guide.

**The drawer is how you move between places.** A screen listed in it has no
back button, so every place is reached and left the same way. A screen you
drill into — live detail, one saved ride — is not in the drawer, so it passes
`back` to `Page` and shows a back arrow. The swipe gesture works there as well,
but not everyone knows it exists.

| Route | Screen | What it is |
| --- | --- | --- |
| `StartRide` | `StartRideScreen.tsx` | The app's home. One screen for the whole ride: map, ride type, sensor, start, then timer, live figures, pause and finish. |
| `Recording` | `RecordingScreen.tsx` | Read-only live detail behind a ride: GPS accuracy, kept and dropped fixes, the vibration graph. Drilled into, so it has a back arrow. |
| `Rides` | `RidesScreen.tsx` | Saved rides and the upload queue. |
| `RideDetail` | `RideDetailScreen.tsx` | One finished ride, with route replay. Drilled into, so it has a back arrow. |
| `Research` | `ResearchScreen.tsx` | The XIAO research lab. |
| `Auth` | `AuthScreen.tsx` | Account. |

The research lab needs a board, a labelled experiment and a file transfer, so
it is not something a rider should meet on the way to starting a ride. The
drawer lists it alongside the ride screen, saved rides and the account.

A ride is started and finished in exactly one place, the ride screen. The live
detail screen deliberately has no stop button.

## The XIAO connection

`src/native/xiaoConnection.ts` holds one BLE link for the whole app, at module
scope. A link is a property of the phone, not of a React tree: pairing a board
on the ride screen and then opening the research lab must not drop it. It is
also the only thing that decides whether the link is up — screens report what
it says and never keep their own idea of connectedness.

Screens read `useXiaoConnection()` and call `connect` / `disconnect` / `check`.
`src/native/XiaoBle.ts` underneath is pure transport: scanning, GATT, the
board's protocols, and no policy about when to retry.

### Knowing when the link is gone

A `XiaoBleConnection` is a JavaScript object. Turning the sensor off does not
reach in and delete it, so "we have an object" was never evidence of anything,
and a board that ran out of battery in a pocket left every screen reporting a
sensor that was not there above buttons that answered with BLE errors.

Four mechanisms now decide it, because no one of them sees everything:

- **The disconnect callback.** `device.onDisconnected` fires the moment GATT
  drops. The fast path, and it covers almost every real loss.
- **The radio state.** `subscribeToRadioState` watches the adapter itself.
  Bluetooth being switched off takes every link with it and makes retrying
  pointless until it comes back; switching it on again is the single best
  moment to retry.
- **Coming back to the front.** A suspended process is delivered no callbacks,
  so a link that died overnight is only discoverable by asking. Every
  foreground asks the radio instead of trusting what was last written down.
- **`requireXiaoConnection()` before anything a rider pressed.** It verifies,
  then hands the link over. `getXiaoConnection()` stays for polls that run
  every second and can simply fail.

### Getting it back

Recovery is automatic, bounded and visible: `reconnectDelaysMs` runs
1s / 2s / 5s / 10s / 20s / 30s / 60s, the last repeating while the app is in
front. Backgrounded, it parks; the app returning to the front and the radio
being switched on both restart it at once, which is when the answer could
differ. Only a board this phone has met before is chased — a first pairing that
failed is reported and left to the rider rather than scanned for indefinitely.

The board is remembered across launches (`xiaoDeviceId`, `xiaoDeviceName`), so
a reconnect goes straight to it by id instead of waiting out a fifteen-second
scan; a stale id falls back to the scan. The ride's stream rate is remembered
too and re-applied to every new link, because a board that reconnects mid-ride
comes up at its own default and would otherwise change what the rest of the
route was measured at.

The switch in the sensor sheet governs both halves: pick the board up on
launch, and get it back on its own if the link drops. It only runs once a board
has actually been paired on this phone — scanning asks for Bluetooth
permission, and a first launch should not open with a dialog about hardware the
person may not own.

### Starting the radio

`connectToXiao` waits for the radio to report `PoweredOn` before it scans.
`new BleManager()` returns before the native adapter has reported anything, and
a scan started in that window is rejected with "BluetoothLE is in unknown
state" — which is why the first Connect used to fail and the second one worked.
`Unknown` and `Resetting` are waited out; `PoweredOff`, `Unauthorized` and
`Unsupported` end the attempt with something the rider can act on, and reach
the screens as `radioMessage`.

Nothing touches the BLE stack at import. `new BleManager()` starts the native
radio, so the watches are started by the first connect or by the launch restore
of an already-paired board, never by loading the module.

### The app log

`src/diagnostics/log.ts` writes what the app did to an NDJSON file under the
document directory: one entry per line, flat rather than nested, each carrying
a `level`, a `source` (`app`, `ble`, `ride`, `sync`, `research`) and a short
stable `event` slug. It replaced scattered `console.warn` calls, which go to a
Metro console that is not attached when any of this actually happens.

It is bounded on two axes, because a log nobody can lose control of is one
nobody has to think about:

- **Size.** Two files of `maxFileBytes` each, rolled over rather than appended
  to forever, so the ceiling on disk is fixed.
- **Age.** Anything older than `maxAgeDays` is deleted on the next launch, for
  the phone that goes a month between rides.

**Writing happens in every build; exporting does not.** `DiagnosticsLog.tsx`
renders nothing unless `diagnosticsAvailable` is true, which is `__DEV__` —
true in the build `npm run iphone:build` produces, false in the `preview` and
`production` EAS profiles. A rider never meets it. RSSI sampling is gated the
same way, because it is an active radio probe rather than a record of something
that happened, and a shipped app has no way to hand the log over anyway.

`Sharing.shareAsync` presents a `UIActivityViewController` over a real file
URL, so **Save to Files** is one of the destinations and a network share
mounted in the iOS Files app can be written to directly — the file never passes
through a mailbox or a sync client, and it keeps its name.

There is deliberately no analysis tooling in this repo. The format is plain
NDJSON so it can simply be read.

#### What the BLE entries carry

The BLE vocabulary in `logEvents.ts` is typed rather than free text, because
its entries get counted and compared. It exists because a ride came back
reporting an unstable link and there was nothing to look at, and because the
phone is an iPhone, so there is no btsnoop to pull afterwards either.

- **Disconnect reason codes.** `react-native-ble-plx` raises a `BleError`
  carrying `iosErrorCode`, and the two values that matter are opposites.
  `ConnectionTimeout` (6) is the supervision timer expiring — the phone stopped
  hearing the board, so range, body-blocking or interference.
  `PeripheralDisconnected` (7) is the board ending the link itself: a reset, a
  brown-out, firmware. Both used to arrive as `error.message`, which
  distinguishes neither.
- **RSSI while the link is up.** A link that dies near the noise floor was
  starved of signal; one that dies at -65 dBm was not, and the antenna is not
  the thing to change. Sampling stands down entirely during a research
  retrieval, so transfer times stay comparable with captures already uploaded.
- **The negotiated ATT_MTU.** iOS sets it without being asked, and a 408-byte
  research response needs more round trips below 185 bytes than above it. A
  slow retrieval with a small MTU is arithmetic; a slow one with a large MTU is
  a link problem.
- **Per-request timings and retries.** `researchRequest` retries up to three
  times per page and `transferMs` folds every attempt into one number, so a
  page that needed three tries and one that returned immediately were otherwise
  indistinguishable.
- **Stream gaps and packet loss.** The board numbers every packet, so what
  arrived can be compared with what was sent. A dropped notification is a
  stretch of road with no roughness on it, and nothing else in the app notices.

Signal samples, page timings and board counters are `debug`; a dropped link or
a failed request is `warn`. Filtering on level is how a long file becomes a
short one.

The web fallback (`log.web.ts`) keeps entries in memory and refuses to export,
because `npm run dev:web` has neither a document directory nor a share sheet.

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
- a phone GPS track for the capture window, with speed per fix and a speed
  summary (see below)
- a context fix taken before the capture, and one taken at retrieval
- the requested duration and measured board sample rate
- the original verified `.skateresearch` recording
- the board validation report and BLE transfer time

**The phone logs its own GPS for exactly as long as the board records.** Speed is
the first thing surface roughness has to be normalised for — the same asphalt
reads rougher at 20 km/h than at 8 — so the capture carries a fix roughly every
second, each with the platform's reported ground speed, plus a summary with
average, median and peak speed and a distance-based cross-check computed with the
same filter and maths a ride uses. The window is bounded to the recording: the
transfer afterwards is a rider standing still, and those fixes would flatten
every figure. `src/research/captureTrack.ts` owns the log at module scope, keeps
the screen awake while it runs, and refuses to attach a track to a board capture
it was not started for. The live speed shows on the capture card, so a run can be
held at a target speed and repeated.

Keep the phone with you and the research screen in front during a capture: the
log is a foreground subscription, and a pocketed, locked phone is the one way to
lose it.

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
- `src/research/captureTrack.ts`: the phone's GPS log and speed for a capture
- `src/research/researchFiles.ts`: durable recording/photo/metadata files
- `src/database/db.ts`: ride and research-collection indexes
- `src/screens/StartRideScreen.tsx`: the whole ride, from ready to finished
- `src/screens/RecordingScreen.tsx`: read-only live detail and GPS state
- `src/components/Page.tsx`: the page frame every screen is built in
- `src/native/xiaoConnection.ts`: the app's single shared XIAO BLE connection
- `src/storage/preferences.ts`: remembered ride type, auto-connect, account-seen
- `src/recording/backgroundLocation.ts`: background location task and permissions
- `src/recording/rideRecorder.ts`: active ride, running totals, sample buffer
- `src/recording/recorder.ts`: the app's single recorder, wired to the database
- `src/sync/syncLoop.ts`: the upload drain loop, over ports
- `src/sync/syncBatching.ts`: request sizing and per-ride ordering
- `src/sync/backoff.ts`: how long a failed operation waits
- `src/sync/autoSync.ts`: automatic upload triggers
- `../shared/src/xiaoResearch.mjs`: recording validation and file codec
- `assets/`: launcher, splash and favicon images. Generated — the logo lives in
  `../brand/`, and `python scripts/build-brand-assets.py` rewrites this directory.
  The Android adaptive icon's background colour is written out in `app.json`,
  because a manifest cannot read a design token; it has to match the page orange.

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
