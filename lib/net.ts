"use client";
// Mainnet-only. The app trades exclusively on Solana mainnet — there is no devnet mode.
// getNet/setNet are kept as thin shims so existing call sites keep compiling.
export type Net = "mainnet";
// Default to PublicNode: free, keyless, CORS-enabled mainnet RPC. Override with a paid
// endpoint (Helius/QuickNode/Triton) via NEXT_PUBLIC_MAINNET_RPC for production scale.
const MAINNET = process.env.NEXT_PUBLIC_MAINNET_RPC || "https://solana-rpc.publicnode.com";

export function getNet(): Net { return "mainnet"; }
export function setNet(_n: Net) { /* no-op: mainnet only */ }
export function rpcFor(_n?: Net) { return MAINNET; }
export function getRpc() { return MAINNET; }
