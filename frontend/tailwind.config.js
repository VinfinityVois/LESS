/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        surface: "#090e13",
        "surface-low": "#111a22",
        "surface-high": "#15212b",
        "surface-highest": "#26353d",
        primary: "#61d8d0",
        "primary-container": "#61d8d0",
        secondary: "#8bd5a5",
        "secondary-container": "#4d9f70",
        error: "#ed8888",
        "error-container": "#51282c",
        outline: "#83959c",
      },
      fontFamily: {
        sans: ["DM Sans", "Inter", "system-ui", "sans-serif"],
        display: ["Manrope", "Space Grotesk", "Inter", "sans-serif"],
        mono: ["IBM Plex Mono", "JetBrains Mono", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
