import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { encryptSecretKey, decryptSecretKey, createWallet, loadKeypair } from "../lib/solana/wallet.ts";

// The module reads the master key from the environment at call time.
process.env.WALLET_ENCRYPTION_KEY = "a".repeat(64);

test("a wallet round-trips through encryption", () => {
  const wallet = createWallet();
  const signer = loadKeypair(wallet.encrypted.ciphertext);

  assert.notEqual(signer, null);
  assert.equal(signer?.publicKey.toBase58(), wallet.address);
});

test("ciphertext differs every time for the same key", () => {
  // A fresh IV per encryption; identical ciphertext would leak that two users share a key.
  const keypair = Keypair.generate();
  const first = encryptSecretKey(keypair.secretKey).ciphertext;
  const second = encryptSecretKey(keypair.secretKey).ciphertext;

  assert.notEqual(first, second);
  assert.deepEqual(decryptSecretKey(first), decryptSecretKey(second));
});

test("tampered ciphertext fails to decrypt rather than returning garbage", () => {
  // GCM authenticates; flipping a byte must be detected, not silently decrypted into a
  // key that signs the wrong transactions.
  const wallet = createWallet();
  const [iv, tag, data] = wallet.encrypted.ciphertext.split(":") as [string, string, string];
  const flipped = data.slice(0, -2) + (data.slice(-2) === "00" ? "01" : "00");

  assert.equal(decryptSecretKey([iv, tag, flipped].join(":")), null);
  assert.equal(loadKeypair([iv, tag, flipped].join(":")), null);
});

test("a different master key cannot decrypt", () => {
  const wallet = createWallet();
  process.env.WALLET_ENCRYPTION_KEY = "b".repeat(64);
  assert.equal(decryptSecretKey(wallet.encrypted.ciphertext), null);
  process.env.WALLET_ENCRYPTION_KEY = "a".repeat(64);
});

test("malformed ciphertext is rejected without throwing", () => {
  assert.equal(decryptSecretKey("not-a-ciphertext"), null);
  assert.equal(decryptSecretKey("aa:bb"), null);
  assert.equal(decryptSecretKey(""), null);
  assert.equal(loadKeypair("garbage"), null);
});

test("a passphrase master key is derived to a valid length", () => {
  process.env.WALLET_ENCRYPTION_KEY = "a short human passphrase";
  const wallet = createWallet();
  assert.equal(loadKeypair(wallet.encrypted.ciphertext)?.publicKey.toBase58(), wallet.address);
  process.env.WALLET_ENCRYPTION_KEY = "a".repeat(64);
});
