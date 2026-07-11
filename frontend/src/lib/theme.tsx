import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

type Theme = 'dark' | 'light' | 'system';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

// Ported from Bhumika's ThemeProvider. Scope-limited on purpose: this app's
// Tailwind config (tailwind.config.js) has no `darkMode: 'class'` strategy
// and no light-mode color tokens — every existing component hardcodes the
// dark palette (bg-dark-bg, text-text-primary, etc.). Building a full light
// theme is out of scope for this merge and a real regression risk, so
// `setTheme` is exposed for API compatibility but the app stays forced to
// 'dark' until a light theme is actually built out.
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme] = useState<Theme>('dark');

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add('dark');
  }, []);

  const setTheme = (_next: Theme) => {
    // Intentionally a no-op until a light theme exists — see comment above.
  };

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
