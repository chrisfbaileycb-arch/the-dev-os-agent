import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { setupPwa } from './pwa';
import { applyTheme, loadTheme } from './lib/theme';
import './styles.css';
// Painted before the first render so a visitor who chose sand never sees a flash of the default.
applyTheme(loadTheme());
setupPwa();
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
