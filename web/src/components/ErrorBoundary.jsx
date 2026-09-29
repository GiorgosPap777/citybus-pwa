import { Component } from 'react';
import { translator } from '../i18n.js';
import { readJson } from '../storage.js';

/**
 * Without this, any render error unmounts the whole tree and leaves an installed
 * app as a blank screen with no browser chrome to reload from — which is exactly
 * what a nameless stop in the English feed once did.
 *
 * It sits outside App, so it reads the saved language directly rather than
 * through App's state.
 */
export default class ErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    console.error('[app] render failed', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const t = translator(readJson('citybus.lang.v1', null) ?? 'el');
    return (
      <div className="crash" role="alert">
        <h1>{t('crashTitle')}</h1>
        <p>{t('crashBody')}</p>
        <button type="button" className="btn" onClick={() => window.location.reload()}>
          {t('reload')}
        </button>
      </div>
    );
  }
}
