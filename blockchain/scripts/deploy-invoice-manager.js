const hre = require("hardhat");

async function main() {
  const creditScoringAddress = "0xE8F1A557cf003aB9b70d79Ac5d5AedBfBA087F60"; // Replace with real address

  const InvoiceManager = await hre.ethers.getContractFactory("InvoiceManager");
  const contract = await InvoiceManager.deploy(creditScoringAddress);
  await contract.waitForDeployment();

  console.log("✅ Deployed InvoiceManager at:", contract.target);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
