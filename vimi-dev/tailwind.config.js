/** Tailwind build for Vimi Bilingual.
 *  Scans the extension's HTML + JS (classes are also added from JS) and emits a
 *  static, purged BilingualTranslate/tailwind.css. Dark mode via .dark class.
 *  Build:  npx tailwindcss -i input.css -o ../BilingualTranslate/tailwind.css --minify
 */
module.exports = {
  darkMode: "class",
  content: [
    "../BilingualTranslate/*.html",
    "../BilingualTranslate/*.js",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#e8f0fe",
          100: "#d2e3fc",
          400: "#5b9bff",
          500: "#2b7cff",
          600: "#1a73e8",
          700: "#1557d6",
          800: "#1144a8",
        },
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      borderRadius: { xl2: "1rem" },
    },
  },
  plugins: [],
};
