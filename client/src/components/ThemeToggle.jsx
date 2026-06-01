import { useEffect, useState } from 'react';

export default function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.classList.toggle('light', !dark);
    document.body.classList.toggle('bg-ink-950', dark);
    document.body.classList.toggle('bg-white', !dark);
    document.body.classList.toggle('text-ink-100', dark);
    document.body.classList.toggle('text-ink-900', !dark);
  }, [dark]);

  return (
    <button
      onClick={() => setDark(d => !d)}
      className="rounded-lg border border-ink-800 dark:border-ink-800 px-2.5 py-1.5 text-xs text-ink-400 hover:text-ink-100 hover:border-ink-600 transition-colors"
      aria-label="Toggle theme"
    >
      {dark ? '☾ Dark' : '☀ Light'}
    </button>
  );
}
