import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getInvoiceManagerContract } from "../utils/getInvoiceManagerContract";

interface Invoice {
  id: number;
  issuer: string;
  recipient: string;
  amount: number;
  dueDate: number;
  paid: boolean;
}

const InvoicesView: React.FC = () => {
  const [wallet, setWallet] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(false);

  const loadInvoices = async () => {
    try {
      if (!window.ethereum) {
        alert("Please install MetaMask!");
        return;
      }

      setLoading(true);
      const provider = new ethers.BrowserProvider(window.ethereum);
      await provider.send("eth_requestAccounts", []);
      const signer = await provider.getSigner();
      const userAddress = await signer.getAddress();
      setWallet(userAddress);

      const contract = getInvoiceManagerContract(signer);

      const ids: number[] = await contract.getInvoicesByUser(userAddress);

      const fetchedInvoices = await Promise.all(
        ids.map(async (id: number) => {
          const inv = await contract.invoices(id);
          return {
            id: inv.id,
            issuer: inv.issuer,
            recipient: inv.recipient,
            amount: inv.amount,
            dueDate: Number(inv.dueDate) * 1000,
            paid: inv.paid,
          };
        })
      );

      setInvoices(fetchedInvoices);
    } catch (err) {
    } finally {
      setLoading(false);
    }
  };

  const markPaid = async (id: number) => {
    try {
      if (!window.ethereum) return;
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const contract = getInvoiceManagerContract(signer);

      const tx = await contract.markInvoicePaid(id);
      await tx.wait();
      alert(`✅ Invoice #${id} marked as paid`);
      loadInvoices();
    } catch (err) {
      alert("❌ Failed to mark invoice as paid");
    }
  };

  useEffect(() => {
    loadInvoices();
  }, []);

  return (
    <div className="max-w-4xl mx-auto mt-10 p-6 bg-white rounded-lg shadow">
      <h2 className="text-2xl font-semibold mb-4">📄 Your Invoices</h2>
      {wallet && <p className="mb-4">Connected Wallet: <strong>{wallet}</strong></p>}
      {loading ? (
        <p>Loading invoices...</p>
      ) : invoices.length === 0 ? (
        <p>No invoices found.</p>
      ) : (
        <table className="w-full table-auto border">
          <thead>
            <tr className="bg-gray-100">
              <th className="p-2 text-left">ID</th>
              <th className="p-2 text-left">Amount</th>
              <th className="p-2 text-left">Due Date</th>
              <th className="p-2 text-left">Status</th>
              <th className="p-2 text-left">Action</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <tr key={inv.id} className="border-t">
                <td className="p-2">{inv.id}</td>
                <td className="p-2">${inv.amount}</td>
                <td className="p-2">{new Date(inv.dueDate).toLocaleDateString()}</td>
                <td className="p-2">{inv.paid ? "✅ Paid" : "❌ Unpaid"}</td>
                <td className="p-2">
                  {!inv.paid && (
                    <button
                      className="px-3 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-700"
                      onClick={() => markPaid(inv.id)}
                    >
                      Mark as Paid
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default InvoicesView;
