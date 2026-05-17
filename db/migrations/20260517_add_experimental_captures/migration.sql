-- CreateTable
CREATE TABLE "experimental_captures" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "experimental_captures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "experimental_captures_user_id_idx" ON "experimental_captures"("user_id");

-- CreateIndex
CREATE INDEX "experimental_captures_created_at_idx" ON "experimental_captures"("created_at");

-- AddForeignKey
ALTER TABLE "experimental_captures" ADD CONSTRAINT "experimental_captures_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
