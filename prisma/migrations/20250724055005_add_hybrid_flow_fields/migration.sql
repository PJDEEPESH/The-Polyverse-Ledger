-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "description" TEXT DEFAULT '',
ADD COLUMN     "ethAmount" DOUBLE PRECISION,
ADD COLUMN     "ethPrice" DOUBLE PRECISION,
ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "paymentHash" TEXT,
ADD COLUMN     "weiAmount" TEXT;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "invoiceId" TEXT,
ALTER COLUMN "hash" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
