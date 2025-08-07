import React, { useEffect, useState, useRef, useCallback } from "react";
import Layout from "../components/Layout";
import { FileText, Plus, Search, ChevronDown, Loader2, AlertCircle, CheckCircle, Wifi, WifiOff, DollarSign } from "lucide-react";
import { ethers } from "ethers";
import axios, { AxiosError } from "axios";
import { getInvoiceManagerContract } from "../utils/getInvoiceManagerContract";

// Safe environment variable access
const getEnvVar = (name: string, defaultValue: string) => {
  try {
    return (window as any)?.__ENV__?.[name] || 
           (typeof process !== 'undefined' ? process.env[name] : null) || 
           defaultValue;
  } catch {
    return defaultValue;
  }
};

const API_BASE = getEnvVar('REACT_APP_API_URL', 'http://localhost:3000');
const NODE_ENV = getEnvVar('NODE_ENV', 'development');

interface Invoice {
  id: string;
  amount: number; // USD amount
  ethAmount?: number; // ETH equivalent
  weiAmount?: string; // Wei amount
  ethPrice?: number; // Exchange rate
  date: Date;
  PAID: boolean;
  status: 'pending' | 'PAID' | 'overdue' | 'blockchain_pending';
  dueDate: string;
  createdAt: string;
  updatedAt: string;
  description?: string;
  blockchainHash?: string;
  conversion?: {
    usdAmount: number;
    ethAmount: number;
    weiAmount: string;
    ethPrice: number;
    displayText: string;
  };
  source?: string;
  userId?: string;
  crossChainIdentityId?: string;
  userWalletAddress?: string;
  walletAddress?: string;
}

interface NetworkInfo {
  chainId: string;
  name: string;
}

interface PriceConversion {
  ethPrice: number;
  ethAmount: number;
  displayText: string;
  loading: boolean;
  error: string | null;
}

interface BlockchainTransaction {
  hash: string | null;
  status: 'idle' | 'preparing' | 'waiting_signature' | 'pending' | 'confirmed' | 'failed';
  error: string | null;
}

const createDebounce = <T extends (...args: any[]) => any>(
  callback: T,
  delay: number
) => {
  let timeoutId: NodeJS.Timeout;
  
  const debouncedFunction = ((...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => callback(...args), delay);
  }) as T;

  const cancel = () => {
    clearTimeout(timeoutId);
  };

  return { debouncedFunction, cancel };
};

