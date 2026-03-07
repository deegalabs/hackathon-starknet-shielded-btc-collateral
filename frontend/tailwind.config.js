/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "#0a0a14",
        surface: "#111128",
        "surface-2": "#1a1a35",
        border: "#1e1e3f",
        "border-bright": "#2d2d5e",
        btc: "#f7931a",
        "btc-dim": "#b36613",
        stark: "#9c74ff",
        "stark-dim": "#6b4fc4",
        privacy: "#10b981",
        "privacy-dim": "#065f46",
        muted: "#64748b",
        subtle: "#334155",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
      animation: {
        "pulse-slow": "pulse 3s ease-in-out infinite",
        "fade-in": "fadeIn 0.3s ease-in-out",
        "slide-up": "slideUp 0.3s ease-out",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { transform: "translateY(8px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
      },
    },
  },
  plugins: [],
};
