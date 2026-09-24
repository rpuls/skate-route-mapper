# Development Plan

Written after a repo review on 2026-09-24, resuming from a break between
2026-05-28 and 2026-09-23. It records four pieces of work that the review found
blocking or missing, with the evidence for each, so neither developer has to
re-derive it.

**Status, 2026-09-24 (later the same day):** sections 1, 2 and 3 are built. The
evidence and reasoning below are kept because they are still the argument for
the design; what changed is recorded under each section and summarised in
"What was built". Section 4 is untouched.

This is a planning document. The proven hardware state lives in
`hardware/HARDWARE-HANDOFF.md`, and the signal-processing direction lives in
`docs/vibration-roughness-plan.md`. Neither is superseded here.

## Product shape this plan assumes

The app must be worth using without any extra hardware, so it is built in two
tiers:

- **Phone only.** A normal sports tracker: route, distance, duration, speed,
  saved and replayable. Later, riders rate road sections by hand.
- **Phone + XIAO board.** The board measures pavement vibration at a rate the
  phone cannot reach, and contributes measured surface quality to the same
  routes.

Phone accelerometers are not a realistic substitute for the board. The phone
owns GPS and the route; the board owns vibration. The 5 Hz phone IMU recording
path is therefore legacy and is being removed.

The long-term goal serves both groups: good-asphalt route planning for anyone,
built from data that device owners contribute.

---

## 1. Background route recording — built

Implemented as proposed: one `expo-location` + `TaskManager` task for both
platforms, with the Android service's fix filter ported to TypeScript first.

- `mobile/src/recording/backgroundLocation.ts` registers the task and owns
  permissions. `backgroundLocation.web.ts` falls back to `watchPositionAsync`,
  since `expo-task-manager` has no web implementation.
- `mobile/src/recording/rideRecorder.ts` owns the recording itself, reading the
  active ride and its progress from SQLite rather than from React, so a fix
  delivered to a cold-started app is still recorded.
- `shared/src/rideTracking.ts` holds the ported filter and the distance,
  moving-time and speed accumulator. See `docs/ride-tracking.md`.
- `app.json` gained the `location` background mode, the always-and-when-in-use
  permission string, and `isAndroidBackgroundLocationEnabled` /
  `isAndroidForegroundServiceEnabled` on the `expo-location` plugin.
- `expo-task-manager` was added as a dependency.

**Not yet verified on a device.** This is native configuration, so it needs a
fresh `npm run iphone:build` and a real outdoor ride with the screen locked
before it can be called done.

`BackgroundRecorderService.kt` is no longer used by the app — `expo-location`
raises the Android foreground service now — but the module is left in place, so
the decision below is still the Android developer's to make. Its unused
JavaScript wrapper, `mobile/src/native/BackgroundRecorder.ts`, was deleted.

The rest of this section is the original evidence, kept because it is still the
argument for the design.

**This is a shipping blocker.** A tracker that stops recording when the screen
locks is not a tracker.

### Current state

`mobile/app.json` declares only `UIBackgroundModes: ["bluetooth-central"]`, and
has `NSLocationWhenInUseUsageDescription` but no
`NSLocationAlwaysAndWhenInUseUsageDescription`. `RecordingScreen` records
location with `Location.watchPositionAsync`, which is foreground-only, and holds
the screen on with `useKeepAwake`. On iPhone, recording therefore survives only
while the app is visible and the screen is awake.

Android is covered by a custom Expo module,
`mobile/modules/background-recorder/`. `BackgroundRecorderService.kt` is a
foreground service declaring `location|connectedDevice`, which is the only way
Android permits background location. It works.

So the two platforms have entirely separate implementations, one of which does
not exist.

### Proposal

Move both platforms onto `expo-location`'s `startLocationUpdatesAsync` with
`TaskManager`. One registered background task writes GPS fixes to SQLite; both
platforms use it; the custom Kotlin module can then be retired.

Required changes:

- `app.json`: add `"location"` to iOS `UIBackgroundModes`.
- `app.json`: add `NSLocationAlwaysAndWhenInUseUsageDescription`.
- `app.json`: set `locationAlwaysAndWhenInUsePermission` on the `expo-location`
  plugin config.
- Register a TaskManager task that persists fixes, so recording does not depend
  on a mounted React component.
- Gate on `Location.isBackgroundLocationAvailableAsync()` and request background
  permission explicitly, separately from foreground permission.

This is a native config change, so it needs a new `npm run iphone:build`, not
just a reload.

### Decision for the Android developer

