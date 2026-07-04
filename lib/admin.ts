"use client";
import { useEffect, useState } from "react";

// Owner-only admin gate. The Admin + Commissions surfaces are hidden for everyone
// and only unlock on a device that has been explicitly unlocked once. This hides the
// UI; the real fund safety lives server-side (see app/api/withdraw): a withdrawal can
// only ever be built FROM the owner fee wallet and must be signed by that wallet.
const STORAGE_KEY = "degen_admin";

// Unlock secret. OVERRIDE in production via NEXT_PUBLIC_ADMIN_KEY so it is not the
// shared default. Unlock this MacBook once by opening any page with ?admin=<key>.
const ADMIN_KEY = process.env.NEXT_PUBLIC_ADMIN_KEY || "dgn-owner-unlock-2f9ax7q";

export function useIsAdmin() {
  const [admin, setAdmin] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const k = params.get("admin");
      if (k !== null) {
        if (k === ADMIN_KEY) localStorage.setItem(STORAGE_KEY, ADMIN_KEY);
        // Strip the key from the URL so it is never left visible or shareable.
        params.delete("admin");
        const qs = params.toString();
        window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
      }
      setAdmin(localStorage.getItem(STORAGE_KEY) === ADMIN_KEY);
    } catch {
      // ignore (SSR / storage disabled)
    }
    setReady(true);
  }, []);

  return { admin, ready };
}

// Remove admin access from this device.
export function lockAdmin() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

// The unlock token stored on this device — sent as `x-admin-key` to owner-only APIs.
export function getAdminKey(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || "";
  } catch {
    return "";
  }
}
