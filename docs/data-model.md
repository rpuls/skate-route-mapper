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

## Relationship

- one `Ride` has many `Sample` rows
- each `Sample` belongs to one `Ride`

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
