-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('skates', 'skateboard', 'longboard');

-- CreateEnum
CREATE TYPE "SensorSource" AS ENUM ('phone', 'external');

-- CreateTable
CREATE TABLE "rides" (
    "id" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ NOT NULL,
    "ended_at" TIMESTAMPTZ,
    "vehicle_type" "VehicleType" NOT NULL,
    "sensor_source" "SensorSource" NOT NULL,
    "client_id" TEXT,
    "app_version" TEXT,
    "device_model" TEXT,
    "sample_count" INTEGER NOT NULL DEFAULT 0,
    "gps_point_count" INTEGER NOT NULL DEFAULT 0,
    "avg_vibration" DOUBLE PRECISION,
    "max_vibration" DOUBLE PRECISION,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "samples" (
    "id" BIGSERIAL NOT NULL,
    "ride_id" TEXT NOT NULL,
    "recorded_at" TIMESTAMPTZ NOT NULL,
    "ax" DOUBLE PRECISION NOT NULL,
    "ay" DOUBLE PRECISION NOT NULL,
    "az" DOUBLE PRECISION NOT NULL,
    "gx" DOUBLE PRECISION NOT NULL,
    "gy" DOUBLE PRECISION NOT NULL,
    "gz" DOUBLE PRECISION NOT NULL,
    "vibration_magnitude" DOUBLE PRECISION NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "speed" DOUBLE PRECISION,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "samples_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rides_started_at_idx" ON "rides"("started_at" DESC);

-- CreateIndex
CREATE INDEX "samples_ride_id_recorded_at_idx" ON "samples"("ride_id", "recorded_at");

-- AddForeignKey
ALTER TABLE "samples" ADD CONSTRAINT "samples_ride_id_fkey" FOREIGN KEY ("ride_id") REFERENCES "rides"("id") ON DELETE CASCADE ON UPDATE CASCADE;
