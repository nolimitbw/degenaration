"use client";
import { PrivyProvider } from "@privy-io/react-auth";

export default function Providers({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  if (!appId) return <>{children}</>;
  return (
    <PrivyProvider
      appId={appId}
      config={{
        appearance: { theme: "light", accentColor: "#22e07a" },
        embeddedWallets: { createOnLogin: "users-without-wallets" },
        loginMethods: ["email", "google", "wallet"]
      }}
    >
      {children}
    </PrivyProvider>
  );
}
