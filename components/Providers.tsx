"use client";
import { useEffect, useState } from "react";
import { PrivyProvider } from "@privy-io/react-auth";

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
        appearance: { theme: dark ? "dark" : "light", accentColor: "#a3ff12" },
        embeddedWallets: { solana: { createOnLogin: "users-without-wallets" } },
        loginMethods: ["email", "google", "wallet"]
      }}
    >
      {children}
    </PrivyProvider>
  );
}
