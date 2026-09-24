# Skate Route Mapper

Skate Route Mapper helps skaters find better routes, avoid rough pavement, and build a clearer picture of surface quality over time. The backend ingests ride data so it can be processed, ranked, and used for route intelligence.

This project is built for inline skates, skateboards, and longboards, where small changes in pavement quality make a real difference.

## Who The App Is For

The app has to be worth using **without** any extra hardware, so it is built in
two tiers.

**Everyone — phone only.** Record a skate route like any other sports tracker:
route, distance, duration and speed, saved and replayable on a map. Later,
riders will be able to rate road sections by hand, so a route's surface quality
can be described even where no sensor has been.

**Riders with the XIAO board.** The external sensor measures pavement vibration
at a rate the phone cannot reach, and contributes measured surface quality to
the same routes.

Phone accelerometers are not a realistic substitute for the board: they are too
slow, too filtered, and too dependent on where the phone is carried. The phone
owns GPS and the route; the board owns vibration.

The long-term goal serves both groups: good-asphalt route planning for anyone,
built from data that device owners contribute.

## Repo Structure

```text
backend/     Backend API service
admin/       Admin dashboard app
db/          Prisma schema and migrations
docs/        API contract, data model, design and planning docs
firmware/    XIAO BLE vibration-sensor firmware
hardware/    Hardware handoff, research protocol, offline analysis tooling
mobile/      Expo React Native app
shared/      Shared TypeScript types and contracts
test/        Playwright end-to-end tests
```

What each part does:

- `mobile` is the client that records ride routes with GPS, and labelled
  high-rate research captures from the XIAO board.
- `backend` is the Node.js backend that receives ride data, serves admin endpoints, and owns server-side processing.
- `admin` is the internal dashboard app, including the XIAO hardware bench and
  the signal analysis workbench.
- `db` holds the Prisma datamodel and migrations.
- `firmware` holds companion-device firmware that supports mobile recording.
- `hardware` holds the hardware handoff, research protocol, and offline
  analysis tooling for `.skateresearch` captures.
- `shared` holds the shared ride/sample contract and design tokens used by the apps.

Project docs:

- `hardware/HARDWARE-HANDOFF.md` is the living resume point for the proven XIAO vibration hardware, battery assembly, and next field experiment.
- `hardware/README.md` covers the XIAO hardware bench inside the admin app, USB/BLE checks, and staged battery hookup.
- `docs/api.md` defines the backend contract.
- `docs/data-model.md` explains the Prisma datamodel.
- `docs/design-guide.md` defines the visual language, design tokens, and button variants.
- `docs/admin-frontend.md` defines admin app structure, MUI usage, and data-fetching conventions.
- `docs/ride-tracking.md` explains how GPS fixes become a ride's distance,
  moving time and speed, and why each rule exists.
- `docs/vibration-roughness-plan.md` plans high-frequency sensor capture, compact vibration features, and route roughness segmentation.
- `docs/development-plan.md` records the current gaps and the planned order of work.
- `mobile/README.md` covers the one-command iPhone workflow, device registration, native rebuilds, and web testing.
- `firmware/xiao-lsm6dsox/README.md` covers the XIAO ESP32S3 + LSM6DSOX BLE IMU sketch and packet format.

## How The System Works

There are two data paths.

**Ride recording** is the product flow:

1. A user starts a ride in the mobile app.
2. A registered background task collects GPS fixes, plus vibration samples when
   a XIAO board is connected. Recording continues with the screen locked.
3. Fixes are filtered, folded into the ride's distance, moving time and speed,
   and stored locally on-device in SQLite in batches.
4. A signed-in user's queue uploads itself on ride finish, on app foreground,
   and on a retry timer.
5. Finishing a ride recomputes its route figures server-side from the samples
   that arrived, so the stored distance always matches the stored route.
6. The admin dashboard inspects rides and derived metrics from the database.

**Research capture** is the algorithm-development flow, and does not run during
an ordinary ride:

1. The phone asks the XIAO for a bounded 10/30/60 second capture at 833 or
   1,666 Hz.
2. The board samples into its own RAM, independent of BLE reliability.
3. The phone retrieves and validates the capture, attaches a category, label,
   note, photo and GPS fixes, and saves it as a `.skateresearch` file.
4. A signed-in user uploads it, and an admin downloads it for laptop analysis
   or inspects it in the admin signal workbench.

Core backend endpoints:

