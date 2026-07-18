import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#111111",
        paper: "#FAFAF7",
        paperdim: "#F0EEE7",
        good: "#2D5C3E",
        over: "#B23B2E",
        muted: "#6B6A63",
      },
    },
  },
  plugins: [],
};
export default config;
