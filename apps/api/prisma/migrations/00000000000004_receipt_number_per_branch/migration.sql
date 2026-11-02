-- DropIndex
DROP INDEX IF EXISTS "Receipt_number_key";

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Receipt_branchId_number_key" ON "Receipt"("branchId", "number");

