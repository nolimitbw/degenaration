import { requireEnv } from "../env.ts";

/**
 * Supabase PostgREST access using the service key.
 *
 * SERVER ONLY. The service key bypasses row-level security, so nothing in this module
 * may ever be imported into a client component. Every caller is a route handler that
 * has already established who the user is.
 */

const TIMEOUT_MS = 8_000;

type QueryOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  /** PostgREST `Prefer` header, e.g. `return=representation`. */
  prefer?: string;
};

export async function db<T>(path: string, options: QueryOptions = {}): Promise<T | null> {
  const url = requireEnv("SUPABASE_URL").replace(/\/+$/, "");
  const key = requireEnv("SUPABASE_SERVICE_KEY");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${url}/rest/v1/${path}`, {
      method: options.method ?? "GET",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "content-type": "application/json",
        Prefer: options.prefer ?? "return=representation"
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
      cache: "no-store"
    });
    if (!res.ok) return null;
    if (res.status === 204) return null;
    return (await res.json().catch(() => null)) as T | null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
