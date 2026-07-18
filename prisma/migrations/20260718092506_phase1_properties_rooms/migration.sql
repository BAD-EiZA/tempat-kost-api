-- CreateEnum
CREATE TYPE "PropertyStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RoomStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'OCCUPIED', 'NOTICE_TO_VACATE', 'CLEANING', 'MAINTENANCE', 'INACTIVE');

-- CreateTable
CREATE TABLE "properties" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "PropertyStatus" NOT NULL DEFAULT 'DRAFT',
    "address_line" TEXT,
    "city" TEXT,
    "province" TEXT,
    "postal_code" TEXT,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "contact_phone" TEXT,
    "description" TEXT,
    "timezone" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_types" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "property_id" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "base_rent" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "default_deposit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "room_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rooms" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "room_type_id" TEXT,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "floor_label" TEXT,
    "status" "RoomStatus" NOT NULL DEFAULT 'AVAILABLE',
    "rent_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "deposit_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,
    "available_from" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "properties_workspace_id_status_idx" ON "properties"("workspace_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "properties_workspace_id_code_key" ON "properties"("workspace_id", "code");

-- CreateIndex
CREATE INDEX "room_types_workspace_id_idx" ON "room_types"("workspace_id");

-- CreateIndex
CREATE INDEX "rooms_workspace_id_status_idx" ON "rooms"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "rooms_property_id_status_idx" ON "rooms"("property_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_property_id_code_key" ON "rooms"("property_id", "code");

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_types" ADD CONSTRAINT "room_types_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_types" ADD CONSTRAINT "room_types_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_room_type_id_fkey" FOREIGN KEY ("room_type_id") REFERENCES "room_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;
