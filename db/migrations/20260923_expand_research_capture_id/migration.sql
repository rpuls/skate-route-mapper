ALTER TABLE "research_captures"
ALTER COLUMN "capture_id" TYPE BIGINT
USING "capture_id"::BIGINT;
