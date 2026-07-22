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
        page:   "#f6f7fb",
        card:   "#ffffff",
        line:   { DEFAULT: "#eceef3", strong: "#e2e5ec" },
        ink:    { DEFAULT: "#111322", 2: "#667085", 3: "#98a2b3" },
        accent: { DEFAULT: "#6366f1", dark: "#4f52e0", soft: "#eef0fe" },
        good:   { DEFAULT: "#12b76a", soft: "#e7f7ef" },
        warn:   { DEFAULT: "#f79009", soft: "#fef2e2" },
        bad:    { DEFAULT: "#f04438", soft: "#fdebea" },
        info:   { DEFAULT: "#2e90fa", soft: "#e8f2fe" },
        grape:  { DEFAULT: "#875bf7", soft: "#f1ebfe" },
      },
      borderRadius: {
        card: "16px",
        btn: "10px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(16,24,40,0.04), 0 2px 6px rgba(16,24,40,0.04)",
        pop: "0 12px 32px rgba(16,24,40,0.14)",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
