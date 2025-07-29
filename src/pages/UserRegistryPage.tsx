import React, { useEffect, useState } from 'react';
import { ethers } from 'ethers';
import { getUserRegistryContract } from '../utils/getUserRegistryContract';
import toast from 'react-hot-toast';
import { BASE_API_URL } from '../utils/constants';
import { Wallet, Plus, Trash2, AlertCircle, Info, CreditCard, Users, Lock } from 'lucide-react';

interface RegisteredUser {
  id: string;
  walletAddress: string;
  metadataURI: string;
  registeredAt: string;
  blockchainId: string;
  planName?: string;
  planSource?: string;
  queryLimit?: number;
  userLimit?: number;
  trialStartDate?: string;
  trialUsed?: boolean;
  subscriptionEndDate?: string;
  isBnsName?: boolean;
}

interface WalletInfo {
  id: string;
  walletAddress: string;
  blockchainId: string;
  blockchainName: string;
  creditScore: number;
  hasUBID: boolean;
  isUnique: boolean; // counts toward wallet limit
  isPrimary: boolean;
  createdAt: string;
}

interface WalletLimits {
  planName: string;
  allowedWallets: number;
  usedWallets: number;
  queryLimit: number;
  txnLimit: number | null;
  trialActive: boolean;
  walletDetails: WalletInfo[];
}

interface PlanData {
  planName: string;
  queryLimit: number;
  userLimit: number;
  planSource: 'free' | 'individual' | 'organization';
  trialStartDate?: string;
  trialUsed?: boolean;
  subscriptionActive: boolean;
  subscriptionEndDate?: string;
  success: boolean;
}

// ✅ Plan capabilities based on your requirements
// ✅ Plan capabilities based on your requirements
const PLAN_CAPABILITIES = {
  'Free': { 
    maxWallets: 1, 
    canViewOthers: false, 
    queryLimit: 1000, 
    canAddWallets: false, 
    txnLimit: null 
  },
  'Basic': { 
    maxWallets: 1, 
    canViewOthers: false, 
    queryLimit: 1000, 
    canAddWallets: false, 
    txnLimit: null 
  },
  'Pro': { 
    maxWallets: 3, 
    canViewOthers: true, 
    queryLimit: 15000, 
    canAddWallets: true, 
    txnLimit: 20000 
  },
  'Premium': { 
    maxWallets: 5, 
    canViewOthers: true, 
    queryLimit: 1000000, 
    canAddWallets: true, 
    txnLimit: null  // null means unlimited
  }
};


const TRIAL_DAYS = 5;
const DEBUG_MODE = process.env.NODE_ENV === 'development';

