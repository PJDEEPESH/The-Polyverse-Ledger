// src/components/TransactionLimits.tsx
import React, { useEffect, useState } from 'react';
import { DollarSign, TrendingUp, AlertTriangle } from 'lucide-react';

interface TransactionLimitsProps {
  walletAddress: string;
  blockchainId: string;
}

interface TransactionLimitsData {
  currentVolume: number;
  limit: number | null;
  remaining: number;
  plan: string;
  planSource: string;
}

const TransactionLimits: React.FC<TransactionLimitsProps> = ({
  walletAddress,
  blockchainId
}) => {
  const [limits, setLimits] = useState<TransactionLimitsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLimits = async () => {
      try {
        const response = await fetch(
          `http://localhost:3000/api/v1/transaction/limits/${walletAddress}/${blockchainId}`
        );
        const data = await response.json();
        
        if (data.success) {
          setLimits(data.data);
        }
      } catch (error) {
        console.error('Failed to fetch transaction limits:', error);
      } finally {
        setLoading(false);
      }
    };

    if (walletAddress && blockchainId) {
      fetchLimits();
    }
  }, [walletAddress, blockchainId]);

  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow p-6">
        <div className="animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-1/4 mb-4"></div>
          <div className="space-y-2">
            <div className="h-3 bg-gray-200 rounded"></div>
            <div className="h-3 bg-gray-200 rounded w-5/6"></div>
          </div>
        </div>
      </div>
    );
  }

  if (!limits) {
    return (
      <div className="bg-white rounded-xl shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Transaction Limits</h2>
        <p className="text-gray-500">Unable to load transaction limits</p>
      </div>
    );
  }

  const usagePercentage = limits.limit ? (limits.currentVolume / limits.limit) * 100 : 0;
  const isNearLimit = usagePercentage > 80;
  const isUnlimited = limits.limit === null;

  return (
    <div className="bg-white rounded-xl shadow p-6">
      <div className="flex items-center mb-4">
        <DollarSign className="w-5 h-5 text-green-600 mr-2" />
        <h2 className="text-lg font-semibold text-gray-900">Transaction Limits</h2>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-gray-600">Plan:</span>
          <span className="font-medium text-gray-900">
            {limits.plan} ({limits.planSource})
          </span>
        </div>

        {isUnlimited ? (
          <div className="flex items-center justify-between">
            <span className="text-gray-600">Monthly Limit:</span>
            <span className="font-medium text-green-600">Unlimited</span>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <span className="text-gray-600">Monthly Limit:</span>
              <span className="font-medium text-gray-900">
                ${limits.limit?.toLocaleString()}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-gray-600">Used This Month:</span>
              <span className="font-medium text-gray-900">
                ${limits.currentVolume.toLocaleString()}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-gray-600">Remaining:</span>
              <span className="font-medium text-gray-900">
                ${limits.remaining.toLocaleString()}
              </span>
            </div>

            {/* Progress Bar */}
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-600">Usage</span>
                <span className="text-sm text-gray-600">{usagePercentage.toFixed(1)}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className={`h-2 rounded-full ${
                    isNearLimit ? 'bg-red-500' : 'bg-green-500'
                  }`}
                  style={{ width: `${Math.min(usagePercentage, 100)}%` }}
                ></div>
              </div>
            </div>

            {/* Warning */}
            {isNearLimit && (
              <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <div className="flex items-center">
                  <AlertTriangle className="w-4 h-4 text-yellow-600 mr-2" />
                  <span className="text-yellow-800 text-sm">
                    You've used {usagePercentage.toFixed(1)}% of your monthly transaction limit
                  </span>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default TransactionLimits;
