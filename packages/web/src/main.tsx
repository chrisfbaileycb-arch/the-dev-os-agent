import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import ErrorBoundary from './ui/ErrorBoundary';
import BetaGate from './ui/BetaGate';
import { setupPwa } from './pwa';
import { applyTheme, loadTheme } from './lib/theme';
import { purgeLegacyBrowserSecrets } from './lib/sessionSecrets';
import './styles.css';
// Painted before the first render so a visitor who chose sand never sees a flash of the default.
purgeLegacyBrowserSecrets();
applyTheme(loadTheme());
setupPwa();
// The private-beta gate owns the root: the workspace only mounts once access is granted.
createRoot(document.getElementById('root')!).render(<React.StrictMode><ErrorBoundary><BetaGate>{lock => <App onLock={lock} />}</BetaGate></ErrorBoundary></React.StrictMode>);
