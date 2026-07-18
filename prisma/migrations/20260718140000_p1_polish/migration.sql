-- P1 polish columns
ALTER TABLE "domain_outbox" ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "domain_outbox" ADD COLUMN IF NOT EXISTS "last_error" TEXT;
ALTER TABLE "domain_outbox" ADD COLUMN IF NOT EXISTS "failed_at" TIMESTAMP(3);

ALTER TABLE "maintenance_requests" ADD COLUMN IF NOT EXISTS "photo_urls" JSONB;
ALTER TABLE "maintenance_requests" ADD COLUMN IF NOT EXISTS "ai_json" JSONB;

ALTER TABLE "prospects" ADD COLUMN IF NOT EXISTS "lost_reason" TEXT;

ALTER TABLE "contract_documents" ADD COLUMN IF NOT EXISTS "owner_signed_at" TIMESTAMP(3);
ALTER TABLE "contract_documents" ADD COLUMN IF NOT EXISTS "owner_name" TEXT;
ALTER TABLE "contract_documents" ADD COLUMN IF NOT EXISTS "voided_at" TIMESTAMP(3);
ALTER TABLE "contract_documents" ADD COLUMN IF NOT EXISTS "void_reason" TEXT;

CREATE TABLE IF NOT EXISTS "push_subscriptions" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL,
  "p256dh" TEXT NOT NULL,
  "auth" TEXT NOT NULL,
  "user_agent" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "push_subscriptions_user_id_endpoint_key" ON "push_subscriptions"("user_id", "endpoint");
CREATE INDEX IF NOT EXISTS "push_subscriptions_user_id_idx" ON "push_subscriptions"("user_id");

DO $$ BEGIN
  ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;