"use client";
// Functional devnet/mainnet switch. Persisted in localStorage; drives client RPC + API net param.
export type Net = "devnet" | "mainnet";
const KEY = "degen_net";
// Default to PublicNode: free, keyless, CORS-enabled mainnet RPC. Override with a paid
// endpoint (Helius/QuickNode/Triton) via NEXT_PUBLIC_MAINNET_RPC for production scale.
const MAINNET = process.env.NEXT_PUBLIC_MAINNET_RPC || "https://solana-rpc.publicnode.com";
const DEVNET = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";

export function getNet(): Net {
  if (typeof window === "undefined") return "mainnet";
  return (localStorage.getItem(KEY) as Net) || "mainnet";
}
export function setNet(n: Net) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, n);
  window.dispatchEvent(new CustomEvent("degen-net", { detail: n }));
}
export function rpcFor(n: Net) { return n === "mainnet" ? MAINNET : DEVNET; }
export function getRpc() { return rpcFor(getNet()); }
