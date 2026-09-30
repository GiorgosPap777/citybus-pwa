import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { errorMessage } from '../i18n.js';

const prefersReducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

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

const stopsAwayLabel = (n, t) => (n === 1 ? t('nextStopAway') : t('stopsAway', { n }));

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
 *
 * While a bus is followed, a Back chip leads the row. Following a bus collapses
 * the sheet, and the only way back to the full list was to know the header
 * expands it — users did not, and closed the stop instead.
 */
function Peek({ vehicles, loading, focusedVehicle, stopsAway, onFocusVehicle, onUnfocus, t }) {
  if (loading) return null;
  const back = focusedVehicle && (
    <button
      type="button"
      className="peek-chip back"
      onClick={onUnfocus}
      aria-label={t('backToArrivals')}
      title={t('backToArrivals')}
    >
      <Icon name="chevronLeft" size={16} />
      {t('back')}
    </button>
  );
  if (!vehicles.length) {
    return back ? (
      <div className="peek">
        {back}
        <p className="hint">{t('noService')}</p>
      </div>
    ) : (
      <p className="hint">{t('noService')}</p>
    );
  }
  return (
    <div className="peek">
      {back}
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
            {focused && stopsAway != null && (
              <small className="chip-note">{stopsAwayLabel(stopsAway, t)}</small>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Sets or clears an arrival alert for one bus. Hidden once a bus is a minute out,
 * where an alert could only come too late, but kept while set so it can be cleared.
 */
function AlertBell({ vehicle, alert, lead, onToggle, t }) {
  const on = alert?.vehicleCode === vehicle.vehicleCode;
  if (!on && vehicle.departureMins <= 1) return <span className="bell-btn" aria-hidden="true" />;
  // What a tap would set; see useArrivalAlert.
  const minutes = vehicle.departureMins > lead ? lead : 1;
  return (
    <button
      type="button"
      className={`bell-btn ${on ? 'on' : ''}`}
      onClick={() => onToggle(vehicle)}
      aria-pressed={on}
      aria-label={on ? t('alertOff') : t('alertOn', { n: minutes })}
      title={on ? t('alertOff') : t('alertOn', { n: minutes })}
    >
      <Icon name="bell" size={17} filled={on} />
      {on && (
        <small>
          {alert.minutes}
          {t('minShort')}
        </small>
      )}
    </button>
  );
}

/**
 * The next timetabled departures. Alone (no live buses) it is the main content
 * and always open. Beside live arrivals it is optional, so its heading becomes a
 * toggle: one line when closed, which is all the space a busy stop can spare.
 */
function ScheduleList({ schedule, open = true, onToggle, t }) {
  const sectionRef = useRef(null);
  const reveal = useRef(false);

  // Opened from the bottom of a long list, the times land below the fold and the
  // toggle looks like it did nothing. Scroll just far enough to show the first
  // few: revealing the whole section would push every live bus out of view.
  const hasData = !!schedule.data;
  useEffect(() => {
    if (!reveal.current || !open || !hasData) return;
    reveal.current = false;
    const rows = sectionRef.current?.querySelectorAll('li');
    const target = rows?.length ? rows[Math.min(2, rows.length - 1)] : sectionRef.current;
    target?.scrollIntoView({
      block: 'nearest',
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
  }, [open, hasData]);

  const head = onToggle ? (
    <h3 className="section-head">
      <button
        type="button"
        className="section-toggle"
        onClick={() => {
          reveal.current = !open;
          onToggle();
        }}
        aria-expanded={open}
      >
        <Icon name="clock" size={15} />
        <span>{t('timetable')}</span>
        <Icon name="chevronDown" size={16} />
      </button>
    </h3>
  ) : (
    <h3 className="section-head">{t('scheduledHead')}</h3>
  );

  if (!open) return <section>{head}</section>;
  if (schedule.loading) {
    return (
      <section>
        {onToggle && head}
        <p className="state">{t('loading')}</p>
      </section>
    );
  }
  if (schedule.error || !schedule.data) {
    // Alone, a failed timetable says nothing rather than add a second error to
    // "no buses"; behind its toggle, the user asked for it and gets an answer.
    return onToggle ? (
      <section>
        {head}
        <p className="hint">{errorMessage(schedule.error, t)}</p>
      </section>
    ) : null;
  }

  // The list was computed when fetched; drop what has left since, rather than
  // refetching, while the sheet stays open.
  const now = Date.now();
  const departures = schedule.data.departures.filter((d) => d.departsAt >= now - 60_000);

  return (
    <section ref={sectionRef}>
      {head}
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
  timetableShown,
  onToggleTimetable,
  loading,
  error,
  refreshing,
  onRefresh,
  onClose,
  isFavourite,
  onToggleFavourite,
  focusedVehicle,
  stopsAway,
  onFocusVehicle,
  onUnfocus,
  alert,
  alertLead,
  onToggleAlert,
  onShare,
  collapsed,
  gripProps,
  t,
}) {
  const vehicles = arrivals?.vehicles ?? [];

  return (
    <>
      <header className="sheet-head grip" {...gripProps}>
        <div className="sheet-title">
          {/* A stop opened from a link has only its code until the stop list arrives. */}
          <h2>{stop.name || t('loading')}</h2>
          <p className="muted">
            {t('stop')} {stop.code}
            {refreshing && <span className="dot-pulse" aria-hidden="true" />}
          </p>
        </div>
        <div className="sheet-actions">
          <button
            type="button"
            className="icon-btn"
            onClick={onShare}
            aria-label={t('share')}
            title={t('share')}
          >
            <Icon name="share" />
          </button>
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
          stopsAway={stopsAway}
          onFocusVehicle={onFocusVehicle}
          onUnfocus={onUnfocus}
          t={t}
        />
      ) : (
        <>
          {loading && <p className="state">{t('loading')}</p>}

          {!loading && error && (
            <div className="state error" role="status">
              <p>{errorMessage(error, t)}</p>
              <button type="button" className="btn" onClick={onRefresh}>
                {t('retry')}
              </button>
            </div>
          )}

          {!loading && !error && vehicles.length === 0 && (
            <p className="state">{t('noService')}</p>
          )}

          {/* With no live buses, whether none are due or live data failed, the
              timetable is the only answer left. */}
          {!loading && vehicles.length === 0 && <ScheduleList schedule={schedule} t={t} />}

          {vehicles.length > 0 && (
            <ul className="arrivals">
              {vehicles.map((vehicle) => {
                const focused = vehicle.vehicleCode === focusedVehicle;
                return (
                  <li key={vehicle.vehicleCode} className={`live ${focused ? 'focused' : ''}`}>
                    {/* The whole row is the target: a small icon button alone went unnoticed. */}
                    <button
                      type="button"
                      className="row"
                      onClick={() => onFocusVehicle(vehicle)}
                      aria-pressed={focused}
                      title={t('showRoute')}
                    >
                      <LineBadge line={vehicle} />
                      <span className="line-text">
                        <strong>{vehicle.lineName}</strong>
                        <small>{vehicle.routeName}</small>
                        {focused && stopsAway != null && (
                          <small className="stops-away">{stopsAwayLabel(stopsAway, t)}</small>
                        )}
                      </span>
                      <span className="row-hint" aria-hidden="true">
                        <Icon name={vehicle.hasPosition ? 'locate' : 'route'} size={16} />
                      </span>
                      <Eta minutes={vehicle.departureMins} t={t} />
                    </button>
                    <AlertBell
                      vehicle={vehicle}
                      alert={alert}
                      lead={alertLead}
                      onToggle={onToggleAlert}
                      t={t}
                    />
                  </li>
                );
              })}
            </ul>
          )}

          {vehicles.length > 0 && (
            <ScheduleList
              schedule={schedule}
              open={timetableShown}
              onToggle={onToggleTimetable}
              t={t}
            />
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
