import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.plan.deleteMany();

  await prisma.plan.createMany({
    data: [
      {
        name: "Free",
        price: 0,
        queryLimit: 100,
        txnLimit: null,
        userLimit: 1,
        features: ["Trial access to everything"],
      },
      {
        name: "Basic",
        price: 149,
        queryLimit: 1000,
        txnLimit: 10000,
        userLimit: 1,
        features: ["Credit scoring limited", "Invoices limited"],
      },
      {
        name: "Pro",
        price: 699,
        queryLimit: 15000,
        txnLimit: 20000,
        userLimit: 3,
        features: ["UBID", "Credit scoring", "Invoices"],
      },
      {
        name: "Premium",
        price: 3699,
        queryLimit: 1000000,
        txnLimit: null,
        userLimit: 5,
        features: ["All features unlocked"],
      },
    ],
  });

  console.log('✅ Plans seeded successfully');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
