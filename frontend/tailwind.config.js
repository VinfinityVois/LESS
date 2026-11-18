/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        surface: "#0c0f14",
        "surface-low": "#12161e",
        "surface-high": "#1a1f2a",
        "surface-highest": "#252b38",
        primary: "#4cd7f6",
        "primary-container": "#06b6d4",
        secondary: "#4edea3",
        "secondary-container": "#00a572",
        error: "#ffb4ab",
        "error-container": "#93000a",
        outline: "#6b7482",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        display: ["Space Grotesk", "Inter", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
