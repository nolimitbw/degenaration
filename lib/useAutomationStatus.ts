"use client";

import { useEffect, useState } from "react";

type AutomationStatus = {
  loading: boolean;
  configured: boolean;
  live: boolean;
  copyLive: boolean;
  mode: string;
  network: string | null;
};

const initial: AutomationStatus = {
  loading: true,
  configured: false,
  live: false,
  copyLive: false,
  mode: "checking",
  network: null
};

export function useAutomationStatus() {
  const [status, setStatus] = useState(initial);
  useEffect(() => {
    let active = true;
    fetch("/api/platform/config", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (!active) return;
        const automation = data?.automation || {};
        setStatus({
          loading: false,
          configured: automation.configured === true,
          live: automation.live === true,
          copyLive: automation.copyLive === true,
          mode: typeof automation.mode === "string" ? automation.mode : "unavailable",
          network: typeof automation.network === "string" ? automation.network : null
        });
      })
      .catch(() => active && setStatus({ ...initial, loading: false, mode: "unreachable" }));
    return () => { active = false; };
  }, []);
  return status;
}

export function automationLabel(status: AutomationStatus) {
  if (status.loading) return "Checking engine";
  if (status.live) return "Automation live";
  if (!status.configured) return "Automation not configured";
  return status.mode === "watch-only" ? "Automation watch-only" : "Automation unavailable";
}
