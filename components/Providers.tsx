"use client";
import { useEffect, useState } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";

const rpcUrl = process.env.NEXT_PUBLIC_MAINNET_RPC || "https://solana-rpc.publicnode.com";
const rpcSubscriptionsUrl = process.env.NEXT_PUBLIC_MAINNET_WS || rpcUrl.replace(/^http/, "ws");

function usePrefersDark() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setDark(mq.matches);
    const listener = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener("change", listener);
    return () => mq.removeEventListener("change", listener);
  }, []);
  return dark;
}

export default function Providers({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const dark = usePrefersDark();
  if (!appId) return <>{children}</>;
  return (
    <PrivyProvider
      appId={appId}
      config={{
        appearance: { theme: dark ? "dark" : "light", accentColor: "#ff2255" },
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
