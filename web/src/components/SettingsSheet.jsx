import { useMemo } from 'react';
import Icon from './Icon.jsx';
import { cityName } from '../i18n.js';
import { ALERT_LEADS } from '../hooks/useArrivalAlert.js';

export default function SettingsSheet({
  cities,
  city,
  onCityChange,
  lang,
  onLangChange,
  alertLead,
  onAlertLeadChange,
  onClose,
  collapsed,
  gripProps,
  t,
}) {
  // The server lists cities by slug, which is no order at all once the names are
  // shown in Greek (Αγρινίου, Αλεξανδρούπολης, Άρτας, Χαλκίδος, …).
  // The current city is listed even when the scraped list lacks it (a city dropped
  // upstream, or the list not loaded yet). A <select> whose value matches no option
  // shows the first one as chosen, and choosing that then fires no change at all.
  // A city found to have no data (the server learns it on first use) cannot be
  // picked, instead of being picked and then answering with an error.
  const options = useMemo(() => {
    const list = cities.some((c) => c.slug === city) ? cities : [...cities, { slug: city }];
    return list
      .map((c) => ({
        slug: c.slug,
        label: c.noData ? `${cityName(c, lang)} — ${t('noData')}` : cityName(c, lang),
        disabled: !!c.noData && c.slug !== city,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, lang));
  }, [cities, city, lang, t]);

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
                <option key={c.slug} value={c.slug} disabled={c.disabled}>
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

          <div className="field">
            <span className="label">{t('alertLead')}</span>
            <div className="segmented">
              {ALERT_LEADS.map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  className={alertLead === minutes ? 'on' : ''}
                  onClick={() => onAlertLeadChange(minutes)}
                >
                  {minutes}
                  {t('minShort')}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}
