-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('PROSPECT', 'ACTIVE', 'FORMER', 'BLACKLISTED');

-- CreateEnum
CREATE TYPE "LeaseStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'PENDING_SIGNATURE', 'UPCOMING', 'ACTIVE', 'ENDING_SOON', 'ENDED', 'TERMINATED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'WEEKLY', 'YEARLY');

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "preferred_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "date_of_birth" DATE,
    "occupation" TEXT,
    "hometown_address" TEXT,
    "emergency_name" TEXT,
    "emergency_phone" TEXT,
    "notes" TEXT,
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leases" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "lease_number" TEXT NOT NULL,
    "status" "LeaseStatus" NOT NULL DEFAULT 'DRAFT',
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "billing_cycle" "BillingCycle" NOT NULL DEFAULT 'MONTHLY',
    "rent_amount" DECIMAL(18,2) NOT NULL,
    "deposit_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "due_day" INTEGER NOT NULL DEFAULT 1,
    "grace_period_days" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "activated_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tenants_workspace_id_status_idx" ON "tenants"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "tenants_workspace_id_phone_idx" ON "tenants"("workspace_id", "phone");

-- CreateIndex
CREATE INDEX "leases_workspace_id_status_idx" ON "leases"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "leases_property_id_status_idx" ON "leases"("property_id", "status");

-- CreateIndex
CREATE INDEX "leases_room_id_status_idx" ON "leases"("room_id", "status");

-- CreateIndex
CREATE INDEX "leases_tenant_id_idx" ON "leases"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "leases_workspace_id_lease_number_key" ON "leases"("workspace_id", "lease_number");

-- AddForeignKey
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leases" ADD CONSTRAINT "leases_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leases" ADD CONSTRAINT "leases_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leases" ADD CONSTRAINT "leases_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leases" ADD CONSTRAINT "leases_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
