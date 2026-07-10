import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        void: "var(--void)",
        panel: "var(--panel)",
        edge: "var(--edge)",
        toxic: "var(--toxic)",
        brand: "var(--toxic)",
        up: "var(--toxic)",
        down: "var(--hotpink)",
        hotpink: "var(--hotpink)",
        cyber: "var(--cyber)",
        gold: "#f0b429",
        dim: "var(--dim)",
        ink: "var(--ink)",
        night: "#03130a",
        night2: "#051a0d",
        grape: "var(--toxic)",
        magenta: "#5ef2a6",
        azure: "var(--cyber)",
        ember: "var(--ember)",
        starlight: "var(--ember)",
        haze: "var(--haze)"
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
