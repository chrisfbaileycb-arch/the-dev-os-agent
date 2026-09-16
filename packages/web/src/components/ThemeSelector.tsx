import React, { useState, useEffect } from 'react';

const THEMES = [
  { id: 'dev-dark-coder', name: 'Dev Dark Coder' },
  { id: 'standard-white', name: 'Standard White' },
  { id: 'earth-tones', name: 'Earth Tones' },
  { id: 'pastels', name: 'Pastels' }
];

export function ThemeSelector() {
  const [currentTheme, setCurrentTheme] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('app_theme') || 'standard-white';
    }
    return 'standard-white';
  });

  useEffect(() => {
    const savedTheme = localStorage.getItem('app_theme');
    if (savedTheme) {
      setCurrentTheme(savedTheme);
      document.documentElement.setAttribute('data-theme', savedTheme);
    } else {
      document.documentElement.setAttribute('data-theme', currentTheme);
    }
  }, []);

  const handleThemeChange = (themeId: string) => {
    setCurrentTheme(themeId);
    localStorage.setItem('app_theme', themeId);
    document.documentElement.setAttribute('data-theme', themeId);
  };

  return (
    <div className="theme-selector" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <label htmlFor="theme-select" style={{ fontSize: '14px', color: 'inherit' }}>Theme:</label>
      <select
        id="theme-select"
        value={currentTheme}
        onChange={(e) => handleThemeChange(e.target.value)}
        className="theme-select-input"
        style={{
          padding: '6px 12px',
          borderRadius: '6px',
          border: '1px solid var(--line, #d0d7de)',
          backgroundColor: 'var(--panel, #ffffff)',
          color: 'var(--ink, #24292f)',
          cursor: 'pointer',
          fontSize: '14px'
        }}
      >
        {THEMES.map(theme => (
          <option key={theme.id} value={theme.id}>
            {theme.name}
          </option>
        ))}
      </select>
    </div>
  );
}

export default ThemeSelector;
