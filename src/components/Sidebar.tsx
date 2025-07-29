import React from 'react';
import { Link } from 'react-router-dom';

export default function Sidebar() {
  return (
    <div className="w-64 bg-white border-r h-screen p-4">
      <h2 className="text-xl font-bold mb-6">MythosNet</h2>
      <nav className="space-y-4">
        <Link to="/" className="block text-gray-700 hover:text-indigo-600">Dashboard</Link>
        <Link to="/blockchains" className="block text-gray-700 hover:text-indigo-600">Blockchains</Link>
        <Link to="/users" className="block text-gray-700 hover:text-indigo-600">Users</Link>
        <Link to="/invoices" className="block text-gray-700 hover:text-indigo-600">Invoices</Link>
        <Link to="/user-registry" className="block text-gray-700 hover:text-indigo-600">User-Registry</Link>
      </nav>
    </div>
  );
}
