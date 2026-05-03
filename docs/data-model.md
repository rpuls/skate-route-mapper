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
- `api/src/db.ts`

## Models

### Ride

One ride session recorded by the mobile app.

Main fields:

- `id`
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
- `role`
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
- `createdAt`

## Enums

### VehicleType

- `skates`
- `skateboard`
- `longboard`

### SensorSource

- `phone`
- `external`

### AdminRole

- `owner`
- `admin`

## Relationship

- one `Ride` has many `Sample` rows
- each `Sample` belongs to one `Ride`
- one `AdminUser` has many `AdminSession` rows
- each `AdminSession` belongs to one `AdminUser`

## Auth And User Model Direction

The current production boundary uses two layers:

- API keys for mobile ingestion and internal scripts.
- `AdminUser` plus `AdminSession` for dashboard login.

The API can seed the first owner account on startup when both variables are present:

```env
INIT_ADMIN_EMAIL=admin@example.com
INIT_ADMIN_PASSWORD=use-a-long-random-password
```

This is seed-once behavior: if any admin user already exists, startup leaves the admin table untouched.

Possible later datamodel additions:

- `ApiKey`: hashed server-side key records with scopes such as `ingestion:write` and `admin:read`.
- `User`: future app user identity once the product needs accounts.
- `Device`: mobile install or physical device identity, related to a `User` when accounts exist.
- `Ride.userId` and `Ride.deviceId`: nullable at first so existing anonymous ride data stays valid.

Suggested order:

1. Build dashboard ride inspection on top of `AdminUser` sessions.
2. Add admin management screens for creating, disabling, and rotating admin accounts.
3. Move static environment keys into hashed `ApiKey` rows when you need key rotation, per-client keys, revocation, or audit trails.
4. Add `User` only when the mobile app is ready for account UX.

## Prisma Workflow

Generate the Prisma client:

```bash
npm run db:generate
```

Create a new migration during development:

```bash
npm run db:migrate:dev
```

Apply committed migrations in deploy environments:

```bash
npm run db:migrate:deploy
```

## Why This Helps

Compared to handwritten schema SQL inside application code, this gives the project:

- one visible datamodel file
- migrations tracked in version control
- typed database access
- easier communication between backend and mobile work
- documentation that stays much closer to the real schema
