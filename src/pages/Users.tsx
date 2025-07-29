import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Wallet, Search, ChevronDown, RefreshCw, AlertCircle, Info, Lock } from 'lucide-react';
import Layout from '../components/Layout';
import PlanCard from '../components/PlanCard';
import PlanUsageStats from '../components/PlanUsageStats';
import UpgradePlans from '../components/UpgradePlans';
import TransactionLimits from '../components/TransactionLimits';
import { BASE_API_URL } from '../utils/constants';
import { isTrialActive, getTrialDaysRemaining } from '../utils/isTrialActive';

interface User {
  id: string;
  walletAddress: string;
  blockchainId: string;
  bns: string;
  crossChainAddress: string;
  metadataUri: string;
  creditScore: number;
  createdAt: string;
  updatedAt: string;
  Plan?: { name: string };
  planSource?: string;
  trialStartDate?: string;
  trialUsed?: boolean;
  queriesUsed?: number;
  queriesLimit?: number;
  trialDaysRemaining?: number;
  trialActive?: boolean;
  subscriptionEndDate?: string;
  subscriptionStartDate?: string;
  subscriptionActive?: boolean;
  isPrimary?: boolean;
  source?: 'primary' | 'crosschain';
  parentUserId?: string;
  blockchainName?: string;
  isCurrentUser?: boolean;
}

interface WalletConnectionState {
  isConnected: boolean;
  walletAddress: string | null;
  blockchainId: string | null;
  lastChecked: number;
}

interface LoadingState {
  initializing: boolean;
  fetchingUsers: boolean;
  fetchingCurrentUser: boolean;
  refreshing: boolean;
}

// Plan limits configuration
const PLAN_LIMITS = {
  'Free': { maxWallets: 1, canViewOthers: false, queryLimit: 100, txnLimit: null },
  'Basic': { maxWallets: 1, canViewOthers: false, queryLimit: 1000, txnLimit: null },
  'Pro': { maxWallets: 3, canViewOthers: true, queryLimit: 15000, txnLimit: 20000 },
  'Premium': { maxWallets: 5, canViewOthers: true, queryLimit: 100000, txnLimit: null }
};

const TRIAL_DAYS = 5;
const DEBUG_MODE = process.env.NODE_ENV === 'development';

