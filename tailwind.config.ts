import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        void: "#f5f7fa",
        panel: "#ffffff",
        edge: "#e2e5ec",
        toxic: "#22e07a",
        brand: "#22e07a",
        up: "#22e07a",
        down: "#ff4d5e",
        hotpink: "#ff4d5e",
        cyber: "#34d399",
        gold: "#f0b429",
        dim: "#8b93a5",
        night: "#03130a",
        night2: "#051a0d",
        grape: "#22e07a",
        magenta: "#5ef2a6",
        azure: "#34d399",
        ember: "#eafff2",
        starlight: "#eafff2",
        haze: "#8fb8a0"
      },
      fontFamily: {
        display: ["var(--font-display)", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"]
      },
      boxShadow: {
        toxic: "0 0 0 1px rgba(34,224,122,0.35), 0 8px 24px -8px rgba(34,224,122,0.45)",
        pink: "0 0 0 1px rgba(255,77,94,0.35), 0 8px 24px -8px rgba(255,77,94,0.4)",
        card: "0 1px 3px 0 rgba(0,0,0,0.06), 0 1px 2px -1px rgba(0,0,0,0.06)"
      }
    }
  },
  plugins: []
};
export default config;
