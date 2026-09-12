/**
 * Public Privy key-quorum identifier used to provision the server as a TEE wallet signer.
 * This is an identifier, not the authorization private key; the private key remains server-only.
 */
export const PRIVY_SIGNER_ID = process.env.NEXT_PUBLIC_PRIVY_SIGNER_ID?.trim() || "";

export function requiredPrivySignerId(): string {
  if (!PRIVY_SIGNER_ID) throw new Error("Auto-trading authorization is not configured. Please contact support.");
  return PRIVY_SIGNER_ID;
}
