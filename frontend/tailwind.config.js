/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#12201c",
        moss: "#1f6f54",
        leaf: "#58cc02",
        sand: "#f7f4ee",
      },
    },
  },
  plugins: [],
};
