"use client";

/**
 * Client-side access to the Telegram Mini App bridge.
 *
 * Nothing here is trusted for authorization. `initData` is forwarded to the server on
 * every request and re-verified there; the values read from `initDataUnsafe` are used
 * only to render a name before the server answers.
 */

type TelegramWebApp = {
  initData?: string;
  initDataUnsafe?: { user?: { id?: number; first_name?: string; username?: string } };
  ready?: () => void;
  expand?: () => void;
  colorScheme?: string;
  HapticFeedback?: { impactOccurred?: (style: string) => void };
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
};

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export function getWebApp(): TelegramWebApp | null {
  if (typeof window === "undefined") return null;
  return window.Telegram?.WebApp ?? null;
}

/** The raw initData string, or null when the page is open outside Telegram. */
export function getInitData(): string | null {
  const raw = getWebApp()?.initData;
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

/** fetch() with the Telegram init data attached, which is how the server authenticates us. */
export async function apiFetch(path: string): Promise<Response> {
  const initData = getInitData();
  return fetch(path, {
    headers: initData ? { "x-telegram-init-data": initData } : {},
    cache: "no-store"
  });
}

export async function apiPost(path: string, body: unknown): Promise<Response> {
  const initData = getInitData();
  return fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(initData ? { "x-telegram-init-data": initData } : {})
    },
    body: JSON.stringify(body),
    cache: "no-store"
  });
}

export async function apiDelete(path: string): Promise<Response> {
  const initData = getInitData();
  return fetch(path, {
    method: "DELETE",
    headers: initData ? { "x-telegram-init-data": initData } : {},
    cache: "no-store"
  });
}

/** Telegram's haptics, where the client provides them. Absent outside Telegram. */
export function haptic(style: "light" | "medium" | "heavy" = "light") {
  getWebApp()?.HapticFeedback?.impactOccurred?.(style);
}
