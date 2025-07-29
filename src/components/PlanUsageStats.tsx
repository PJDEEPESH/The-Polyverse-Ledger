import React from 'react';

export interface PlanUsageStatsProps {
  used: number;
  limit: number;
}

const PlanUsageStats: React.FC<PlanUsageStatsProps> = ({ used, limit }) => {
  // Add safety checks
  const safeUsed = used || 0;
  const safeLimit = limit || 0;
  const queriesRemaining = Math.max(safeLimit - safeUsed, 0);
  const percentUsed = safeLimit > 0 ? (safeUsed / safeLimit) * 100 : 0;

  console.log('PlanUsageStats props:', { used, limit, safeUsed, safeLimit }); // Debug log

  return (
    <div className="bg-white rounded-xl shadow p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Queries Usage</h2>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-gray-600">Used:</span>
          <span className="font-bold text-gray-900">{safeUsed.toLocaleString()}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-600">Remaining:</span>
          <span className="font-bold text-gray-900">{queriesRemaining.toLocaleString()}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-600">Limit:</span>
          <span className="font-bold text-gray-900">{safeLimit.toLocaleString()}</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-indigo-600 h-2 rounded-full"
            style={{ width: `${Math.min(percentUsed, 100)}%` }}
          />
        </div>
        <p className="text-xs text-gray-500 text-center">{Math.round(percentUsed)}% used</p>
      </div>
    </div>
  );
};


export default PlanUsageStats;