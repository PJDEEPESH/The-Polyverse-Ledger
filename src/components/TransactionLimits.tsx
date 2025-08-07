// src/components/TransactionLimits.tsx
import React from 'react';
import { DollarSign, TrendingUp, AlertTriangle, CheckCircle } from 'lucide-react';

interface TransactionLimitsProps {
  walletAddress: string;
  blockchainId: string;
  // ✅ Accept transaction limits data from parent component
  transactionLimits?: {
    used: number;
    limit: number | null;
    currency: string;
    percentage: number;
    transactionCount?: number;
    resetDate?: string;
    planName?: string;
  };
  isLoading?: boolean;
  isCurrentPlan?: boolean;
  currentPlanName?: string; // ✅ Add this prop (though the type should probably be string, not boolean)
}

const TransactionLimits: React.FC<TransactionLimitsProps> = ({ 
  walletAddress, 
  blockchainId,
  transactionLimits,
  isLoading = false,
  currentPlanName = 'Free'
}) => {
  // ✅ Use passed data with fallbacks
  const limits = transactionLimits || {
    used: 0,
    limit: null,
    currency: 'USD',
    percentage: 0,
    planName: currentPlanName
  };
   const displayPlanName = limits.planName || currentPlanName || 'Free';
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: limits.currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const getStatusColor = (percentage: number) => {
    if (percentage >= 90) return 'text-red-600';
    if (percentage >= 70) return 'text-yellow-600';
    return 'text-green-600';
  };

  const getStatusIcon = (percentage: number) => {
    if (percentage >= 90) return <AlertTriangle className="w-5 h-5 text-red-500" />;
    if (percentage >= 70) return <TrendingUp className="w-5 h-5 text-yellow-500" />;
    return <CheckCircle className="w-5 h-5 text-green-500" />;
  };

  const isUnlimited = limits.limit === null;
  const remaining = limits.limit ? limits.limit - limits.used : 0;

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl shadow-sm p-6">
        <div className="animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-3/4 mb-4"></div>
          <div className="space-y-2">
            <div className="h-3 bg-gray-200 rounded"></div>
            <div className="h-3 bg-gray-200 rounded w-5/6"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 flex items-center">
          <DollarSign className="w-5 h-5 mr-2 text-indigo-600" />
          Transaction Limits
        </h3>
        {getStatusIcon(limits.percentage)}
      </div>

      <div className="space-y-4">
        {/* Plan Information */}
        <div className="flex items-center justify-between">
          <span className="text-gray-600">Plan:</span>
          <span className="font-medium text-gray-900">
           {displayPlanName}
          </span>
        </div>

        {/* Usage Display */}
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
                {formatCurrency(limits.limit || 0)}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-gray-600">Used This Month:</span>
              <span className="font-medium text-gray-900">
                {formatCurrency(limits.used)}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-gray-600">Remaining:</span>
              <span className="font-medium text-gray-900">
                {formatCurrency(remaining)}
              </span>
            </div>

            {/* Progress Bar */}
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-600">Usage</span>
                <span className="text-sm text-gray-600">{limits.percentage.toFixed(1)}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all duration-300 ${
                    limits.percentage >= 90 ? 'bg-red-500' : 
                    limits.percentage >= 70 ? 'bg-yellow-500' : 'bg-green-500'
                  }`}
                  style={{ width: `${Math.min(limits.percentage, 100)}%` }}
                ></div>
              </div>
            </div>

            {/* Warning */}
            {limits.percentage >= 80 && (
              <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <div className="flex items-center">
                  <AlertTriangle className="w-4 h-4 text-yellow-600 mr-2" />
                  <span className="text-yellow-800 text-sm">
                    You've used {limits.percentage.toFixed(1)}% of your monthly transaction limit
                  </span>
                </div>
              </div>
            )}
          </>
        )}

        {/* Additional Statistics */}
        {limits.transactionCount && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600">Transactions This Month:</span>
            <span className="font-medium">{limits.transactionCount}</span>
          </div>
        )}

        {/* Reset Date */}
        {limits.resetDate && (
          <div className="text-xs text-gray-500 mt-2">
            Limits reset on {new Date(limits.resetDate).toLocaleDateString()}
          </div>
        )}
      </div>
    </div>
  );
};

export default TransactionLimits;
