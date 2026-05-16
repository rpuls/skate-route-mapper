# Skate Route Mapper

Skate Route Mapper helps skaters find better routes, avoid rough pavement, and build a clearer picture of surface quality over time. The mobile app records vibration, motion, and GPS data while you ride, and the backend is designed to ingest that data immediately so it can be processed, ranked, and used in future route intelligence.

For end users, the promise is simple:

- record a ride with your phone
- capture how smooth or rough the road feels
- replay the route on a map
- turn raw ride data into useful route-quality insight

This project is built for inline skates, skateboards, and longboards, where small changes in pavement quality make a real difference.

## Repo Structure

```text
backend/         Backend API service
admin/       Admin dashboard app
db/          Prisma schema and migrations
firmware/    Device firmware such as the Nesso N1 BLE IMU sketch
mobile/      Expo React Native app
shared/      Shared TypeScript types and contracts
```

What each part does:

- `mobile` is the client that records rides with accelerometer, gyroscope, and GPS.
- `backend` is the Node.js backend that receives ride data, serves admin endpoints, and owns server-side processing.
- `admin` is the internal dashboard app.
- `db` holds the Prisma datamodel and migrations.
- `firmware` holds companion-device firmware that supports mobile recording.
- `shared` holds the shared ride/sample contract and design tokens used by the apps.

Project docs:

- `docs/api.md` defines the backend contract.
- `docs/data-model.md` explains the Prisma datamodel.
- `docs/design-guide.md` defines the visual language, design tokens, and button variants.
- `docs/admin-frontend.md` defines admin app structure, MUI usage, and data-fetching conventions.
- `docs/vibration-roughness-plan.md` plans high-frequency sensor capture, compact vibration features, and route roughness segmentation.
- `mobile/README.md` covers mobile development, Expo Go, web testing, and device-build notes.
- `firmware/nesso-n1/README.md` covers the legacy Nesso N1 raw BLE IMU sketch.
- `firmware/nesso-n1-new/README.md` covers the Gate A compact roughness feature-frame prototype.

## How The System Works

The current system follows a very direct flow:

1. A user starts a ride in the mobile app.
2. The app collects motion and GPS samples.
3. Samples are stored locally on-device.
4. The backend is ready to accept ride start events, sample batches, and ride completion events.
5. Later, an admin dashboard can inspect rides and derived metrics from the database.

Core backend endpoints:

- `POST /v1/mobile/rides/start`
- `POST /v1/mobile/rides/:rideId/samples`
- `POST /v1/mobile/rides/:rideId/finish`
- `GET /v1/admin/rides`
- `GET /v1/admin/rides/:rideId`
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

### Run The Mobile App

From the repo root:

```bash
npm run dev:mobile
```

To run on a physical iPhone with Expo Go from Windows, use the tunnel command:

```bash
npm run dev:iphone
```

For a physical iPhone without a Mac/Xcode:

1. Install Expo Go from the App Store.
2. Sign in with the same Expo account used by the CLI.
3. Run `npm run dev:iphone`.
4. Scan the QR code on the iPhone.

If your phone and computer are on the same Wi-Fi network, LAN mode is usually faster:

```bash
npm run start --workspace @skate-route-mapper/mobile -- --lan --go
```

Use an EAS development build only when Expo Go is not enough, for example when testing custom native modules such as BLE. Physical iPhone development builds require Apple signing through a paid Apple Developer account.

The browser target is useful for UI/layout checks:

```bash
npm run dev:web
```

Notes:

- a physical device is strongly recommended because the app depends on motion sensors and GPS
- `dev:iphone` is the default iPhone + Expo Go path and uses Expo's ngrok tunnel
- tunnel mode depends on Expo's ngrok service and can fail when ngrok is blocked or unavailable
- the web target is mainly useful for UI checks, not full ride recording
- the web target uses fallbacks for native-only pieces such as SQLite storage and maps
- the mobile app is not containerized; Docker is meant for backend services and the admin app

Package-local mobile commands are still available for platform-specific work, for
example `npm run android --workspace @skate-route-mapper/mobile`.

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
- `mobile/src/screens/RecordingScreen.tsx` handles live sensor and GPS collection.
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

What already works:

- mobile ride recording
- local SQLite persistence on device
- optional mobile signup/sign-in
- offline-first pending-change sync from mobile SQLite to the backend
- mobile web layout preview with native fallbacks
- ride replay on a map
- backend ride ingestion and mobile sync APIs
- Prisma-backed backend schema and migrations
- protected admin dashboard entity views
- admin ride detail analysis with route map and vibration charts
- shared TypeScript contracts for mobile and backend
- shared design tokens and design guide
- Docker-based local stack for API, Postgres, and admin

What is not wired up yet:

- admin user management screens
- paginated/downsampled deep analysis for very large ride sample sets
- advanced analytics or calibrated surface scoring
- production storage/sync for compact Nesso roughness feature frames

Signal research in progress:

- `docs/vibration-roughness-plan.md` is the canonical plan for high-frequency
  vibration capture, feature frames, calibration, and eventual route roughness
  segments.
- `firmware/nesso-n1-new/` contains the current Gate A Nesso firmware prototype.
- The current Gate A firmware label is `calibration v2`; it sends compact BLE
  feature frames and prints serial fields for tuning (`vibRms`, `vibP2p`,
  `jerkRms`, `rawStd`, `rawP2p`, `score`, `smoothScore`, `level`).
- Indoor calibration is promising, but real asphalt testing is still required
  before treating the `1-6` levels as product-calibrated.

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

1. Harden admin ride analysis for large rides with pagination, downsampling, and backend summaries.
2. Add admin user management.
3. Improve mobile sync ergonomics, retries, and historical ride recovery.
4. Add better route scoring and later geospatial features.
