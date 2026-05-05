-- Drop the dashboard role split. Admin users now have one permission level.
ALTER TABLE "admin_users" DROP COLUMN "role";

DROP TYPE "AdminRole";
