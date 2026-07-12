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

export async function adminHeaders(getAccessToken: () => Promise<string | null>, identityToken?: string | null) {
  const token = await getAccessToken();
  return {
    "content-type": "application/json",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(identityToken ? { "x-privy-id-token": identityToken } : {})
  };
}
