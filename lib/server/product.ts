import { NextResponse } from "next/server";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function rpcResponse<T>(result: { ok: true; data: T } | { ok: false; status: number; error: string }) {
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data, { headers: { "Cache-Control": "no-store, max-age=0" } });
}

export function isObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function boundedNumber(value: unknown, min: number, max: number) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

export function boundedInteger(value: unknown, min: number, max: number) {
  const number = boundedNumber(value, min, max);
  return number != null && Number.isInteger(number) ? number : null;
}

export function exactLamports(value: unknown, max = BigInt("100000000000")) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  try {
    const amount = BigInt(value);
    return amount > BigInt(0) && amount <= max ? amount.toString() : null;
  } catch {
    return null;
  }
}

export function normalizePeriod(value: string | null, allowed: readonly string[], fallback: string) {
  return value && allowed.includes(value) ? value : fallback;
}
