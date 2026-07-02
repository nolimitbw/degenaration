import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        void: "#07070b",
        panel: "#0d0d15",
        edge: "#1c1c2a",
        toxic: "#a3ff12",
        hotpink: "#ff2d78",
        cyber: "#7b5cff",
        dim: "#8b8b9e"
      },
      fontFamily: {
        display: ["var(--font-display)", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"]
      },
      boxShadow: {
        toxic: "0 0 24px rgba(163,255,18,0.35)",
        pink: "0 0 24px rgba(255,45,120,0.35)"
      }
    }
  },
  plugins: []
};
export default config;
