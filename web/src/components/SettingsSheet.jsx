export default function SettingsSheet({ cities, city, onCityChange, lang, onLangChange, onClose, t }) {
  return (
    <>
      <header className="sheet-head">
        <div className="sheet-title">
          <h2>{t('settings')}</h2>
        </div>
        <div className="sheet-actions">
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t('close')}>
            ✕
          </button>
        </div>
      </header>

      <div className="field">
        <label htmlFor="city-select">{t('city')}</label>
        <select
          id="city-select"
          value={city}
          onChange={(e) => onCityChange(e.target.value)}
        >
          {cities.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.name}
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
  );
}
