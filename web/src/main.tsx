import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { setupPwa } from './pwa';
import './styles.css';
setupPwa();
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
