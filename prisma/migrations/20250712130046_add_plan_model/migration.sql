/*
  Warnings:

  - You are about to alter the column `price` on the `Plan` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Integer`.
  - You are about to alter the column `txnLimit` on the `Plan` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Integer`.
  - The `features` column on the `Plan` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "Plan" ALTER COLUMN "price" SET DATA TYPE INTEGER,
ALTER COLUMN "txnLimit" SET DATA TYPE INTEGER,
DROP COLUMN "features",
ADD COLUMN     "features" TEXT[];
