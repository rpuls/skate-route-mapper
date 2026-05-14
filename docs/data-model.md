# Data Model

The backend datamodel is now defined with Prisma.

Canonical source of truth:

- [db/schema.prisma](/c:/Users/rasmu/Documents/GitHub/skate-route-mapper/db/schema.prisma)

This schema file is the place both developers should look first when discussing:

- table structure
- field names
- enums
- relations
- nullability

## Database Framework

The database stack is:

- `PostgreSQL` for persistence
- `Prisma` for schema definition, migrations, and typed database access

Relevant files:

- `db/schema.prisma`
- `db/migrations/`
- `backend/src/db/prisma.ts`
- `backend/src/features/rides/repository.ts`
- `backend/src/features/sync/repository.ts`
- `backend/src/features/adminUsers/repository.ts`
- `backend/src/features/adminResources/repository.ts`
- `shared/src/adminResources.ts`

## Admin Resource Metadata

The custom admin app asks the API for resource metadata at `GET /v1/admin/resources`. The API builds that metadata from Prisma's generated datamodel, so the generic entity viewer stays aligned with `db/schema.prisma` after migrations and `npm run db:generate`.

The admin resource layer should stay mostly generated from the datamodel. Keep only small policy overrides in the API layer for sensitive fields and special transforms:

- hide secrets such as `passwordHash` and session token hashes
- expose virtual fields such as `AdminUser.password`
- keep transforms, such as password hashing, inside the API
- graduate from the generic resource view to a custom interface when the workflow has real product logic

## Models

### Ride

One ride session recorded by the mobile app.

Main fields:

- `id`
- `userId`
- `deviceId`
- `startedAt`
- `endedAt`
- `vehicleType`
- `sensorSource`
- `clientId`
- `appVersion`
- `deviceModel`
- `sampleCount`
- `gpsPointCount`
- `avgVibration`
- `maxVibration`
- `createdAt`
- `updatedAt`

### AdminUser

One internal dashboard user.

Main fields:

- `id`
- `email`
- `passwordHash`
- `name`
- `active`
- `lastLoginAt`
- `createdAt`
- `updatedAt`

### AdminSession

One active dashboard login session. The raw session token is returned once at login; only a hash is stored in the database.

Main fields:

- `id`
- `adminUserId`
- `tokenHash`
- `expiresAt`
- `revokedAt`
- `createdAt`

### User

One optional end-user account for the mobile app. This is separate from
`AdminUser`, which is only for internal dashboard access.

Main fields:

- `id`
- `email`
- `passwordHash`
- `name`
- `lastLoginAt`
- `createdAt`
- `updatedAt`

### UserSession

One mobile user login session. The raw session token is returned once at
signup/login; only a hash is stored in the database.

Main fields:

- `id`
- `userId`
- `tokenHash`
- `expiresAt`
- `revokedAt`
- `createdAt`

### Device

One mobile install/device identity when the app provides a stable `clientId`.
Devices can exist without a user so logged-out ride uploads remain possible.

Main fields:

- `id`
- `userId`
- `clientId`
- `deviceModel`
- `appVersion`
- `lastSeenAt`
- `createdAt`
- `updatedAt`

### Sample

One measurement sample belonging to a ride.

Main fields:

- `id`
- `rideId`
- `recordedAt`
- `ax`
- `ay`
- `az`
- `gx`
- `gy`
- `gz`
- `vibrationMagnitude`
- `latitude`
- `longitude`
- `speed`
- `locationTimestamp`
- `locationAccuracy`
- `locationAgeMs`
- `createdAt`

### SyncOperation

One idempotency record for an offline-first mobile sync operation that has
already been applied to Postgres.

Main fields:

- `id`
- `userId`
- `operationType`
- `createdAtMs`
- `processedAt`
- `payload`

## Enums

### VehicleType

- `skates`
- `skateboard`
- `longboard`

### SensorSource

- `phone`
- `external` - external IMU for accelerometer/gyroscope, with phone GPS

## Relationship

- one `Ride` has many `Sample` rows
- each `Sample` belongs to one `Ride`
- one `AdminUser` has many `AdminSession` rows
- each `AdminSession` belongs to one `AdminUser`
- one `User` has many `UserSession`, `Device`, and `Ride` rows
- one `User` can have many `SyncOperation` rows
- one `Device` can have many `Ride` rows
- `Ride.userId` and `Ride.deviceId` are nullable so anonymous and existing
  ride data remains valid
- `SyncOperation.userId` is nullable so trusted ingestion/admin syncs can also
  be idempotent

## Auth And User Model Direction

The current production boundary uses three layers:

- API keys for mobile ingestion and internal scripts.
- `AdminUser` plus `AdminSession` for dashboard login.
- `User` plus `UserSession` for optional mobile accounts.

API authorization is intentionally separated by route namespace:

- `/v1/mobile/*` is the mobile/user-facing surface. Auth endpoints are public,
  current-user endpoints require a mobile user session, and ingestion routes
  accept either a mobile user session, the mobile ingestion key, or admin
  credentials for internal tooling.
- `/v1/admin/*` is the admin surface. It only accepts admin credentials.
- `/v1/admin/mobile/*` is an admin-only surface for mobile-compatible actions. It mirrors mobile payload shapes where useful but still requires admin credentials.
- Future user-facing read endpoints should be tied to a `User` or `Device`
  identity and must only return data that identity is allowed to access.
- Mobile signup/sign-in is optional. The app should still be able to record
  locally while logged out; accounts enable future upload/sync and recovery
  after reinstalling or wiping a device.
- The mobile app stores offline writes in local SQLite `pending_changes` and
  sends them to `POST /v1/mobile/sync` over HTTPS. The backend stores applied
  operation IDs in `sync_operations` so retries do not duplicate ride writes.

The API can seed the first admin account on startup when both variables are present:

```env
INIT_ADMIN_EMAIL=admin@example.com
INIT_ADMIN_PASSWORD=use-a-long-random-password
```

This is seed-once behavior: if any admin user already exists, startup leaves the admin table untouched.

Possible later datamodel additions:

- `ApiKey`: hashed server-side key records with scopes such as `ingestion:write` and `admin:read`.
- richer device/session metadata such as platform, push token, or token family.

Suggested order:

1. Build dashboard ride inspection on top of `AdminUser` sessions.
2. Add admin management screens for creating, disabling, and rotating admin accounts.
3. Move static environment keys into hashed `ApiKey` rows when you need key rotation, per-client keys, revocation, or audit trails.
4. Build sync/read APIs on top of `User`, `Device`, and nullable ride ownership
   without blocking anonymous local recording.

## Prisma Workflow

Generate the Prisma client:

```bash
npm run db:generate
```

Run mobile/backend contract drift tests:

```bash
npm run contracts:test
```

This command checks both sides of the mobile data boundary:

- backend Zod schemas accept shared mobile API fixtures
- mobile local persistence round-trips shared ride/sample fixtures

It intentionally does not expose admin datamodel details to the mobile app.

Create a new migration during development:

```bash
npm run db:migrate
```

Apply committed migrations in deploy environments:

```bash
npm run db:deploy
```

## Why This Helps

Compared to handwritten schema SQL inside application code, this gives the project:

- one visible datamodel file
- migrations tracked in version control
- typed database access
- easier communication between backend and mobile work
- documentation that stays much closer to the real schema
