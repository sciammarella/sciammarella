import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

export default {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: "1rem", screens: { "2xl": "1320px" } },
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "monospace"],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        popover: { DEFAULT: "hsl(var(--popover))", foreground: "hsl(var(--popover-foreground))" },
        brand: { DEFAULT: "hsl(var(--brand))", soft: "hsl(var(--brand-soft))" },
        demo: { DEFAULT: "hsl(var(--demo))", soft: "hsl(var(--demo-soft))" },
        risk: {
          1: "hsl(var(--risk-1))",
          2: "hsl(var(--risk-2))",
          3: "hsl(var(--risk-3))",
          4: "hsl(var(--risk-4))",
          5: "hsl(var(--risk-5))",
        },
        info: { DEFAULT: "hsl(var(--info))", soft: "hsl(var(--info-soft))" },
        attention: { DEFAULT: "hsl(var(--attention))", soft: "hsl(var(--attention-soft))" },
        critical: { DEFAULT: "hsl(var(--critical))", soft: "hsl(var(--critical-soft))" },
        positive: "hsl(var(--positive))",
        negative: "hsl(var(--negative))",
      },
      borderRadius: { lg: "var(--radius)", md: "calc(var(--radius) - 2px)", sm: "calc(var(--radius) - 4px)" },
    },
  },
  plugins: [animate],
} satisfies Config;
