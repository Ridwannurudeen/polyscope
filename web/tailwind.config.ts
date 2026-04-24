import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Ink scale — custom neutrals, slight cool tint, tuned for terminal
        // rendering. Never use default Tailwind grays.
        ink: {
          50: "#F8F9FB",
          100: "#ECEEF2",
          200: "#D8DCE4",
          300: "#AFB6C3",
          400: "#7A8496",
          500: "#4D5566",
          600: "#2A303D",
          700: "#1E232D",
          800: "#161A22",
          900: "#0F1218",
          950: "#0A0C10",
        },
        // Scope — mint-cyan accent, signal-positive / predictive / attribution.
        // Distinct from Hyperliquid green (shifted more cyan).
        scope: {
          50: "#E9FCF4",
          100: "#C8F8E1",
          200: "#94F1C6",
          300: "#5BE8A7",
          400: "#33EBB6",
          500: "#00E5A0",
          600: "#00B37C",
          700: "#008A60",
          800: "#05684A",
          900: "#084E39",
        },
        // Fade — warm amber, counter-consensus / fade / warning.
        fade: {
          400: "#FFC566",
          500: "#FFB636",
          600: "#E09514",
          700: "#A86C0B",
        },
        // Alert — destructive / error. Used sparingly.
        alert: {
          400: "#FF8090",
          500: "#FF5A6B",
          600: "#D43D4D",
        },
        // Semantic tokens (used in CSS vars too)
        background: "var(--background)",
        foreground: "var(--foreground)",
        surface: "var(--surface)",
        elevated: "var(--elevated)",
        border: "var(--border)",
        "border-strong": "var(--border-strong)",
        muted: "var(--muted)",
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
        display: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
      fontSize: {
        // Terminal scale — tight, purposeful.
        "eyebrow": ["10px", { lineHeight: "1.2", letterSpacing: "0.08em" }],
        "micro": ["11px", { lineHeight: "1.3", letterSpacing: "0.02em" }],
        "caption": ["12px", { lineHeight: "1.4", letterSpacing: "0" }],
        "body-sm": ["13px", { lineHeight: "1.5", letterSpacing: "0" }],
        "body": ["14px", { lineHeight: "1.55", letterSpacing: "0" }],
        "body-lg": ["15px", { lineHeight: "1.6", letterSpacing: "-0.005em" }],
        "h4": ["17px", { lineHeight: "1.3", letterSpacing: "-0.01em" }],
        "h3": ["20px", { lineHeight: "1.3", letterSpacing: "-0.015em" }],
        "h2": ["28px", { lineHeight: "1.2", letterSpacing: "-0.02em" }],
        "h1": ["36px", { lineHeight: "1.1", letterSpacing: "-0.025em" }],
        "display": ["56px", { lineHeight: "1.02", letterSpacing: "-0.035em" }],
        "display-xl": ["80px", { lineHeight: "0.98", letterSpacing: "-0.04em" }],
      },
      borderRadius: {
        // Terminal feels sharper than mid-2020s defaults. Kill 2xl/3xl.
        none: "0",
        sm: "2px",
        DEFAULT: "4px",
        md: "6px",
        lg: "8px",
        xl: "10px",
        "2xl": "12px", // reserved for modals only
        full: "9999px",
      },
      spacing: {
        // Extended scale for dense terminal layouts
        "0.25": "1px",
        "4.5": "18px",
      },
      letterSpacing: {
        tightest: "-0.04em",
        tighter: "-0.025em",
        tight: "-0.015em",
        normal: "0",
        wide: "0.02em",
        wider: "0.08em",
        widest: "0.12em",
      },
      transitionTimingFunction: {
        // Weighted easing — replaces default `ease`
        "out-quart": "cubic-bezier(0.25, 1, 0.5, 1)",
        "out-expo": "cubic-bezier(0.16, 1, 0.3, 1)",
        "in-out-quart": "cubic-bezier(0.76, 0, 0.24, 1)",
      },
      transitionDuration: {
        "120": "120ms",
        "180": "180ms",
        "240": "240ms",
        "420": "420ms",
      },
      boxShadow: {
        // Sparse shadow scale — mostly for modals/dropdowns only
        "elevated": "0 1px 0 rgba(255,255,255,0.02) inset, 0 8px 24px rgba(0,0,0,0.4)",
        "modal": "0 24px 64px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.03) inset",
        "glow-scope": "0 0 0 1px rgba(0,229,160,0.25), 0 0 24px rgba(0,229,160,0.08)",
      },
      keyframes: {
        "tick-up": {
          "0%": { transform: "translateY(4px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        "tick-down": {
          "0%": { transform: "translateY(-4px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        "pulse-subtle": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.55" },
        },
      },
      animation: {
        "tick-up": "tick-up 180ms cubic-bezier(0.25, 1, 0.5, 1)",
        "tick-down": "tick-down 180ms cubic-bezier(0.25, 1, 0.5, 1)",
        "pulse-subtle": "pulse-subtle 2.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
export default config;
