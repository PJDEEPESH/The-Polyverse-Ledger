// src/pages/blockchain.tsx
import React, { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { Network, Plus } from 'lucide-react';

// Match the actual backend response structure
type Blockchain = {
  id: string;
  name: string;
  ubid: string;
  bnsName?: string | null;
  networkType: string;
  chainProtocol: string;
  createdAt: string;
  updatedAt: string;
};

const BlockchainsPage = () => {
  const [blockchains, setBlockchains] = useState<Blockchain[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [blockchainName, setBlockchainName] = useState('');

  const fetchBlockchains = async () => {
    try {
      const res = await fetch('http://localhost:3000/api/v1/blockchain/list');
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Failed to fetch blockchains: ${res.status}`);
      }
      
      const data = await res.json();

      setBlockchains(data);
    } catch (err: any) {

      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBlockchains();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!blockchainName.trim()) {
      alert('Please enter a blockchain name');
      return;
    }

    try {

      const response = await fetch('http://localhost:3000/api/v1/blockchain/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: blockchainName.trim() }),
      });
      

      
      if (response.ok) {
        const result = await response.json();

        setShowModal(false);
        setBlockchainName('');
        fetchBlockchains(); // Refresh the list
      } else {

      }
    } catch (error) {
      alert('Failed to register blockchain. Please try again.');
    }
  };


  return (
    <Layout>
      <div className="p-8">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Registered Blockchains</h1>
            <p className="text-gray-500">Manage your connected blockchain networks</p>
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center hover:bg-indigo-700"
          >
            <Plus className="w-5 h-5 mr-2" />
            Register New
          </button>
        </div>

        {loading && <p className="text-gray-600">Loading blockchain networks...</p>}
        {error && <p className="text-red-500">Error: {error}</p>}

        {!loading && !error && blockchains.length === 0 && (
          <div className="text-center py-12">
            <Network className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-500 mb-4">No blockchain networks registered yet</p>
            <button
              onClick={() => setShowModal(true)}
              className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700"
            >
              Register your first blockchain
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {blockchains.map((chain) => (
            <div key={chain.id} className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
              <div className="flex items-center mb-4">
                <div className="bg-indigo-100 p-3 rounded-lg">
                  <Network className="w-6 h-6 text-indigo-600" />
                </div>
                <div className="ml-4">
                  <h3 className="text-lg font-semibold text-gray-900">{chain.name}</h3>
                  <p className="text-sm text-gray-500">
                    {chain.networkType} • {chain.chainProtocol}
                  </p>
                </div>
              </div>
              
              {/* Additional details */}
              <div className="mb-4">
                <div className="text-xs text-gray-600 mb-1">
                  <span className="font-medium">UBID:</span>
                </div>
                <div className="text-xs font-mono bg-gray-50 p-2 rounded break-all">
                  {chain.ubid}
                </div>
                {chain.bnsName && (
                  <div className="mt-2">
                    <span className="text-xs font-medium text-gray-600">BNS:</span>
                    <span className="text-xs text-gray-500 ml-1">{chain.bnsName}</span>
                  </div>
                )}
              </div>

              <div className="border-t border-gray-100 pt-4 mt-4">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Status</span>
                  <span className="text-green-600 font-medium">Active</span>
                </div>
                <div className="flex justify-between text-sm mt-2">
                  <span className="text-gray-500">Registered On</span>
                  <span className="font-medium">
                    {chain.createdAt ? new Date(chain.createdAt).toLocaleDateString() : 'N/A'}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {showModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 w-full max-w-md">
              <h2 className="text-xl font-bold mb-4">Register New Blockchain</h2>
              <form onSubmit={handleSubmit}>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Blockchain Name
                  </label>
                  <input
                    type="text"
                    value={blockchainName}
                    onChange={(e) => setBlockchainName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="e.g., Ethereum, Polygon, BSC"
                    required
                    maxLength={100}
                  />
                </div>
                <div className="flex justify-end space-x-4">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                  >
                    Register
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
};

export default BlockchainsPage;
