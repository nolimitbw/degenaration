"use client";
import { useEffect, useState } from "react";

type PlatformConfig = { platformFeeBps: number; feeLabel: string; feeWalletConfigured: boolean };

export default function FeeStatus({ variant = "hero" }: { variant?: "hero" | "stat" }) {
  const [config, setConfig] = useState<PlatformConfig | null>(null);

  useEffect(() => {
    fetch("/api/platform/config", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => setConfig(data))
      .catch(() => setConfig({ platformFeeBps: 0, feeLabel: "Check preview", feeWalletConfigured: false }));
  }, []);

  const feeLabel = config?.feeLabel ?? "Checking";
  const label = config?.feeWalletConfigured ? "Execution fee" : "Fees off";
  const helper = config?.feeWalletConfigured ? "Shown before signing" : "Until fee wallet is set";

  if (variant === "stat") {
    return (
      <>
        <p className="text-xl font-bold text-grape md:text-2xl">{feeLabel}</p>
        <p className="mt-2 text-sm text-haze">{config ? label : "Fee status"}</p>
      </>
    );
  }

  return (
    <div>
      <dt>Fees</dt>
      <dd title={helper}>{feeLabel}</dd>
    </div>
  );
}
