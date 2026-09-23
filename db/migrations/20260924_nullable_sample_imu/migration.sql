-- GPS-only rides carry no IMU data. The phone is a route tracker; vibration
-- comes from the external XIAO board, so a sample may legitimately have a
-- location fix and no acceleration or rotation reading.
ALTER TABLE "samples"
  ALTER COLUMN "ax" DROP NOT NULL,
  ALTER COLUMN "ay" DROP NOT NULL,
  ALTER COLUMN "az" DROP NOT NULL,
  ALTER COLUMN "gx" DROP NOT NULL,
  ALTER COLUMN "gy" DROP NOT NULL,
  ALTER COLUMN "gz" DROP NOT NULL,
  ALTER COLUMN "vibration_magnitude" DROP NOT NULL;
