// Updated Dashboard.tsx with recent activity
import React, { useState, useEffect } from 'react';
import CreditScoreViewer from '../components/CreditScoreViewer';
import { BarChart3, Users, FileText, Network } from 'lucide-react';


const Dashboard = () => {
  const [stats, setStats] = useState({
    totalUsers: 0,
    totalInvoices: 0,
    totalBlockchains: 0,
    averageScore: 0
  });
  const [userInfo, setUserInfo] = useState<any>(null);
  const [recentActivity, setRecentActivity] = useState([]);


  useEffect(() => {
    const fetchStats = async () => {
      try {
        const response = await fetch('http://localhost:3000/api/v1/dashboard/stats');
        const data = await response.json();
        setStats(data);
      } catch (error) {
        
      }
    };


    const fetchActivity = async () => {
      try {
        const response = await fetch('http://localhost:3000/api/v1/dashboard/activity');
        const data = await response.json();
        setRecentActivity(data);
      } catch (error) {
       
      }
    };


    const fetchUserInfo = async () => {
    try {
      const walletAddress = window.localStorage.getItem('walletAddress');
      const chainId = window.localStorage.getItem('blockchainId'); // ✅ ADDED: Get chainId from localStorage
      if (!walletAddress) return;


      const res = await fetch(`http://localhost:3000/api/v1/user/wallet/${walletAddress}/${chainId}`);
      const json = await res.json();
      if (json.success) {
        setUserInfo(json.data);
      }
    } catch (error) {
      
    }
  };
    fetchStats();
    fetchActivity();
     fetchUserInfo();
  }, []);


  const cards = [
    { title: 'Total Users', value: stats.totalUsers, icon: Users, color: 'bg-blue-500' },
    { title: 'Total Invoices', value: stats.totalInvoices, icon: FileText, color: 'bg-green-500' },
    { title: 'Connected Blockchains', value: stats.totalBlockchains, icon: Network, color: 'bg-purple-500' },
    { title: 'Average Credit Score', value: stats.averageScore, icon: BarChart3, color: 'bg-yellow-500' }
  ];


  const formatTimeAgo = (timestamp: string) => {
    const now = new Date();
    const time = new Date(timestamp);
    const diffMs = now.getTime() - time.getTime();
    const diffMin = Math.floor(diffMs / 60000);


    if (diffMin < 1) return 'Just now';
    if (diffMin === 1) return '1 minute ago';
    return `${diffMin} minutes ago`;
  };


  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard Overview</h1>
        <p className="text-gray-500">Monitor your blockchain credit system</p>
        <CreditScoreViewer />
        {userInfo && (
  <div className="mt-2 text-sm text-gray-600">
    <p>
      <strong>Your Plan:</strong> {userInfo.Plan?.name || 'Free'}
    </p>
    {userInfo.Plan?.name === 'Free' && userInfo.trialStartDate && (
  <p>
    Trial expires in{" "}
    {Math.max(
      5 - Math.floor((Date.now() - new Date(userInfo.trialStartDate).getTime()) / (1000 * 60 * 60 * 24)),
      0
    )}{" "}
    days
  </p>
)}


  </div>
)}


      </div>


      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {cards.map(({ title, value, icon: Icon, color }) => (
          <div key={title} className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <div className={`${color} p-3 rounded-lg`}>
                <Icon className="w-6 h-6 text-white" />
              </div>
            </div>
            <h3 className="text-gray-500 text-sm font-medium">{title}</h3>
            <p className="text-3xl font-bold text-gray-900 mt-1">{(value ?? 0).toLocaleString()}</p>
          </div>
        ))}
      </div>


      <div className="mt-8 bg-white rounded-xl shadow-sm p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Activity</h2>
        <div className="space-y-4">
          {recentActivity.length === 0 ? (
            <p className="text-gray-500">No recent activity found.</p>
          ) : (
            recentActivity.map((activity: any, index) => {
              const Icon =
                activity.type === 'user' ? Users :
                activity.type === 'invoice' ? FileText :
                activity.type === 'blockchain' ? Network :
                Users;


              return (
                <div key={index} className="flex items-center justify-between py-3 border-b border-gray-100">
                  <div className="flex items-center">
                    <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center">
                      <Icon className="w-5 h-5 text-gray-500" />
                    </div>
                    <div className="ml-4">
                      <p className="text-sm font-medium text-gray-900">{activity.description}</p>
                      <p className="text-sm text-gray-500">{activity.details}</p>
                    </div>
                  </div>
                  <span className="text-sm text-gray-500">
                    {formatTimeAgo(activity.timestamp)}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};


export default Dashboard;
