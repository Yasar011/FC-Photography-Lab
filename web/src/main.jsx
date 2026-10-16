import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';

import App from './App.jsx';
import { AuthProvider } from './lib/auth.jsx';
import { ToastProvider } from './components/ui.jsx';
import { DEMO } from './firebase.js';
import { demoBootstrap, DemoBar } from '@demo';
import './styles.css';

const root = ReactDOM.createRoot(document.getElementById('root'));

async function start() {
  if (demoBootstrap) {
    // Demo mode: seed sample data with the real backend logic, run scheduled jobs in-page.
    root.render(<div className="center-screen"><div className="row muted"><div className="spinner" /> Preparing demo data…</div></div>);
    await demoBootstrap();
  }
  // Hash routing in demo so the static build works from any folder/host.
  const Router = DEMO ? HashRouter : BrowserRouter;
  root.render(
    <React.StrictMode>
      <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ToastProvider>
          <AuthProvider>
            <App />
            <DemoBar />
          </AuthProvider>
        </ToastProvider>
      </Router>
    </React.StrictMode>,
  );
}

start();
