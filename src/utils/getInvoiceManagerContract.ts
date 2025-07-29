// src/utils/getInvoiceManagerContract.ts
import { ethers } from "ethers";
// ✅ Add the required import attribute
import InvoiceManagerABI from "../abi/InvoiceManager.json" with { type: "json" };

const CONTRACT_ADDRESS = "0x6558Fa904722B144DE4CEA8241f120BcBA187eb6"; 

export const getInvoiceManagerContract = (
  signerOrProvider: ethers.Provider | ethers.Signer
) => {
  return new ethers.Contract(CONTRACT_ADDRESS, InvoiceManagerABI.abi, signerOrProvider);
};
