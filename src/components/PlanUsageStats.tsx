// src/components/PlanUsageStats.tsx
import React from 'react';
import { Activity, AlertTriangle, CheckCircle, Clock } from 'lucide-react';

interface PlanUsageStatsProps {
  used: number;
  limit: number;
  isAtLimit?: boolean;
  usagePercentage?: number;
  resetDate?: string;
}

const PlanUsageStats: React.FC<PlanUsageStatsProps> = ({ 
  used, 
  limit, 
  isAtLimit = false,
  usagePercentage = 0,
  resetDate 
}) => {

   const calculatedPercentage = limit > 0 ? (used / limit) * 100 : 0;
  
  
  // ✅ Ensure percentage doesn't exceed 100%
  const displayPercentage = Math.min(usagePercentage, 100);
  const getStatusColor = () => {
    if (isAtLimit) return 'text-red-600';
    if (usagePercentage >= 80) return 'text-yellow-600';
    return 'text-green-600';
  };

  const getStatusIcon = () => {
    if (isAtLimit) return <AlertTriangle className="w-5 h-5 text-red-500" />;
    if (usagePercentage >= 80) return <Clock className="w-5 h-5 text-yellow-500" />;
    return <CheckCircle className="w-5 h-5 text-green-500" />;
  };

  const getProgressBarColor = () => {
    if (isAtLimit) return 'bg-red-500';
    if (usagePercentage >= 80) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  return (
    <div className="bg-white rounded-xl shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 flex items-center">
          <Activity className="w-5 h-5 mr-2 text-indigo-600" />
          Query Usage
        </h3>
        {getStatusIcon()}
      </div>

      <div className="space-y-4">
        {/* Usage Display */}
        <div>
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm text-gray-600">Usage</span>
            <span className={`text-sm font-medium ${getStatusColor()}`}>
              {used.toLocaleString()} / {limit.toLocaleString()}
            </span>
          </div>
          
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div 
              className={`h-2 rounded-full transition-all duration-300 ${getProgressBarColor()}`}
              style={{ width: `${Math.min(usagePercentage, 100)}%` }}
            ></div>
          </div>
        </div>

        {/* Status Message */}
        <div className={`text-xs ${getStatusColor()}`}>
          {isAtLimit ? (
            <div className="flex items-center">
              <AlertTriangle className="w-3 h-3 mr-1" />
              Limit reached - upgrade to continue
            </div>
          ) : usagePercentage >= 80 ? (
            <div className="flex items-center">
              <Clock className="w-3 h-3 mr-1" />
              {(100 - usagePercentage).toFixed(1)}% remaining
            </div>
          ) : (
            <div className="flex items-center">
              <CheckCircle className="w-3 h-3 mr-1" />
              {usagePercentage.toFixed(1)}% used
            </div>
          )}
        </div>

        {/* Reset Date */}
        {resetDate && (
          <div className="text-xs text-gray-500">
            Resets on {new Date(resetDate).toLocaleDateString()}
          </div>
        )}

        {/* Upgrade suggestion for at-limit users */}
        {isAtLimit && (
          <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-xs text-red-700">
              Upgrade your plan to get more queries and continue using all features.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default PlanUsageStats;
