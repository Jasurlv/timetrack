/** @type {import('tailwindcss').Config} */
export default {
  content: ["./app/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#111827",
        paper: "#f8fafc",
        leaf: "#2563eb",
        signal: "#dc2626",
        success: "#16a34a",
        warning: "#d97706",
      },
      fontFamily: {
        display: ["Arial", "sans-serif"],
        sans: ["Arial", "sans-serif"],
      },
    },
  },
  plugins: [],
};
