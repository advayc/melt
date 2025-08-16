import { useEffect, useState } from 'react';
import { Theme } from '../types';

export default function ThemeToggle(): JSX.Element {
  const [theme, setTheme] = useState<Theme>('dark');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    window.screenTimeAPI.getTheme().then((currentTheme) => {
      setTheme(currentTheme);
      setLoading(false);
    });
  }, []);

  const toggleTheme = async (): Promise<void> => {
    await window.screenTimeAPI.toggleTheme();
    const newTheme = await window.screenTimeAPI.getTheme();
    setTheme(newTheme);
  };

  if (loading) return <div className="theme-toggle">🌙</div>;

  return (
    <button 
      onClick={toggleTheme}
      className="theme-toggle"
      title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
      aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
    >
      {theme === 'light' ? '🌙' : '☀️'}
    </button>
  );
}
