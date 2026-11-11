import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        base: "#0a0c10",
        surface: "#0e1116",
        panel: "#12161c",
        raised: "#171c24",
        line: "#242b36",
        "line-soft": "#1a2029",
        text: "#e6eaf1",
        muted: "#98a3b3",
        faint: "#687385",
        accent: {
          DEFAULT: "#6ea8fe",
          hover: "#8cbcff",
          soft: "#16243a",
        },
        ok: "#4cc38a",
        warn: "#e0b34c",
        danger: "#f2777a",
      },
      fontFamily: {
        sans: [
          "system-ui",
          "-apple-system",
          "PingFang SC",
          "Hiragino Sans GB",
          "Microsoft YaHei",
          "Noto Sans CJK SC",
          "Source Han Sans SC",
          "sans-serif",
        ],
        mono: ["SFMono-Regular", "Menlo", "Consolas", "Liberation Mono", "monospace"],
      },
      boxShadow: {
        panel: "inset 0 1px 0 rgba(255,255,255,0.03), 0 10px 30px rgba(0,0,0,0.35)",
      },
      fontSize: {
        "2xs": ["11px", "16px"],
      },
    },
  },
  plugins: [],
} satisfies Config;
