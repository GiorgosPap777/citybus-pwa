import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import 'leaflet/dist/leaflet.css';
import './styles.css';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';

// Up to 1.1.0 the service worker cached map tiles as opaque responses in
// 'osm-tiles', which Chrome counts at 6–11 MB each: phones showed 1.5 GB of site
// data for a few MB of images. Its replacement is 'osm-tiles-v2'. Deleting a cache
// that does not exist is a no-op, so this is safe on every start.
window.caches?.delete('osm-tiles').catch(() => {});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
