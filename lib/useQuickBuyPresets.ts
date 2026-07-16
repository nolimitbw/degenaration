"use client";
import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { getMyProfile, saveProfileLimits } from "./queries";

export const DEFAULT_QUICK_BUY_PRESETS = [0.1, 0.5, 1, 2];
const SYNC_EVENT = "degen-quick-buy-presets";

/**
 * Per-user quick-buy SOL presets, shared across trenches/drawer/terminal via `profiles`.
 * Every call site gets its own hook instance (e.g. the trenches page and the TokenDrawer
 * it renders are mounted at the same time), so a save() broadcasts a window event —
 * matching lib/net.ts's degen-net pattern — so all mounted instances stay in sync
 * without a full context/provider.
 */
export function useQuickBuyPresets() {
  const { ready, authenticated, getAccessToken } = usePrivy();
  const [presets, setPresets] = useState<number[]>(DEFAULT_QUICK_BUY_PRESETS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    const profile = authenticated
      ? getAccessToken().then((token) => getMyProfile(token))
      : getMyProfile();
    profile.then((p) => {
      if (!alive) return;
      if (p?.quick_buy_amounts?.length) setPresets(p.quick_buy_amounts);
      setLoaded(true);
    }).catch(() => { if (alive) setLoaded(true); });
    const onSync = (e: any) => setPresets(e.detail);
    window.addEventListener(SYNC_EVENT, onSync);
    return () => { alive = false; window.removeEventListener(SYNC_EVENT, onSync); };
  }, [ready, authenticated, getAccessToken]);

  const save = useCallback(async (next: number[]) => {
    const cleaned = next.filter((n) => Number.isFinite(n) && n > 0);
    if (!cleaned.length) return { error: { message: "Enter at least one amount" } };
    const token = authenticated ? await getAccessToken() : null;
    const { error } = await saveProfileLimits({ quick_buy_amounts: cleaned }, token);
    if (!error) {
      setPresets(cleaned);
      window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: cleaned }));
    }
    return { error };
  }, [authenticated, getAccessToken]);

  return { presets, loaded, save };
}
