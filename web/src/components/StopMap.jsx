import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Circle,
  CircleMarker,
  MapContainer,
  Marker,
  Pane,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import L from 'leaflet';

// Kept as constants: OpenStreetMap asks that heavy apps not lean on their tile
// servers, so this is the one line to change if the app ever outgrows them.
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const FALLBACK_CENTER = [35.3387, 25.1442]; // Heraklion, used only until stops load

// The top bar and the bottom sheet float over the map, so anything the user is
// meant to look at has to be steered into the band between them. The sheet's
// real height comes from `getBottomInset` (it collapses and grows with content);
// SHEET_INSET is the estimate used when that is not available.
const TOP_INSET = 76;
const SHEET_INSET = (height) => Math.min(Math.round(height * 0.42), 360);
// Below this much visible map, steering into the band does more harm than good.
const MIN_BAND_PX = 160;

// Buses report a new position every poll (15s). A short glide reads as movement
// without ever drawing a bus somewhere it has not been reported.
const GLIDE_MS = 1500;
// A jump longer than this is a new trip or a GPS glitch, not travel. Animating it
// would sweep a bus across town.
const MAX_GLIDE_M = 1500;

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

// Leaflet replaces a marker's DOM whenever it is handed a new icon object, so
// icons are reused rather than rebuilt on every render.
const busIcons = new Map();
function busIcon(vehicle, focused) {
  const background = vehicle.lineColor || '#1d4ed8';
  const text = vehicle.lineTextColor || '#ffffff';
  const border = vehicle.borderColor || background;
  const key = [vehicle.lineCode, background, text, border, focused].join('|');
  if (!busIcons.has(key)) {
    busIcons.set(
      key,
      L.divIcon({
        className: `bus-marker${focused ? ' focused' : ''}`,
        html: `<span style="background:${escapeHtml(background)};color:${escapeHtml(text)};border-color:${escapeHtml(border)}">${escapeHtml(vehicle.lineCode)}</span>`,
        iconSize: [36, 24],
        iconAnchor: [18, 12],
      }),
    );
  }
  return busIcons.get(key);
}

const userIcon = L.divIcon({
  className: 'user-marker',
  html: '<span></span>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

const prefersReducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** Visible map height below the top bar and above the sheet, and the sheet's height. */
function visibleBand(map, getBottomInset) {
  const { y } = map.getSize();
  const bottom = getBottomInset?.() ?? SHEET_INSET(y);
  return { bottom, band: y - TOP_INSET - bottom };
}

/**
 * Leaflet measures its container once at init and then only on a window resize.
 * That is not enough on a phone: rotating the device, the on-screen keyboard
 * opening, or the browser chrome collapsing all change the map's box without a
 * window resize event, leaving the map rendered at the wrong scale.
 */
function KeepSizeInSync() {
  const map = useMap();
  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize({ animate: false }));
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  return null;
}

/** Frames the whole network the first time a city's stops arrive. */
function FitToStops({ stops, cityKey, getBottomInset }) {
  const map = useMap();
  const fittedFor = useRef(null);

  useEffect(() => {
    if (!stops.length || fittedFor.current === cityKey) return undefined;

    let frame = 0;
    const attempt = (remaining) => {
      map.invalidateSize({ animate: false });
      const { x, y } = map.getSize();

      // fitBounds against a not-yet-laid-out container resolves to max zoom and
      // strands every stop off-screen, so wait for a real size before framing.
      if (x > 80 && y > 80) {
        const bounds = L.latLngBounds(stops.map((s) => [s.latitude, s.longitude]));
        if (bounds.isValid()) {
          // Frame the network into the strip that is actually visible, between the
          // top bar and the sheet — otherwise half the city sits under the sheet.
          const { bottom, band } = visibleBand(map, getBottomInset);
          map.fitBounds(
            bounds,
            band >= MIN_BAND_PX
              ? { paddingTopLeft: [24, TOP_INSET], paddingBottomRight: [24, bottom] }
              : { padding: [24, 24] },
          );
          fittedFor.current = cityKey;
          return;
        }
      }
      if (remaining > 0) frame = requestAnimationFrame(() => attempt(remaining - 1));
    };

    attempt(10);
    return () => cancelAnimationFrame(frame);
  }, [stops, cityKey, map, getBottomInset]);

  return null;
}

/**
 * Pans to whatever the user just asked to look at: a point (a stop, themselves)
 * or bounds (a bus together with the stop it is heading for).
 */
function PanTo({ target, getBottomInset }) {
  const map = useMap();
  useEffect(() => {
    if (!target) return;
    const { bottom, band } = visibleBand(map, getBottomInset);

    if (target.bounds) {
      map.flyToBounds(target.bounds, {
        ...(band >= MIN_BAND_PX
          ? { paddingTopLeft: [48, TOP_INSET + 24], paddingBottomRight: [48, bottom + 24] }
          : { padding: [32, 32] }),
        maxZoom: 17,
        duration: 0.6,
      });
      return;
    }

    const zoom = Math.max(map.getZoom(), target.zoom ?? 16);
    // Centring would drop the target behind the sheet, so shift the view down by
    // half the hidden height — the target then lands in the visible band above it.
    const hidden = bottom - TOP_INSET;
    const centre =
      hidden > 0
        ? map.unproject(map.project([target.lat, target.lon], zoom).add([0, hidden / 2]), zoom)
        : L.latLng(target.lat, target.lon);

    map.flyTo(centre, zoom, { duration: 0.6 });
  }, [target, map, getBottomInset]);
  return null;
}

/** Reports drags the user makes; programmatic pans (flyTo) do not fire dragstart. */
function OnUserDrag({ onDrag }) {
  useMapEvents({ dragstart: onDrag });
  return null;
}

/** A marker that glides to each new position instead of jumping to it. */
function GlidingMarker({ position, ...props }) {
  const markerRef = useRef(null);
  // react-leaflet moves the marker itself whenever `position` changes identity,
  // which would cut every glide short. It gets the first position only; later
  // ones are animated here.
  const [initial] = useState(position);
  const [lat, lon] = position;

  useEffect(() => {
    const marker = markerRef.current;
    if (!marker) return undefined;
    const from = marker.getLatLng();
    const to = L.latLng(lat, lon);
    if (from.equals(to) || prefersReducedMotion() || from.distanceTo(to) > MAX_GLIDE_M) {
      marker.setLatLng(to);
      return undefined;
    }

    let frame = 0;
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / GLIDE_MS);
      const eased = 1 - (1 - t) ** 3;
      marker.setLatLng([
        from.lat + (to.lat - from.lat) * eased,
        from.lng + (to.lng - from.lng) * eased,
      ]);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    // An interrupted glide leaves the marker mid-way; the next one starts from there.
    return () => cancelAnimationFrame(frame);
  }, [lat, lon]);

  return <Marker ref={markerRef} position={initial} {...props} />;
}

