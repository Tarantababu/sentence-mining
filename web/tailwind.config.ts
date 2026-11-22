import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
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
} satisfies Config;
