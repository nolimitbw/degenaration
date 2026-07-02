import { createBrowserClient } from "@supabase/ssr";

// Fallbacks keep the production build from crashing during prerender if env vars
// aren't present yet. At runtime on Vercel, the real NEXT_PUBLIC_* values are inlined
// at build time and used instead. Set them in Vercel → Settings → Environment Variables.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "placeholder-anon-key";

export const supabase = createBrowserClient(url, key);
