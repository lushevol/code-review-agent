import { nextui } from "@nextui-org/react";

// Dynamically generate safelist from NextUI's theme colors
const plugin = nextui();
const colorKeys = Object.keys(plugin.config.theme.extend.colors);
const NUI_COLORS = ["default", "primary", "secondary", "success", "warning", "danger", "foreground"];
const NUI_SHADES = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900"];

// Explicit safelist for all utility patterns NextUI components use at runtime
const safelist = [];
for (const prefix of ["bg", "text", "border"]) {
  for (const color of NUI_COLORS) {
    safelist.push(`${prefix}-${color}`);
    for (const shade of NUI_SHADES) {
      safelist.push(`${prefix}-${color}-${shade}`);
    }
    // Opacity modifiers used by NextUI (e.g. bg-default/40)
    for (const opacity of ["10", "20", "30", "40", "50", "60", "70", "80", "90"]) {
      safelist.push(`${prefix}-${color}/${opacity}`);
    }
  }
}
for (const size of ["tiny", "small", "medium", "large"]) {
  safelist.push(`text-${size}`);
}
for (const r of ["small", "medium", "large"]) {
  safelist.push(`rounded-${r}`);
  safelist.push(`shadow-${r}`);
}
for (const v of ["hover", "disabled"]) {
  safelist.push(`opacity-${v}`);
}
// Additional utilities NextUI components use
safelist.push("bg-transparent");
safelist.push("border-medium", "border-small", "border-large");
safelist.push("border-2", "border-1");

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  safelist,
  theme: {
    extend: {},
  },
  darkMode: "class",
  plugins: [nextui()],
};
