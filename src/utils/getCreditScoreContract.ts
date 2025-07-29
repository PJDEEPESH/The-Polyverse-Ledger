//src/utils/getCreditScoreContract.ts
import { ethers } from "ethers";
import CreditScoreABI from "../abi/CreditScore.json";


const contractAddress = "0x6cDFd1734cE9Fd0FB85c9Ac732EEA8C96d8C21c4";

export const getCreditScoreContract = (signerOrProvider: any) => {
  const abi = CreditScoreABI.abi || CreditScoreABI;
  return new ethers.Contract(contractAddress, abi, signerOrProvider);
};
