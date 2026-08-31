/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        // UI chrome font (the document body font is chosen by the user)
        ui: ['"Red Hat Text"', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      colors: {
        // Baulko Bulletin brand palette. `bb.orange` (#fe9c53) is the exact
        // dominant orange sampled from the site logo.
        bb: {
          orange: '#fe9c53',
          50: '#fff7ed',
          100: '#ffedd5',
          200: '#fed7aa',
          300: '#fdba74',
          400: '#fe9c53',
          500: '#fb8b34',
          600: '#ea7317',
          700: '#c2570f',
          800: '#9a450f',
          900: '#7c3a10',
        },
        gdoc: {
          bg: '#faf7f4',
          panel: '#ffffff',
          border: '#e7e0d8',
          muted: '#6b6257',
          hover: '#fdf1e7',
          active: '#ffe8d2',
          accent: '#ea7317',
        },
      },
    },
  },
  plugins: [],
}
