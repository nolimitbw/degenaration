import type { Config } from "tailwindcss";

// Degenaration palette: dark trading-terminal base (Trojan-like), brand = white + green.
// Token names are kept stable so the whole app reskins from here:
//   toxic  = brand green (primary accent, up, buy)
//   hotpink = red (down, sell, danger)  [name kept for backward-compat]
//   cyber  = soft mint (secondary accent / badges) [name kept for backward-compat]
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        void: "#08090c",
        panel: "#0f1116",
        edge: "#1d2029",
        toxic: "#22e07a",
        brand: "#22e07a",
        up: "#22e07a",
        down: "#ff4d5e",
        hotpink: "#ff4d5e",
        cyber: "#7ff0b8",
        gold: "#f0b429",
        dim: "#7d828c"
      },
      fontFamily: {
        display: ["var(--font-display)", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"]
      },
      boxShadow: {
        toxic: "0 0 0 1px rgba(34,224,122,0.35), 0 8px 24px -8px rgba(34,224,122,0.45)",
        pink: "0 0 0 1px rgba(255,77,94,0.35), 0 8px 24px -8px rgba(255,77,94,0.4)",
        card: "0 1px 0 0 rgba(255,255,255,0.03) inset, 0 8px 24px -12px rgba(0,0,0,0.6)"
      }
    }
  },
  plugins: []
};
export default config;
