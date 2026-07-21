"use client";
import { PrivyProvider } from "@privy-io/react-auth";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";

const rpcUrl = process.env.NEXT_PUBLIC_MAINNET_RPC || "https://solana-rpc.publicnode.com";
const rpcSubscriptionsUrl = process.env.NEXT_PUBLIC_MAINNET_WS || rpcUrl.replace(/^http/, "ws");

export default function Providers({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  if (!appId) return <>{children}</>;
  return (
    <PrivyProvider
      appId={appId}
      config={{
        appearance: { theme: "dark", accentColor: "#c29463" },
        embeddedWallets: { solana: { createOnLogin: "users-without-wallets" } },
        loginMethods: ["email", "google", "wallet"],
        solana: {
          rpcs: {
            "solana:mainnet": {
              rpc: createSolanaRpc(rpcUrl),
              rpcSubscriptions: createSolanaRpcSubscriptions(rpcSubscriptionsUrl)
            }
          }
        }
      }}
    >
      {children}
    </PrivyProvider>
  );
}
