import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './style.css';
import './usability.css';
import './motion.css';
import './overview.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
