import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // 沿用專案既有主藍，集中為暫定產品 primary；不得宣稱為正式品牌標準色。
        primary: {
          DEFAULT: "rgb(var(--primary) / <alpha-value>)",
          hover: "rgb(var(--primary-hover) / <alpha-value>)",
          foreground: "rgb(var(--primary-foreground) / <alpha-value>)",
          muted: "rgb(var(--primary-muted) / <alpha-value>)",
          50: "rgb(var(--primary-muted) / <alpha-value>)",
          100: "#cce0f2",
          200: "#99c2e6",
          300: "#66a3d9",
          400: "#3385cc",
        },
        background: "rgb(var(--background) / <alpha-value>)",
        surface: {
          DEFAULT: "rgb(var(--surface) / <alpha-value>)",
          muted: "rgb(var(--surface-muted) / <alpha-value>)",
        },
        border: "rgb(var(--border) / <alpha-value>)",
        input: "rgb(var(--input) / <alpha-value>)",
        text: {
          primary: "rgb(var(--text-primary) / <alpha-value>)",
          secondary: "rgb(var(--text-secondary) / <alpha-value>)",
          muted: "rgb(var(--text-muted) / <alpha-value>)",
        },
        disabled: "rgb(var(--disabled) / <alpha-value>)",
        "focus-ring": "rgb(var(--focus-ring) / <alpha-value>)",
        danger: {
          DEFAULT: "rgb(var(--danger) / <alpha-value>)",
          muted: "rgb(var(--danger-muted) / <alpha-value>)",
          bg: "rgb(var(--danger-muted) / <alpha-value>)",
          border: "#f1aeb5",
          text: "#842029",
        },
        warning: {
          DEFAULT: "rgb(var(--warning) / <alpha-value>)",
          muted: "rgb(var(--warning-muted) / <alpha-value>)",
          bg: "rgb(var(--warning-muted) / <alpha-value>)",
          border: "#ffe69c",
          text: "#664d03",
        },
        info: {
          DEFAULT: "rgb(var(--info) / <alpha-value>)",
          muted: "rgb(var(--info-muted) / <alpha-value>)",
          bg: "rgb(var(--info-muted) / <alpha-value>)",
          border: "#9ec5fe",
          text: "#052c65",
        },
        success: {
          DEFAULT: "rgb(var(--success) / <alpha-value>)",
          muted: "rgb(var(--success-muted) / <alpha-value>)",
          bg: "rgb(var(--success-muted) / <alpha-value>)",
          border: "#a3cfbb",
          text: "#0a3622",
        },
        secondary: { DEFAULT: "#6C757D", bg: "#e2e3e5", border: "#c4c8cb", text: "#41464b" },
        gov: {
          red: "#DC3545",
          redbg: "#f8d7da",
          yellow: "#FFC107",
          yellowbg: "#fff3cd",
          blue: "#0D6EFD",
          bluebg: "#cfe2ff",
          green: "#198754",
          greenbg: "#d1e7dd",
          gray: "#6C757D",
          graybg: "#e2e3e5",
        },
      },
      keyframes: {
        "pulse-red": {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(220,53,69,0.5)" },
          "50%": { boxShadow: "0 0 0 4px rgba(220,53,69,0)" },
        },
        // 九階段進度列「目前節點」的慢速呼吸提示。
        // 外圈：以 transform scale + opacity 做緩慢擴散淡出，套在絕對定位的 pseudo/span 上，
        // 不改變節點寬高、不影響 layout、不造成畫面位置跳動。
        "stage-halo": {
          "0%": { transform: "scale(1)", opacity: "0.45" },
          "70%": { transform: "scale(1.75)", opacity: "0" },
          "100%": { transform: "scale(1.75)", opacity: "0" },
        },
        // 圓心：極輕微的呼吸，不閃爍（透明度只在 0.75～1 之間變化）。
        "stage-core": {
          "0%, 100%": { transform: "scale(1)", opacity: "1" },
          "50%": { transform: "scale(0.86)", opacity: "0.75" },
        },
      },
      animation: {
        "pulse-red": "pulse-red 1.6s ease-in-out infinite",
        "stage-halo": "stage-halo 2.2s cubic-bezier(0.4, 0, 0.2, 1) infinite",
        "stage-core": "stage-core 2.2s ease-in-out infinite",
      },
      borderRadius: {
        card: "0.75rem",
      },
      boxShadow: {
        card: "var(--shadow-card)",
        overlay: "var(--shadow-overlay)",
      },
    },
  },
  plugins: [],
};
export default config;
