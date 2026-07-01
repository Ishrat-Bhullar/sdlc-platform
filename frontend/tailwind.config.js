/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ey: {
          yellow: '#FFE600',
          'yellow-dark': '#E6CF00',
          'yellow-light': '#FFF5CC',
        },
        dark: {
          bg: '#0A0A0A',
          card: '#111111',
          cardHover: '#1A1A1A',
          border: '#222222',
          'border-light': '#333333',
        },
        text: {
          primary: '#E2E8F0',
          secondary: '#94A3B8',
          muted: '#64748B',
        },
        status: {
          success: '#22C55E',
          warning: '#F59E0B',
          error: '#EF4444',
          info: '#3B82F6',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'typing': 'typing 1s steps(3) infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
      },
      keyframes: {
        typing: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' },
        },
        glow: {
          '0%': { boxShadow: '0 0 5px rgba(255, 230, 0, 0.3)' },
          '100%': { boxShadow: '0 0 20px rgba(255, 230, 0, 0.6)' },
        },
      },
    },
  },
  plugins: [],
};