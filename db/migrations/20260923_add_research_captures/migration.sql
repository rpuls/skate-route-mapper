CREATE TABLE "research_captures" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "capture_id" INTEGER NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL,
    "category" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "duration_seconds" INTEGER NOT NULL,
    "rate_hz" INTEGER NOT NULL,
    "sample_count" INTEGER NOT NULL,
    "metadata" JSONB NOT NULL,
    "recording" BYTEA NOT NULL,
    "photo" BYTEA,
    "photo_content_type" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "research_captures_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "research_captures_user_id_captured_at_idx"
ON "research_captures"("user_id", "captured_at" DESC);

CREATE INDEX "research_captures_capture_id_idx"
ON "research_captures"("capture_id");

ALTER TABLE "research_captures"
ADD CONSTRAINT "research_captures_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