- `POST /v1/mobile/rides/start`
- `POST /v1/mobile/rides/:rideId/samples`
- `POST /v1/mobile/rides/:rideId/finish`
- `POST /v1/mobile/sync`
- `POST /v1/mobile/research-captures`
- `GET /v1/admin/rides`
- `GET /v1/admin/rides/:rideId`
- `POST /v1/admin/rides/:rideId/recompute-metrics`
- `GET /v1/admin/research-captures/:researchCaptureId/recording`
- `GET /v1/admin/research-captures/:researchCaptureId/photo`
- `POST /v1/admin/mobile/rides/start`
- `POST /v1/admin/mobile/rides/:rideId/samples`
- `POST /v1/admin/mobile/rides/:rideId/finish`
- `GET /health`

API boundaries:

- `/v1/mobile/*` is the end-user/mobile API.
- `/v1/admin/*` is the internal admin API.
- `/v1/admin/mobile/*` is for admin-only workflows that perform mobile-compatible actions.
- Admin credentials may authorize mobile endpoints; mobile credentials must never authorize admin endpoints.

## Recommended Stack

Recommended stack for this project:

- `Node.js`
- `Fastify`
- `PostgreSQL`
- `Prisma`
- `Railway`

Why this stack fits:

- `Node.js` keeps backend and future admin dashboard in the same language.
- `Fastify` is lightweight and well suited for ingestion-heavy APIs.
- `PostgreSQL` is a strong fit for structured ride data, aggregation, and future geospatial work.
- `Prisma` makes the datamodel explicit in one schema file and keeps migrations versioned.
- `Railway` is a clean deployment fit for separate API, admin, and database services.

Recommendation:

- use plain PostgreSQL as the source of truth
- keep the API as the only write entrypoint
- consider Supabase later only if you specifically want managed auth, storage, or realtime features
- use Prisma as the canonical schema and migration layer

## Developer Setup

### Prerequisites

- Node.js 20+
- npm 10+
- Docker Desktop or another local Docker engine
- PostgreSQL 15+ locally, or a remote Postgres instance
- Expo-compatible Android or iOS environment for mobile development

### Fastest Local Setup With Docker

If you want the backend stack running quickly and consistently, use Docker.

Start the local backend/admin stack:

```bash
npm run app
```

Follow logs:

```bash
npm run logs
```

Direct Docker command:

```bash
docker compose up --build --detach --wait
```

When the stack is ready, the command prints the local access URLs.

To stop the stack, use Docker Desktop or run `docker compose down`.

This starts:

- `db` on `localhost:5433`
- `backend` on `http://localhost:3001`
- `admin` on `http://localhost:3000`

### End-to-End Tests

Playwright E2E tests live under `test/`. The root command starts an isolated Docker Compose stack for PostgreSQL, the API, and the admin app, runs the browser test, then tears the stack down with its test database volume:

```bash
npm run e2e
```

Run the same suite headed when you want to watch the browser:

```bash
npm run e2e:headed
```

The command installs the Playwright Chromium browser automatically when needed.

The E2E stack uses these local ports:

- admin on `http://localhost:3100`
- backend on `http://localhost:3101`

PostgreSQL stays internal to the Docker network for the E2E stack.

The first test signs in with the local development admin account, creates a ride entity record through the generic admin entity UI, then deletes it again.

GitHub Actions runs contract tests, builds, and E2E tests on pushes to `main`
and on pull requests. The workflow lives in `.github/workflows/ci.yml`.

What Docker covers:

- PostgreSQL database
- backend API container
- admin web app container

This is the easiest way to mirror the eventual Railway shape locally.

### Install Dependencies

From the repo root:

```bash
npm install
```

### Environment Variables

Local default `.env` files are included for quick backend/admin testing:

- `.env` is used by Docker Compose.
- `backend/.env` is used by the API when running outside Docker.
- `admin/.env` is used by Vite when running the admin app outside Docker.
- `mobile/.env` can be created from `mobile/.env.example` for Expo public mobile config.

Tracked examples are available at `.env.example`, `backend/.env.example`, `admin/.env.example`, and `mobile/.env.example`.

The local defaults include this development admin account:

```env
INIT_ADMIN_EMAIL=admin@example.com
INIT_ADMIN_PASSWORD=local-dev-admin-password
```

The API local default uses the Docker-exposed PostgreSQL port:

```env
PORT=3001
HOST=0.0.0.0
DATABASE_URL=postgres://postgres:postgres@localhost:5433/skate_route_mapper
CORS_ORIGIN=http://localhost:3000
MOBILE_INGESTION_API_KEY=local-dev-mobile-ingestion-key
ADMIN_API_KEY=local-dev-admin-dashboard-key
INIT_ADMIN_EMAIL=admin@example.com
INIT_ADMIN_PASSWORD=local-dev-admin-password
ADMIN_SESSION_TTL_HOURS=24
```

