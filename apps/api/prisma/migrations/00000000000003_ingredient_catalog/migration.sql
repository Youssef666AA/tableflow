-- Recipes are restaurant-wide, so a recipe line must reference an ingredient
-- concept rather than one branch's stock row. This introduces the catalogue and
-- backfills existing inventory and recipes onto it without losing data.

-- CreateTable
CREATE TABLE "Ingredient" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" "Unit" NOT NULL,
    "category" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ingredient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Ingredient_restaurantId_idx" ON "Ingredient"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "Ingredient_restaurantId_name_key" ON "Ingredient"("restaurantId", "name");

-- AddForeignKey
ALTER TABLE "Ingredient" ADD CONSTRAINT "Ingredient_restaurantId_fkey"
    FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: one catalogue entry per distinct ingredient name within a restaurant.
INSERT INTO "Ingredient" ("id", "restaurantId", "name", "unit", "category", "createdAt", "updatedAt")
SELECT
    gen_random_uuid(),
    source."restaurantId",
    source."name",
    source."unit",
    source."category",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM (
    SELECT DISTINCT ON (b."restaurantId", ii."name")
        b."restaurantId" AS "restaurantId",
        ii."name"        AS "name",
        ii."unit"        AS "unit",
        ii."category"    AS "category"
    FROM "InventoryItem" ii
    JOIN "Branch" b ON b."id" = ii."branchId"
    ORDER BY b."restaurantId", ii."name", ii."createdAt"
) AS source;

-- InventoryItem now points at the catalogue.
ALTER TABLE "InventoryItem" ADD COLUMN "ingredientId" TEXT;

UPDATE "InventoryItem" ii
SET "ingredientId" = i."id"
FROM "Branch" b, "Ingredient" i
WHERE b."id" = ii."branchId"
  AND i."restaurantId" = b."restaurantId"
  AND i."name" = ii."name";

-- Any stock row we could not match has no catalogue entry to belong to.
DELETE FROM "InventoryItem" WHERE "ingredientId" IS NULL;

ALTER TABLE "InventoryItem" ALTER COLUMN "ingredientId" SET NOT NULL;

CREATE UNIQUE INDEX "InventoryItem_branchId_ingredientId_key"
    ON "InventoryItem"("branchId", "ingredientId");

ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_ingredientId_fkey"
    FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RecipeIngredient moves from a branch stock row to the catalogue entry.
ALTER TABLE "RecipeIngredient" ADD COLUMN "ingredientId" TEXT;

UPDATE "RecipeIngredient" ri
SET "ingredientId" = ii."ingredientId"
FROM "InventoryItem" ii
WHERE ii."id" = ri."inventoryItemId";

DELETE FROM "RecipeIngredient" WHERE "ingredientId" IS NULL;

ALTER TABLE "RecipeIngredient" ALTER COLUMN "ingredientId" SET NOT NULL;

ALTER TABLE "RecipeIngredient" DROP CONSTRAINT IF EXISTS "RecipeIngredient_inventoryItemId_fkey";
DROP INDEX IF EXISTS "RecipeIngredient_inventoryItemId_idx";
DROP INDEX IF EXISTS "RecipeIngredient_recipeId_inventoryItemId_key";
ALTER TABLE "RecipeIngredient" DROP COLUMN "inventoryItemId";

CREATE INDEX "RecipeIngredient_ingredientId_idx" ON "RecipeIngredient"("ingredientId");
CREATE UNIQUE INDEX "RecipeIngredient_recipeId_ingredientId_key"
    ON "RecipeIngredient"("recipeId", "ingredientId");

ALTER TABLE "RecipeIngredient" ADD CONSTRAINT "RecipeIngredient_ingredientId_fkey"
    FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
