import type { Config } from "tailwindcss";

// Gulf Life brand palette — derived from the logo (gold key, navy wordmark)
// and the campaign email template (gold #AB9055/#907240, navy #2B354E,
// cream #F7F4EE, warm hairlines). Antique gold accent + navy primary.
const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        page:   "#f7f5f0",
        card:   "#ffffff",
        line:   { DEFAULT: "#ebe6da", strong: "#ddd6c6" },
        ink:    { DEFAULT: "#1f2941", 2: "#5d6577", 3: "#9aa1b0" },
        accent: { DEFAULT: "#a08447", dark: "#7f6434", soft: "#f4eee0", light: "#c9a96e" },
        navy:   { DEFAULT: "#2B354E", deep: "#232d48", dark: "#1c2438" },
        good:   { DEFAULT: "#12b76a", soft: "#e7f7ef" },
        warn:   { DEFAULT: "#f79009", soft: "#fef2e2" },
        bad:    { DEFAULT: "#f04438", soft: "#fdebea" },
        info:   { DEFAULT: "#2B354E", soft: "#eef1f7" },
        grape:  { DEFAULT: "#7d5b8f", soft: "#f3eef7" },
      },
      borderRadius: {
        card: "16px",
        btn: "10px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(31,41,65,0.04), 0 2px 6px rgba(31,41,65,0.04)",
        pop: "0 12px 32px rgba(31,41,65,0.14)",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
};

export default config;
