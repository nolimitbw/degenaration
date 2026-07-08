"use client";
import { useEffect, useState } from "react";

// Owner-only admin gate. The Admin + Commissions surfaces are hidden and only unlock on a
// device where the operator has entered the admin key once via ?admin=<key>. This client
// flag only controls UI visibility — the REAL gate is server-side: every owner-only API
// validates x-admin-key against the SERVER-ONLY ADMIN_KEY env var (never shipped to the
// client), so a bogus local unlock can read nothing and approve nothing. No admin secret is
// ever baked into the bundle. See app/api/admin/*.
const STORAGE_KEY = "degen_admin";

export function useIsAdmin() {
  const [admin, setAdmin] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const k = params.get("admin");
      if (k !== null) {
        // Store whatever the operator entered on THIS device; the server validates it for real.
        if (k) localStorage.setItem(STORAGE_KEY, k);
        // Strip the key from the URL so it is never left visible or shareable.
        params.delete("admin");
        const qs = params.toString();
        window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
      }
      setAdmin(!!localStorage.getItem(STORAGE_KEY));
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
