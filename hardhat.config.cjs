require("dotenv").config();
require("@nomicfoundation/hardhat-toolbox");

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const INFURA_PROJECT_ID = process.env.INFURA_PROJECT_ID;

if (!PRIVATE_KEY) {
  throw new Error("❌ Missing PRIVATE_KEY in .env");
}

module.exports = {
  solidity: "0.8.19",
  paths: {
    sources: "./blockchain/contracts",
    artifacts: "./artifacts",
    cache: "./cache",
    tests: "./test",
  },
  networks: {
    mainnet: {
      url: `https://mainnet.infura.io/v3/${INFURA_PROJECT_ID}`,
      accounts: [PRIVATE_KEY],
    },
    holesky: {
      url: "https://holesky.drpc.org",
      accounts: [PRIVATE_KEY],
      chainId: 17000,
    },
  },
};