const UserRegistryPage = () => {
  // Basic registration states
  const [walletAddress, setWalletAddress] = useState('');
  const [bnsName, setBnsName] = useState('');
  const [metadataUri, setMetadataUri] = useState('');
  const [registeredUser, setRegisteredUser] = useState<RegisteredUser | null>(null);
  const [newBnsName, setNewBnsName] = useState('');
  const [newMetadataUri, setNewMetadataUri] = useState('');
  const [loading, setLoading] = useState(false);
  const [blockchainId, setBlockchainId] = useState('');
  const [isChecking, setIsChecking] = useState(true);
  const [planData, setPlanData] = useState<PlanData | null>(null);
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [availableOrgs, setAvailableOrgs] = useState<any[]>([]);
  const [showOrgSelection, setShowOrgSelection] = useState(false);
  const [inputType, setInputType] = useState<'bns' | 'metadata'>('bns');
  const [planCheckLoading, setPlanCheckLoading] = useState(false);

  // ✅ Multi-wallet states
  const [walletLimits, setWalletLimits] = useState<WalletLimits | null>(null);
  const [userWallets, setUserWallets] = useState<WalletInfo[]>([]);
  const [showAddWallet, setShowAddWallet] = useState(false);
  const [newWalletAddress, setNewWalletAddress] = useState('');
  const [newWalletChain, setNewWalletChain] = useState('');
  const [newWalletMetadata, setNewWalletMetadata] = useState('');
  const [addingWallet, setAddingWallet] = useState(false);
  const [walletScoresLoading, setWalletScoresLoading] = useState(false);

  const notify = (msg: string, type: 'success' | 'error' | 'warning') => {
    if (type === 'success') toast.success(msg);
    else if (type === 'warning') toast.error(msg, { icon: '⚠️' });
    else toast.error(msg);
  };

  // ✅ Get current user's plan capabilities
  const getCurrentPlanCapabilities = () => {
    if (!registeredUser?.planName) return PLAN_CAPABILITIES['Free'];
    const planName = registeredUser.planName as keyof typeof PLAN_CAPABILITIES;
    return PLAN_CAPABILITIES[planName] || PLAN_CAPABILITIES['Free'];
  };

  // ✅ BNS Name validation
  const validateBnsName = (name: string) => {
    if (!name) return false;
    const bnsPattern = /^[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]*\.[a-zA-Z]{2,}$/;
    return bnsPattern.test(name) && name.length >= 5 && name.length <= 50;
  };

  // ✅ Metadata URI validation
  const validateMetadataUri = (uri: string) => {
    if (!uri) return false;
    return uri.startsWith('ipfs://') || uri.startsWith('https://') || uri.startsWith('ar://');
  };

  // ✅ Wallet address validation
  const validateWalletAddress = (address: string) => {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  };

  // ✅ Fetch user's wallet limits and all wallets
  const fetchWalletLimits = async (userId: string) => {
    try {
      setWalletScoresLoading(true);
      DEBUG_MODE && console.log(`🔍 Fetching wallet limits for user ${userId}`);
      
      const response = await fetch(`${BASE_API_URL}/user/wallet-limits/${userId}`);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch wallet limits: ${response.status}`);
      }

      const data = await response.json();
      DEBUG_MODE && console.log('💼 Wallet limits data:', data);
      
      if (data.success) {
        setWalletLimits(data.data);
        setUserWallets(data.data.walletDetails || []);
        
        notify(`💼 Loaded ${data.data.walletDetails?.length || 0} wallets`, 'success');
        return data.data;
      }
      return null;
    } catch (error) {
      console.error('🚨 Failed to fetch wallet limits:', error);
      notify('Failed to load wallet information', 'error');
      return null;
    } finally {
      setWalletScoresLoading(false);
    }
  };

  // ✅ Add additional wallet
  const addAdditionalWallet = async () => {
    if (!validateWalletAddress(newWalletAddress)) {
      return notify('Please enter a valid wallet address', 'error');
    }
    
    if (!newWalletChain.trim()) {
      return notify('Please enter a blockchain ID', 'error');
    }
    
    if (!newWalletMetadata.trim()) {
      return notify('Please enter metadata URI', 'error');
    }

      try {
    setAddingWallet(true);
    DEBUG_MODE && console.log(`➕ Adding wallet: ${newWalletAddress} on ${newWalletChain}`);
    
    const response = await fetch(`${BASE_API_URL}/user/add-wallet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: registeredUser?.id,
        walletAddress: newWalletAddress,
        blockchainId: newWalletChain,
        metadataURI: newWalletMetadata,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      
      if (errorData.code === 'WALLET_LIMIT_EXCEEDED') {
        notify(`❌ Wallet Limit Reached: ${errorData.error}`, 'error');
        return;
      }
      
      if (errorData.code === 'WALLET_EXISTS' || errorData.code === 'CANNOT_ADD_PRIMARY_WALLET') {
        notify('❌ This wallet is already registered', 'error');
        return;
      }
      
      throw new Error(errorData.error || 'Failed to add wallet');
    }

    const responseData = await response.json();
    notify(`✅ Wallet added successfully ${responseData.countsTowardLimit ? '(counts toward limit)' : '(cross-chain duplicate)'}`, 'success');
    
    // Refresh wallet data
    if (registeredUser?.id) {
      await fetchWalletLimits(registeredUser.id);
    }
    
    // Clear form
    setNewWalletAddress('');
    setNewWalletChain('');
    setNewWalletMetadata('');
    setShowAddWallet(false);
    
  } catch (error) {
    console.error('🚨 Failed to add wallet:', error);
    
    // ✅ FIXED: Proper error type handling
    let errorMessage = 'Unknown error';
    
    if (error instanceof Error) {
      errorMessage = error.message;
    } else if (typeof error === 'string') {
      errorMessage = error;
    } else if (error && typeof error === 'object' && 'message' in error) {
      errorMessage = String(error.message);
    }
    
    // Handle specific error codes
    if (errorMessage.includes('CANNOT_ADD_PRIMARY_WALLET')) {
      notify('❌ Cannot add your primary wallet as additional wallet', 'error');
    } else if (errorMessage.includes('WALLET_EXISTS')) {
      notify('❌ This wallet is already registered', 'error');
    } else {
      notify(`Failed to add wallet: ${errorMessage}`, 'error');
    }
  } finally {
    setAddingWallet(false);
  }
};

  // ✅ Remove wallet
  const removeWallet = async (walletId: string) => {
    if (!confirm('Are you sure you want to remove this wallet?')) return;
    
    try {
      setLoading(true);
      
      const response = await fetch(`${BASE_API_URL}/user/remove-wallet/${walletId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to remove wallet');
      }

      notify('✅ Wallet removed successfully', 'success');
      
      // Refresh wallet data
      if (registeredUser?.id) {
        await fetchWalletLimits(registeredUser.id);
      }
      
    } catch (error) {
      console.error('🚨 Failed to remove wallet:', error);
      notify(`Failed to remove wallet: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  // ✅ Get credit score color
  const getCreditScoreColor = (score: number) => {
    if (score >= 700) return 'text-green-600';
    if (score >= 500) return 'text-yellow-600';
    return 'text-red-600';
  };

  // ✅ Get credit score label
  const getCreditScoreLabel = (score: number) => {
    if (score >= 700) return 'Excellent';
    if (score >= 600) return 'Good';
    if (score >= 500) return 'Fair';
    return 'Poor';
  };

  // ✅ Enhanced plan data fetching
  const fetchPlanData = async (address: string, chainId: string) => {
    try {
      setPlanCheckLoading(true);
      DEBUG_MODE && console.log(`🔍 Fetching plan data for ${address}/${chainId}`);
      
      const planRes = await fetch(`${BASE_API_URL}/user/plan/${address}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      });
      
      if (!planRes.ok) {
        DEBUG_MODE && console.warn(`⚠️ Plan API returned ${planRes.status}`);
        return null;
      }

      const planResponse = await planRes.json();
      DEBUG_MODE && console.log('📋 Plan Data:', planResponse);
      
      if (planResponse && planResponse.success) {
        setPlanData(planResponse);
        return planResponse;
      }
      return null;
    } catch (error) {
      console.error('🚨 Failed to fetch plan data:', error);
      return null;
    } finally {
      setPlanCheckLoading(false);
    }
  };

  // ✅ Store wallet data
  const storeWalletData = (address: string, chainId: string) => {
    window.localStorage.setItem('walletAddress', address);
    window.localStorage.setItem('blockchainId', chainId);
    DEBUG_MODE && console.log(`💾 Stored wallet data: ${address}/${chainId}`);
  };

  // ✅ Enhanced registration with BNS support
  const registerInDB = async (address: string, metadataValue: string, chainId: string, orgId?: string) => {
    try {
      DEBUG_MODE && console.log(`📝 Registering in DB: ${address} with ${metadataValue}`);
      
      const payload = { 
        walletAddress: address, 
        metadataURI: metadataValue, 
        blockchainId: chainId,
        isBnsName: validateBnsName(metadataValue),
        ...(orgId && { orgId })
      };

      const res = await fetch(`${BASE_API_URL}/user/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.details || errorData.error || `Registration failed with status ${res.status}`);
      }

      const responseData = await res.json();
      DEBUG_MODE && console.log('✅ Registration successful:', responseData);
      
      // Fetch plan data after registration
      const planInfo = await fetchPlanData(address, chainId);
      
      const newUser: RegisteredUser = {
        id: responseData.data.id,
        walletAddress: address,
        metadataURI: metadataValue,
        blockchainId: chainId,
        registeredAt: new Date(responseData.data.createdAt || responseData.data.updatedAt || Date.now()).toLocaleString(),
        planName: planInfo?.planName || 'Basic',
        planSource: planInfo?.planSource || 'individual',
        queryLimit: planInfo?.queryLimit || 1000,
        userLimit: planInfo?.userLimit || 1,
        trialStartDate: responseData.data.trialStartDate,
        trialUsed: responseData.data.trialUsed || false,
        subscriptionEndDate: planInfo?.subscriptionEndDate,
        isBnsName: validateBnsName(metadataValue),
      };

      setRegisteredUser(newUser);
      
      // Fetch wallet limits for multi-wallet plans
      const capabilities = PLAN_CAPABILITIES[newUser.planName as keyof typeof PLAN_CAPABILITIES];
      if (capabilities?.maxWallets > 1) {
        await fetchWalletLimits(newUser.id);
      }

      notify(`✅ ${responseData.message || 'User registered successfully'}`, 'success');
      
      setSelectedOrgId('');
      setShowOrgSelection(false);
      setBnsName('');
      setMetadataUri('');
      
      return true;
    } catch (err) {
      console.error("🚨 DB registration error:", err);
      notify(`Registration failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
      return false;
    }
  };

  // ✅ Enhanced registration handler
  const handleRegister = async () => {
    const metadataValue = inputType === 'bns' ? bnsName : metadataUri;
    
    if (!metadataValue.trim()) {
      return notify(`Please provide a valid ${inputType === 'bns' ? 'BNS name' : 'metadata URI'}`, 'error');
    }

    if (inputType === 'bns' && !validateBnsName(metadataValue)) {
      return notify('Please provide a valid BNS name (e.g., yourname.bns)', 'error');
    }

    if (inputType === 'metadata' && !validateMetadataUri(metadataValue)) {
      return notify('Please provide a valid metadata URI (ipfs://, https://, or ar://)', 'error');
    }

    try {
      setLoading(true);
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const address = await signer.getAddress();

      DEBUG_MODE && console.log(`🚀 Starting registration for ${address} with ${metadataValue}`);

      // Direct organization registration
      if (showOrgSelection && selectedOrgId) {
        notify('🏢 Registering with organization...', 'success');
        await registerInDB(address, metadataValue, blockchainId, selectedOrgId);
        return;
      }

      // Blockchain registration for individual users
      const contract = getUserRegistryContract(signer);
      const isRegistered = await contract.isRegistered(address);
      
      if (isRegistered) {
        return notify('Wallet already registered on blockchain', 'error');
      }

      notify('⏳ Submitting to blockchain...', 'success');
      const tx = await contract.registerUser(metadataValue);
      notify('⏳ Transaction sent, waiting for confirmation...', 'success');
      await tx.wait();
      notify('✅ Registered on blockchain successfully', 'success');

      storeWalletData(address, blockchainId);
      await registerInDB(address, metadataValue, blockchainId);
      
    } catch (err) {
      console.error('🚨 Registration failed:', err);
      notify(`Registration failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  // ✅ Update metadata/BNS name
  const handleUpdate = async () => {
    const updateValue = inputType === 'bns' ? newBnsName : newMetadataUri;
    
    if (!updateValue.trim()) {
      return notify(`Please provide valid new ${inputType === 'bns' ? 'BNS name' : 'metadata URI'}`, 'error');
    }

    if (inputType === 'bns' && !validateBnsName(updateValue)) {
      return notify('Please provide a valid BNS name (e.g., yourname.bns)', 'error');
    }

    if (inputType === 'metadata' && !validateMetadataUri(updateValue)) {
      return notify('Please provide a valid metadata URI', 'error');
    }

    try {
      setLoading(true);
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const contract = getUserRegistryContract(signer);

      notify('⏳ Updating on blockchain...', 'success');
      const tx = await contract.updateMetadata(updateValue);
      await tx.wait();

      const res = await fetch(`${BASE_API_URL}/user/kyc/${walletAddress}/${blockchainId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          identityHash: updateValue,
          isBnsName: validateBnsName(updateValue)
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.details || errorData.error || 'Database update failed');
      }

      setRegisteredUser(prev => prev ? { 
        ...prev, 
        metadataURI: updateValue,
        isBnsName: validateBnsName(updateValue)
      } : null);
      
      notify('✅ Successfully updated on blockchain and database', 'success');
      setNewBnsName('');
      setNewMetadataUri('');
    } catch (err) {
      console.error('🚨 Update failed:', err);
      notify(`Update failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  // ✅ Enhanced user registration check
  const checkUserRegistration = async (address: string, chainId: string) => {
    try {
      DEBUG_MODE && console.log(`🔍 Checking registration for ${address}/${chainId}`);
      
      storeWalletData(address, chainId);

      const res = await fetch(`${BASE_API_URL}/user/wallet/${address}/${chainId}`);
      
      if (res.status === 404) {
        DEBUG_MODE && console.log('👤 User not found in database');
        return;
      }

      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);

      const result = await res.json();
      DEBUG_MODE && console.log('👤 User found:', result);
      
      // Fetch fresh plan data
      const planInfo = await fetchPlanData(address, chainId);
      
      const userData: RegisteredUser = {
        id: result.data.id,
        walletAddress: result.data.walletAddress,
        metadataURI: result.data.metadataURI,
        blockchainId: result.data.blockchainId,
        registeredAt: new Date(result.data.createdAt || result.data.updatedAt || Date.now()).toLocaleString(),
        planName: planInfo?.planName || result.data.Plan?.name || 'Basic',
        planSource: planInfo?.planSource || 'individual',
        queryLimit: planInfo?.queryLimit || result.data.queriesLimit || 1000,
        userLimit: planInfo?.userLimit || result.data.userLimit || 1,
        trialStartDate: result.data.trialStartDate,
        trialUsed: result.data.trialUsed || false,
        subscriptionEndDate: planInfo?.subscriptionEndDate,
        isBnsName: validateBnsName(result.data.metadataURI),
      };

      setRegisteredUser(userData);
      
      // Fetch wallet limits for multi-wallet plans
      const capabilities = PLAN_CAPABILITIES[userData.planName as keyof typeof PLAN_CAPABILITIES];
      if (capabilities?.maxWallets > 1) {
        await fetchWalletLimits(userData.id);
      }

    } catch (err) {
      console.error('🚨 Registration check failed:', err);
      notify(`Failed to check registration: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
    } finally {
      setIsChecking(false);
    }
  };

  // ✅ Calculate trial days remaining
  const calculateTrialDaysRemaining = (trialStartDate?: string) => {
    if (!trialStartDate) return 0;
    
    const start = new Date(trialStartDate);
    const now = new Date();
    const daysPassed = Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    return Math.max(TRIAL_DAYS - daysPassed, 0);
  };

  // ✅ Get plan status info
  const getPlanStatusInfo = () => {
    if (!registeredUser) return null;

    const isFreePlan = registeredUser.planName === 'Free';
    const trialDaysLeft = calculateTrialDaysRemaining(registeredUser.trialStartDate);
    const trialActive = isFreePlan && trialDaysLeft > 0;
    
    let isSubscriptionActive = false;
    
    if (!isFreePlan) {
      if (registeredUser.subscriptionEndDate) {
        isSubscriptionActive = new Date(registeredUser.subscriptionEndDate) > new Date();
      } else {
        isSubscriptionActive = true;
      }
    }

    return {
      isFreePlan,
      trialDaysLeft,
      trialActive,
      isSubscriptionActive,
      planCheckComplete: !planCheckLoading
    };
  };

  const planStatus = getPlanStatusInfo();
  const planCapabilities = getCurrentPlanCapabilities();

  // ✅ Initialize wallet connection and check registration
  useEffect(() => {
    const init = async () => {
      try {
        if (!window.ethereum) throw new Error('MetaMask not detected');

        const provider = new ethers.BrowserProvider(window.ethereum);
        await provider.send('eth_requestAccounts', []);
        const signer = await provider.getSigner();
        const address = await signer.getAddress();
        setWalletAddress(address);

        const network = await provider.getNetwork();
        const chainId = network.chainId.toString();
        setBlockchainId(chainId);

        DEBUG_MODE && console.log(`🔗 Connected to ${address} on chain ${chainId}`);

        await checkUserRegistration(address, chainId);
      } catch (err) {
        console.error('🚨 Wallet connection failed:', err);
        notify(err instanceof Error ? err.message : 'Failed to connect wallet', 'error');
        setIsChecking(false);
      }
    };

    init();
  }, []);

  if (isChecking) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto"></div>
          <p className="mt-2">Checking registration status...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">User Registry</h1>
      
      {/* Wallet Info */}
      <div className="mb-4 p-3 bg-gray-50 border rounded">
        <p className="text-sm text-gray-600">
          <strong>Wallet:</strong> <span className="font-mono break-all">{walletAddress}</span>
        </p>
        <p className="text-sm text-gray-600">
          <strong>Network:</strong> <span className="font-mono">{blockchainId}</span>
        </p>
      </div>

      {registeredUser ? (
        <>
          {/* ✅ Enhanced Registration Status */}
          <div className="p-4 bg-green-50 border border-green-200 rounded mb-4">
            <div className="flex items-center justify-between mb-3">
              <p className="font-semibold text-green-800">✅ Registration Active</p>
              {planCheckLoading && (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-green-500"></div>
              )}
            </div>
            
            <div className="space-y-2 text-sm">
              <p><strong>Identity:</strong> 
                <span className="ml-2 font-mono break-all">{registeredUser.metadataURI}</span>
                {registeredUser.isBnsName && <span className="ml-2 bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs">BNS</span>}
              </p>
              <p><strong>Network:</strong> {registeredUser.blockchainId}</p>
              <p><strong>Registered:</strong> {registeredUser.registeredAt}</p>
            </div>

            {/* ✅ Enhanced Plan Information */}
            <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded">
              <div className="flex items-center justify-between mb-2">
                <p className="font-semibold text-blue-800">📋 Plan Information</p>
                {planCheckLoading && <span className="text-xs text-blue-600">Updating...</span>}
              </div>
              
              <div className="space-y-1 text-sm">
                <p><strong>Plan:</strong> {registeredUser.planName}
                  {registeredUser.planSource && (
                    <span className="ml-2 bg-purple-100 text-purple-800 px-2 py-1 rounded text-xs capitalize">
                      {registeredUser.planSource}
                    </span>
                  )}
                </p>
                
                {/* ✅ Plan Capabilities Display */}
                <div className="mt-2 grid grid-cols-2 gap-4">
                  <div>
                    <p><strong>Limits:</strong></p>
                    <ul className="ml-4 list-disc text-sm">
                      <li>Wallets: <strong>{planCapabilities.maxWallets}</strong></li>
                      <li>Queries: <strong>{planCapabilities.queryLimit.toLocaleString()}</strong>/month</li>
                      {planCapabilities.txnLimit && (
                        <li>Transaction: <strong>${planCapabilities.txnLimit.toLocaleString()}</strong> limit</li>
                      )}
                    </ul>
                  </div>
                  <div>
                    <p><strong>Features:</strong></p>
                    <ul className="ml-4 list-disc text-sm">
                      <li>{planCapabilities.canViewOthers ? '✅' : '❌'} View other users</li>
                      <li>{planCapabilities.canAddWallets ? '✅' : '❌'} Multi-wallet support</li>
                      <li>✅ Credit scoring</li>
                    </ul>
                  </div>
                </div>
                
                {/* ✅ Status Indicators */}
                {planStatus?.isFreePlan && planStatus.trialActive && (
                  <div className="mt-2 p-2 bg-yellow-100 border border-yellow-200 rounded">
                    <p className="text-yellow-800 font-medium">
                      🕒 Trial: {planStatus.trialDaysLeft} days remaining
                    </p>
                  </div>
                )}
                
                {!planStatus?.isFreePlan && planStatus?.isSubscriptionActive && (
                  <div className="mt-2 p-2 bg-green-100 border border-green-200 rounded">
                    <p className="text-green-800 font-medium">
                      ✅ Subscription Active
                      {registeredUser.subscriptionEndDate && (
                        <span className="block text-xs mt-1">
                          Until: {new Date(registeredUser.subscriptionEndDate).toLocaleDateString()}
                        </span>
                      )}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ✅ Multi-Wallet Management Section */}
          {planCapabilities.maxWallets > 1 && (
            <div className="mb-6 p-4 bg-indigo-50 border border-indigo-200 rounded">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center">
                  <Wallet className="w-5 h-5 text-indigo-600 mr-2" />
                  <h3 className="font-semibold text-indigo-800">💼 Wallet Portfolio</h3>
                </div>
                <button
                  onClick={() => setShowAddWallet(!showAddWallet)}
                  disabled={walletLimits ? walletLimits.usedWallets >= walletLimits.allowedWallets : false}
                  className="flex items-center bg-indigo-500 text-white px-3 py-2 rounded text-sm hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Add Wallet
                </button>
              </div>
              
              {/* Wallet Usage Summary */}
              {walletLimits && (
                <div className="mb-4 p-3 bg-white border rounded">
                  <div className="flex justify-between items-center mb-2">
                    <p className="font-medium">Wallet Usage</p>
                    {walletScoresLoading && (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-indigo-500"></div>
                    )}
                  </div>
                  <div className="text-sm text-gray-600">
                    <p><strong>{walletLimits.usedWallets}/{walletLimits.allowedWallets}</strong> wallets used</p>
                    <p className="text-xs mt-1">
                      Applied counting rules: Cross-chain duplicates counted once
                    </p>
                  </div>
                </div>
              )}

              {/* Add Wallet Form */}
              {showAddWallet && (
                <div className="mb-4 p-4 bg-white border border-gray-200 rounded">
                  <h4 className="font-medium mb-3">Add Additional Wallet</h4>
                  <div className="space-y-3">
                    <input
                      type="text"
                      placeholder="Wallet Address (0x...)"
                      value={newWalletAddress}
                      onChange={(e) => setNewWalletAddress(e.target.value)}
                      className="w-full p-2 border rounded focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                    <input
                      type="text"
                      placeholder="Blockchain ID"
                      value={newWalletChain}
                      onChange={(e) => setNewWalletChain(e.target.value)}
                      className="w-full p-2 border rounded focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                    <input
                      type="text"
                      placeholder="Metadata URI"
                      value={newWalletMetadata}
                      onChange={(e) => setNewWalletMetadata(e.target.value)}
                      className="w-full p-2 border rounded focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                    <div className="flex space-x-2">
                      <button
                        onClick={addAdditionalWallet}
                        disabled={addingWallet || !newWalletAddress || !newWalletChain || !newWalletMetadata}
                        className="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600 disabled:opacity-50 transition-colors"
                      >
                        {addingWallet ? "Adding..." : "Add Wallet"}
                      </button>
                      <button
                        onClick={() => setShowAddWallet(false)}
                        className="bg-gray-500 text-white px-4 py-2 rounded hover:bg-gray-600 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Wallet List */}
              {userWallets.length > 0 && (
                <div className="space-y-2">
                  <h4 className="font-medium">Your Wallets</h4>
                  {userWallets.map((wallet) => (
                    <div key={wallet.id} className="p-3 bg-white border rounded">
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <div className="flex items-center">
                            <span className="font-mono text-sm">
                              {wallet.walletAddress.slice(0, 6)}...{wallet.walletAddress.slice(-4)}
                            </span>
                            {wallet.isPrimary && (
                              <span className="ml-2 bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs">Primary</span>
                            )}
                            {!wallet.isUnique && (
                              <span className="ml-2 bg-yellow-100 text-yellow-800 px-2 py-1 rounded text-xs">Cross-chain</span>
                            )}
                            {wallet.hasUBID && (
                              <span className="ml-2 bg-purple-100 text-purple-800 px-2 py-1 rounded text-xs">UBID</span>
                            )}
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            <p>{wallet.blockchainName} • Added {new Date(wallet.createdAt).toLocaleDateString()}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className={`text-lg font-bold ${getCreditScoreColor(wallet.creditScore)}`}>
                            {wallet.creditScore}
                          </div>
                          <div className="text-xs text-gray-500">
                            {getCreditScoreLabel(wallet.creditScore)}
                          </div>
                        </div>
                        {!wallet.isPrimary && (
                          <button
                            onClick={() => removeWallet(wallet.id)}
                            disabled={loading}
                            className="ml-3 text-red-500 hover:text-red-700 p-1 transition-colors"
                            title="Remove wallet"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Wallet Counting Rules Info */}
              <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded">
                <div className="flex items-center mb-2">
                  <Info className="w-4 h-4 text-blue-500 mr-2" />
                  <span className="text-sm font-medium text-blue-800">Wallet Counting Rules</span>
                </div>
                <div className="text-xs text-blue-700 space-y-1">
                  <p>• Same wallet on multiple chains = Counts as 1 wallet</p>
                  <p>• Different wallet addresses = Each counts separately</p>
                  <p>• UBID-enabled chains = Each UBID chain counts separately</p>
                </div>
              </div>
            </div>
          )}

          {/* ✅ Limited Access Message for Free/Basic Plans */}
          {!planCapabilities.canAddWallets && (
            <div className="mb-6 p-4 bg-gray-50 border border-gray-200 rounded">
              <div className="flex items-center">
                <Lock className="w-5 h-5 text-gray-400 mr-3" />
                <div>
                  <h3 className="font-medium text-gray-700">Single Wallet Plan</h3>
                  <p className="text-gray-600 text-sm mt-1">
                    Your {registeredUser.planName} plan supports 1 wallet. 
                    Upgrade to Pro or Premium for multi-wallet support.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ✅ Update Section */}
          <div className="space-y-3">
            <h3 className="font-semibold">Update Identity</h3>
            <div className="flex space-x-2 mb-3">
              <button
                onClick={() => setInputType('bns')}
                className={`px-3 py-1 rounded text-sm transition-colors ${
                  inputType === 'bns' 
                    ? 'bg-blue-500 text-white' 
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                BNS Name
              </button>
              <button
                onClick={() => setInputType('metadata')}
                className={`px-3 py-1 rounded text-sm transition-colors ${
                  inputType === 'metadata' 
                    ? 'bg-blue-500 text-white' 
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                Metadata URI
              </button>
            </div>

            {inputType === 'bns' ? (
              <input
                className="border p-3 rounded w-full focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="New BNS name (e.g., newname.bns)"
                value={newBnsName}
                onChange={(e) => setNewBnsName(e.target.value)}
              />
            ) : (
              <input
                className="border p-3 rounded w-full focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="New metadata URI (ipfs://, https://, ar://)"
                value={newMetadataUri}
                onChange={(e) => setNewMetadataUri(e.target.value)}
              />
            )}

            <button
              onClick={handleUpdate}
              disabled={loading || (!newBnsName && !newMetadataUri)}
              className="w-full bg-indigo-600 px-4 py-3 text-white rounded disabled:opacity-50 hover:bg-indigo-700 transition-colors font-medium"
            >
              {loading ? "Updating..." : `Update ${inputType === 'bns' ? 'BNS Name' : 'Metadata'}`}
            </button>
          </div>
        </>
      ) : (
        <>
          {/* ✅ Registration Form */}
          <div className="space-y-3">
            <div className="flex space-x-2 mb-3">
              <button
                onClick={() => setInputType('bns')}
                className={`px-3 py-1 rounded text-sm transition-colors ${
                  inputType === 'bns' 
                    ? 'bg-green-500 text-white' 
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                BNS Name
              </button>
              <button
                onClick={() => setInputType('metadata')}
                className={`px-3 py-1 rounded text-sm transition-colors ${
                  inputType === 'metadata' 
                    ? 'bg-green-500 text-white' 
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                Metadata URI
              </button>
            </div>

            {inputType === 'bns' ? (
              <input
                className="border p-3 rounded w-full focus:ring-2 focus:ring-green-500 focus:border-green-500"
                placeholder="BNS name (e.g., yourname.bns)"
                value={bnsName}
                onChange={(e) => setBnsName(e.target.value)}
              />
            ) : (
              <input
                className="border p-3 rounded w-full focus:ring-2 focus:ring-green-500 focus:border-green-500"
                placeholder="Metadata URI (ipfs://, https://, ar://)"
                value={metadataUri}
                onChange={(e) => setMetadataUri(e.target.value)}
              />
            )}

            <button
              onClick={handleRegister}
              disabled={loading || (!bnsName && !metadataUri)}
              className="w-full bg-green-600 px-4 py-3 text-white rounded disabled:opacity-50 hover:bg-green-700 transition-colors font-medium"
            >
              {loading ? "Registering..." : `Register ${inputType === 'bns' ? 'BNS Name' : 'Identity'}`}
            </button>
            
            {/* ✅ Input validation hints */}
            <div className="text-xs text-gray-500">
              {inputType === 'bns' ? (
                <p>💡 BNS name format: yourname.bns, alice.eth, etc.</p>
              ) : (
                <p>💡 Supported: ipfs://, https://, ar:// URIs</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default UserRegistryPage;
