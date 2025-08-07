import React, { useEffect, useState, useRef } from 'react';
import { ethers } from 'ethers';

interface QueryUsage {
  used: number;
  limit: number;
  remaining?: number;
  trialDaysRemaining?: number;
  trialActive?: boolean;
  period?: {
    month: number;
    year: number;
  };
  plan?: {
    name: string;
    limit: number;
  };
}

interface CreditScoreData {
  creditScore: number;
  source: 'primary' | 'crosschain';
  userId: string;
  crossChainIdentityId?: string;
  walletAddress: string;
  blockchainId: string;
}

const CreditScoreViewer = () => {
  const [creditScoreData, setCreditScoreData] = useState<CreditScoreData | null>(null);
  const [wallet, setWallet] = useState<string | null>(null);
  const [blockchainId, setBlockchainId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [queryUsage, setQueryUsage] = useState<QueryUsage | null>(null);
  const [lastFetchTime, setLastFetchTime] = useState<number>(0);
  const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

  const isFetchingRef = useRef(false);

  const fetchScore = async () => {
    // ✅ Check cache first
    const now = Date.now();
    if (now - lastFetchTime < CACHE_DURATION && creditScoreData !== null) {
      setLoading(false);
      return;
    }

    if (isFetchingRef.current) return;
    isFetchingRef.current = true;

    try {
      setLoading(true);
      setError(null);
      setErrorCode(null);

      if (!window.ethereum) {
        setError("Please install MetaMask!");
        return;
      }

      const provider = new ethers.BrowserProvider(window.ethereum);
      const accounts = await provider.send("eth_accounts", []);
      if (accounts.length === 0) {
        await provider.send("eth_requestAccounts", []);
      }

      const signer = await provider.getSigner();
      const userAddress = await signer.getAddress();
      setWallet(userAddress);

      const network = await provider.getNetwork();
      const chainId = network.chainId.toString();
      setBlockchainId(chainId);

      // Store wallet info in localStorage for consistency
      window.localStorage.setItem('walletAddress', userAddress);
      window.localStorage.setItem('blockchainId', chainId);

      // ✅ FIXED: Use the correct wallet-based credit score endpoint
      const creditResponse = await fetch(`http://localhost:3000/api/v1/credit-score/wallet/${userAddress}/${chainId}`);

      if (!creditResponse.ok) {
        let errorData;
        try {
          errorData = await creditResponse.json();
        } catch (parseError) {

          errorData = { error: `HTTP ${creditResponse.status}: ${creditResponse.statusText}` };
        }
        
        if (creditResponse.status === 404) {
          setCreditScoreData(null);
          setError("Wallet not registered. Please register first to get a credit score.");
          setErrorCode('WALLET_NOT_REGISTERED');
          return;
        }
        
        if (creditResponse.status === 403) {
          setCreditScoreData(null);
          if (errorData.code === "TRIAL_EXPIRED") {
            setError("Your free trial has expired. Please upgrade your plan to continue accessing your credit score.");
            setErrorCode("TRIAL_EXPIRED");
          } else if (errorData.code === "QUERY_LIMIT_EXCEEDED") {
            setError("You've reached your monthly query limit. Please upgrade your plan.");
            setErrorCode("QUERY_LIMIT_EXCEEDED");
          } else {
            setError(errorData.error || "Access denied");
          }
          return;
        }
        
        if (creditResponse.status === 429) {
          setCreditScoreData(null);
          if (errorData.code === "TRIAL_LIMIT_EXCEEDED" || errorData.code === "QUERY_LIMIT_EXCEEDED") {
            setError("You've reached your query limit (100/100). Please upgrade your plan to continue.");
            setErrorCode("QUERY_LIMIT_EXCEEDED");
          } else {
            setError("Too many requests. Please try again later.");
          }
          return;
        }

        throw new Error(`Failed to fetch credit score: ${creditResponse.status} - ${errorData.error || creditResponse.statusText}`);
      }

      // Only read JSON if response is ok
      const creditData = await creditResponse.json();

      if (creditData.success && creditData.creditScore !== undefined) {
        setCreditScoreData({
          creditScore: creditData.creditScore,
          source: creditData.source, // 'primary' or 'crosschain'
          userId: creditData.userId,
          crossChainIdentityId: creditData.crossChainIdentityId,
          walletAddress: creditData.walletAddress,
          blockchainId: creditData.blockchainId
        });
      } else {
        setCreditScoreData(null);
        setError("Invalid credit score data received");
      }

      // Fetch query usage data (if user is registered)
      if (creditData.success) {
        try {
          const usageResponse = await fetch(`http://localhost:3000/api/v1/query/usage/${userAddress}/${chainId}`);

          if (usageResponse.ok) {
            const usageData = await usageResponse.json();
            
            if (usageData.success && usageData.data) {
              setQueryUsage({
                used: usageData.data.queriesUsed || 0,        
                limit: usageData.data.queriesLimit || 0,      
                remaining: usageData.data.queriesRemaining || 0,
                trialDaysRemaining: usageData.data.trialDaysRemaining,
                trialActive: usageData.data.trialActive,
                period: usageData.data.period,
                plan: {
                  name: usageData.data.plan || 'Free',        
                  limit: usageData.data.queriesLimit || 0
                }
              });
            }
          } else {
            const errorData = await usageResponse.json();

          }
        } catch (usageError) {

        }
      }

      // ✅ Update cache timestamp after successful fetch
      setLastFetchTime(now);

    } catch (err: any) {

      setCreditScoreData(null);
      setError(err.message || "Failed to load credit score");
      setQueryUsage(null);
    } finally {
      setLoading(false);
      isFetchingRef.current = false;
    }
  };

  // ✅ Add manual refresh function that bypasses cache
  const refreshScore = async () => {
    setLastFetchTime(0); // Reset cache
    await fetchScore();
  };

  useEffect(() => {
    fetchScore();
  }, []);

  const getUsagePercentage = () => {
    if (!queryUsage || queryUsage.limit === 0) return 0;
    return Math.round((queryUsage.used / queryUsage.limit) * 100);
  };

  // ✅ Helper function to check if data is cached
  const isCacheValid = () => {
    return (Date.now() - lastFetchTime) < CACHE_DURATION && creditScoreData !== null;
  };

  // ✅ Helper function to get cache remaining time
  const getCacheRemainingTime = () => {
    if (!isCacheValid()) return 0;
    return Math.ceil((CACHE_DURATION - (Date.now() - lastFetchTime)) / 1000);
  };

  // ✅ Helper function to get wallet type display
  const getWalletTypeDisplay = () => {
    if (!creditScoreData) return '';
    return creditScoreData.source === 'primary' ? '🏛️ Primary Wallet' : '🔗 Cross-Chain Wallet';
  };

  return (
    <div className="p-6 border rounded-lg shadow-md bg-white max-w-lg mx-auto mt-10">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold">Your Web3 Credit Score</h2>
        
        {/* ✅ Cache Status & Refresh Button */}
        <div className="flex items-center space-x-2">
          <button
            onClick={refreshScore}
            className="text-xs px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded-full transition-colors disabled:opacity-50"
            disabled={loading}
            title="Refresh data (will consume a query)"
          >
            {loading ? '⟳' : '↻'}
          </button>
        </div>
      </div>

      {wallet && (
        <div className="mb-4">
          <p className="text-sm text-gray-600">
            <strong>Wallet:</strong>
            <span className="font-mono text-xs ml-2 break-all">{wallet}</span>
          </p>
          {blockchainId && (
            <p className="text-sm text-gray-600 mt-1">
              <strong>Chain ID:</strong>
              <span className="font-mono text-xs ml-2">{blockchainId}</span>
            </p>
          )}
          {/* ✅ NEW: Show wallet type */}
          {creditScoreData && (
            <p className="text-sm text-gray-600 mt-1">
              <strong>Type:</strong>
              <span className="ml-2">{getWalletTypeDisplay()}</span>
            </p>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex items-center space-x-2">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
          <p>Loading credit score...</p>
        </div>
      ) : error ? (
        <>
          <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
            <p className="text-yellow-800">⚠️ {error}</p>
            {errorCode === 'WALLET_NOT_REGISTERED' && (
              <p className="text-sm text-yellow-600 mt-2">
                This wallet is not registered in the system. Please register it first to get your credit score.
              </p>
            )}
          </div>

          {errorCode === "TRIAL_EXPIRED" && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-800 font-semibold">🚫 Trial Expired</p>
              <p className="text-red-700 text-sm mt-1">
                Your free trial has ended. Upgrade to a paid plan to continue accessing credit score features.
              </p>
              <a
                href="/users"
                className="inline-block mt-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
              >
                Upgrade Plan
              </a>
            </div>
          )}

          {errorCode === "QUERY_LIMIT_EXCEEDED" && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-800 font-semibold">🚫 Query Limit Exceeded</p>
              <p className="text-red-700 text-sm mt-1">
                You've reached your monthly limit. Upgrade your plan to continue accessing your credit score.
              </p>
              <a
                href="/users"
                className="inline-block mt-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
              >
                Upgrade Plan
              </a>
            </div>
          )}

          {errorCode === 'WALLET_NOT_REGISTERED' && (
            <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-blue-800 font-semibold">📝 Registration Required</p>
              <p className="text-blue-700 text-sm mt-1">
                Register your wallet to start building your Web3 credit score.
              </p>
              <a
                href="/user-registry"
                className="inline-block mt-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
              >
                Register Wallet
              </a>
            </div>
          )}
        </>
      ) : creditScoreData ? (
        <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-green-800">
            <strong>Credit Score:</strong>
            <span className="text-2xl font-bold ml-2">{creditScoreData.creditScore}</span>
            <span className="text-sm text-green-600 ml-2">/ 1000</span>
          </p>
          {/* ✅ NEW: Show additional CrossChain info */}
          {creditScoreData.source === 'crosschain' && creditScoreData.crossChainIdentityId && (
            <p className="text-xs text-green-600 mt-2">
              CrossChain Identity ID: {creditScoreData.crossChainIdentityId.slice(0, 8)}...
            </p>
          )}
        </div>
      ) : (
        <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
          <p className="text-gray-800">No credit score available</p>
        </div>
      )}

      {/* ✅ Show query usage for registered users */}
      {queryUsage && (
        <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-blue-800 text-sm font-semibold">Query Usage</p>
          <div className="flex justify-between items-center mt-1">
            <span className="text-sm text-blue-700">
              {queryUsage.used} / {queryUsage.limit} queries used
            </span>
            <span className="text-xs text-blue-600">
              ({getUsagePercentage()}%)
            </span>
          </div>
          {queryUsage.plan && (
            <p className="text-xs text-blue-600 mt-1">
              Plan: {queryUsage.plan.name}
            </p>
          )}
        </div>
      )}

      {error && !creditScoreData && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-800">❌ Failed to fetch credit score</p>
          <div className="flex space-x-2 mt-2">
            <button
              onClick={refreshScore}
              className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors disabled:opacity-50"
              disabled={loading}
            >
              {loading ? 'Retrying...' : 'Retry'}
            </button>
            {!isCacheValid() && (
              <p className="text-xs text-red-600 self-center">
                Note: This will consume a query from your limit
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default CreditScoreViewer;