const UsersPage = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [users, setUsers] = useState<User[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [error, setError] = useState('');
  const [walletState, setWalletState] = useState<WalletConnectionState>({
    isConnected: false,
    walletAddress: null,
    blockchainId: null,
    lastChecked: 0
  });
  const [loadingState, setLoadingState] = useState<LoadingState>({
    initializing: true,
    fetchingUsers: false,
    fetchingCurrentUser: false,
    refreshing: false
  });

  // ✅ FIXED: Enhanced API call with better error handling
  const apiCall = async (url: string, options: RequestInit = {}, retryCount = 0): Promise<any> => {
    try {
      DEBUG_MODE && console.log(`🌐 API Call: ${url}`, options);
      
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });

      DEBUG_MODE && console.log(`📡 API Response: ${response.status} - ${url}`);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      DEBUG_MODE && console.log(`✅ API Data:`, data);
      return data;
    } catch (error: any) {
      DEBUG_MODE && console.error(`❌ API Error:`, error);
      
      if (retryCount < 2) {
        console.warn(`API call failed, retrying... (${retryCount + 1}/3)`);
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, retryCount)));
        return apiCall(url, options, retryCount + 1);
      }
      throw error;
    }
  };

  // Wallet connection check
  const checkWalletConnection = useCallback(() => {
    const walletAddress = window.localStorage.getItem('walletAddress');
    const blockchainId = window.localStorage.getItem('blockchainId');
    const isConnected = !!(walletAddress && blockchainId);
    
    const newState = {
      isConnected,
      walletAddress,
      blockchainId,
      lastChecked: Date.now()
    };

    DEBUG_MODE && console.log('🔌 Wallet Connection Check:', {
      walletAddress: walletAddress ? `${walletAddress.slice(0, 6)}...` : null,
      blockchainId: blockchainId ? `${blockchainId.slice(0, 8)}...` : null,
      isConnected
    });
    
    if (JSON.stringify(newState) !== JSON.stringify(walletState)) {
      setWalletState(newState);
      
      if (!isConnected && walletState.isConnected) {
        setCurrentUser(null);
        setUsers([]);
        setError('');
      }
    }
    
    return isConnected;
  }, [walletState]);

  // Determine if current user is cross-chain identity
  const isCurrentUserCrossChain = useMemo(() => {
    if (!currentUser || !walletState.walletAddress) {
      return false;
    }
    
    const isCrossChain = currentUser.source === 'crosschain' || !currentUser.isPrimary;
    
    DEBUG_MODE && console.log('🔗 Cross-chain detection:', {
      source: currentUser.source,
      isPrimary: currentUser.isPrimary,
      isCrossChain: isCrossChain,
      parentUserId: currentUser.parentUserId
    });
    
    return isCrossChain;
  }, [currentUser, walletState.walletAddress]);

  // Get effective plan limits
  const getEffectivePlanLimits = useMemo(() => {
    if (!currentUser) return PLAN_LIMITS['Free'];
    
    if (isCurrentUserCrossChain) {
      return PLAN_LIMITS['Premium'];
    }
    
    const planName = currentUser.Plan?.name as keyof typeof PLAN_LIMITS;
    return PLAN_LIMITS[planName] || PLAN_LIMITS['Free'];
  }, [currentUser, isCurrentUserCrossChain]);

  // ✅ FIXED: Robust user detection with multiple fallback strategies
  const fetchCurrentUser = useCallback(async () => {
    if (!walletState.isConnected || !walletState.walletAddress || !walletState.blockchainId) {
      DEBUG_MODE && console.log('⚠️ No wallet connected - clearing current user');
      setCurrentUser(null);
      return;
    }

    try {
      setLoadingState(prev => ({ ...prev, fetchingCurrentUser: true }));
      setError(''); // Clear previous errors
      
      const { walletAddress, blockchainId } = walletState;
      DEBUG_MODE && console.log(`🔍 Starting user fetch for: ${walletAddress}/${blockchainId}`);

      let userFound = false;
      let detectedUser: User | null = null;

      // ✅ STRATEGY 1: Try cross-chain identity detection first
      try {
        DEBUG_MODE && console.log('🔗 Attempting cross-chain identity detection...');
        
        const crossChainEndpoints = [
          `${BASE_API_URL}/crosschain-identity/wallet/${walletAddress}/${blockchainId}`,
          `${BASE_API_URL}/crosschain-identity/by-wallet/${walletAddress}/${blockchainId}`,
          `${BASE_API_URL}/crosschain-identity?wallet=${walletAddress}&blockchain=${blockchainId}`
        ];

        for (const endpoint of crossChainEndpoints) {
          try {
            const crossChainResponse = await apiCall(endpoint);
            
            if (crossChainResponse && (crossChainResponse.success !== false) && 
                (crossChainResponse.data || crossChainResponse.id || crossChainResponse.walletAddress)) {
              
              const crossChainUser = crossChainResponse.data || crossChainResponse;
              DEBUG_MODE && console.log('✅ Cross-chain identity found:', crossChainUser);

              // Get primary user data
              let primaryUser = null;
              if (crossChainUser.userId) {
                try {
                  const primaryResponse = await apiCall(`${BASE_API_URL}/user/${crossChainUser.userId}`);
                  primaryUser = primaryResponse.data || primaryResponse;
                } catch (primaryError) {
                  DEBUG_MODE && console.log('⚠️ Could not fetch primary user, using defaults');
                }
              }

              detectedUser = {
                id: crossChainUser.id || `cc-${walletAddress}-${Date.now()}`,
                walletAddress: crossChainUser.walletAddress || walletAddress,
                blockchainId: crossChainUser.blockchainId || blockchainId,
                bns: crossChainUser.bns || '',
                crossChainAddress: crossChainUser.walletAddress || walletAddress,
                metadataUri: crossChainUser.metadataUri || '',
                creditScore: crossChainUser.creditScore || 0,
                createdAt: crossChainUser.createdAt || new Date().toISOString(),
                updatedAt: crossChainUser.updatedAt || new Date().toISOString(),
                Plan: primaryUser?.Plan || { name: 'Premium' },
                planSource: 'inherited',
                queriesLimit: PLAN_LIMITS['Premium'].queryLimit,
                queriesUsed: 0,
                trialActive: false,
                trialDaysRemaining: 0,
                subscriptionActive: primaryUser?.subscriptionActive || false,
                subscriptionStartDate: primaryUser?.subscriptionStartDate,
                subscriptionEndDate: primaryUser?.subscriptionEndDate,
                isPrimary: false,
                source: 'crosschain' as const,
                parentUserId: crossChainUser.userId,
                blockchainName: crossChainUser.Blockchain?.name || crossChainUser.blockchainName || 'Cross-Chain',
                isCurrentUser: true
              };

              userFound = true;
              break;
            }
          } catch (endpointError) {
            DEBUG_MODE && console.log(`Cross-chain endpoint failed: ${endpoint}`, endpointError);
            continue;
          }
        }
      } catch (crossChainError) {
        DEBUG_MODE && console.log('Cross-chain detection failed:', crossChainError);
      }

      // ✅ STRATEGY 2: If not cross-chain, try primary user detection
      if (!userFound) {
        try {
          DEBUG_MODE && console.log('👤 Attempting primary user detection...');
          
          // Check if user exists
          const existsEndpoints = [
            `${BASE_API_URL}/user/exists/${walletAddress}/${blockchainId}`,
            `${BASE_API_URL}/user/check/${walletAddress}/${blockchainId}`,
            `${BASE_API_URL}/users/exists?wallet=${walletAddress}&blockchain=${blockchainId}`
          ];

          let userExists = false;
          for (const endpoint of existsEndpoints) {
            try {
              const existsResponse = await apiCall(endpoint);
              if (existsResponse && (existsResponse.exists === true || existsResponse.found === true || existsResponse === true)) {
                userExists = true;
                break;
              }
            } catch (existsError) {
              continue;
            }
          }

          if (!userExists) {
            // Try direct user fetch as final check
            try {
              await apiCall(`${BASE_API_URL}/user/wallet/${walletAddress}/${blockchainId}`);
              userExists = true;
            } catch (directError) {
              DEBUG_MODE && console.log('❌ User does not exist');
            }
          }

          if (!userExists) {
            setCurrentUser(null);
            setError('Wallet not registered. Please register your wallet first.');
            return;
          }

          // Fetch user data with multiple fallback endpoints
          const userEndpoints = [
            `${BASE_API_URL}/user/wallet/${walletAddress}/${blockchainId}`,
            `${BASE_API_URL}/users/${walletAddress}/${blockchainId}`,
            `${BASE_API_URL}/user?wallet=${walletAddress}&blockchain=${blockchainId}`
          ];

          let userData = null;
          for (const endpoint of userEndpoints) {
            try {
              const response = await apiCall(endpoint);
              userData = response.data || response;
              if (userData && userData.walletAddress) {
                break;
              }
            } catch (userError) {
              continue;
            }
          }

          // Fetch plan data with fallbacks
          const planEndpoints = [
            `${BASE_API_URL}/user/plan/${walletAddress}`,
            `${BASE_API_URL}/plan/${walletAddress}`,
            `${BASE_API_URL}/users/plan?wallet=${walletAddress}`
          ];

          let planData = null;
          for (const endpoint of planEndpoints) {
            try {
              const response = await apiCall(endpoint);
              planData = response.data || response;
              if (planData) break;
            } catch (planError) {
              continue;
            }
          }

          // Fetch usage data with fallbacks
          const usageEndpoints = [
            `${BASE_API_URL}/query/usage/${walletAddress}/${blockchainId}`,
            `${BASE_API_URL}/usage/${walletAddress}/${blockchainId}`,
            `${BASE_API_URL}/user/usage?wallet=${walletAddress}&blockchain=${blockchainId}`
          ];

          let usageData = null;
          for (const endpoint of usageEndpoints) {
            try {
              const response = await apiCall(endpoint);
              usageData = response.data || response;
              if (usageData) break;
            } catch (usageError) {
              continue;
            }
          }

          // Create user object with available data
          const planName = planData?.planName || planData?.name || userData?.Plan?.name || 'Free';
          const planLimits = PLAN_LIMITS[planName as keyof typeof PLAN_LIMITS] || PLAN_LIMITS['Free'];
          
          const trialStartDate = planData?.trialStartDate || userData?.trialStartDate;
          const trialUsed = planData?.trialUsed || userData?.trialUsed || false;
          
          const trialActive = planName === 'Free' && !trialUsed ? true : 
                             planName === 'Free' && trialUsed ? isTrialActive(trialStartDate) : false;
          const trialDaysRemaining = planName === 'Free' && trialUsed ? getTrialDaysRemaining(trialStartDate) : 
                                    (trialUsed ? 0 : TRIAL_DAYS);

          detectedUser = {
            id: userData?.id || `${walletAddress}-${blockchainId}`,
            walletAddress: walletAddress,
            blockchainId: blockchainId,
            bns: userData?.bns || userData?.metadataURI || userData?.metadataUri || '',
            crossChainAddress: userData?.crossChainAddress || '',
            metadataUri: userData?.metadataURI || userData?.metadataUri || '',
            creditScore: userData?.creditScore || 0,
            createdAt: userData?.createdAt || new Date().toISOString(),
            updatedAt: userData?.updatedAt || new Date().toISOString(),
            Plan: { name: planName },
            planSource: planData?.planSource || 'individual',
            queriesLimit: planLimits.queryLimit,
            queriesUsed: usageData?.queriesUsed || usageData?.used || 0,
            trialStartDate: trialStartDate,
            trialUsed: trialUsed,
            trialActive: trialActive,
            trialDaysRemaining: trialDaysRemaining,
            subscriptionStartDate: planData?.subscriptionStartDate,
            subscriptionEndDate: planName !== 'Free' ? planData?.subscriptionEndDate : undefined,
            subscriptionActive: planName !== 'Free' ? (planData?.subscriptionActive || false) : false,
            isPrimary: true,
            source: 'primary' as const,
            isCurrentUser: true,
            blockchainName: 'Primary Wallet'
          };

          userFound = true;
          DEBUG_MODE && console.log('✅ Primary user created:', detectedUser);

        } catch (primaryUserError) {
          DEBUG_MODE && console.error('Primary user detection failed:', primaryUserError);
        }
      }

      // ✅ STRATEGY 3: Create minimal user if all detection fails but wallet is connected
      if (!userFound && walletState.isConnected) {
        DEBUG_MODE && console.log('⚠️ Creating minimal user as fallback');
        
        detectedUser = {
          id: `minimal-${walletAddress}-${Date.now()}`,
          walletAddress: walletAddress,
          blockchainId: blockchainId,
          bns: '',
          crossChainAddress: '',
          metadataUri: '',
          creditScore: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          Plan: { name: 'Free' },
          planSource: 'individual',
          queriesLimit: PLAN_LIMITS['Free'].queryLimit,
          queriesUsed: 0,
          trialStartDate: new Date().toISOString(),
          trialUsed: false,
          trialActive: true,
          trialDaysRemaining: TRIAL_DAYS,
          subscriptionActive: false,
          isPrimary: true,
          source: 'primary' as const,
          isCurrentUser: true,
          blockchainName: 'Primary Wallet'
        };
        
        setError('Some features may be limited. Please ensure your wallet is properly registered.');
      }

      if (detectedUser) {
        setCurrentUser(detectedUser);
        setError('');
        DEBUG_MODE && console.log('✅ User successfully loaded:', {
          id: detectedUser.id,
          source: detectedUser.source,
          plan: detectedUser.Plan?.name
        });
      } else {
        setCurrentUser(null);
        setError('Unable to load user data. Please check your wallet connection and try again.');
      }

    } catch (err: any) {
      console.error('🚨 Failed to fetch current user:', err);
      setCurrentUser(null);
      setError(`Failed to load user data: ${err.message || 'Unknown error'}. Please try refreshing.`);
    } finally {
      setLoadingState(prev => ({ ...prev, fetchingCurrentUser: false }));
    }
  }, [walletState]);

  // ✅ FIXED: Enhanced fetchUsers with better error handling
  const fetchUsers = useCallback(async (isRefresh = false) => {
    if (!walletState.isConnected || !walletState.walletAddress || !walletState.blockchainId || !currentUser) {
      DEBUG_MODE && console.log('❌ Prerequisites not met for user fetch');
      setUsers([]);
      return;
    }

    try {
      setLoadingState(prev => ({
        ...prev,
        [isRefresh ? 'refreshing' : 'fetchingUsers']: true
      }));

      const effectivePlanLimits = getEffectivePlanLimits;
      
      // CASE 1: Cross-chain identity user
      if (isCurrentUserCrossChain) {
        DEBUG_MODE && console.log('🔗 Fetching cross-chain identities');
        
        let allCrossChainUsers: User[] = [];
        
        // Always include current user
        allCrossChainUsers.push({
          ...currentUser,
          isCurrentUser: true
        });

        // Try to fetch sibling cross-chain identities
        if (currentUser.parentUserId) {
          try {
            const crossChainEndpoints = [
              `${BASE_API_URL}/crosschain-identity/user/${currentUser.parentUserId}`,
              `${BASE_API_URL}/crosschain-identity?parentId=${currentUser.parentUserId}`,
              `${BASE_API_URL}/user/${currentUser.parentUserId}/crosschain-identities`
            ];

            for (const endpoint of crossChainEndpoints) {
              try {
                const response = await apiCall(endpoint);
                const crossChainUsers = response.success ? response.data : response;
                
                if (Array.isArray(crossChainUsers)) {
                  crossChainUsers.forEach(ccUser => {
                    if (ccUser.walletAddress?.toLowerCase() !== walletState.walletAddress?.toLowerCase()) {
                      allCrossChainUsers.push({
                        id: ccUser.id,
                        walletAddress: ccUser.walletAddress,
                        blockchainId: ccUser.blockchainId,
                        bns: ccUser.bns || '',
                        crossChainAddress: ccUser.walletAddress,
                        metadataUri: ccUser.metadataUri || '',
                        creditScore: ccUser.creditScore || 0,
                        createdAt: ccUser.createdAt,
                        updatedAt: ccUser.updatedAt,
                        Plan: { name: 'Premium' },
                        planSource: 'inherited',
                        isPrimary: false,
                        source: 'crosschain' as const,
                        parentUserId: ccUser.userId,
                        blockchainName: ccUser.Blockchain?.name || 'Cross-Chain',
                        isCurrentUser: false
                      });
                    }
                  });
                }
                break; // Success, exit loop
              } catch (endpointError) {
                continue;
              }
            }
          } catch (error) {
            DEBUG_MODE && console.log('Could not fetch sibling cross-chain identities');
          }
        }

        setUsers(allCrossChainUsers);
        return;
      }

      // CASE 2: Free/Basic plan users
      if (!effectivePlanLimits.canViewOthers) {
        setUsers([currentUser]);
        return;
      }

      // CASE 3: Premium/Pro plan users
      let allUsersData: User[] = [];

      // Add current primary user
      allUsersData.push({
        ...currentUser,
        isPrimary: true,
        source: 'primary' as const,
        isCurrentUser: true
      });

      // Try to fetch cross-chain identities for this primary user
      try {
        const crossChainEndpoints = [
          `${BASE_API_URL}/crosschain-identity/user/${currentUser.id}`,
          `${BASE_API_URL}/user/${currentUser.id}/crosschain-identities`,
          `${BASE_API_URL}/crosschain-identity?userId=${currentUser.id}`
        ];

        for (const endpoint of crossChainEndpoints) {
          try {
            const response = await apiCall(endpoint);
            const crossChainUsers = response.success ? response.data : response;
            
            if (Array.isArray(crossChainUsers)) {
              crossChainUsers.forEach(ccUser => {
                allUsersData.push({
                  id: ccUser.id,
                  walletAddress: ccUser.walletAddress,
                  blockchainId: ccUser.blockchainId,
                  bns: ccUser.bns || '',
                  crossChainAddress: ccUser.walletAddress,
                  metadataUri: ccUser.metadataUri || '',
                  creditScore: ccUser.creditScore || 0,
                  createdAt: ccUser.createdAt,
                  updatedAt: ccUser.updatedAt,
                  Plan: currentUser.Plan,
                  planSource: 'inherited',
                  isPrimary: false,
                  source: 'crosschain' as const,
                  parentUserId: currentUser.id,
                  blockchainName: ccUser.Blockchain?.name || 'Cross-Chain',
                  isCurrentUser: false
                });
              });
            }
            break; // Success, exit loop
          } catch (endpointError) {
            continue;
          }
        }
      } catch (crossChainError) {
        DEBUG_MODE && console.log('No cross-chain identities found for primary user');
      }
      
      // Apply wallet limits
      const limitedUsers = allUsersData.slice(0, effectivePlanLimits.maxWallets);
      setUsers(limitedUsers);

    } catch (err: any) {
      console.error('🚨 Users fetch error:', err);
      setUsers(currentUser ? [currentUser] : []); // Fallback to at least show current user
    } finally {
      setLoadingState(prev => ({
        ...prev,
        fetchingUsers: false,
        refreshing: false
      }));
    }
  }, [
    walletState.isConnected, 
    walletState.walletAddress, 
    walletState.blockchainId, 
    currentUser, 
    getEffectivePlanLimits, 
    isCurrentUserCrossChain
  ]);

  // Determine access permissions
  const canViewOtherUsers = useMemo(() => {
    if (!currentUser) return false;
    
    if (isCurrentUserCrossChain) return true;
    
    const limits = getEffectivePlanLimits;
    const hasActivePlan = currentUser.Plan?.name !== 'Free' || currentUser.trialActive;
    
    return limits.canViewOthers && hasActivePlan;
  }, [currentUser, isCurrentUserCrossChain, getEffectivePlanLimits]);

  // Auto-initialization
  useEffect(() => {
    const initializeData = async () => {
      setLoadingState(prev => ({ ...prev, initializing: true }));
      
      const isConnected = checkWalletConnection();
      if (isConnected) {
        await fetchCurrentUser();
      } else {
        setCurrentUser(null);
        setUsers([]);
      }
      
      setLoadingState(prev => ({ ...prev, initializing: false }));
    };

    initializeData();
  }, []);

  // Fetch users when current user is loaded
  useEffect(() => {
    if (currentUser && walletState.isConnected) {
      fetchUsers();
    }
  }, [currentUser, walletState.isConnected, fetchUsers]);

  // Wallet connection monitoring
  useEffect(() => {
    const interval = setInterval(() => {
      const wasConnected = walletState.isConnected;
      const isConnected = checkWalletConnection();
      
      if (wasConnected && !isConnected) {
        setCurrentUser(null);
        setUsers([]);
        setError('');
      } else if (!wasConnected && isConnected) {
        fetchCurrentUser();
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [walletState.isConnected, fetchCurrentUser, checkWalletConnection]);

  // Enhanced filtering
  const filteredUsers = useMemo(() => {
    return users.filter((user) => {
      const matchesSearch = user.walletAddress?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           user.blockchainId?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           user.bns?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           user.blockchainName?.toLowerCase().includes(searchTerm.toLowerCase());
      
      return matchesSearch;
    });
  }, [users, searchTerm]);

  // Refresh handler
  const handleRefresh = useCallback(async () => {
    if (!walletState.isConnected) {
      setError('Please connect your wallet first');
      return;
    }
    
    setLoadingState(prev => ({ ...prev, refreshing: true }));
    setError(''); // Clear errors before refresh
    await fetchCurrentUser();
    setLoadingState(prev => ({ ...prev, refreshing: false }));
  }, [walletState.isConnected, fetchCurrentUser]);

  // Helper functions
  const formatWalletAddress = (address: string) => {
    if (!address) return 'No Address';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return 'N/A';
    try {
      return new Date(dateString).toLocaleDateString();
    } catch {
      return 'N/A';
    }
  };

  const getCreditScoreColor = (score: number) => {
    if (score >= 700) return 'text-green-600';
    if (score >= 500) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getCreditScoreLabel = (score: number) => {
    if (score >= 700) return 'Excellent';
    if (score >= 600) return 'Good';
    if (score >= 500) return 'Fair';
    return 'Poor';
  };

  // Plan info with cross-chain support
  const getCurrentPlanInfo = useMemo(() => {
    const planName = currentUser?.Plan?.name || 'Free';
    const effectiveLimits = getEffectivePlanLimits;
    const actualQueryLimit = currentUser?.queriesLimit || effectiveLimits.queryLimit;
    
    const displayPlanName = isCurrentUserCrossChain ? 'Premium' : planName;
    
    const planConfigs = {
      'Free': { 
        name: 'Free Plan', 
        queries: actualQueryLimit, 
        duration: '5 Days Rolling', 
        users: effectiveLimits.maxWallets, 
        features: [`${actualQueryLimit} queries in 5 days`, 'Basic credit scoring', 'Limited invoicing'] 
      },
      'Basic': { 
        name: 'Basic Plan ($149/month)', 
        queries: actualQueryLimit, 
        duration: 'monthly', 
        users: effectiveLimits.maxWallets, 
        features: [`${actualQueryLimit.toLocaleString()} queries/month`, 'Credit scoring', 'Invoicing', 'Single wallet'] 
      },
      'Pro': { 
        name: 'Pro Plan ($699/month)', 
        queries: actualQueryLimit, 
        duration: 'monthly', 
        users: effectiveLimits.maxWallets, 
        features: [`${actualQueryLimit.toLocaleString()} queries/month`, 'UBID access', 'Up to 3 wallets', '$20K transaction limit'] 
      },
      'Premium': { 
        name: isCurrentUserCrossChain ? 'Premium Plan (Inherited)' : 'Premium Plan ($3,699/month)', 
        queries: actualQueryLimit, 
        duration: 'monthly', 
        users: effectiveLimits.maxWallets, 
        features: [`${actualQueryLimit.toLocaleString()} queries/month`, 'All features', 'Up to 5 wallets', 'Unlimited transactions'] 
      }
    };

    return planConfigs[displayPlanName as keyof typeof planConfigs] || planConfigs.Free;
  }, [currentUser?.Plan?.name, currentUser?.queriesLimit, getEffectivePlanLimits, isCurrentUserCrossChain]);

  const shouldShowUpgradePlans = useMemo(() => {
    if (!currentUser || !walletState.isConnected || isCurrentUserCrossChain) return false;
    
    const planName = currentUser.Plan?.name || 'Free';
    const subscriptionActive = currentUser.subscriptionActive || false;
    
    const isSubscriptionExpired = currentUser.subscriptionEndDate 
      ? new Date(currentUser.subscriptionEndDate) < new Date() 
      : !subscriptionActive;
    
    switch (planName) {
      case 'Free':
        return true;
      case 'Basic':
        return true;
      case 'Pro':
        return isSubscriptionExpired;
      case 'Premium':
        return isSubscriptionExpired;
      default:
        return true;
    }
  }, [currentUser, walletState.isConnected, isCurrentUserCrossChain]);

  const hasActivePaidPlan = useMemo(() => {
    if (!currentUser || !walletState.isConnected) return false;
    const planName = currentUser.Plan?.name || 'Free';
    return planName !== 'Free' && !shouldShowUpgradePlans;
  }, [currentUser, walletState.isConnected, shouldShowUpgradePlans]);

  // Subscription handlers
  const handleSubscriptionSuccess = useCallback(async (subscriptionId: string) => {
    console.log('✅ Subscription successful:', subscriptionId);
    await fetchCurrentUser();
  }, [fetchCurrentUser]);

  const handleSubscriptionError = useCallback((error: string) => {
    console.error('🚨 Subscription error:', error);
    setError(`Subscription error: ${error}`);
  }, []);

  const handleSubscriptionCancel = useCallback(() => {
    console.log('❌ Subscription cancelled');
  }, []);

  // Content rendering
  const renderContent = () => {
    if (loadingState.initializing) {
      return (
        <div className="mb-8 p-6 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-center">
            <RefreshCw className="w-6 h-6 text-blue-500 mr-3 animate-spin" />
            <div>
              <h3 className="text-lg font-medium text-blue-800">Initializing Dashboard</h3>
              <p className="text-blue-700 mt-1">
                Setting up your dashboard and checking wallet connection...
              </p>
            </div>
          </div>
        </div>
      );
    }

    if (!walletState.isConnected) {
      return (
        <div className="mb-8 p-6 bg-orange-50 border border-orange-200 rounded-lg">
          <div className="flex items-center">
            <AlertCircle className="w-6 h-6 text-orange-500 mr-3" />
            <div>
              <h3 className="text-lg font-medium text-orange-800">Wallet Not Connected</h3>
              <p className="text-orange-700 mt-1">
                Please connect your wallet to access your plan dashboard and user data.
              </p>
            </div>
          </div>
        </div>
      );
    }

    if (loadingState.fetchingCurrentUser) {
      return (
        <div className="mb-8 p-6 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-center">
            <RefreshCw className="w-6 h-6 text-blue-500 mr-3 animate-spin" />
            <div>
              <h3 className="text-lg font-medium text-blue-800">Loading Your Data</h3>
              <p className="text-blue-700 mt-1">
                Fetching your wallet information and plan details...
              </p>
            </div>
          </div>
        </div>
      );
    }

    if (walletState.isConnected && !currentUser && error.includes('not registered')) {
      return (
        <div className="mb-8 p-6 bg-yellow-50 border border-yellow-200 rounded-lg">
          <div className="flex items-center">
            <AlertCircle className="w-6 h-6 text-yellow-500 mr-3" />
            <div>
              <h3 className="text-lg font-medium text-yellow-800">Wallet Not Registered</h3>
              <p className="text-yellow-700 mt-1">
                Your wallet is connected but not registered. Please register your wallet to access the dashboard.
              </p>
              <button 
                onClick={() => window.location.href = '/register'}
                className="mt-2 px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700"
              >
                Register Wallet
              </button>
            </div>
          </div>
        </div>
      );
    }

    if (currentUser) {
      return (
        <>
          {/* Plan Dashboard Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <PlanCard
              planInfo={getCurrentPlanInfo}
              trialActive={currentUser.trialActive || false}
              trialDaysRemaining={currentUser.trialDaysRemaining || 0}
              subscriptionEndDate={currentUser.subscriptionEndDate}
              isCurrentPlan={currentUser.Plan?.name !== 'Free'}
            />
            <PlanUsageStats
              used={currentUser.queriesUsed || 0}
              limit={currentUser.queriesLimit || 0}
            />
            <TransactionLimits
              walletAddress={currentUser.walletAddress}
              blockchainId={currentUser.blockchainId}
            />
          </div>

          {/* Cross-chain Identity Notice */}
          {isCurrentUserCrossChain && (
            <div className="mb-8 p-6 bg-purple-50 border border-purple-200 rounded-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <Lock className="w-6 h-6 text-purple-500 mr-3" />
                  <div>
                    <h3 className="text-lg font-medium text-purple-700">Cross-Chain Identity</h3>
                    <p className="text-purple-600 mt-1">
                      You are using a cross-chain identity wallet with inherited Premium plan benefits.
                      You can view all your cross-chain identities below.
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm text-purple-500">Plan Type</div>
                  <div className="text-lg font-semibold text-purple-700">Premium (Inherited)</div>
                </div>
              </div>
            </div>
          )}

          {/* Access Notice for Free/Basic Primary Users */}
          {!canViewOtherUsers && !isCurrentUserCrossChain && (
            <div className="mb-8 p-6 bg-gray-50 border border-gray-200 rounded-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <Lock className="w-6 h-6 text-gray-400 mr-3" />
                  <div>
                    <h3 className="text-lg font-medium text-gray-700">Limited Access</h3>
                    <p className="text-gray-600 mt-1">
                      Your {currentUser.Plan?.name} plan only allows viewing your own wallet data.
                      Upgrade to Pro or Premium to access multi-wallet features.
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm text-gray-500">Current Plan</div>
                  <div className="text-lg font-semibold text-gray-700">{currentUser.Plan?.name}</div>
                </div>
              </div>
            </div>
          )}

          {/* Upgrade Plans Section */}
          {shouldShowUpgradePlans && (
            <div className="mb-8">
              <UpgradePlans
                currentUser={currentUser}
                trialEndDate={currentUser.subscriptionEndDate || ''}
                currentPlanExpiry={currentUser.subscriptionEndDate || ''}
                onApprove={handleSubscriptionSuccess}
                onError={handleSubscriptionError}
                onCancel={handleSubscriptionCancel}
              />
            </div>
          )}

          {/* Active Plan Status */}
          {(hasActivePaidPlan || isCurrentUserCrossChain) && (
            <div className="mb-8 p-6 bg-gradient-to-r from-green-50 to-blue-50 border border-green-200 rounded-lg">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-green-800 flex items-center">
                    ✅ {getCurrentPlanInfo.name.replace(' ($3,699/month)', '')} Active
                    <span className="ml-2 px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-full">
                      {getEffectivePlanLimits.maxWallets} wallet{getEffectivePlanLimits.maxWallets > 1 ? 's' : ''} allowed
                    </span>
                  </h3>
                  <p className="text-green-600 mt-1">
                    Access to {isCurrentUserCrossChain ? 'cross-chain identity data' : canViewOtherUsers ? 'multi-wallet data' : 'your wallet data'}
                    {currentUser.subscriptionEndDate && !isCurrentUserCrossChain && (
                      <span className="block text-sm mt-1">
                        Active until {new Date(currentUser.subscriptionEndDate).toLocaleDateString()}
                      </span>
                    )}
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold text-green-700">
                    {(currentUser.queriesLimit || 0).toLocaleString()}
                  </div>
                  <div className="text-sm text-green-600">Monthly Queries</div>
                </div>
              </div>
            </div>
          )}
        </>
      );
    }

    return (
      <div className="mb-8 p-6 bg-red-50 border border-red-200 rounded-lg">
        <div className="flex items-center">
          <AlertCircle className="w-6 h-6 text-red-500 mr-3" />
          <div>
            <h3 className="text-lg font-medium text-red-800">Error Loading Data</h3>
            <p className="text-red-700 mt-1">
              {error || 'There was an error loading your wallet data. Please try refreshing the page.'}
            </p>
            <button 
              onClick={handleRefresh}
              className="mt-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
              disabled={loadingState.refreshing}
            >
              {loadingState.refreshing ? 'Refreshing...' : 'Try Again'}
            </button>
            <button 
              onClick={() => window.location.href = '/register'}
              className="mt-2 ml-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Register Wallet
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <Layout>
      <div className="p-8">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {isCurrentUserCrossChain ? 'Cross-Chain Identity Dashboard' : 'Users Dashboard'}
            </h1>
            <p className="text-gray-500">
              {walletState.isConnected 
                ? currentUser 
                  ? isCurrentUserCrossChain
                    ? `Manage your cross-chain identity with inherited Premium plan benefits`
                    : `Manage your ${currentUser.Plan?.name || 'Basic'} plan and monitor accessible data`
                  : 'Loading your wallet information...'
                : 'Connect your wallet to access your dashboard'
              }
            </p>
          </div>
          <button
            onClick={handleRefresh}
            disabled={loadingState.refreshing || loadingState.fetchingCurrentUser || !walletState.isConnected}
            className="flex items-center px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${(loadingState.refreshing || loadingState.fetchingCurrentUser) ? 'animate-spin' : ''}`} />
            {!walletState.isConnected ? 'Connect Wallet' : 
             loadingState.refreshing ? 'Refreshing...' : 
             loadingState.fetchingCurrentUser ? 'Loading...' : 'Refresh'}
          </button>
        </div>

        {/* Debug Panel */}
        {DEBUG_MODE && (
          <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <div className="flex items-center mb-2">
              <Info className="w-4 h-4 text-yellow-600 mr-2" />
              <h3 className="font-medium text-yellow-800">Debug Info</h3>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm text-yellow-700">
              <div>
                <p><strong>Wallet Connected:</strong> {String(walletState.isConnected)}</p>
                <p><strong>Current User:</strong> {currentUser ? 'Yes' : 'No'}</p>
                <p><strong>User Source:</strong> {currentUser?.source || 'None'}</p>
                <p><strong>Is Primary:</strong> {String(currentUser?.isPrimary || false)}</p>
              </div>
              <div>
                <p><strong>Plan:</strong> {currentUser?.Plan?.name || 'None'}</p>
                <p><strong>Plan Source:</strong> {currentUser?.planSource || 'None'}</p>
                <p><strong>Users Count:</strong> {users.length}</p>
                <p><strong>Parent User ID:</strong> {currentUser?.parentUserId || 'None'}</p>
              </div>
              <div>
                <p><strong>Is Cross-Chain:</strong> {String(isCurrentUserCrossChain)}</p>
                <p><strong>Can View Others:</strong> {String(canViewOtherUsers)}</p>
                <p><strong>Blockchain Name:</strong> {currentUser?.blockchainName || 'None'}</p>
                <p><strong>Cross-Chain Address:</strong> {currentUser?.crossChainAddress ? 'Yes' : 'No'}</p>
              </div>
              <div>
                <p><strong>Max Wallets:</strong> {getEffectivePlanLimits.maxWallets}</p>
                <p><strong>Error:</strong> {error ? 'Yes' : 'No'}</p>
                <p><strong>Query Limit:</strong> {currentUser?.queriesLimit || 0}</p>
                <p><strong>Wallet Address:</strong> {walletState.walletAddress?.slice(0, 8) || 'None'}...</p>
              </div>
            </div>
            {error && (
              <div className="mt-3 p-2 bg-red-100 rounded text-red-700 text-xs">
                <strong>Error Details:</strong> {error}
              </div>
            )}
          </div>
        )}

        {/* Main Content */}
        {renderContent()}

        {/* Error Display */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center">
            <AlertCircle className="w-5 h-5 text-red-500 mr-3 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-red-800 font-medium">Error</p>
              <p className="text-red-600 text-sm">{error}</p>
              <div className="mt-2 space-x-2">
                <button 
                  onClick={handleRefresh}
                  className="text-red-600 underline text-sm hover:text-red-800"
                  disabled={loadingState.refreshing}
                >
                  {loadingState.refreshing ? 'Refreshing...' : 'Try Again'}
                </button>
                <button 
                  onClick={() => setError('')}
                  className="text-red-600 underline text-sm hover:text-red-800"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Users Table */}
        {walletState.isConnected && currentUser && (
          <div className="bg-white rounded-xl shadow-sm">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center flex-1">
                  <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                    <input
                      type="text"
                      placeholder={
                        isCurrentUserCrossChain
                          ? "Search your cross-chain identities..."
                          : canViewOtherUsers 
                            ? "Search your wallets and sub-users..." 
                            : "Search your wallet data..."
                      }
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                  </div>
                </div>
              </div>

              <div className="mt-4 flex items-center space-x-6 text-sm text-gray-600">
                <span>
                  {isCurrentUserCrossChain 
                    ? 'Cross-Chain Identities'
                    : canViewOtherUsers 
                      ? 'Your Wallets' 
                      : 'Your Wallet'
                  }: <strong>{users.length}</strong>
                </span>
                <span>Filtered: <strong>{filteredUsers.length}</strong></span>
                <span>Plan: <strong>
                  {isCurrentUserCrossChain ? 'Premium (Inherited)' : currentUser.Plan?.name} 
                  ({getEffectivePlanLimits.maxWallets} wallet limit)
                </strong></span>
              </div>
            </div>

            {/* Table content */}
            <div className="overflow-x-auto">
              {loadingState.fetchingUsers ? (
                <div className="p-8 text-center">
                  <div className="inline-flex items-center text-gray-500">
                    <RefreshCw className="w-5 h-5 mr-2 animate-spin" />
                    Loading {isCurrentUserCrossChain ? 'cross-chain identities' : 'wallet data'}...
                  </div>
                </div>
              ) : filteredUsers.length > 0 ? (
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {isCurrentUserCrossChain ? 'Cross-Chain Identity' : canViewOtherUsers ? 'Wallet Address' : 'Your Wallet'}
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Blockchain Info</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Credit Score</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Plan</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {filteredUsers.map((user) => (
                      <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex items-center">
                            <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center">
                              <Wallet className="w-5 h-5 text-indigo-600" />
                            </div>
                            <div className="ml-4">
                              <div className="text-sm font-medium text-gray-900 font-mono">
                                {formatWalletAddress(user.walletAddress)}
                              </div>
                              <div className="text-sm text-gray-500 font-mono flex items-center">
                                ID: {user.id.slice(0, 8)}...
                                {user.isPrimary ? (
                                  <span className="ml-2 px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-full">Primary</span>
                                ) : (
                                  <span className="ml-2 px-2 py-1 bg-purple-100 text-purple-700 text-xs rounded-full">
                                    {isCurrentUserCrossChain ? 'Cross-Chain' : 'Sub-Wallet'}
                                  </span>
                                )}
                                {user.isCurrentUser && (
                                  <span className="ml-2 px-2 py-1 bg-green-100 text-green-700 text-xs rounded-full">Current</span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-sm text-gray-900">
                            <div className="font-medium">
                              {user.blockchainName ? `${user.blockchainName}` : 'BNS: ' + (user.bns || 'N/A')}
                            </div>
                            <div className="text-xs text-gray-500 font-mono">
                              Chain: {user.blockchainId?.slice(0, 12)}...
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-sm">
                            <div className={`font-bold text-lg ${getCreditScoreColor(user.creditScore || 0)}`}>
                              {user.creditScore || 0}
                            </div>
                            <div className="text-xs text-gray-500">
                              {getCreditScoreLabel(user.creditScore || 0)}
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="px-2 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-800">
                            {user.Plan?.name || 'Free'}
                            {user.planSource === 'inherited' && ' (Inherited)'}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                            user.isPrimary 
                              ? 'bg-green-100 text-green-800' 
                              : 'bg-purple-100 text-purple-800'
                          }`}>
                            {user.isPrimary ? 'Primary' : isCurrentUserCrossChain ? 'Cross-Chain' : 'Sub-Wallet'}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-sm text-gray-900">{formatDate(user.createdAt)}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="text-center py-12">
                  <div className="text-gray-500">
                    <Wallet className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                    <p className="text-lg font-medium">
                      {isCurrentUserCrossChain ? 'You have 1 cross-chain identity' : 'No wallet data found'}
                    </p>
                    <p className="text-sm text-gray-400 mt-2">
                      {isCurrentUserCrossChain 
                        ? 'This is your current cross-chain identity. Additional identities will appear here when created.'
                        : 'Your wallet data will appear here once available'
                      }
                    </p>
                    <button
                      onClick={handleRefresh}
                      className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                      disabled={loadingState.refreshing}
                    >
                      {loadingState.refreshing ? 'Refreshing...' : 'Refresh Data'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
};

export default UsersPage;
