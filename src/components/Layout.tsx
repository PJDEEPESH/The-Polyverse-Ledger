import '../styles/globals.css';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';

const Layout = ({ children }: { children: React.ReactNode }) => {
  useEffect(() => {
    if (!document.getElementById("paypal-sdk")) {
      const script = document.createElement("script");
      script.src = "https://www.paypal.com/sdk/js?client-id=AVI8931riEwagyhfrXKvtS2lDc82_HliaiU__ySr8aL-2D0jCa2GAHaABg-6ox5nveBLHNZmtdtG4KMB&vault=true&intent=subscription";
      script.id = "paypal-sdk";
      script.async = true;
      document.body.appendChild(script);
    }
  }, []);

  return (
    <div>
      <nav style={{ padding: '1rem', background: '#f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <Link to="/invoices" style={{ marginRight: '1rem' }}>Invoices</Link>
          <Link to="/users" style={{ marginRight: '1rem' }}>Users</Link>
          <Link to="/blockchains">Blockchains</Link>
        </div>
        <ConnectButton />
      </nav>
      <main style={{ padding: '1rem' }}>
        {children}
      </main>
    </div>
  );
};

export default Layout;
