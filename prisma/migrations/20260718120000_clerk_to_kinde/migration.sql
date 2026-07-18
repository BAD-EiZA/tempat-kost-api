-- Rename users.clerk_user_id -> external_user_id (Kinde sub)
ALTER TABLE "users" RENAME COLUMN "clerk_user_id" TO "external_user_id";
