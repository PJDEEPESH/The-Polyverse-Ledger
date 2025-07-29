/*
  Warnings:

  - You are about to drop the column `destinationAddress` on the `CrossChainTransaction` table. All the data in the column will be lost.
  - Added the required column `fromAddress` to the `CrossChainTransaction` table without a default value. This is not possible if the table is not empty.
  - Added the required column `networkId` to the `CrossChainTransaction` table without a default value. This is not possible if the table is not empty.
  - Added the required column `toAddress` to the `CrossChainTransaction` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "CrossChainTransaction" DROP COLUMN "destinationAddress",
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'ETH',
ADD COLUMN     "destinationBlockchainId" TEXT,
ADD COLUMN     "fromAddress" TEXT NOT NULL,
ADD COLUMN     "invoiceId" TEXT,
ADD COLUMN     "networkId" TEXT NOT NULL,
ADD COLUMN     "toAddress" TEXT NOT NULL,
ADD COLUMN     "transactionHash" TEXT,
ALTER COLUMN "amount" SET DATA TYPE TEXT,
ALTER COLUMN "assetType" DROP NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'pending',
ALTER COLUMN "proofHash" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "CrossChainTransaction_userId_idx" ON "CrossChainTransaction"("userId");

-- CreateIndex
CREATE INDEX "CrossChainTransaction_invoiceId_idx" ON "CrossChainTransaction"("invoiceId");

-- CreateIndex
CREATE INDEX "CrossChainTransaction_transactionHash_idx" ON "CrossChainTransaction"("transactionHash");

-- AddForeignKey
ALTER TABLE "CrossChainTransaction" ADD CONSTRAINT "CrossChainTransaction_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrossChainTransaction" ADD CONSTRAINT "CrossChainTransaction_destinationBlockchainId_fkey" FOREIGN KEY ("destinationBlockchainId") REFERENCES "Blockchain"("id") ON DELETE SET NULL ON UPDATE CASCADE;
