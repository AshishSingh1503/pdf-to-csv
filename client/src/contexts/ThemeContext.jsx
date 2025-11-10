import React, { createContext, useContext, useEffect, useState, useRef } from 'react';

const ThemeContext = createContext();

export const ThemeProvider = ({ children }) => {
  // theme: 'light' | 'dark' | 'system' (persisted)
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('theme') || 'system';
    } catch (e) {
      return 'system';
    }
  });

  const [effectiveTheme, setEffectiveTheme] = useState(() => {
    if (typeof window === 'undefined') return 'light';
    try {
      const stored = localStorage.getItem('theme');
      const t = stored || 'system';
      if (t === 'system') {
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
      return t === 'dark' ? 'dark' : 'light';
    } catch (e) {
      return 'light';
    }
  });

  const mqRef = useRef(null);

  // keep localStorage in sync when user changes explicit theme (persist 'theme' not effectiveTheme)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem('theme', theme);
    } catch (e) {
      // ignore
    }
  }, [theme]);

  // compute effective theme and listen for system changes when theme === 'system'
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
    mqRef.current = mq;

    const compute = () => {
      if (theme === 'system') {
        const isDark = mq ? mq.matches : false;
        setEffectiveTheme(isDark ? 'dark' : 'light');
      } else {
        setEffectiveTheme(theme === 'dark' ? 'dark' : 'light');
      }
    };

    compute();

    const listener = (e) => {
      if (theme === 'system') {
        setEffectiveTheme(e.matches ? 'dark' : 'light');
      }
    };

    if (mq && typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', listener);
    } else if (mq && typeof mq.addListener === 'function') {
      mq.addListener(listener);
    }

    return () => {
      try {
        if (mq && typeof mq.removeEventListener === 'function') mq.removeEventListener('change', listener);
        else if (mq && typeof mq.removeListener === 'function') mq.removeListener(listener);
      } catch (e) {}
    };
  }, [theme]);

  // apply/remove dark class based on effectiveTheme
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement || document.body;
    if (!root) return;
    if (effectiveTheme === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
  }, [effectiveTheme]);

  const toggleTheme = () => {
    setTheme((t) => {
      if (t === 'dark') return 'light';
      if (t === 'light') return 'system';
      return 'dark'; // system -> dark
    });
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, effectiveTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  return useContext(ThemeContext);
};

export default ThemeContext;
