import { ethers } from 'ethers';
import CreditScore from '../abi/CreditScore.json';


const CONTRACT_ADDRESS = "0xE8F1A557cf003aB9b70d79Ac5d5AedBfBA087F60";

export function getCreditScoreContract(signerOrProvider) {
  return new ethers.Contract(CONTRACT_ADDRESS, CreditScore.abi, signerOrProvider);
}
