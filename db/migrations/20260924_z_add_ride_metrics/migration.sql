-- What a ride covered, stored on the ride itself.
--
-- The rides list, the admin dashboard and the phone all want distance,
-- duration and speed. Deriving them means walking the sample table, which a
-- 30-minute XIAO ride makes expensive, so the ride carries its own figures.
--
-- They are nullable because they are unknown, not zero, for rides recorded
-- before ride tracking existed. The backend fills them in when a ride finishes.
ALTER TABLE "rides"
  ADD COLUMN "distance_meters" DOUBLE PRECISION,
  ADD COLUMN "moving_seconds" DOUBLE PRECISION,
  ADD COLUMN "avg_speed_mps" DOUBLE PRECISION,
  ADD COLUMN "max_speed_mps" DOUBLE PRECISION,
  ADD COLUMN "accepted_fix_count" INTEGER,
  ADD COLUMN "rejected_fix_count" INTEGER;

-- How many samples actually measured vibration.
--
-- The running average of `avg_vibration` was weighted by `sample_count`, which
-- counts every sample including the GPS-only ones that carry no vibration at
-- all. A ride with a few hundred GPS fixes and a handful of board readings had
-- its average dragged towards zero by samples that never measured anything.
ALTER TABLE "rides"
  ADD COLUMN "vibration_sample_count" INTEGER NOT NULL DEFAULT 0;

UPDATE "rides"
SET "vibration_sample_count" = COALESCE(measured."reading_count", 0),
    "avg_vibration" = measured."mean_vibration"
FROM (
  SELECT "ride_id",
         COUNT("vibration_magnitude") AS "reading_count",
         AVG("vibration_magnitude") AS "mean_vibration"
  FROM "samples"
  GROUP BY "ride_id"
) AS measured
WHERE "rides"."id" = measured."ride_id";