const InvoicesPage: React.FC = () => {
  // State management
  const [showModal, setShowModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [wallet, setWallet] = useState(""); // Recipient address
  const [amount, setAmount] = useState(""); // USD amount
  const [dueDate, setDueDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [success, setSuccess] = useState("");
  const [blockchainId, setBlockchainId] = useState("");
  const [userWalletAddress, setUserWalletAddress] = useState("");
  const [networkInfo, setNetworkInfo] = useState<NetworkInfo | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  // Price conversion state
  const [priceConversion, setPriceConversion] = useState<PriceConversion>({
    ethPrice: 0,
    ethAmount: 0,
    displayText: "",
    loading: false,
    error: null,
  });

  // Blockchain transaction state
  const [blockchainTx, setBlockchainTx] = useState<BlockchainTransaction>({
    hash: null,
    status: 'idle',
    error: null,
  });

  // Performance and caching
  const [lastFetchTime, setLastFetchTime] = useState<number>(0);
  const CACHE_DURATION = 2 * 60 * 1000;
  const isFetchingRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const retryCountRef = useRef(0);
  const MAX_RETRIES = 3;

  // Debounce refs
  const searchDebounceRef = useRef<{ debouncedFunction: any; cancel: () => void }>();
  const priceDebounceRef = useRef<{ debouncedFunction: any; cancel: () => void }>();

  // Helper functions
  const sanitizeInput = useCallback((input: string): string => {
    return input.trim().replace(/[<>]/g, '');
  }, []);

  const validateWalletAddress = useCallback((address: string): boolean => {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  }, []);

  const resetMessages = useCallback(() => {
    setError("");
    setFormError("");
    setSuccess("");
    setBlockchainTx({
      hash: null,
      status: 'idle',
      error: null,
    });
  }, []);

  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => setSuccess(""), 5000);
      return () => clearTimeout(timer);
    }
  }, [success]);

  // Safe MetaMask event handlers
  const handleAccountsChanged = useCallback((accounts: string[]) => {
    try {
      if (accounts.length === 0) {
        setIsConnected(false);
        setUserWalletAddress("");
        setInvoices([]);
        setError("Please connect your wallet");
      } else {
        setUserWalletAddress(accounts[0]);
        setIsConnected(true);
        resetMessages();
        setLastFetchTime(0);
        setTimeout(() => fetchInvoices(), 100);
      }
    } catch (err) {
      // Error handling
    }
  }, [resetMessages]);

  const handleChainChanged = useCallback((chainId: string) => {
    try {
      setLastFetchTime(0);
      setTimeout(async () => {
        try {
          const provider = new ethers.BrowserProvider(window.ethereum);
          const network = await provider.getNetwork();
          setNetworkInfo({
            chainId: network.chainId.toString(),
            name: network.name,
          });
          await fetchInvoices();
        } catch (err) {
          setError('Network change detected. Please refresh the page.');
        }
      }, 100);
    } catch (err) {
      // Error handling
    }
  }, []);

  // Safe event listener setup
  useEffect(() => {
    if (!window.ethereum) return;

    try {
      if (window.ethereum.removeListener) {
        window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
        window.ethereum.removeListener('chainChanged', handleChainChanged);
      }

      window.ethereum.on('accountsChanged', handleAccountsChanged);
      window.ethereum.on('chainChanged', handleChainChanged);
    } catch (err) {
      // Error handling
    }

    return () => {
      try {
        if (window.ethereum?.removeListener) {
          window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
          window.ethereum.removeListener('chainChanged', handleChainChanged);
        }
      } catch (err) {
        // Error handling
      }
    };
  }, [handleAccountsChanged, handleChainChanged]);

  // USD to ETH price conversion
  const fetchPriceConversion = useCallback(async (usdAmount: string) => {
    if (!usdAmount || isNaN(Number(usdAmount)) || Number(usdAmount) <= 0) {
      setPriceConversion({
        ethPrice: 0,
        ethAmount: 0,
        displayText: "",
        loading: false,
        error: null,
      });
      return;
    }

    setPriceConversion(prev => ({ ...prev, loading: true, error: null }));

    try {
      const response = await axios.get(
        'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd',
        { timeout: 5000 }
      );
      
      const ethPrice = response.data.ethereum?.usd || 3000;
      const ethAmount = Number(usdAmount) / ethPrice;
      
      setPriceConversion({
        ethPrice,
        ethAmount,
        displayText: `This will be ~${ethAmount.toFixed(6)} ETH`,
        loading: false,
        error: null,
      });

    } catch (err) {
      setPriceConversion(prev => ({
        ...prev,
        loading: false,
        error: "Unable to fetch current ETH price",
      }));
    }
  }, []);

  // Setup debounced price conversion
  useEffect(() => {
    if (priceDebounceRef.current) {
      priceDebounceRef.current.cancel();
    }
    priceDebounceRef.current = createDebounce(fetchPriceConversion, 800);

    return () => {
      if (priceDebounceRef.current) {
        priceDebounceRef.current.cancel();
      }
    };
  }, [fetchPriceConversion]);

  useEffect(() => {
    if (amount && priceDebounceRef.current) {
      priceDebounceRef.current.debouncedFunction(amount);
    } else {
      setPriceConversion({
        ethPrice: 0,
        ethAmount: 0,
        displayText: "",
        loading: false,
        error: null,
      });
    }
  }, [amount]);

  const validateForm = useCallback((): boolean => {
    resetMessages();
    
    if (!wallet?.trim() || !amount?.trim() || !dueDate?.trim()) {
      setFormError("Wallet address, amount, and due date are required.");
      return false;
    }

    const sanitizedWallet = sanitizeInput(wallet);
    if (!validateWalletAddress(sanitizedWallet)) {
      setFormError("Invalid wallet address format. Must be a valid Ethereum address (0x + 40 hex characters).");
      return false;
    }

    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0 || numAmount < 0.01) {
      setFormError("Amount must be at least $0.01 USD.");
      return false;
    }

    if (numAmount > 1000000) {
      setFormError("Amount exceeds maximum limit of $1,000,000 USD.");
      return false;
    }

    const selectedDate = new Date(`${dueDate}T00:00:00.000Z`);
    const now = new Date();
    const minDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const maxDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
    
    if (selectedDate < minDate) {
      setFormError("Due date must be at least 24 hours in the future.");
      return false;
    }

    if (selectedDate > maxDate) {
      setFormError("Due date cannot be more than 1 year from now.");
      return false;
    }

    return true;
  }, [wallet, amount, dueDate, sanitizeInput, validateWalletAddress, resetMessages]);

  const createBlockchainTransaction = useCallback(async (
    recipientAddress: string,
    ethAmount: number,
    dueDate: Date,
  ) => {
    try {
      setBlockchainTx({ hash: null, status: 'preparing', error: null });

      if (!window.ethereum) {
        throw new Error("MetaMask not found");
      }

      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const contract = getInvoiceManagerContract(signer);

      // Convert ETH to Wei
      let weiAmount: bigint;
      try {
        const limitedPrecisionEth = Math.floor(ethAmount * 100000000) / 100000000;
        const ethString = limitedPrecisionEth.toFixed(8);
        weiAmount = ethers.parseEther(ethString);
      } catch (conversionError: unknown) {
        const errorMessage = conversionError instanceof Error 
          ? conversionError.message 
          : 'Unknown conversion error';
        throw new Error(`Failed to convert ETH to Wei: ${errorMessage}`);
      }

      const dueDateTimestamp = Math.floor(dueDate.getTime() / 1000);

      setBlockchainTx({ hash: null, status: 'waiting_signature', error: null });

      // Call contract without description parameter
      const tx = await contract.createInvoice(
        recipientAddress,
        weiAmount,
        dueDateTimestamp
      );

      setBlockchainTx({ hash: tx.hash, status: 'pending', error: null });

      // Wait for confirmation
      const receipt = await tx.wait(1);
      
      if (receipt.status === 1) {
        setBlockchainTx({ hash: tx.hash, status: 'confirmed', error: null });
        
        // Try to extract invoice ID from events
        let blockchainInvoiceId = null;
        if (receipt.logs && receipt.logs.length > 0) {
          try {
            for (const log of receipt.logs) {
              try {
                const parsedLog = contract.interface.parseLog(log);
                
                if (parsedLog?.name === 'InvoiceCreated' || parsedLog?.name === 'InvoiceGenerated') {
                  blockchainInvoiceId = parsedLog.args?.invoiceId?.toString() || 
                                       parsedLog.args?.id?.toString();
                }
              } catch (parseError) {
                // Continue to next log
              }
            }
          } catch (eventError) {
            // Event parsing error, continue without blockchain ID
          }
        }
        
        return {
          txHash: tx.hash,
          status: 'confirmed',
          blockchainInvoiceId,
          explorerUrl: `https://etherscan.io/tx/${tx.hash}`
        };
        
      } else {
        throw new Error('Transaction failed on blockchain');
      }
      
    } catch (error: unknown) {
      let errorMessage = 'Unknown blockchain error';
      if (error instanceof Error && error.message) {
        errorMessage = error.message;
        
        if (error.message.includes('no matching fragment')) {
          errorMessage = 'Contract function signature mismatch. Please check your contract ABI and function parameters.';
        } else if (error.message.includes('insufficient funds')) {
          errorMessage = 'Insufficient ETH balance for gas fees';
        } else if (error.message.includes('user rejected')) {
          errorMessage = 'Transaction was rejected by user';
        } else if (error.message.includes('gas required exceeds allowance')) {
          errorMessage = 'Transaction requires more gas than allowed';
        } else if (error.message.includes('execution reverted')) {
          errorMessage = 'Smart contract execution failed - check contract requirements';
        }
      }
      
      setBlockchainTx({ hash: null, status: 'failed', error: errorMessage });
      throw new Error(errorMessage);
    }
  }, []);

  // Updated fetchInvoices with wallet filtering
  const fetchInvoices = useCallback(async () => {
    const now = Date.now();
    if (now - lastFetchTime < CACHE_DURATION && invoices.length > 0) {
      setLoading(false);
      setLastFetchTime(now);
      return;
    }

    if (isFetchingRef.current) {
      return;
    }

    isFetchingRef.current = true;
    
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    try {
      setLoading(true);
      resetMessages();

      if (!window.ethereum) {
        throw new Error("Please install MetaMask to use this application");
      }

      const accounts = await window.ethereum.request({ 
        method: 'eth_requestAccounts' 
      });
      
      if (accounts.length === 0) {
        throw new Error("Please connect your wallet");
      }

      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const userAddress = await signer.getAddress();
      const network = await provider.getNetwork();
      const chainId = network.chainId.toString();

      setUserWalletAddress(userAddress);
      setIsConnected(true);
      setNetworkInfo({
        chainId,
        name: network.name,
      });

      if (signal.aborted) return;

      try {
        let invoicesRes;
        
        // Try multiple approaches for fetching invoices
        if (NODE_ENV === 'development') {
          try {
            invoicesRes = await axios.get(
              `${API_BASE}/api/v1/invoices/wallet/${userAddress}/${chainId}`, 
              { 
                signal,
                timeout: 15000,
                headers: {
                  'Content-Type': 'application/json',
                  'X-Wallet-Address': userAddress,
                  'X-Blockchain-Id': chainId,
                  'Authorization': `Bearer dev-token-${userAddress}`
                }
              }
            );
          } catch (devError) {
            invoicesRes = await axios.get(
              `${API_BASE}/api/v1/invoices/wallet/${userAddress}/${chainId}`, 
              { 
                signal,
                timeout: 15000,
                headers: {
                  'Content-Type': 'application/json',
                  'X-Wallet-Address': userAddress,
                  'X-Blockchain-Id': chainId
                }
              }
            );
          }
        } else {
          invoicesRes = await axios.get(
            `${API_BASE}/api/v1/invoices/wallet/${userAddress}/${chainId}`, 
            { 
              signal,
              timeout: 15000,
              headers: {
                'Content-Type': 'application/json',
                'X-Wallet-Address': userAddress,
                'X-Blockchain-Id': chainId
              }
            }
          );
        }
        
        // Map and filter invoices for the connected wallet
        let fetchedInvoices = invoicesRes.data.data?.map((inv: any) => ({
          id: inv.id,
          amount: inv.amount,
          ethAmount: inv.ethAmount,
          weiAmount: inv.weiAmount,
          ethPrice: inv.ethPrice,
          date: new Date(inv.dueDate),
          dueDate: inv.dueDate,
          PAID: inv.status === "PAID",
          status: inv.status,
          description: inv.description || "",
          createdAt: inv.createdAt || new Date().toISOString(),
          updatedAt: inv.updatedAt || new Date().toISOString(),
          blockchainHash: inv.paymentHash || inv.blockchainHash,
          conversion: inv.conversion || null,
          source: inv.source || 'unknown',
          userId: inv.userId || null,
          crossChainIdentityId: inv.crossChainIdentityId || null,
          userWalletAddress: inv.userWalletAddress || null,
          walletAddress: inv.walletAddress || null,
        })) || [];

        // Client-side filtering to ensure only wallet-related invoices are shown
        fetchedInvoices = fetchedInvoices.filter((invoice: any) => {
          const isCreator = invoice.userWalletAddress && 
                           invoice.userWalletAddress.toLowerCase() === userAddress.toLowerCase();
          const isRecipient = invoice.walletAddress && 
                             invoice.walletAddress.toLowerCase() === userAddress.toLowerCase();
          
          return isCreator || isRecipient;
        });

        setInvoices(fetchedInvoices);
        setBlockchainId(chainId);
        setLastFetchTime(now);
        retryCountRef.current = 0;
        setError('');

      } catch (fetchError) {
        if (axios.isAxiosError(fetchError)) {
          const status = fetchError.response?.status;
          const errorData = fetchError.response?.data as any;
          
          if (status === 401 || status === 404) {
            try {
              // Try alternative endpoint with wallet filtering
              const altRes = await axios.get(
                `${API_BASE}/api/v1/invoices`, 
                { 
                  signal,
                  timeout: 10000,
                  params: {
                    walletAddress: userAddress,
                    blockchainId: chainId,
                    filterByWallet: true
                  },
                  headers: {
                    'Content-Type': 'application/json'
                  }
                }
              );
              
              if (altRes.data && altRes.data.data) {
                let fetchedInvoices = altRes.data.data?.map((inv: any) => ({
                  id: inv.id,
                  amount: inv.amount,
                  ethAmount: inv.ethAmount,
                  weiAmount: inv.weiAmount,
                  ethPrice: inv.ethPrice,
                  date: new Date(inv.dueDate),
                  dueDate: inv.dueDate,
                  PAID: inv.status === "PAID",
                  status: inv.status,
                  description: inv.description || "",
                  createdAt: inv.createdAt || new Date().toISOString(),
                  updatedAt: inv.updatedAt || new Date().toISOString(),
                  blockchainHash: inv.paymentHash || inv.blockchainHash,
                  conversion: inv.conversion || null,
                  source: inv.source || 'unknown',
                  userId: inv.userId || null,
                  crossChainIdentityId: inv.crossChainIdentityId || null,
                  userWalletAddress: inv.userWalletAddress || null,
                  walletAddress: inv.walletAddress || null,
                })) || [];

                // Apply client-side filtering
                fetchedInvoices = fetchedInvoices.filter((invoice: any) => {
                  const isCreator = invoice.userWalletAddress && 
                                   invoice.userWalletAddress.toLowerCase() === userAddress.toLowerCase();
                  const isRecipient = invoice.walletAddress && 
                                     invoice.walletAddress.toLowerCase() === userAddress.toLowerCase();
                  
                  return isCreator || isRecipient;
                });

                setInvoices(fetchedInvoices);
                setBlockchainId(chainId);
                setLastFetchTime(now);
                retryCountRef.current = 0;
                setError('');
                return;
              }
            } catch (altError) {
              // Alternative endpoint failed
            }
            
            // No invoices found for this wallet (normal for new wallets)
            setInvoices([]);
            setError('');
            
          } else if (status === 403) {
            setError("Access denied. Please check your wallet permissions.");
          } else if (status === 429) {
            setError("Too many requests. Please wait a moment and try again.");
          } else if (status && status >= 500) {
            setError("Server error. Please try again later.");
          } else {
            setInvoices([]);
            setError('');
          }
        }
        
        setBlockchainId(chainId);
        setLastFetchTime(now);
      }

    } catch (err: unknown) {
      if (axios.isCancel(err) || (err as Error).name === 'AbortError') {
        return;
      }

      // Only retry for genuine network errors
      if (retryCountRef.current < MAX_RETRIES && 
          (err instanceof Error && (
            err.message.includes('timeout') || 
            err.message.includes('network') ||
            err.message.includes('fetch')
          ))) {
        retryCountRef.current++;
        setTimeout(() => fetchInvoices(), Math.pow(2, retryCountRef.current) * 1000);
        return;
      }

      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to connect to the service.");
      }
    } finally {
      setLoading(false);
      isFetchingRef.current = false;
    }
  }, [lastFetchTime, invoices.length, resetMessages]);

  // Updated handleSubmit with better success messaging
  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    resetMessages();
    setCreating(true);

    if (!validateForm()) {
      setCreating(false);
      return;
    }

    try {
      if (!userWalletAddress || !isConnected) {
        throw new Error("Please connect your wallet first");
      }

      if (!priceConversion.ethAmount || !priceConversion.ethPrice) {
        throw new Error("Please wait for price conversion to complete");
      }

      const sanitizedWallet = sanitizeInput(wallet);
      
      // Create blockchain transaction first
      const blockchainResult = await createBlockchainTransaction(
        sanitizedWallet,
        Number(priceConversion.ethAmount),
        new Date(dueDate)
      );

      const invoiceData = {
        blockchainId: blockchainId || networkInfo?.chainId || 'ethereum',
        walletAddress: sanitizedWallet,
        amount: parseFloat(amount),
        dueDate,
        tokenized: false,
        tokenAddress: null,
        escrowAddress: null,
        subscriptionId: null,
        userWalletAddress,
        blockchainTxHash: blockchainResult.txHash,
        blockchainInvoiceId: blockchainResult.blockchainInvoiceId,
      };

      const response = await axios.post(`${API_BASE}/api/v1/invoices`, invoiceData, {
        timeout: 30000,
        headers: {
          'Content-Type': 'application/json',
          'X-Wallet-Address': userWalletAddress,
          'X-Blockchain-Id': networkInfo?.chainId || blockchainId
        }
      });

      // Success
      handleCloseModal();
      
      let successMessage = "✅ Invoice created successfully!";
      successMessage += `\n🔗 Blockchain: ${blockchainResult.status}`;
      successMessage += `\n📋 Tx: ${blockchainResult.txHash?.slice(0, 10)}...`;
      successMessage += `\n💱 ${priceConversion.displayText} at $${priceConversion.ethPrice.toFixed(2)}/ETH`;
      
      if (response.data.message) {
        const message = response.data.message.toLowerCase();
        if (message.includes('crosschain')) {
          successMessage += `\n👤 Used cross-chain wallet identity`;
        } else if (message.includes('primary')) {
          successMessage += `\n👤 Used primary wallet registration`;
        }
      }
      
      setSuccess(successMessage);
      
      setLastFetchTime(0);
      await fetchInvoices();
      
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        const axiosError = err as AxiosError;
        const errorData = axiosError.response?.data as any;
        const status = axiosError.response?.status;
        
        if (status === 400 && errorData?.code === 'WALLET_NOT_REGISTERED') {
          setFormError("System error: Auto-registration failed. Please try again.");
        } else if (status === 429) {
          setFormError("Monthly transaction limit exceeded. Please upgrade your plan.");
        } else if (status === 403 && errorData?.code === 'WALLET_LIMIT_EXCEEDED') {
          setFormError(`Wallet Limit Exceeded: ${errorData.error}. Please upgrade your plan to add more wallets.`);
        } else {
          setFormError(errorData?.error || "Failed to save invoice to database.");
        }
      } else if (err instanceof Error) {
        setFormError("Failed to create invoice: " + err.message);
      } else {
        setFormError("An unexpected error occurred. Please try again.");
      }
    } finally {
      setCreating(false);
    }
  }, [validateForm, isConnected, userWalletAddress, wallet, amount, dueDate, blockchainId, sanitizeInput, resetMessages, priceConversion, createBlockchainTransaction, networkInfo]);

  // Pay invoice handler
  const handlePayInvoice = useCallback(async (invoiceId: string) => {
    if (!userWalletAddress) {
      setError("Please connect your wallet first");
      return;
    }

    try {
      await axios.post(`${API_BASE}/api/v1/invoices/${invoiceId}/markPaid`, {
        userWalletAddress,
      });

      setSuccess("✅ Invoice marked as PAID successfully!");
      setLastFetchTime(0);
      await fetchInvoices();
      
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        const errorData = err.response?.data as any;
        setError(`❌ Failed to mark as PAID: ${errorData?.error || "Unknown error"}`);
      } else {
        setError("❌ Failed to mark invoice as PAID.");
      }
    }
  }, [userWalletAddress, fetchInvoices]);

  // Modal handlers
  const handleCloseModal = useCallback(() => {
    setShowModal(false);
    setWallet("");
    setAmount("");
    setDueDate("");
    setFormError("");
    setPriceConversion({
      ethPrice: 0,
      ethAmount: 0,
      displayText: "",
      loading: false,
      error: null,
    });
    setBlockchainTx({
      hash: null,
      status: 'idle',
      error: null,
    });
    
    if (priceDebounceRef.current) {
      priceDebounceRef.current.cancel();
    }
  }, []);

  // Search functionality
  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    
    if (searchDebounceRef.current) {
      searchDebounceRef.current.cancel();
    }
    
    searchDebounceRef.current = createDebounce((term: string) => {
      setSearchTerm(sanitizeInput(term));
    }, 300);
    
    searchDebounceRef.current.debouncedFunction(value);
  }, [sanitizeInput]);

  // Filtered invoices
  const filteredInvoices = React.useMemo(() => {
    if (!searchTerm.trim()) return invoices;
    
    const term = searchTerm.toLowerCase();
    return invoices.filter((inv: Invoice) => 
      inv.id.toLowerCase().includes(term) ||
      inv.amount.toString().toLowerCase().includes(term) ||
      inv.status.toLowerCase().includes(term) ||
      (inv.description && inv.description.toLowerCase().includes(term))
    );
  }, [invoices, searchTerm]);

  // Utility functions
  const formatDate = useCallback((date: Date | string) => {
    try {
      const dateObj = date instanceof Date ? date : new Date(date);
      if (isNaN(dateObj.getTime())) return 'Invalid Date';
      
      return dateObj.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch (error) {
      return 'Invalid Date';
    }
  }, []);

  const formatAmount = useCallback((invoice: Invoice) => {
    try {
      const usdAmount = typeof invoice.amount === 'string' ? parseFloat(invoice.amount) : invoice.amount;
      if (isNaN(usdAmount)) return invoice.amount.toString();
      
      let display = `${usdAmount.toFixed(2)} USD`;
      
      if (invoice.ethAmount) {
        display += ` (~${invoice.ethAmount.toFixed(6)} ETH)`;
      }
      
      if (invoice.blockchainHash) {
        display += `\n🔗 ${invoice.blockchainHash.slice(0, 10)}...`;
      }
      
      return display;
    } catch (error) {
      return invoice.amount.toString();
    }
  }, []);

  const getMinDate = useCallback(() => {
    const minDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
    return minDate.toISOString().split('T')[0];
  }, []);

  const getMaxDate = useCallback(() => {
    const maxDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    return maxDate.toISOString().split('T')[0];
  }, []);

  // Initial load
  useEffect(() => {
    fetchInvoices();
    
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (searchDebounceRef.current) {
        searchDebounceRef.current.cancel();
      }
      if (priceDebounceRef.current) {
        priceDebounceRef.current.cancel();
      }
      isFetchingRef.current = false;
    };
  }, []);

  return (
    <Layout>
      <div className="min-h-screen bg-gray-50">
        <div className="p-6 md:p-10">
          {/* Header */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
            <div className="flex-1">
              <h1 className="text-3xl font-bold text-gray-900">Invoices</h1>
              <p className="text-gray-500 mt-1">Manage your USD blockchain invoices</p>
              {userWalletAddress && (
                <div className="flex items-center mt-3 space-x-4 text-sm">
                  <div className="flex items-center">
                    {isConnected ? (
                      <Wifi className="w-4 h-4 text-green-500 mr-2" />
                    ) : (
                      <WifiOff className="w-4 h-4 text-red-500 mr-2" />
                    )}
                    <span className="text-gray-600">
                      {userWalletAddress.slice(0, 6)}...{userWalletAddress.slice(-4)}
                    </span>
                  </div>
                  {networkInfo && (
                    <div className="text-gray-400">
                      Network: {networkInfo.name}
                    </div>
                  )}
                </div>
              )}
            </div>
            <button
              onClick={() => setShowModal(true)}
              className="bg-indigo-600 text-white px-5 py-2.5 rounded-lg flex items-center shadow-md hover:bg-indigo-700 transition duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={loading || !isConnected}
              title={!isConnected ? "Please connect your wallet first" : "Create new invoice"}
            >
              <Plus className="w-5 h-5 mr-2" /> New Invoice
            </button>
          </div>

          {/* Success Message */}
          {success && (
            <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg flex items-start shadow-sm">
              <CheckCircle className="w-5 h-5 text-green-600 mr-3 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <pre className="text-green-800 text-sm font-medium whitespace-pre-wrap">{success}</pre>
              </div>
              <button
                onClick={() => setSuccess("")}
                className="ml-3 text-green-600 hover:text-green-800 text-lg font-bold"
              >
                ×
              </button>
            </div>
          )}

          {/* Error Display */}
          {error && error.trim() !== '' && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg shadow-sm">
              <div className="flex items-start">
                <AlertCircle className="w-5 h-5 text-red-600 mr-3 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-red-800 text-sm font-medium">{error}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button 
                      onClick={() => {
                        setError("");
                        retryCountRef.current = 0;
                        setLastFetchTime(0);
                        fetchInvoices();
                      }}
                      className="text-red-600 hover:text-red-800 text-sm underline"
                    >
                      Try Again
                    </button>
                    <button
                      onClick={() => setError("")}
                      className="text-red-600 hover:text-red-800 text-sm underline"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Connection Warning */}
          {!isConnected && !loading && (
            <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg flex items-center shadow-sm">
              <AlertCircle className="w-5 h-5 text-yellow-600 mr-3 flex-shrink-0" />
              <p className="text-yellow-800 text-sm font-medium">
                Please connect your MetaMask wallet to view and create invoices.
              </p>
            </div>
          )}

          {/* Invoices Table */}
          <div className="bg-white rounded-xl shadow-md border overflow-hidden">
            <div className="p-6 border-b border-gray-200">
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <input
                    type="text"
                    placeholder="Search invoices..."
                    onChange={handleSearchChange}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div className="flex gap-2">
                  <button className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center transition">
                    Filter
                    <ChevronDown className="w-4 h-4 ml-2" />
                  </button>
                  <button
                    onClick={() => {
                      setLastFetchTime(0);
                      fetchInvoices();
                    }}
                    disabled={loading}
                    className="px-4 py-2 text-indigo-600 border border-indigo-300 rounded-lg hover:bg-indigo-50 transition disabled:opacity-50 flex items-center"
                  >
                    {loading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      'Refresh'
                    )}
                  </button>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              {loading ? (
                <div className="p-12 text-center">
                  <Loader2 className="w-8 h-8 text-gray-400 animate-spin mx-auto mb-4" />
                  <p className="text-gray-600">Loading invoices...</p>
                  {retryCountRef.current > 0 && (
                    <p className="text-sm text-gray-500 mt-2">
                      Retry attempt {retryCountRef.current}/{MAX_RETRIES}
                    </p>
                  )}
                </div>
              ) : filteredInvoices.length === 0 ? (
                <div className="p-12 text-center">
                  <FileText className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-500 text-lg font-medium mb-2">
                    {searchTerm ? "No invoices match your search" : 
                     !isConnected ? "Connect your wallet to view invoices" :
                     "No invoices found"}
                  </p>
                  <p className="text-gray-400 text-sm">
                    {searchTerm ? "Try a different search term" : 
                     !isConnected ? "Please connect your MetaMask wallet" :
                     "Create your first invoice to get started"}
                  </p>
                </div>
              ) : (
                <table className="min-w-full text-sm text-left">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-4 font-medium text-gray-700">Invoice</th>
                      <th className="px-6 py-4 font-medium text-gray-700">Amount</th>
                      <th className="px-6 py-4 font-medium text-gray-700">Due Date</th>
                      <th className="px-6 py-4 font-medium text-gray-700">Status</th>
                      <th className="px-6 py-4 font-medium text-gray-700">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {filteredInvoices.map((invoice) => (
                      <tr key={invoice.id} className="hover:bg-gray-50 transition">
                        <td className="px-6 py-4">
                          <div className="flex items-center">
                            <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                              <FileText className="w-5 h-5 text-blue-600" />
                            </div>
                            <div className="ml-4">
                              <span className="text-sm font-medium text-gray-900">
                                {invoice.id.slice(0, 8)}...{invoice.id.slice(-4)}
                              </span>
                              {invoice.description && (
                                <p className="text-xs text-gray-500 mt-1">
                                  {invoice.description}
                                </p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-sm font-medium text-gray-900">
                            ${invoice.amount.toFixed(2)} USD
                          </div>
                          {invoice.ethAmount && (
                            <div className="text-xs text-gray-500">
                              ~{invoice.ethAmount.toFixed(6)} ETH
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-700">
                          {formatDate(invoice.date)}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`px-3 py-1 text-xs font-medium rounded-full ${
                            invoice.status === 'PAID' 
                              ? 'bg-green-100 text-green-800'
                              : invoice.status === 'overdue'
                              ? 'bg-red-100 text-red-800'
                              : invoice.status === 'blockchain_pending'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-yellow-100 text-yellow-800'
                          }`}>
                            {invoice.status === 'blockchain_pending' ? 'Blockchain Pending' :
                             invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1)}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          {!invoice.PAID && (
                            <button
                              onClick={() => handlePayInvoice(invoice.id)}
                              disabled={loading}
                              className="px-3 py-1 text-xs font-medium bg-indigo-100 text-indigo-800 rounded-full hover:bg-indigo-200 transition disabled:opacity-50"
                            >
                              Mark as Paid
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {filteredInvoices.length > 0 && (
              <div className="px-6 py-3 bg-gray-50 border-t border-gray-200 text-sm text-gray-600">
                Showing {filteredInvoices.length} of {invoices.length} invoices
              </div>
            )}
          </div>

          {/* Create Invoice Modal */}
          {showModal && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl max-h-[90vh] overflow-y-auto">
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-xl font-bold text-gray-900">Create New Invoice</h2>
                  <button
                    onClick={handleCloseModal}
                    className="text-gray-400 hover:text-gray-600 text-2xl font-bold"
                    disabled={creating}
                  >
                    ×
                  </button>
                </div>
                
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Recipient Wallet Address <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={wallet}
                      onChange={(e) => setWallet(sanitizeInput(e.target.value))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-100"
                      placeholder="0x..."
                      required
                      disabled={creating}
                      maxLength={42}
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Enter the wallet address of who should receive this invoice
                    </p>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Amount (USD) <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                      <input
                        type="number"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-100"
                        placeholder="2500.00"
                        required
                        min="0.01"
                        max="1000000"
                        step="0.01"
                        disabled={creating}
                      />
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      Enter amount in US Dollars
                    </p>
                  </div>

                  {/* ETH Conversion Display */}
                  {(amount && Number(amount) > 0) && (
                    <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                      {priceConversion.loading ? (
                        <div className="flex items-center text-blue-800">
                          <Loader2 className="w-4 h-4 animate-spin mr-2" />
                          <span className="text-sm">Calculating ETH equivalent...</span>
                        </div>
                      ) : priceConversion.error ? (
                        <p className="text-red-600 text-sm">{priceConversion.error}</p>
                      ) : priceConversion.displayText ? (
                        <div className="text-blue-800 text-sm">
                          <p className="font-medium">{priceConversion.displayText}</p>
                          <p className="text-xs opacity-75 mt-1">
                            Current rate: ${priceConversion.ethPrice.toFixed(2)} USD/ETH
                          </p>
                        </div>
                      ) : null}
                    </div>
                  )}
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Due Date <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-100"
                      required
                      min={getMinDate()}
                      max={getMaxDate()}
                      disabled={creating}
                    />
                  </div>
                  
                  {formError && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                      <div className="flex items-start">
                        <AlertCircle className="w-4 h-4 text-red-600 mr-2 mt-0.5 flex-shrink-0" />
                        <p className="text-red-800 text-sm">{formError}</p>
                      </div>
                    </div>
                  )}

                  {/* Blockchain Transaction Status */}
                  {blockchainTx.status !== 'idle' && (
                    <div className={`p-3 border rounded-lg ${
                      blockchainTx.status === 'failed' ? 'bg-red-50 border-red-200' :
                      blockchainTx.status === 'confirmed' ? 'bg-green-50 border-green-200' :
                      'bg-blue-50 border-blue-200'
                    }`}>
                      <div className="flex items-center">
                        {blockchainTx.status === 'preparing' && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                        {blockchainTx.status === 'waiting_signature' && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                        {blockchainTx.status === 'pending' && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                        {blockchainTx.status === 'confirmed' && <CheckCircle className="w-4 h-4 text-green-600 mr-2" />}
                        {blockchainTx.status === 'failed' && <AlertCircle className="w-4 h-4 text-red-600 mr-2" />}
                        
                        <div className="text-sm">
                          <p className={`font-medium ${
                            blockchainTx.status === 'failed' ? 'text-red-800' :
                            blockchainTx.status === 'confirmed' ? 'text-green-800' :
                            'text-blue-800'
                          }`}>
                            {blockchainTx.status === 'preparing' && 'Preparing blockchain transaction...'}
                            {blockchainTx.status === 'waiting_signature' && 'Please sign the transaction in MetaMask'}
                            {blockchainTx.status === 'pending' && 'Transaction submitted, waiting for confirmation...'}
                            {blockchainTx.status === 'confirmed' && 'Blockchain transaction confirmed!'}
                            {blockchainTx.status === 'failed' && 'Blockchain transaction failed'}
                          </p>
                          
                          {blockchainTx.hash && (
                            <p className="text-xs mt-1 opacity-75">
                              Hash: {blockchainTx.hash.slice(0, 10)}...{blockchainTx.hash.slice(-6)}
                            </p>
                          )}
                          
                          {blockchainTx.error && (
                            <p className="text-xs text-red-600 mt-1">
                              Error: {blockchainTx.error}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {creating && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                      <div className="flex items-center">
                        <Loader2 className="w-5 h-5 text-blue-600 animate-spin mr-3" />
                        <div>
                          <p className="text-blue-800 text-sm font-medium">
                            Creating invoice...
                          </p>
                          <p className="text-blue-600 text-xs mt-1">
                            {blockchainTx.status === 'confirmed' ? 
                              'Saving to database...' : 
                              'Processing blockchain transaction...'}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                  
                  <div className="flex gap-3 mt-6">
                    <button
                      type="button"
                      onClick={handleCloseModal}
                      className="flex-1 px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition disabled:opacity-50"
                      disabled={creating}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center transition"
                      disabled={
                        creating ||
                        priceConversion.loading ||
                        !!priceConversion.error ||
                        !isConnected || 
                        !priceConversion.ethAmount
                      }
                    >
                      {creating ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Creating...
                        </>
                      ) : (
                        "Create Invoice"
                      )}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
};

export default InvoicesPage;