import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // 台達電藍：品牌主色，用於按鈕、連結、focus 等互動元件
        primary: {
          DEFAULT: "#005BAC",
          hover: "#004B8D",
          50: "#e6f0f9",
          100: "#cce0f2",
          200: "#99c2e6",
          300: "#66a3d9",
          400: "#3385cc",
        },
        // 語意色（參考 Bootstrap）：用於狀態燈號、警示區塊等
        danger: { DEFAULT: "#DC3545", bg: "#f8d7da", border: "#f1aeb5", text: "#842029" },
        warning: { DEFAULT: "#FFC107", bg: "#fff3cd", border: "#ffe69c", text: "#664d03" },
        info: { DEFAULT: "#0D6EFD", bg: "#cfe2ff", border: "#9ec5fe", text: "#052c65" },
        success: { DEFAULT: "#198754", bg: "#d1e7dd", border: "#a3cfbb", text: "#0a3622" },
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
      },
      animation: {
        "pulse-red": "pulse-red 1.6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
export default config;
