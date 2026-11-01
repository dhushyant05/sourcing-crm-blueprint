/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: { sans: ['"Inter Variable"', 'Inter', 'system-ui', 'sans-serif'] },
      colors: {
        brand: { 50: '#ebf7fc', 100: '#d3eef9', 200: '#a8dcf2', 300: '#7dcaeb', 400: '#4fb6e3', 500: '#2a9fd6', 600: '#1f86bb', 700: '#1a6d98' },
        accent: { 200: '#cdeebb', 300: '#a9de8c', 400: '#8fd06b', 500: '#6cc04a', 600: '#56a33a' },
        ink: { 50: '#f8fafc', 100: '#f1f5f9', 200: '#e2e8f0', 300: '#cbd5e1', 400: '#94a3b8', 500: '#64748b', 600: '#475569', 700: '#334155', 800: '#1e293b', 850: '#172033', 900: '#0f172a', 950: '#0b1120' },
      },
      borderRadius: { xl: '12px', '2xl': '16px' },
      boxShadow: {
        soft: '0 1px 2px rgba(15,23,42,.04), 0 4px 16px -4px rgba(15,23,42,.08)',
        lift: '0 2px 4px rgba(15,23,42,.04), 0 12px 32px -8px rgba(15,23,42,.18)',
      },
      keyframes: {
        'fade-in': { from: { opacity: 0, transform: 'translateY(4px)' }, to: { opacity: 1, transform: 'none' } },
        'slide-in': { from: { transform: 'translateX(100%)' }, to: { transform: 'none' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: { 'fade-in': 'fade-in .25s ease-out both', 'slide-in': 'slide-in .28s cubic-bezier(.2,.8,.2,1) both' },
    },
  },
  plugins: [],
};
