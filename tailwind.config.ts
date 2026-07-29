import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        void: "rgb(var(--void-rgb) / <alpha-value>)",
        panel: "rgb(var(--panel-rgb) / <alpha-value>)",
        edge: "rgb(var(--edge-rgb) / <alpha-value>)",
        brand: "rgb(var(--brand-rgb) / <alpha-value>)",
        up: "rgb(var(--up-rgb) / <alpha-value>)",
        down: "rgb(var(--hotpink-rgb) / <alpha-value>)",
        // Was #f0b429, a brighter yellow than the palette the product actually renders.
        // Aligned to the semantic gold so a `bg-gold` control matches every other
        // gold surface in the app.
        gold: "var(--gold-400)",
        dim: "rgb(var(--dim-rgb) / <alpha-value>)",
        ink: "rgb(var(--ink-rgb) / <alpha-value>)",
        night: "#080808",
        night2: "#0d0d0d",
        grape: "rgb(var(--toxic-rgb) / <alpha-value>)",
        magenta: "#ff5577",
        azure: "rgb(var(--cyber-rgb) / <alpha-value>)",
        ember: "rgb(var(--ember-rgb) / <alpha-value>)",
        starlight: "rgb(var(--ember-rgb) / <alpha-value>)",
        haze: "rgb(var(--haze-rgb) / <alpha-value>)",

        // Semantic tokens (spec §5.2). Prefer these in new work over the legacy
        // palette names above, which are kept as aliases during migration.
        canvas: "var(--canvas)",
        "canvas-elevated": "var(--canvas-elevated)",
        "surface-1": "var(--surface-1)",
        "surface-2": "var(--surface-2)",
        "surface-3": "var(--surface-3)",
        "surface-hover": "var(--surface-hover)",
        "gold-100": "var(--gold-100)",
        "gold-200": "var(--gold-200)",
        "gold-300": "rgb(var(--gold-300-rgb) / <alpha-value>)",
        "gold-400": "rgb(var(--gold-400-rgb) / <alpha-value>)",
        "gold-500": "rgb(var(--gold-500-rgb) / <alpha-value>)",
        "gold-600": "var(--gold-600)",
        "text-primary": "var(--text-primary)",
        "text-secondary": "var(--text-secondary)",
        "text-muted": "var(--text-muted)",
        "text-disabled": "var(--text-disabled)",
        success: "rgb(var(--success-rgb) / <alpha-value>)",
        danger: "rgb(var(--danger-rgb) / <alpha-value>)",
        warning: "rgb(var(--warning-rgb) / <alpha-value>)",
        info: "rgb(var(--info-rgb) / <alpha-value>)"
      },
      borderColor: {
        subtle: "var(--border-subtle)",
        DEFAULT: "var(--border-default)",
        strong: "var(--border-strong)"
      },
      fontFamily: {
        display: ["var(--font-display)", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"]
      },
      boxShadow: {
        gold: "var(--shadow-toxic)",
        danger: "var(--shadow-pink)",
        card: "0 1px 3px 0 rgba(0,0,0,0.06), 0 1px 2px -1px rgba(0,0,0,0.06)"
      }
    }
  },
  plugins: []
};
export default config;
