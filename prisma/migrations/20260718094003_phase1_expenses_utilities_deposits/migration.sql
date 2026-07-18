-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "UtilityPayerType" AS ENUM ('TENANT', 'OWNER', 'SHARED', 'INCLUDED_IN_RENT');

-- CreateEnum
CREATE TYPE "UtilityBillingMethod" AS ENUM ('INDIVIDUAL_POSTPAID_METER', 'INDIVIDUAL_PREPAID_TOKEN', 'FIXED_MONTHLY', 'SHARED_METER', 'DIRECT_TENANT_PAYMENT', 'INCLUDED');

-- CreateEnum
CREATE TYPE "DepositTxnType" AS ENUM ('CHARGED', 'PAID', 'ADDITIONAL', 'DEDUCTION', 'REFUND', 'ADJUSTMENT');

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "property_id" TEXT,
    "category" TEXT NOT NULL,
    "vendor" TEXT,
    "expense_date" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'IDR',
    "description" TEXT,
    "status" "ExpenseStatus" NOT NULL DEFAULT 'DRAFT',
    "payment_method" TEXT,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "utility_billing_policies" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "utility_type" TEXT NOT NULL DEFAULT 'ELECTRICITY',
    "payer_type" "UtilityPayerType" NOT NULL DEFAULT 'TENANT',
    "billing_method" "UtilityBillingMethod" NOT NULL DEFAULT 'FIXED_MONTHLY',
    "rate_per_unit" DECIMAL(18,4),
    "fixed_monthly_fee" DECIMAL(18,2),
    "owner_unit_allowance" DECIMAL(18,4),
    "owner_amount_allowance" DECIMAL(18,2),
    "owner_percentage" DECIMAL(5,2),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "utility_billing_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deposit_accounts" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "lease_id" TEXT NOT NULL,
    "balance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'IDR',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deposit_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deposit_transactions" (
    "id" TEXT NOT NULL,
    "deposit_account_id" TEXT NOT NULL,
    "type" "DepositTxnType" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "balance_after" DECIMAL(18,2) NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deposit_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "expenses_workspace_id_status_idx" ON "expenses"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "expenses_property_id_expense_date_idx" ON "expenses"("property_id", "expense_date");

-- CreateIndex
CREATE INDEX "utility_billing_policies_workspace_id_property_id_idx" ON "utility_billing_policies"("workspace_id", "property_id");

-- CreateIndex
CREATE UNIQUE INDEX "deposit_accounts_lease_id_key" ON "deposit_accounts"("lease_id");

-- CreateIndex
CREATE INDEX "deposit_accounts_workspace_id_idx" ON "deposit_accounts"("workspace_id");

-- CreateIndex
CREATE INDEX "deposit_accounts_tenant_id_idx" ON "deposit_accounts"("tenant_id");

-- CreateIndex
CREATE INDEX "deposit_transactions_deposit_account_id_created_at_idx" ON "deposit_transactions"("deposit_account_id", "created_at");

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "utility_billing_policies" ADD CONSTRAINT "utility_billing_policies_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "utility_billing_policies" ADD CONSTRAINT "utility_billing_policies_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposit_accounts" ADD CONSTRAINT "deposit_accounts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposit_accounts" ADD CONSTRAINT "deposit_accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposit_accounts" ADD CONSTRAINT "deposit_accounts_lease_id_fkey" FOREIGN KEY ("lease_id") REFERENCES "leases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposit_transactions" ADD CONSTRAINT "deposit_transactions_deposit_account_id_fkey" FOREIGN KEY ("deposit_account_id") REFERENCES "deposit_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
