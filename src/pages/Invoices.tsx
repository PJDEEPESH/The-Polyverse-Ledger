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

  // Auto-clear messages
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(""), 5000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => setSuccess(""), 5000);
      return () => clearTimeout(timer);
    }
  }, [success]);

  // Safe MetaMask event handlers
  const handleAccountsChanged = useCallback((accounts: string[]) => {
    console.log('Accounts changed:', accounts);
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
      console.error('Error handling account change:', err);
    }
  }, [resetMessages]);

  const handleChainChanged = useCallback((chainId: string) => {
    console.log('Network changed to:', chainId);
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
          console.error('Error handling chain change:', err);
          setError('Network change detected. Please refresh the page.');
        }
      }, 100);
    } catch (err) {
      console.error('Error in chain change handler:', err);
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
      console.error('Error setting up MetaMask listeners:', err);
    }

    return () => {
      try {
        if (window.ethereum?.removeListener) {
          window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
          window.ethereum.removeListener('chainChanged', handleChainChanged);
        }
      } catch (err) {
        console.error('Error removing MetaMask listeners:', err);
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
      console.error('Price conversion error:', err);
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

  // ✅ CORRECTED: fetchInvoices - Remove pre-validation, allow auto-registration
  const fetchInvoices = useCallback(async () => {
    const now = Date.now();
    if (now - lastFetchTime < CACHE_DURATION && invoices.length > 0) {
      console.log('Using cached invoice data');
      setLoading(false);
      setLastFetchTime(now);
      return;
    }

    if (isFetchingRef.current) {
      console.log('Fetch already in progress');
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

      // ✅ CORRECTED: Try to get user data, but don't fail if not found
      let userData = null;
      try {
        const userRes = await axios.get(`${API_BASE}/api/v1/user/wallet/${userAddress}/${chainId}`, { 
          signal,
          timeout: 10000,
        });
        userData = userRes.data?.data;
      } catch (userError) {
        console.log('User not found in primary table, will check CrossChainIdentity during invoice creation');
        // Don't throw error here - let invoice creation handle it
      }

      // ✅ Set blockchainId if available, otherwise use chainId
      setBlockchainId(userData?.blockchainId || chainId);

      if (signal.aborted) return;

      // ✅ CORRECTED: Try to fetch invoices, but handle case where user doesn't exist yet
      let fetchedInvoices = [];
      try {
        const invoicesRes = await axios.get(`${API_BASE}/api/v1/invoices/wallet/${userAddress}/${userData?.blockchainId || chainId}`, { 
          signal,
          timeout: 15000,
        });
        
        fetchedInvoices = invoicesRes.data.data?.map((inv: any) => ({
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
        })) || [];
      } catch (invoiceError) {
        console.log('No invoices found for this wallet, starting fresh');
        fetchedInvoices = [];
      }
      
      setInvoices(fetchedInvoices);
      setLastFetchTime(now);
      retryCountRef.current = 0;

    } catch (err: unknown) {
      if (axios.isCancel(err) || (err as Error).name === 'AbortError') {
        console.log('Request was cancelled');
        return;
      }

      console.error("Error in fetchInvoices:", err);
      
      if (retryCountRef.current < MAX_RETRIES && 
          (err instanceof Error && err.message.includes('timeout')) ||
          (axios.isAxiosError(err) && !err.response)) {
        retryCountRef.current++;
        console.log(`Retrying... Attempt ${retryCountRef.current}/${MAX_RETRIES}`);
        setTimeout(() => fetchInvoices(), Math.pow(2, retryCountRef.current) * 1000);
        return;
      }

      if (axios.isAxiosError(err)) {
        const axiosError = err as AxiosError;
        const status = axiosError.response?.status;
        const errorData = axiosError.response?.data as any;
        
        if (status === 403) {
          setError("Access denied. Please check your wallet permissions.");
        } else if (status === 429) {
          setError("Too many requests. Please wait a moment and try again.");
        } else if (status && status >= 500) {
          setError("Server error. Please try again later.");
        } else {
          setError(errorData?.error || "Failed to load data. You can still create invoices.");
        }
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to connect to the service.");
      }
    } finally {
      setLoading(false);
      isFetchingRef.current = false;
    }
  }, [lastFetchTime, invoices.length, resetMessages]);

  // Form validation
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
      
      console.log('📤 Creating blockchain transaction...');
      console.log('Contract address:', await contract.getAddress());

      // Convert ETH to Wei
      let weiAmount: bigint;
      try {
        const limitedPrecisionEth = Math.floor(ethAmount * 100000000) / 100000000;
        const ethString = limitedPrecisionEth.toFixed(8);
        weiAmount = ethers.parseEther(ethString);
        console.log('Wei amount:', weiAmount.toString());
      } catch (conversionError: unknown) {
        console.error('Wei conversion error:', conversionError);
        const errorMessage = conversionError instanceof Error 
          ? conversionError.message 
          : 'Unknown conversion error';
        throw new Error(`Failed to convert ETH to Wei: ${errorMessage}`);
      }

      const dueDateTimestamp = Math.floor(dueDate.getTime() / 1000);
      
      console.log('Attempting to call contract with parameters:', {
        recipient: recipientAddress,
        amount: weiAmount.toString(),
        dueDate: dueDateTimestamp
      });

      setBlockchainTx({ hash: null, status: 'waiting_signature', error: null });

      // Call contract without description parameter
      const tx = await contract.createInvoice(
        recipientAddress,
        weiAmount,
        dueDateTimestamp
      );

      console.log('⏳ Transaction submitted:', tx.hash);
      setBlockchainTx({ hash: tx.hash, status: 'pending', error: null });

      // Wait for confirmation
      const receipt = await tx.wait(1);
      
      if (receipt.status === 1) {
        console.log('✅ Transaction confirmed:', tx.hash);
        setBlockchainTx({ hash: tx.hash, status: 'confirmed', error: null });
        
        // Try to extract invoice ID from events
        let blockchainInvoiceId = null;
        if (receipt.logs && receipt.logs.length > 0) {
          try {
            for (const log of receipt.logs) {
              try {
                const parsedLog = contract.interface.parseLog(log);
                console.log('📝 Event:', parsedLog?.name, parsedLog?.args);
                
                if (parsedLog?.name === 'InvoiceCreated' || parsedLog?.name === 'InvoiceGenerated') {
                  blockchainInvoiceId = parsedLog.args?.invoiceId?.toString() || 
                                       parsedLog.args?.id?.toString();
                  console.log('🆔 Blockchain Invoice ID:', blockchainInvoiceId);
                }
              } catch (parseError) {
                console.log('⚠️ Could not parse log:', parseError);
              }
            }
          } catch (eventError) {
            console.warn('⚠️ Error parsing events:', eventError);
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
      console.error('❌ Blockchain transaction failed:', error);
      
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

  // ✅ CORRECTED: handleSubmit with proper error handling for CrossChain system
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
      
      console.log('Creating invoice with CrossChain support...');
      
      // Create blockchain transaction first
      const blockchainResult = await createBlockchainTransaction(
        sanitizedWallet,
        Number(priceConversion.ethAmount),
        new Date(dueDate)
      );

      console.log('✅ Blockchain transaction successful:', blockchainResult);

      // ✅ CORRECTED: Send invoice data with proper error handling
      const invoiceData = {
        blockchainId: blockchainId || networkInfo?.chainId || 'ethereum', // fallback
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
        // ✅ REMOVED: description field
      };

      console.log('💾 Saving to database:', invoiceData);

      const response = await axios.post(`${API_BASE}/api/v1/invoices`, invoiceData, {
        timeout: 30000,
        headers: {
          'Content-Type': 'application/json',
        }
      });

      console.log('Database record created:', response.data);

      // Success
      handleCloseModal();
      
      let successMessage = "✅ Invoice created successfully!";
      successMessage += `\n🔗 Blockchain: ${blockchainResult.status}`;
      successMessage += `\n📋 Tx: ${blockchainResult.txHash?.slice(0, 10)}...`;
      successMessage += `\n💱 ${priceConversion.displayText} at $${priceConversion.ethPrice.toFixed(2)}/ETH`;
      successMessage += `\n🏦 Source: ${response.data.data?.source || 'registered'} wallet`;
      
      // Show existing registration confirmation
      if (response.data.data?.existingRegistration) {
        successMessage += `\n✅ Using existing wallet registration`;
      }
      
      setSuccess(successMessage);
      
      setLastFetchTime(0);
      await fetchInvoices();
      
    } catch (err: unknown) {
      console.error("Error creating invoice:", err);
      
      if (axios.isAxiosError(err)) {
        const axiosError = err as AxiosError;
        const errorData = axiosError.response?.data as any;
        const status = axiosError.response?.status;
        
        // ✅ CORRECTED: Handle all possible error codes from backend
        if (status === 400 && errorData?.code === 'WALLET_NOT_REGISTERED') {
          setFormError("Wallet Not Registered: This wallet address is not associated with any registered user. Please register the wallet first using the user management system.");
        } else if (status === 429) {
          setFormError("Monthly transaction limit exceeded. Please upgrade your plan.");
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
      console.log('Marking invoice as PAID:', {
        invoiceId,
        userWalletAddress,
      });

      await axios.post(`${API_BASE}/api/v1/invoices/${invoiceId}/markPaid`, {
        userWalletAddress,
      });

      setSuccess("✅ Invoice marked as PAID successfully!");
      setLastFetchTime(0);
      await fetchInvoices();
      
    } catch (err: unknown) {
      console.error("Error marking invoice as PAID:", err);
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
      
      let display = `$${usdAmount.toFixed(2)} USD`;
      
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
    console.log('Component mounted, starting initial fetch...');
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

  console.log('Render state:', { loading, isConnected, invoices: invoices.length, error });

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
          {error && (
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
                      <th className="px-6 py-4 font-medium text-gray-700">Blockchain</th>
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
                          {invoice.blockchainHash ? (
                            <div className="text-xs">
                              <a
                                href={`https://etherscan.io/tx/${invoice.blockchainHash}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:text-blue-800 underline"
                              >
                                {invoice.blockchainHash.slice(0, 10)}...
                              </a>
                            </div>
                          ) : (
                            <span className="text-xs text-gray-400">No hash</span>
                          )}
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

          {/* ✅ CORRECTED: Create Invoice Modal */}
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
