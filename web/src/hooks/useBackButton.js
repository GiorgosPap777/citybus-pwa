import { useEffect, useRef } from 'react';

// Stored in history.state: how many layers deep that entry is.
const GUARD = 'citybusLayer';

// A reload lands on the entry that was current, layer count and all, but without
// the layers — and Android reloads an installed app whenever it restores one it
// discarded in the background. Rewind to the app's base entry. Relabelling the
// stale entry instead left a back press that visibly did nothing. At module level
// so it runs once per page load; StrictMode runs effects twice in development.
const stale = Number(window.history.state?.[GUARD]) || 0;
if (stale > 0) window.history.go(-stale);

/**
 * Makes the system back button (Android's back gesture, a browser's Back) step out
 * of the app's own layers — settings, a followed bus, an open stop — one at a time.
 * The app is a single page, so an installed copy has no history of its own and back
 * closed it from anywhere, open stop and all.
 *
 * `depth` counts the open layers; `closeTo(n)` closes layers until n remain.
 *
 * Each layer pushes one history entry as it opens, so back pops exactly one. They
 * are pushed then, from the tap that opened the layer, and never in response to
 * back: Chrome's back button skips an entry that pushed another without a user
 * gesture in between. Observed: re-pushing a single guard after each pop made the
 * second back press find no history, which in an installed app closes it.
 *
 * Layers closed in the UI instead (the X, the Back chip) pop their entries with
 * history.go(); left in place, the next back presses would do nothing.
 */
export function useBackButton(depth, closeTo) {
  // How many layers deep the current history entry is, and how many are open.
  const level = useRef(0);
  const open = useRef(depth);
  const closeToRef = useRef(closeTo);

  useEffect(() => {
    closeToRef.current = closeTo;
  }, [closeTo]);

  useEffect(() => {
    const onPopState = (e) => {
      const to = Number(e.state?.[GUARD]) || 0;
      level.current = to;
      // A pop the app made itself lands where the layers already are; only a back
      // press lands below them. Compared, not flagged: closing two layers in two
      // renders makes two pops, and a flag left set by a pop that never came would
      // swallow the user's next back. Forward (desktop browsers) reopens nothing;
      // the entry is reused by the next layer that opens.
      if (to < open.current) closeToRef.current(to);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    open.current = depth;
    if (depth > level.current) {
      for (let n = level.current + 1; n <= depth; n += 1) {
        window.history.pushState({ [GUARD]: n }, '');
      }
      level.current = depth;
    } else if (depth < level.current) {
      window.history.go(depth - level.current);
      level.current = depth;
    }
  }, [depth]);
}