**The filter has been ported** to `shared/src/rideTracking.ts` and is covered by
`backend/test/contracts/rideTracking.contract.test.ts`. Two rules were added
because `expo-location` does not report a provider on either platform, which
makes the provider rule unreachable in practice — see `docs/ride-tracking.md`.

Retiring `BackgroundRecorderService.kt` would lose one thing worth keeping:
`shouldAcceptLocation()` rejects bad fixes, and that logic is not free.

It rejects a fix when:

- latitude or longitude is out of range,
- accuracy is missing or worse than `MAX_ACCEPTED_ACCURACY_METERS` (50 m),
- the previous fix came from the GPS provider and this one is from a worse
  provider with accuracy more than 1.5x worse — this is what keeps wifi and
  cell-tower fixes from corrupting a route,
- the implied speed since the previous fix exceeds
  `MAX_REASONABLE_SPEED_MPS` (666.6 m/s) *and* accuracy is worse than
  `STRICT_JUMP_ACCURACY_METERS` (10 m).

The speed bound is a teleport guard, not a skating speed limit, and the accuracy
condition keeps it from discarding genuine fast fixes. **Port this filter to
TypeScript before removing the module**, so both platforms keep it.

Open question for the two of you: does the Android app need anything else the
foreground service provides that `expo-location` does not?

### The module's BLE path targets obsolete hardware

Separately from the location question: the service's external-sensor path scans
for a **Nesso** device, not the XIAO. The identifiers were never updated when the
project changed hardware.

| | Service UUID | Characteristic | Device name |
| --- | --- | --- | --- |
| `BackgroundRecorderService.kt` | `7b32f8c0-5d0b-4f0e-a1f5-8f30c44c0001` | `7b32f8c1-...` | name contains `Nesso` |
| `shared/src/xiaoBle.ts` | `7b32f8d0-5d0b-4f0e-a1f5-8f30c44c0001` | `7b32f8d1-...` | `Skate XIAO IMU` |

The UUIDs differ by one hex digit — the scheme was bumped for the new board, and
the Kotlin kept the old value. On Android, choosing the external sensor scans for
a device that does not exist in this project and never connects to the XIAO.

Roughly 120 lines are dead as a result: the BLE scan and connect callbacks,
`handleNessoPacket`, `sampleFromNessoPacket`, and `NESSO_PACKET_SIZE`.

This changes the module decision. It is not only that the phone-IMU half is
legacy — the external-sensor half points at the wrong hardware and would have to
be rewritten against the XIAO protocol regardless. If the module is retired in
favour of `expo-location`, external-sensor recording on Android should use the
same `react-native-ble-plx` path the iPhone already uses, driven from JavaScript,
rather than a second Kotlin BLE implementation that has to be kept in sync with
`shared/src/xiaoBle.ts`.

### Unrelated but adjacent

The Android package is `com.timmosquadros.skateroutemapper`; the iOS bundle is
`com.rasmuspuls.skateroutemapper`. Two different org identities. Settle this
before either store release.

---

## 2. Sync batching — built

Implemented as proposed, plus one hazard the proposal did not anticipate.

- `mobile/src/recording/sampleBuffer.ts` buffers samples and writes one queued
  operation per flush, at 250 samples or 20 seconds. Rows and their operation
  are still written in one transaction, so a sample can never reach storage
  without something to ship it.
- `mobile/src/sync/backoff.ts` reads `attempts` and schedules the retry:
  doubling from 5 seconds, capped at 15 minutes, with jitter.
- `mobile/src/sync/autoSync.ts` triggers on ride finish, on app foreground, and
  on a slow timer. There is no connectivity listener — that would mean another
  native dependency for a trigger the timer already covers.
- `syncPendingChanges` loops until the queue drains instead of sending one fixed
  batch, and reports progress.
- Request size, not operation count, turned out to be the real limit. The sync
  and sample routes now accept 8 MB bodies, and the phone keeps a request to 25
  operations or 2,000 samples.
- **The hazard:** skipping an operation that is waiting out a backoff can let a
  `ride.finish` overtake its own samples, and the backend refuses samples for a
  finished ride — so the tail of that ride would be rejected permanently rather
  than merely delayed. `selectSendableOperations` therefore holds back
  everything queued behind a waiting operation *for the same ride*, while other
  rides carry on.

Still open: an operation that fails forever holds up its own ride. It is
surfaced in the rides list rather than retried silently, which is what this
section asked for, but nothing yet lets a rider discard it.

### Current state

`insertSample()` in `mobile/src/database/db.ts` enqueues one `pending_changes`
row **per sample**:

