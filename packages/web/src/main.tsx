import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import BetaGate from './ui/BetaGate';
import { setupPwa } from './pwa';
import { applyTheme, loadTheme } from './lib/theme';
import './styles.css';
// Painted before the first render so a visitor who chose sand never sees a flash of the default.
applyTheme(loadTheme());
setupPwa();
// The private-beta gate owns the root: the workspace only mounts once access is granted.
createRoot(document.getElementById('root')!).render(<React.StrictMode><BetaGate>{lock => <App onLock={lock} />}</BetaGate></React.StrictMode>);
