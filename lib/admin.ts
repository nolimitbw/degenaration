"use client";
import { usePrivy } from "@privy-io/react-auth";

const OWNER_EMAILS = (process.env.NEXT_PUBLIC_ADMIN_OWNER_EMAILS || "Flipthatsol@gmail.com")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

export function emailFromPrivyUser(user: any): string | null {
  const direct = user?.email?.address;
  const google = user?.google?.email;
  const linked = Array.isArray(user?.linkedAccounts)
    ? user.linkedAccounts.find((account: any) => account?.type === "email" || account?.type === "google_oauth")
    : null;
  return String(direct || google || linked?.address || linked?.email || "").trim().toLowerCase() || null;
}

export function isOwnerEmail(email: string | null | undefined) {
  return !!email && OWNER_EMAILS.includes(email.trim().toLowerCase());
}

export function useIsAdmin() {
  const { ready, authenticated, user } = usePrivy();
  const email = emailFromPrivyUser(user);
  return { admin: ready && authenticated && isOwnerEmail(email), ready, email };
}

export async function adminHeaders(getAccessToken: () => Promise<string | null>, identityToken?: string | null, email?: string | null) {
  const token = await getAccessToken();
  return {
    "content-type": "application/json",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(identityToken ? { "x-privy-id-token": identityToken } : {}),
    ...(email ? { "x-admin-email": email } : {})
  };
}

export function adminErrorMessage(error: string | undefined, status?: number) {
  if (error === "forbidden") return "Owner API rejected this session. Sign out and use the owner Google account.";
  if (error === "unauthorized") return "Owner session expired. Sign in with the owner Google account again.";
  return error || `request failed${status ? ` (${status})` : ""}`;
}

export async function adminFetchJson<T>(
  url: string,
  getAccessToken: () => Promise<string | null>,
  identityToken?: string | null,
  email?: string | null,
  init?: RequestInit
): Promise<{ ok: true; status: number; data: T } | { ok: false; status: number; data: any; error: string }> {
  const headers = await adminHeaders(getAccessToken, identityToken, email);
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: { ...headers, ...(init?.headers || {}) }
  }).catch(() => null);
  if (!response) return { ok: false, status: 0, data: null, error: "request failed" };
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.error) {
    return { ok: false, status: response.status, data, error: adminErrorMessage(data?.error, response.status) };
  }
  return { ok: true, status: response.status, data };
}