```ts
export function insertSample(rideId: string, sample: MeasurementSample) {
  db.withTransactionSync(() => {
    insertSampleRow(rideId, sample);
    enqueueSamplesPendingChange(rideId, [sample]);
  });
}
```

`syncPendingChanges()` sends `getPendingChanges(50)` — fifty rows per call — and
`RidesScreen` is the only caller, behind a manual button.

A 30-minute XIAO ride at 20 Hz produces about 36,000 pending rows, which is
roughly 720 button presses to upload. Only the Android native path escapes this,
because it batches 500 samples at a time through `addSamples()`.

Dropping the phone IMU path makes this far less acute — GPS fixes arrive roughly
every 2 seconds rather than 20 times a second — but a XIAO ride still generates
far more than the queue can carry.

### Proposal

**Batch at the source.** Buffer samples in memory and write one
`pending_changes` row per flush, triggered by whichever comes first: a sample
count threshold, or a time interval. Note the ceiling: `rideSamplesSchema` in
`backend/src/features/rides/contracts.ts` caps a batch at 1,000 samples, so a
flush must stay at or below that.

**Sync automatically.** Manual-only sync means data sits on the phone
indefinitely. Trigger on ride finish, on app foreground, and on regained
connectivity.

**Back off on failure.** `markPendingChangesFailed()` already increments an
`attempts` column and stores `lastError`, but nothing reads `attempts` to
schedule a retry — a failing operation is retried at the same rate forever. Use
it for exponential backoff, and surface an operation that has failed repeatedly
rather than retrying it silently.

**Show progress.** A ride upload is long enough to need more than a single
status string.

---

## 3. Manual road rating and route planning

This is the feature that makes the app useful to riders who own no hardware, and
it is the least specified. Treat this section as a starting point for design, not
a settled plan.

### The core modelling problem

Everything so far is **ride-shaped**: samples belong to a ride, and a ride
belongs to a user. Route quality is **road-shaped**: two riders on the same
street must contribute to the same piece of road, and that road's quality must
outlive both rides.

So the data model needs a road entity that rides contribute *to*, rather than a
quality value stored *on* each ride.

A sketch, to be argued with:

- **RoadSegment** — a piece of road with a geometry, a current surface level, and
  a confidence. Independent of any ride.
- **SegmentObservation** — one contribution to a segment, carrying its
  provenance: measured from a XIAO ride, or rated by hand. Keeps who, when, and
  under what conditions.

Keeping observations separate from the segment matters because measured and
human-rated data have very different trust characteristics, and because a
segment's level must be recomputable when the algorithm changes.

### The hard part: map matching

Turning a GPS trace into "this stretch of this street" is the real work. Broadly:

- **Snap to OpenStreetMap ways.** Segments align with real roads, results are
  shareable and routable. Costs a map-matching dependency and OSM data handling.
- **Spatial grid (geohash or H3).** Far simpler; no external data. Segments do
  not align with roads, which hurts once routing matters.

Recommendation: start with the rider's own recorded polyline for v1 manual
rating — a rider rates a stretch of the route they just skated — and defer map
matching until there is enough data for cross-rider aggregation to be worth it.

### Rating quality

Manual ratings are subjective and gameable. Before they feed anything public,
decide how ratings from different riders are weighted, what happens when a
measured value and a human rating disagree, and how a rating ages as road
surfaces change.

### Route planning

Good-asphalt route planning needs a routing graph with a custom cost function,
which means OSM data plus a routing engine such as GraphHopper or Valhalla. This
is a large epic and should not be started before segments exist and carry
trustworthy levels.

### Infrastructure note

Postgres currently stores latitude and longitude as plain `Float` columns with no
spatial index. Add PostGIS when road segments arrive — "which segments does this
route touch" is a spatial query, and doing it without spatial indexing will not
scale. Railway supports PostGIS.

---

## 4. Admin workbench hardening

The admin app is the analysis workbench for the hardware programme, so its value
is rising, not falling. It has accumulated the usual problems of a fast-moving
internal tool.

### `RideAnalysisPanel.tsx` is 1,467 lines

It contains, in one file: a hand-rolled slippy map (`lngLatToWorld`, `mapTiles`,
`mapViewForSamples`, `applyMapInteraction`), a roughness scoring heuristic, chart
rendering, replay transport controls, and the panel itself. Split it along those
seams.

### The roughness heuristic is not a product algorithm

