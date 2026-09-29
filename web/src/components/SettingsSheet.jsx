import { useMemo } from 'react';
import Icon from './Icon.jsx';
import { cityName } from '../i18n.js';

export default function SettingsSheet({
  cities,
  city,
  onCityChange,
  lang,
  onLangChange,
  onClose,
  collapsed,
  gripProps,
  t,
}) {
  // The server lists cities by slug, which is no order at all once the names are
  // shown in Greek (Αγρινίου, Αλεξανδρούπολης, Άρτας, Χαλκίδος, …).
  const options = useMemo(
    () =>
      cities
        .map((c) => ({ slug: c.slug, label: cityName(c, lang) }))
        .sort((a, b) => a.label.localeCompare(b.label, lang)),
    [cities, lang],
  );

  return (
    <>
      <header className="sheet-head grip" {...gripProps}>
        <div className="sheet-title">
          <h2>{t('settings')}</h2>
        </div>
        <div className="sheet-actions">
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t('close')}>
            <Icon name="close" />
          </button>
        </div>
      </header>

      {!collapsed && (
        <>
          <div className="field">
            <label htmlFor="city-select">{t('city')}</label>
            <select id="city-select" value={city} onChange={(e) => onCityChange(e.target.value)}>
              {options.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <span className="label">{t('language')}</span>
            <div className="segmented">
              <button
                type="button"
                className={lang === 'el' ? 'on' : ''}
                onClick={() => onLangChange('el')}
              >
                Ελληνικά
              </button>
              <button
                type="button"
                className={lang === 'en' ? 'on' : ''}
                onClick={() => onLangChange('en')}
              >
                English
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
