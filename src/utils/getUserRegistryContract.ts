import { ethers } from "ethers";
import abi from "../abi/UserRegistry.json";

const CONTRACT_ADDRESS = "0x167d2B79dde22bC30f53D36D2a06403848A445Ce";

export const getUserRegistryContract = (signerOrProvider: ethers.Signer | ethers.Provider) => {
 return new ethers.Contract(CONTRACT_ADDRESS, abi as any, signerOrProvider);
};
