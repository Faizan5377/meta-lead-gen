/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        // Forest-green primary (inspired by the Donezo reference), with slate
        // neutrals and red for danger, on light surfaces.
        brand: {
          50: '#eef6f1', 100: '#d6ebe0', 200: '#b1d8c4', 300: '#83bfa2',
          400: '#54a07d', 500: '#358561', 600: '#286b4d', 700: '#215843',
          800: '#1d4838', 900: '#183b2f', 950: '#12281b',
        },
      },
    },
  },
  plugins: [],
};
