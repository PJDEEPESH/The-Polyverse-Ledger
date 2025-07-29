import "@rainbow-me/rainbowkit/styles.css";
import { getDefaultWallets, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { WagmiProvider, createConfig, http } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { supportedChains } from "../chains/customChains";

const transports = Object.fromEntries(
  supportedChains.map((chain) => [
    chain.id,
    http(chain.rpcUrls.default.http[0])
  ])
);

const { connectors } = getDefaultWallets({
  appName: "MythosNet",
  projectId: "YOUR_PROJECT_ID", // Replace with your actual WalletConnect ID
});

const config = createConfig({
  connectors,
  chains: supportedChains,
  transports,
  ssr: true,
});

const queryClient = new QueryClient();

export function WalletProvider({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
