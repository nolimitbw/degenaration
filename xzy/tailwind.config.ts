import type { Config } from "tailwindcss";

/**
 * Xzy palette: gold accent, white primary text, dim-black surfaces, green gains,
 * red losses. Deliberately narrow — a copy-trading UI earns trust by being legible
 * and consistent, not by being colourful.
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        gold: "#f0b429",
        goldDim: "#8a6714",
        ink: "#ffffff",
        muted: "#9a9a9a",
        faint: "#6b6b6b",
        surface: "#0d0d0d",
        surface2: "#151515",
        base: "#080808",
        edge: "#242424",
        up: "#37d67a",
        down: "#f0506e"
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"]
      }
    }
  },
  plugins: []
};

export default config;