For Railway, set long random values for `MOBILE_INGESTION_API_KEY`, `ADMIN_API_KEY`, and `INIT_ADMIN_PASSWORD` on the API service. Keep the API keys different. The mobile app should only receive the ingestion key; internal tooling can use the admin key.

`INIT_ADMIN_EMAIL` and `INIT_ADMIN_PASSWORD` seed the first admin account only when no admin users exist yet. After the first successful deploy, you can remove those two variables or leave them in place; startup will not overwrite existing admin users.

For the admin web service, set this build-time variable so the browser knows where to send login requests:

```env
VITE_API_BASE_URL=https://your-api-service.up.railway.app
```

### Backend And Admin

Use the Docker stack for backend/admin work:

```bash
npm run app
```

This is the supported local path for PostgreSQL, API, and admin together.
Common root verification and database commands:

```bash
npm run check
npm run build
npm run contracts:test
npm run db:generate
npm run db:migrate
npm run db:deploy
```

Package-local API commands are still available for narrow work, for example
`npm run check --workspace @skate-route-mapper/api`.

What happens on startup:

- the API loads environment variables
- connects to PostgreSQL
- applies committed Prisma migrations
- seeds the first admin user if `INIT_ADMIN_EMAIL` and `INIT_ADMIN_PASSWORD` are set and no admins exist
- starts the Fastify server

Default local API URL:

```text
http://localhost:3001
```

Health check:

```text
GET http://localhost:3001/health
```

### Admin Frontend Architecture

The admin app uses MUI for UI primitives and TanStack Query for all server-state/data fetching.

Canonical frontend rules live in:

- `docs/admin-frontend.md`

Short version:

- raw HTTP functions live in `admin/src/api/`
- query keys live in `admin/src/query/queryKeys.ts`
- server-state hooks live in `admin/src/features/<feature>/`
- pages call feature hooks
- reusable components receive props and do not call `fetch()`
- mutations invalidate TanStack Query keys instead of manually patching broad app state
- the generic entity viewer is generated from Prisma datamodel metadata

### iOS

With the Skate Route Mapper development app installed, run:

```bash
npm run iphone
```

