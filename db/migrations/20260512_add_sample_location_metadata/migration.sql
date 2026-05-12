ALTER TABLE "samples"
  ADD COLUMN "location_timestamp" TIMESTAMP(3),
  ADD COLUMN "location_accuracy" DOUBLE PRECISION,
  ADD COLUMN "location_age_ms" INTEGER;
