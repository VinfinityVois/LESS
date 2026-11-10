/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        surface: "#0f131c",
        "surface-low": "#181c24",
        "surface-high": "#262a33",
        "surface-highest": "#31353e",
        primary: "#4cd7f6",
        "primary-container": "#06b6d4",
        secondary: "#4edea3",
        "secondary-container": "#00a572",
        error: "#ffb4ab",
        "error-container": "#93000a",
        outline: "#869397",
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