`skateRoughnessScore()` computes windowed RMS plus a weighted 95th-percentile
peak, and `roughnessInterpretation()` maps it to labels like "Good skating
asphalt" at hard-coded thresholds. `docs/vibration-roughness-plan.md` explicitly
warns against exactly this: *"Do not treat broadband acceleration RMS alone as
road roughness. Tilt, pushing, turning, carrying the board and landings all add
energy that is unrelated to the surface under rolling wheels."*

It is fine as a debug view. It must not become the product algorithm by default.
Label it as provisional in the UI so nobody reads it as calibrated.

### Untested signal processing

`admin/src/features/research/signalAnalysis.ts` is 595 lines of FFT, band energy
and spectrogram code with no unit tests. The whole repo has two contract test
files, one E2E test and one hardware test. DSP is exactly the kind of code where
a silent numerical error produces plausible-looking wrong answers. Get fixtures
and unit tests around it before tuning algorithms on its output.

### No router

`App.tsx` holds the active view in `useState`, so nothing in the admin app is
linkable. A ride analysis or a research capture cannot be bookmarked or shared
with the other developer. Add a router.

### Placeholder dashboard

`DashboardPage` shows an entities link, a hardware bench link, the session expiry
and the API URL — no actual data. Its own comment lists what it was meant to
show: ride ingest health, newest ride, GPS coverage, sample volume, app versions.

### OpenStreetMap tile usage

`RideAnalysisPanel` loads tiles directly from `tile.openstreetmap.org`. The OSMF
tile usage policy requires attribution and prohibits heavy use. Fine for an
internal tool with two users; not fine if this ever ships to riders. Add
attribution now and plan a tile provider before any public map.

---

## What was built

Steps 1 to 3 of the order below, as one slice: a ride can now be recorded with
the screen locked, shows real figures while it is being ridden, and uploads
itself without anyone pressing a button.

- Background recording on both platforms, through one `expo-location` task.
- The Android fix filter ported to shared TypeScript, with tests.
- Distance, moving time and speed, computed live on the phone and recomputed
  server-side from the synced samples when a ride finishes.
- `Ride` carries those figures, so the rides list, the ride detail screen and
  the admin dashboard read them instead of walking the sample table.
- A recording screen showing elapsed and moving time, distance, current, average
  and top speed, GPS accuracy, and why a fix was dropped.
- Batched sync with exponential backoff, automatic triggers, progress, and
  per-ride ordering.
- The 5 Hz phone IMU recording path removed, as this document called for.
  `sensorSource: "phone"` now means a GPS-only ride.

Two fixes came along with it, because they were in the same code:

- `avgVibration` was weighted by the ride's total sample count, so hundreds of
  GPS-only samples diluted a handful of real board readings towards zero. It is
  now weighted by a new `vibrationSampleCount`, and the migration repairs the
  stored averages.
- `POST /v1/mobile/sync` used Fastify's 1 MB default body limit, which batched
  samples would have exceeded.

### What still needs a device

Everything above type-checks and is unit tested where it is pure, but none of it
has met a real GPS signal. Before this is called done:

- `npm run iphone:build`, then an outdoor ride with the screen locked.
- Check the distance against a known course. The thresholds in
  `rideTrackingDefaults` are reasoned, not measured.
- Check a XIAO ride still pairs vibration with position.
- Check Android's foreground service notification appears and that recording
  survives the app being backgrounded.

## Suggested order

1. ~~**Background recording**, both platforms.~~ Built; needs a device build and
   an outdoor ride to verify.
2. ~~**GPS-only recording screen** and ride metrics on `Ride`.~~ Built.
3. ~~**Sync batching**, so recorded rides actually arrive.~~ Built.
4. **Labelled outdoor captures.** This gate blocks every algorithm decision and
   is physical work, not code — see `hardware/HARDWARE-HANDOFF.md`. This is
   now the next thing to do.
5. **Admin workbench tests and split**, alongside the capture analysis they
   support.
6. **Road segments and manual rating**, once there is real ride data to attach to
   them.
7. **Route planning**, last.

## Open questions

- Does the Android app need anything from `BackgroundRecorderService.kt` that
  `expo-location` cannot provide? The app no longer calls it, and the fix filter
  it owned has been ported, so the remaining question is whether anything else in
  the service is worth keeping before the module is deleted.
- A queued operation that fails permanently blocks the rest of its own ride.
  Should a rider be able to discard it, or should the app try to repair it?
- Which org identity wins for the app package name?
- Does a manual road rating apply to the rider's own recorded polyline, or to a
  shared road segment, in the first version?
- Does the `MOBILE_INGESTION_API_KEY` auth path still have a purpose? The app now
  authenticates with user bearer tokens, and the backend still accepts the
  ingestion key on mobile routes.
