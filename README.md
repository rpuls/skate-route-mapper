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
api/         Backend ingestion API
admin/       Admin dashboard app
db/          Prisma schema and migrations
mobile/      Expo React Native app
shared/      Shared TypeScript types and contracts
```

What each part does:

- `mobile` is the client that records rides with accelerometer, gyroscope, and GPS.
- `api` is the Node.js backend that receives ride sessions and sample batches.
- `admin` is the internal dashboard app.
- `db` holds the Prisma datamodel and migrations.
- `shared` holds the shared ride/sample contract and design tokens used by the apps.

Project docs:

- `docs/api.md` defines the backend contract.
- `docs/data-model.md` explains the Prisma datamodel.
- `docs/design-guide.md` defines the visual language, design tokens, and button variants.
- `mobile/README.md` covers mobile development, Expo Go, web testing, and device-build notes.

## How The System Works

The current system follows a very direct flow:

1. A user starts a ride in the mobile app.
2. The app collects motion and GPS samples.
3. Samples are stored locally on-device.
4. The backend is ready to accept ride start events, sample batches, and ride completion events.
5. Later, an admin dashboard can inspect rides and derived metrics from the database.

Core backend endpoints:

- `POST /v1/rides/start`
- `POST /v1/rides/:rideId/samples`
- `POST /v1/rides/:rideId/finish`
- `GET /v1/rides`
- `GET /v1/rides/:rideId`
- `GET /health`

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
npm run admin-app
```

This rebuilds and starts the PostgreSQL, API, and admin containers. The shorter alias also works:

```bash
npm run app
```

Stop everything:

```bash
npm run stop
```

Follow logs:

```bash
npm run logs
```

The lower-level Docker script is still available:

```bash
npm run docker:up
```

Direct Docker command:

```bash
docker compose up --build --detach --wait
```

When the stack is ready, the command prints the local access URLs.

This starts:

- `db` on `localhost:5433`
- `api` on `http://localhost:3001`
- `admin` on `http://localhost:3000`

Useful commands:

```bash
npm run docker:down
npm run docker:logs
```

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
- `api/.env` is used by the API when running outside Docker.
- `admin/.env` is used by Vite when running the admin app outside Docker.
- `mobile/.env` can be created from `mobile/.env.example` for Expo public mobile config.

Tracked examples are available at `.env.example`, `api/.env.example`, `admin/.env.example`, and `mobile/.env.example`.

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

`INIT_ADMIN_EMAIL` and `INIT_ADMIN_PASSWORD` seed the first owner account only when no admin users exist yet. After the first successful deploy, you can remove those two variables or leave them in place; startup will not overwrite existing admin users.

For the admin web service, set this build-time variable so the browser knows where to send login requests:

```env
VITE_API_BASE_URL=https://your-api-service.up.railway.app
```

### Run The API

From the repo root:

```bash
npm run api:dev
```

Other useful API commands:

```bash
npm run api:check
npm run api:build
npm run api:start
npm run db:generate
npm run db:migrate:dev
npm run db:migrate:deploy
```

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

### Run The Mobile App

From the repo root:

```bash
npm run mobile:start
```

The root mobile scripts enter `mobile/` before starting Expo, matching the direct `cd mobile && npx expo start ...` workflow.

To run on a physical iPhone or Android phone with Expo Go on the same Wi-Fi network:

```bash
npm run mobile:expogo
```

If LAN discovery is not available, you can try Expo's ngrok tunnel mode:

```bash
npm run mobile:tunnel
```

For a physical iPhone without a Mac/Xcode, start with Expo Go:

1. Install Expo Go from the App Store.
2. Sign in with the same Expo account used by the CLI.
3. Run `npm run mobile:tunnel`.
4. Scan the QR code on the iPhone.

If your phone and computer are on the same Wi-Fi network, LAN mode is usually faster:

```bash
npm run mobile:expogo
```

Use an EAS development build only when Expo Go is not enough, for example when testing custom native modules such as BLE. Physical iPhone development builds require Apple signing through a paid Apple Developer account.

Platform-specific commands:

```bash
npm run mobile:android
npm run mobile:ios
npm run mobile:web
```

Notes:

- a physical device is strongly recommended because the app depends on motion sensors and GPS
- `mobile:expogo` is the easiest LAN option from Windows when using Expo Go on a physical device
- `mobile:tunnel` depends on Expo's ngrok tunnel service and can fail when ngrok is blocked or unavailable
- `mobile:ios` launches the local iOS simulator and requires macOS with Xcode
- the web target is mainly useful for UI checks, not full ride recording
- the web target uses fallbacks for native-only pieces such as SQLite storage and maps
- the mobile app is not containerized; Docker is meant for backend services and the admin app

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
- `api` owns ingestion and server-side processing
- `db` owns the Prisma schema and migrations
- `shared` must stay in sync with both

If you change the ride or sample payload shape:

1. Update `shared`.
2. Update the API validation and persistence layer.
3. Update the mobile app to send or consume the new contract.

Key files:

- `mobile/src/store/measurementStore.ts` manages the ride lifecycle in the app.
- `mobile/src/database/db.ts` stores local rides and samples in SQLite.
- `mobile/src/screens/RecordingScreen.tsx` handles live sensor and GPS collection.
- `api/src/server.ts` defines the HTTP routes.
- `api/src/db.ts` defines Prisma-backed persistence logic.
- `db/schema.prisma` is the canonical backend datamodel.
- `api/src/contracts.ts` validates incoming payloads.

## Current Status

What already works:

- mobile ride recording
- local SQLite persistence on device
- mobile web layout preview with native fallbacks
- ride replay on a map
- backend API scaffolding for ride ingestion
- Prisma-backed backend schema and migrations
- shared TypeScript contracts for mobile and backend
- shared design tokens and design guide
- Docker-based local stack for API, Postgres, and admin

What is not wired up yet:

- mobile-to-backend upload flow
- admin dashboard data views
- admin user management screens
- end-user accounts
- advanced analytics or calibrated surface scoring

## Deployment Shape

Recommended Railway setup:

- one service for `api`
- one service for `admin`
- one PostgreSQL service for persistence

That keeps responsibilities clean:

- API handles ingestion and processing
- admin app handles internal tooling
- PostgreSQL stores ride and sample data

## Next Development Priorities

1. Add mobile upload to the API with batched sample syncing.
2. Add a protected dashboard ride list and ride detail view.
3. Add admin user management.
4. Add better route scoring and later geospatial features.
