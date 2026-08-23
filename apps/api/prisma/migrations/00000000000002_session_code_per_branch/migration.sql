-- DropIndex
DROP INDEX "TableSession_code_key";

-- CreateIndex
CREATE UNIQUE INDEX "TableSession_branchId_code_key" ON "TableSession"("branchId", "code");

