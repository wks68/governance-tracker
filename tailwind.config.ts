import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        surface: "#f6f7f9",
        ink: "#111827",
        line: "#d7dce3",
        delta: {
          50: "#eef6fb",
          100: "#d9ebf7",
          200: "#b9d8ed",
          600: "#0068ad",
          700: "#005bac",
          800: "#004b8d",
          900: "#003b70",
          DEFAULT: "#005bac"
        }
      },
      boxShadow: {
        panel: "0 1px 2px rgba(16, 24, 40, 0.06)"
      }
    }
  },
  plugins: []
};

export default config;
