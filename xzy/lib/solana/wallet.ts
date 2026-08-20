import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import { Keypair } from "@solana/web3.js";
import { requireEnv } from "../env.ts";

/**
 * Custodial wallets.
 *
 * Xzy holds the keys so a copy can execute while the user is asleep — that is the whole
 * point of the product, and it means the encrypted secret in the database is the single
 * most valuable thing the system stores. Secret keys are encrypted with AES-256-GCM
 * under a master key held only in the environment, so a database dump on its own yields
 * nothing usable.
 *
 * The plaintext secret key exists only inside `decryptSecretKey` and its immediate
 * caller. It is never logged, never returned over HTTP, and never sent to the client.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function masterKey(): Buffer {
  const raw = requireEnv("WALLET_ENCRYPTION_KEY");
  // Accept a 64-char hex key directly; otherwise derive 32 bytes from the passphrase so
  // a weaker-formatted secret still produces a valid-length key rather than throwing.
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
  return createHash("sha256").update(raw).digest();
}

export type EncryptedSecret = {
  /** iv:authTag:ciphertext, all hex. Self-describing so rotation can be detected later. */
  ciphertext: string;
};

export function encryptSecretKey(secretKey: Uint8Array): EncryptedSecret {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, masterKey(), iv);
  const encrypted = Buffer.concat([cipher.update(Buffer.from(secretKey)), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { ciphertext: [iv.toString("hex"), authTag.toString("hex"), encrypted.toString("hex")].join(":") };
}

export function decryptSecretKey(ciphertext: string): Uint8Array | null {
  const parts = ciphertext.split(":");
  if (parts.length !== 3) return null;
  const [ivHex, tagHex, dataHex] = parts as [string, string, string];
  try {
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(tagHex, "hex");
    if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH) return null;
    const decipher = createDecipheriv(ALGORITHM, masterKey(), iv);
    decipher.setAuthTag(authTag);
    return Uint8Array.from(Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]));
  } catch {
    // Wrong master key or tampered ciphertext. Both mean "cannot use this wallet",
    // which the caller must handle as a hard stop rather than a retry.
    return null;
  }
}

export type NewWallet = { address: string; encrypted: EncryptedSecret };

export function createWallet(): NewWallet {
  const keypair = Keypair.generate();
  return {
    address: keypair.publicKey.toBase58(),
    encrypted: encryptSecretKey(keypair.secretKey)
  };
}

/** Rebuild a signer from its stored ciphertext. Returns null if it cannot be decrypted. */
export function loadKeypair(ciphertext: string): Keypair | null {
  const secret = decryptSecretKey(ciphertext);
  if (!secret || secret.length !== 64) return null;
  try {
    return Keypair.fromSecretKey(secret);
  } catch {
    return null;
  }
}
