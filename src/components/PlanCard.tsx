import React from 'react';

export interface PlanInfo {
  name: string;
  queries: number;
  duration?: string;   
  users?: number;
  features: string[];
}

export interface PlanCardProps {
  planInfo: PlanInfo;
  trialActive: boolean;
  trialDaysRemaining: number;
  subscriptionEndDate?: string;
  isCurrentPlan: boolean;
}

const PlanCard: React.FC<PlanCardProps> = ({
  planInfo,
  trialActive,
  trialDaysRemaining,
  subscriptionEndDate,
  isCurrentPlan
}) => {
  // helper to format an ISO date
  const fmt = (iso?: string) => iso ? new Date(iso).toLocaleDateString() : '';

  return (
    <div className="bg-white rounded-xl shadow p-6 relative">
      {/* Current plan badge */}
      {isCurrentPlan && !trialActive && subscriptionEndDate && new Date(subscriptionEndDate) > new Date() && (
        <div className="absolute top-2 right-2 bg-green-100 text-green-800 px-2 py-1 text-xs rounded">
          Current plan
        </div>
      )}

      <h2 className="text-lg font-semibold mb-4">Your Plan</h2>

      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-600">Plan</span>
          <span className="font-medium">{planInfo.name}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600">Users</span>
          <span className="font-medium">{planInfo.users}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600">Queries</span>
          <span className="font-medium">{planInfo.queries.toLocaleString()}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600">Billing Cycle</span>
          <span className="font-medium">{planInfo.duration}</span>
        </div>
      </div>

      {/* Feature list */}
      <ul className="mt-4 space-y-1 text-sm text-gray-700">
        {planInfo.features.map((f, i) => (
          <li key={i} className="flex items-center">
            <span className="w-1.5 h-1.5 bg-gray-500 rounded-full mr-2" />
            {f}
          </li>
        ))}
      </ul>

      {/* Trial banner */}
      {trialActive && (
        <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-800 text-sm">
          Free trial: {trialDaysRemaining} day{trialDaysRemaining === 1 ? '' : 's'} remaining
        </div>
      )}

      {/* Subscription expiry */}
      {!trialActive && subscriptionEndDate && new Date(subscriptionEndDate) < new Date() && (
        <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-800 text-sm">
          Your subscription expired on {fmt(subscriptionEndDate)}.
        </div>
      )}

      {!trialActive && subscriptionEndDate && new Date(subscriptionEndDate) > new Date() && (
        <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm">
          Active until {fmt(subscriptionEndDate)}
        </div>
      )}
    </div>
  );
};

export default PlanCard;
