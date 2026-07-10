import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        void: "rgb(var(--void-rgb) / <alpha-value>)",
        panel: "rgb(var(--panel-rgb) / <alpha-value>)",
        edge: "rgb(var(--edge-rgb) / <alpha-value>)",
        toxic: "rgb(var(--toxic-rgb) / <alpha-value>)",
        brand: "rgb(var(--brand-rgb) / <alpha-value>)",
        up: "rgb(var(--toxic-rgb) / <alpha-value>)",
        down: "rgb(var(--hotpink-rgb) / <alpha-value>)",
        hotpink: "rgb(var(--hotpink-rgb) / <alpha-value>)",
        cyber: "rgb(var(--cyber-rgb) / <alpha-value>)",
        gold: "#f0b429",
        dim: "rgb(var(--dim-rgb) / <alpha-value>)",
        ink: "rgb(var(--ink-rgb) / <alpha-value>)",
        night: "#03130a",
        night2: "#051a0d",
        grape: "rgb(var(--toxic-rgb) / <alpha-value>)",
        magenta: "#5ef2a6",
        azure: "rgb(var(--cyber-rgb) / <alpha-value>)",
        ember: "rgb(var(--ember-rgb) / <alpha-value>)",
        starlight: "rgb(var(--ember-rgb) / <alpha-value>)",
        haze: "rgb(var(--haze-rgb) / <alpha-value>)"
      },
      fontFamily: {
        display: ["var(--font-display)", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"]
      },
      boxShadow: {
        toxic: "var(--shadow-toxic)",
        pink: "var(--shadow-pink)",
        card: "0 1px 3px 0 rgba(0,0,0,0.06), 0 1px 2px -1px rgba(0,0,0,0.06)"
      }
    }
  },
  plugins: []
};
export default config;