export default function StopMap({
  stops,
  cityKey,
  selectedStop,
  onSelectStop,
  vehicles = [],
  focusedVehicle,
  onSelectVehicle,
  routePoints,
  routeColor,
  userPosition,
  panTarget,
  getBottomInset,
  onUserDrag,
  t,
}) {
  const positioned = useMemo(() => vehicles.filter((v) => v.hasPosition), [vehicles]);
  const selectedCode = selectedStop?.code;

  // Memoised so a live poll (every 15s) does not restyle all ~500 stop markers:
  // react-leaflet calls setStyle whenever it sees a new pathOptions object, and
  // on the canvas renderer each of those is a redraw.
  const stopMarkers = useMemo(
    () =>
      stops.map((stop) => {
        const isSelected = selectedCode === stop.code;
        return (
          <CircleMarker
            key={stop.code}
            center={[stop.latitude, stop.longitude]}
            radius={isSelected ? 9 : 5}
            pathOptions={{
              color: isSelected ? '#ffffff' : '#0b3b8c',
              weight: isSelected ? 3 : 1.5,
              fillColor: isSelected ? '#f59e0b' : '#2563eb',
              fillOpacity: 1,
            }}
            eventHandlers={{ click: () => onSelectStop(stop) }}
          >
            <Tooltip direction="top" offset={[0, -6]}>
              {stop.name}
            </Tooltip>
          </CircleMarker>
        );
      }),
    [stops, selectedCode, onSelectStop],
  );

  return (
    <MapContainer
      center={FALLBACK_CENTER}
      zoom={13}
      className="map"
      zoomControl={false}
      preferCanvas
    >
      <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} maxZoom={19} />

      <KeepSizeInSync />
      <FitToStops stops={stops} cityKey={cityKey} getBottomInset={getBottomInset} />
      <PanTo target={panTarget} getBottomInset={getBottomInset} />
      <OnUserDrag onDrag={onUserDrag} />

      {/* Below the stops' pane (400), so the route line never hides a stop. */}
      <Pane name="beneath-stops" style={{ zIndex: 390 }}>
        {routePoints && (
          <>
            <Polyline
              positions={routePoints}
              pathOptions={{ color: '#ffffff', weight: 9, opacity: 0.9 }}
              interactive={false}
            />
            <Polyline
              positions={routePoints}
              pathOptions={{ color: routeColor || '#1d4ed8', weight: 5, opacity: 0.95 }}
              interactive={false}
            />
          </>
        )}
        {userPosition?.accuracy > 25 && userPosition.accuracy < 1000 && (
          <Circle
            center={[userPosition.lat, userPosition.lon]}
            radius={userPosition.accuracy}
            pathOptions={{ color: '#2563eb', weight: 1, opacity: 0.4, fillOpacity: 0.1 }}
            interactive={false}
          />
        )}
      </Pane>

      {stopMarkers}

      {positioned.map((vehicle) => {
        const focused = vehicle.vehicleCode === focusedVehicle;
        return (
          <GlidingMarker
            key={vehicle.vehicleCode}
            position={[vehicle.latitude, vehicle.longitude]}
            icon={busIcon(vehicle, focused)}
            zIndexOffset={focused ? 2000 : 1000}
            eventHandlers={{ click: () => onSelectVehicle(vehicle) }}
          >
            <Tooltip direction="top" offset={[0, -10]}>
              {vehicle.lineName} · {vehicle.departureMins}
              {t('minShort')}
            </Tooltip>
          </GlidingMarker>
        );
      })}

      {userPosition && (
        <Marker
          position={[userPosition.lat, userPosition.lon]}
          icon={userIcon}
          zIndexOffset={500}
        >
          <Tooltip direction="top" offset={[0, -8]}>
            {t('myLocation')}
          </Tooltip>
        </Marker>
      )}
    </MapContainer>
  );
}
