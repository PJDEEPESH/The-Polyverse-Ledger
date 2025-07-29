/*
  Warnings:

  - You are about to drop the column `currency` on the `CrossChainTransaction` table. All the data in the column will be lost.
  - You are about to drop the column `destinationBlockchainId` on the `CrossChainTransaction` table. All the data in the column will be lost.
  - You are about to drop the column `fromAddress` on the `CrossChainTransaction` table. All the data in the column will be lost.
  - You are about to drop the column `invoiceId` on the `CrossChainTransaction` table. All the data in the column will be lost.
  - You are about to drop the column `networkId` on the `CrossChainTransaction` table. All the data in the column will be lost.
  - You are about to drop the column `toAddress` on the `CrossChainTransaction` table. All the data in the column will be lost.
  - You are about to drop the column `transactionHash` on the `CrossChainTransaction` table. All the data in the column will be lost.
  - Added the required column `destinationAddress` to the `CrossChainTransaction` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `amount` on the `CrossChainTransaction` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Made the column `assetType` on table `CrossChainTransaction` required. This step will fail if there are existing NULL values in that column.
  - Made the column `proofHash` on table `CrossChainTransaction` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "CrossChainTransaction" DROP CONSTRAINT "CrossChainTransaction_destinationBlockchainId_fkey";

-- DropForeignKey
ALTER TABLE "CrossChainTransaction" DROP CONSTRAINT "CrossChainTransaction_invoiceId_fkey";

-- DropIndex
DROP INDEX "CrossChainTransaction_invoiceId_idx";

-- DropIndex
DROP INDEX "CrossChainTransaction_transactionHash_idx";

-- DropIndex
DROP INDEX "CrossChainTransaction_userId_idx";

-- AlterTable
ALTER TABLE "CrossChainTransaction" DROP COLUMN "currency",
DROP COLUMN "destinationBlockchainId",
DROP COLUMN "fromAddress",
DROP COLUMN "invoiceId",
DROP COLUMN "networkId",
DROP COLUMN "toAddress",
DROP COLUMN "transactionHash",
ADD COLUMN     "destinationAddress" TEXT NOT NULL,
DROP COLUMN "amount",
ADD COLUMN     "amount" DOUBLE PRECISION NOT NULL,
ALTER COLUMN "assetType" SET NOT NULL,
ALTER COLUMN "status" DROP DEFAULT,
ALTER COLUMN "proofHash" SET NOT NULL;
