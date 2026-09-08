import { PrivyProvider } from "@privy-io/react-auth";
import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { defineChain } from "viem";
import { App } from "./App.tsx";
import "./styles.css";

const arc = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.io"] } },
  blockExplorers: { default: { name: "Arcscan", url: "https://testnet.arcscan.app" } },
  testnet: true,
});
const root = document.getElementById("root");
if (!root) throw new Error("The application root is missing.");
const appId = import.meta.env.VITE_PRIVY_APP_ID;
createRoot(root).render(
  <React.StrictMode>
    {appId ? (
      <PrivyProvider
        appId={appId}
        config={{
          appearance: { theme: "light", accentColor: "#285749", walletChainType: "ethereum-only" },
          loginMethods: ["email", "wallet"],
          embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
          defaultChain: arc,
          supportedChains: [arc],
        }}
      >
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </PrivyProvider>
    ) : (
      <main className="setup">
        <h1>VulnProof setup</h1>
        <p>Set the Privy app ID to enable sign-in.</p>
        <p>No account data is loaded.</p>
      </main>
    )}
  </React.StrictMode>,
);
