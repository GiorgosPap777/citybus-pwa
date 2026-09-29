import { useEffect, useState } from 'react';
import Icon from './Icon.jsx';

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

function LineBadge({ line }) {
  return (
    <span
      className="line-badge"
      style={{
        background: line.lineColor || '#1d4ed8',
        color: line.lineTextColor || '#fff',
        borderColor: line.borderColor || 'transparent',
      }}
    >
      {line.lineCode}
    </span>
  );
}

function Eta({ minutes, t }) {
  if (minutes <= 0) return <span className="eta now">{t('arriving')}</span>;
  return (
    <span className="eta">
      {minutes}
      <i>{t('minShort')}</i>
    </span>
  );
}

/**
 * What a collapsed sheet still shows: the next buses as chips, so the map can
 * have the screen without the user losing the minute counts. Scrolls sideways
 * when there are more than fit.
 */
function Peek({ vehicles, loading, focusedVehicle, onFocusVehicle, t }) {
  if (loading) return null;
  if (!vehicles.length) return <p className="hint">{t('noService')}</p>;
  return (
    <div className="peek">
      {vehicles.map((vehicle) => {
        const focused = vehicle.vehicleCode === focusedVehicle;
        return (
          <button
            key={vehicle.vehicleCode}
            type="button"
            className={`peek-chip ${focused ? 'on' : ''}`}
            onClick={() => onFocusVehicle(vehicle)}
            aria-pressed={focused}
            title={t('showRoute')}
          >
            <LineBadge line={vehicle} />
            <Eta minutes={vehicle.departureMins} t={t} />
          </button>
        );
      })}
    </div>
  );
}

function ScheduleList({ schedule, t }) {
  if (schedule.loading) return <p className="state">{t('loading')}</p>;
  if (schedule.error || !schedule.data) return null;

  // The list was computed when fetched; drop what has left since, rather than
  // refetching, while the sheet stays open.
  const now = Date.now();
  const departures = schedule.data.departures.filter((d) => d.departsAt >= now - 60_000);

  return (
    <section>
      <h3 className="section-head">{t('scheduledHead')}</h3>
      {departures.length === 0 ? (
        <p className="hint">{t('noScheduled')}</p>
      ) : (
        <ul className="arrivals">
          {departures.map((d) => (
            <li key={`${d.departsAt}:${d.lineCode}:${d.routeName}`}>
              <div className="row">
                <LineBadge line={d} />
                <span className="line-text">
                  <strong>{d.lineName}</strong>
                  <small>{d.routeName}</small>
                </span>
                <span className="eta scheduled">
                  {d.tomorrow && <i>{t('tomorrow')}</i>}
                  {d.time}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function StopSheet({
  stop,
  arrivals,
  schedule,
  loading,
  error,
  refreshing,
  onRefresh,
  onClose,
  isFavourite,
  onToggleFavourite,
  focusedVehicle,
  onFocusVehicle,
  collapsed,
  gripProps,
  t,
}) {
  const vehicles = arrivals?.vehicles ?? [];

  return (
    <>
      <header className="sheet-head grip" {...gripProps}>
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
            <Icon name="star" filled={isFavourite} />
          </button>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t('close')}>
            <Icon name="close" />
          </button>
        </div>
      </header>

      {collapsed ? (
        <Peek
          vehicles={vehicles}
          loading={loading}
          focusedVehicle={focusedVehicle}
          onFocusVehicle={onFocusVehicle}
          t={t}
        />
      ) : (
        <>
          {loading && <p className="state">{t('loading')}</p>}

          {!loading && error && (
            <div className="state error">
              <p>{error.message || t('error')}</p>
              <button type="button" className="btn" onClick={onRefresh}>
                {t('retry')}
              </button>
            </div>
          )}

          {!loading && !error && vehicles.length === 0 && (
            <>
              <p className="state">{t('noService')}</p>
              <ScheduleList schedule={schedule} t={t} />
            </>
          )}

          {vehicles.length > 0 && (
            <ul className="arrivals">
              {vehicles.map((vehicle) => {
                const focused = vehicle.vehicleCode === focusedVehicle;
                return (
                  <li key={vehicle.vehicleCode}>
                    {/* The whole row is the target: a small icon button alone went unnoticed. */}
                    <button
                      type="button"
                      className={`row ${focused ? 'focused' : ''}`}
                      onClick={() => onFocusVehicle(vehicle)}
                      aria-pressed={focused}
                      title={t('showRoute')}
                    >
                      <LineBadge line={vehicle} />
                      <span className="line-text">
                        <strong>{vehicle.lineName}</strong>
                        <small>{vehicle.routeName}</small>
                      </span>
                      <span className="row-hint" aria-hidden="true">
                        <Icon name={vehicle.hasPosition ? 'locate' : 'route'} size={16} />
                      </span>
                      <Eta minutes={vehicle.departureMins} t={t} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {arrivals?.fetchedAt && (
            <footer className="sheet-foot">
              <Ago fetchedAt={arrivals.fetchedAt} t={t} />
              <button
                type="button"
                className="icon-btn"
                onClick={onRefresh}
                aria-label={t('refresh')}
                title={t('refresh')}
              >
                <Icon name="refresh" size={16} />
              </button>
            </footer>
          )}
        </>
      )}
    </>
  );
}