Keep the terminal open and keep the laptop and iPhone on the same Wi-Fi. Device
registration and builds are not part of normal daily use. See
[`mobile/README.md`](mobile/README.md#ios) for the short registration and build
instructions.

### Web layout check

The browser target is useful for UI/layout checks:

```bash
npm run dev:web
```

The web target is for layout checks. BLE, sensors, GPS, camera, SQLite, and maps
must be tested on a physical device.

### Research Dataset

Signal analysis and the road surface work run against real captures, so there is
one command that pulls the dataset out of the API and onto disk:

```bash
npm run research:fetch
```

It reads two values, from a real environment variable first and the repo's
`.env` second:

- `RESEARCH_API_BASE_URL`: which API to fetch from. Falls back to
  `VITE_API_BASE_URL`, then to `http://localhost:3001`. Point it at the deployed
  service to fetch production captures.
- `ADMIN_API_KEY`: the key that API is running with. It is the existing
  machine-to-machine admin key, so nothing new has to be added to Railway.
  `RESEARCH_API_KEY` is read first if the export is ever given a key of its own.

The result lands in `research-data/`, which is gitignored because the recordings
are large, already live in the database, and are one command away:

```text
research-data/
  manifest.json                       every capture's row, as one file
  captures/<id>/capture.json          that capture's row, written last
  captures/<id>/recording.skateresearch
  captures/<id>/surface.jpg           when the capture has a photo
```

`capture.json` is written only after both binaries land, so it doubles as the
"complete" marker: an interrupted run is simply re-run, and a capture whose
`updatedAt` is unchanged is skipped. Use `npm run research:fetch -- --force` to
re-download everything.

Each row carries the whole `metadata` column, which is what the analysis needs
and what the entity viewer does not show: the GPS track over the recording
window, its speed summary, the before and after context fixes, and the board's
own validation report. Decode a recording with `decodeRecording` from
`@skate-route-mapper/shared/xiaoResearch`.

### Design System

The design system is intentionally lightweight. There is no UI framework dependency such as Tamagui yet.

Source of truth:

- `shared/src/design.ts` exports colors, spacing, radius, shadows, layout tokens, and button variants.
- `docs/design-guide.md` documents how those tokens should be used.

Current direction:

- sporty orange app background
- white primary tiles
- faint fills without borders for informational containers
- borders reserved for interactive controls and selected states
- large rounded corners with nested-radius logic
- Open Sans typography
- predefined button variants only

When adding UI, import tokens from `@skate-route-mapper/shared` instead of hardcoding new colors or one-off button styles.

## Developer Workflow

When working in this repo, this is the important mental model:

- `mobile` owns ride capture
- `backend` owns ingestion and server-side processing
- `db` owns the Prisma schema and migrations
- `shared` must stay in sync with both

If you change the ride or sample payload shape:

1. Update `shared/src/mobileContracts.ts`.
2. Update the API validation and persistence layer.
3. Update the mobile app to send or consume the new contract.
4. Run `npm run contracts:test`.

Key files:

- `mobile/src/store/measurementStore.ts` manages the ride lifecycle in the app.
- `mobile/src/database/db.ts` stores local rides and samples in SQLite.
- `mobile/src/recording/backgroundLocation.ts` registers the background location
  task and owns location permissions.
- `mobile/src/recording/rideRecorder.ts` owns the recording itself: active ride,
  running totals, and the sample buffer.
- `shared/src/rideTracking.ts` decides which GPS fixes to keep and turns them
  into distance, moving time and speed. Used by the phone and the backend.
- `mobile/src/sync/autoSync.ts` uploads the queue without being asked.
- `mobile/src/screens/RecordingScreen.tsx` shows the live ride.
- `backend/src/server.ts` starts the API process.
- `backend/src/app.ts` creates the Fastify app and registers route modules.
- `backend/src/endpoints/` owns HTTP paths, auth guards, and response shaping.
- `backend/src/features/<feature>/index.ts` is the public import surface for feature logic.
- `backend/src/features/rides/` owns ride contracts and reusable ride logic.
- `backend/src/features/adminUsers/` owns admin user contracts and reusable admin user logic.
- `backend/src/features/adminResources/` owns generated admin entity metadata and reusable generic entity logic.
- `backend/src/db/prisma.ts` owns the shared Prisma client.
- `db/schema.prisma` is the canonical backend datamodel.

## Current Status

The API is deployed and healthy at
`https://skate-route-mapper-api.up.railway.app`.

What already works:

- background ride recording with GPS on both platforms, through one
  `expo-location` task, with the screen locked
- distance, moving time, current, average and top speed, computed live on the
  phone and recomputed server-side from the synced samples
- GPS fix filtering shared by the phone and the backend, with unit tests
- batched, automatic sync with exponential backoff and per-ride ordering
- optional mobile signup/sign-in
- offline-first pending-change sync from mobile SQLite to the backend
- mobile web layout preview with native fallbacks
- ride replay on a map
- backend ride ingestion and mobile sync APIs
- Prisma-backed backend schema and migrations
- protected admin dashboard entity views, including admin user records
- browser-based XIAO USB/BLE hardware bench in the admin dashboard
- labelled XIAO research captures from the phone, uploaded and inspectable in
  the admin dashboard
- admin ride detail analysis with route map and vibration charts
- shared TypeScript contracts for mobile and backend
- shared design tokens and design guide
- Docker-based local stack for API, Postgres, and admin

What is not verified on a device yet:

- background recording is native configuration, so it needs a fresh
  `npm run iphone:build` and an outdoor ride with the screen locked before it
  can be called done
- the ride-tracking thresholds are reasoned, not measured. Check a recorded
  distance against a known course before trusting them

What is not wired up yet:

- **the core product promise**: no route scoring, no colour-coded surface
  quality on a map for end users
- normal-ride compact feature frames from the XIAO. The board currently streams
  the 20-byte live preview packet; the on-board roughness features described in
  `docs/vibration-roughness-plan.md` are not implemented in firmware
- manual road-section rating by users
- route planning over known-good surfaces
- paginated/downsampled deep analysis for very large ride sample sets
- calibrated surface scoring. The roughness figure in the admin ride analysis
  is an unvalidated broadband-RMS heuristic used for eyeballing data, not a
  product algorithm

The blocking gate for all surface-quality work is physical: no labelled outdoor
captures have been collected yet. See `hardware/HARDWARE-HANDOFF.md`.

## Deployment Shape

Recommended Railway setup:

- one service for `backend`
- one service for `admin`
- one PostgreSQL service for persistence

That keeps responsibilities clean:

- API handles ingestion and processing
- admin app handles internal tooling
- PostgreSQL stores ride and sample data

## Next Development Priorities

1. Verify background recording and ride distance on a device. Build with
   `npm run iphone:build`, ride a known course with the screen locked, and check
   the recorded distance.
2. Collect labelled outdoor XIAO captures. Every algorithm decision below is
   blocked on real road data.
3. From the captured data, choose the feature set and sample rate, then move
   roughness computation onto the board as compact BLE feature frames.
4. Add route scoring, colour-coded segments, and manual road-section rating.
5. Harden admin ride analysis for large rides with pagination, downsampling, and
   backend summaries.
