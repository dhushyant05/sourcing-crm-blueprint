import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import './index.css';
import App from './App';
import './i18n';
import { startTableLabels } from './lib/rtable';

startTableLabels();

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
