import { useEffect, useState } from 'react';

function Ago({ fetchedAt, t }) {
  const [, force] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => force((n) => n + 1), 5000);
    return () => clearInterval(timer);
  }, []);

  if (!fetchedAt) return null;
  const seconds = Math.max(0, Math.round((Date.now() - fetchedAt) / 1000));
  return (
    <span className="ago">
      {t('updated')} {seconds < 5 ? t('justNow') : t('secondsAgo', { n: seconds })}
    </span>
  );
}

export default function StopSheet({
  stop,
  arrivals,
  loading,
  error,
  refreshing,
  onRefresh,
  onClose,
  isFavourite,
  onToggleFavourite,
  onLocateVehicle,
  t,
}) {
  const vehicles = arrivals?.vehicles ?? [];

  return (
    <>
      <header className="sheet-head">
        <div className="sheet-title">
          <h2>{stop.name}</h2>
          <p className="muted">
            {t('stop')} {stop.code}
            {refreshing && <span className="dot-pulse" aria-hidden="true" />}
          </p>
        </div>
        <div className="sheet-actions">
          <button
            type="button"
            className={`icon-btn star ${isFavourite ? 'on' : ''}`}
            onClick={onToggleFavourite}
            aria-pressed={isFavourite}
            aria-label={isFavourite ? t('removeFavourite') : t('addFavourite')}
            title={isFavourite ? t('removeFavourite') : t('addFavourite')}
          >
            {isFavourite ? '★' : '☆'}
          </button>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t('close')}>
            ✕
          </button>
        </div>
      </header>

      {loading && <p className="state">{t('loading')}</p>}

      {!loading && error && (
        <div className="state error">
          <p>{error.message || t('error')}</p>
          <button type="button" className="btn" onClick={onRefresh}>
            {t('retry')}
          </button>
        </div>
      )}

      {!loading && !error && vehicles.length === 0 && <p className="state">{t('noService')}</p>}

      {vehicles.length > 0 && (
        <ul className="arrivals">
          {vehicles.map((vehicle) => (
            <li key={vehicle.vehicleCode}>
              <span
                className="line-badge"
                style={{
                  background: vehicle.lineColor || '#1d4ed8',
                  color: vehicle.lineTextColor || '#fff',
                  borderColor: vehicle.borderColor || 'transparent',
                }}
              >
                {vehicle.lineCode}
              </span>
              <span className="line-text">
                <strong>{vehicle.lineName}</strong>
                <small>{vehicle.routeName}</small>
              </span>
              {vehicle.hasPosition && (
                <button
                  type="button"
                  className="icon-btn locate"
                  onClick={() => onLocateVehicle(vehicle)}
                  aria-label={t('showOnMap')}
                  title={t('showOnMap')}
                >
                  ◎
                </button>
              )}
              <span className={`eta ${vehicle.departureMins <= 0 ? 'now' : ''}`}>
                {vehicle.departureMins <= 0 ? (
                  t('arriving')
                ) : (
                  <>
                    {vehicle.departureMins}
                    <i>{t('minShort')}</i>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {arrivals?.fetchedAt && (
        <footer className="sheet-foot">
          <Ago fetchedAt={arrivals.fetchedAt} t={t} />
          <button type="button" className="btn ghost" onClick={onRefresh}>
            ↻
          </button>
        </footer>
      )}
    </>
  );
}
