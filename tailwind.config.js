/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        gdoc: {
          bg: '#f9fbfd',
          panel: '#ffffff',
          border: '#e0e3e7',
          muted: '#5f6368',
          hover: '#f1f3f4',
          active: '#e8f0fe',
          accent: '#1a73e8',
        },
      },
    },
  },
  plugins: [],
}
