CREATE TABLE "sync_operations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "operation_type" TEXT NOT NULL,
    "created_at_ms" BIGINT NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB NOT NULL,

    CONSTRAINT "sync_operations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sync_operations_user_id_idx" ON "sync_operations"("user_id");
CREATE INDEX "sync_operations_processed_at_idx" ON "sync_operations"("processed_at");

ALTER TABLE "sync_operations"
ADD CONSTRAINT "sync_operations_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
