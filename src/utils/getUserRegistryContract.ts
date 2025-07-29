//src/utils/getUserRegistryContract.ts
import { ethers } from "ethers";
import contractJson from "../abi/UserRegistry.json";

const CONTRACT_ADDRESS = "0xFE1DDeE0338F77a2410CC56A30A0Be62D0843Dbe";

export const getUserRegistryContract = (signerOrProvider: ethers.Signer | ethers.Provider) => {
  return new ethers.Contract(CONTRACT_ADDRESS, contractJson.abi, signerOrProvider);
};
