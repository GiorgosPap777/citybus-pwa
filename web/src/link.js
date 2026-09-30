import { asCity, asStopCode } from './validate.js';

/** The address of one stop: /?city=irakleio&stop=0122. */
export const stopLinkUrl = (city, code) =>
  `${window.location.origin}/?${new URLSearchParams({ city, stop: code })}`;

/**
 * The stop a link opened the app on, if any, read once per page load. The query
 * is then removed from the address bar: left there, every reload (and Android
 * reloads an installed app it restores from the background) would reopen the
 * linked stop over wherever the user had gone since.
 */
export function takeStopLink() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has('city') && !params.has('stop')) return null;
  window.history.replaceState(window.history.state, '', window.location.pathname + window.location.hash);
  const city = asCity(params.get('city'));
  const stop = asStopCode(params.get('stop'));
  return city && stop ? { city, stop } : null;
}
