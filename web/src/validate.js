import { LANGS } from './i18n.js';

// Values that arrive from outside the code — saved settings, a shared link — are
// vetted before use. Anything unrecognised means "not given". The patterns are the
// server's own (assertSlug, assertCode), so nothing passes here that it would refuse.
// Observed: a saved city of 123 crashed the city name, and the error screen's reload
// crashed again.
export const asCity = (value) =>
  typeof value === 'string' && /^[a-z0-9-]{1,40}$/.test(value) ? value : null;
export const asLang = (value) => (LANGS.includes(value) ? value : null);
export const asStopCode = (value) =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,20}$/.test(value) ? value : null;
