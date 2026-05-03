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
- `shared` holds the shared ride and sample contract used by both apps.

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

Start everything:

```bash
npm run docker:up
```

Direct Docker command:

```bash
docker compose up --build --detach --wait
```

When the stack is ready, the command prints the local access URLs.

This starts:

- `db` on `localhost:5432`
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

Create an `.env` file in `api` based on `api/.env.example`.

Example:

```env
PORT=3001
HOST=0.0.0.0
DATABASE_URL=postgres://postgres:postgres@localhost:5432/skate_route_mapper
CORS_ORIGIN=*
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

To run on a physical iPhone with Expo Go over a tunnel:

```bash
npm run mobile:expogo
```

Platform-specific commands:

```bash
npm run mobile:android
npm run mobile:ios
npm run mobile:web
```

Notes:

- a physical device is strongly recommended because the app depends on motion sensors and GPS
- `mobile:expogo` is the easiest option from Windows when using Expo Go on an iPhone
- `mobile:ios` launches the local iOS simulator and requires macOS with Xcode
- the web target is mainly useful for UI checks, not full ride recording
- the mobile app is not containerized; Docker is meant for backend services and the admin app

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
- ride replay on a map
- backend API scaffolding for ride ingestion
- Prisma-backed backend schema and migrations
- shared TypeScript contracts for mobile and backend
- Docker-based local stack for API, Postgres, and admin

What is not wired up yet:

- mobile-to-backend upload flow
- auth or ingestion keys
- admin dashboard
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
2. Add a simple auth layer for trusted ingestion.
3. Add an admin web app for ride inspection and QA.
4. Add better route scoring and later geospatial features.
