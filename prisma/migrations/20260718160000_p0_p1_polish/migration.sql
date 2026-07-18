-- Tenant identity fields from KTP OCR
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "nik" TEXT;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "gender" TEXT;

-- OCR consent + applied fields audit
ALTER TABLE "tenant_documents" ADD COLUMN IF NOT EXISTS "consent_at" TIMESTAMP(3);
ALTER TABLE "tenant_documents" ADD COLUMN IF NOT EXISTS "consent_by_id" TEXT;
ALTER TABLE "tenant_documents" ADD COLUMN IF NOT EXISTS "applied_fields" JSONB;

-- Maintenance repair estimates
ALTER TABLE "maintenance_requests" ADD COLUMN IF NOT EXISTS "estimated_cost" DECIMAL(18,6);
ALTER TABLE "maintenance_requests" ADD COLUMN IF NOT EXISTS "estimate_low" DECIMAL(18,6);
ALTER TABLE "maintenance_requests" ADD COLUMN IF NOT EXISTS "estimate_high" DECIMAL(18,6);
