import { useEffect, useMemo, useRef } from 'react';
import { CircleMarker, MapContainer, Marker, TileLayer, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';

// Kept as constants: OpenStreetMap asks that heavy apps not lean on their tile
// servers, so this is the one line to change if the app ever outgrows them.
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const FALLBACK_CENTER = [35.3387, 25.1442]; // Heraklion, used only until stops load

// The top bar and the bottom sheet float over the map, so anything the user is
// meant to look at has to be steered into the band between them.
const TOP_INSET = 76;
const SHEET_INSET = (height) => Math.min(Math.round(height * 0.42), 360);

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

function busIcon(vehicle) {
  const background = vehicle.lineColor || '#1d4ed8';
  const text = vehicle.lineTextColor || '#ffffff';
  const border = vehicle.borderColor || background;
  return L.divIcon({
    className: 'bus-marker',
    html: `<span style="background:${escapeHtml(background)};color:${escapeHtml(text)};border-color:${escapeHtml(border)}">${escapeHtml(vehicle.lineCode)}</span>`,
    iconSize: [36, 24],
    iconAnchor: [18, 12],
  });
}

const userIcon = L.divIcon({
  className: 'user-marker',
  html: '<span></span>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

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
function FitToStops({ stops, cityKey }) {
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
          const usable = y - TOP_INSET - SHEET_INSET(y);
          map.fitBounds(
            bounds,
            usable >= 180
              ? { paddingTopLeft: [24, TOP_INSET], paddingBottomRight: [24, SHEET_INSET(y)] }
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
  }, [stops, cityKey, map]);

  return null;
}

/** Pans to whatever the user just asked to look at (a stop, a bus, themselves). */
function PanTo({ target }) {
  const map = useMap();
  useEffect(() => {
    if (!target) return;
    const zoom = Math.max(map.getZoom(), target.zoom ?? 16);
    const { y } = map.getSize();

    // Centring would drop the target behind the sheet, so shift the view down by
    // half the hidden height — the target then lands in the visible band above it.
    const hidden = SHEET_INSET(y) - TOP_INSET;
    const centre =
      hidden > 0
        ? map.unproject(map.project([target.lat, target.lon], zoom).add([0, hidden / 2]), zoom)
        : L.latLng(target.lat, target.lon);

    map.flyTo(centre, zoom, { duration: 0.6 });
  }, [target, map]);
  return null;
}

export default function StopMap({
  stops,
  cityKey,
  selectedStop,
  onSelectStop,
  vehicles = [],
  userPosition,
  panTarget,
  t,
}) {
  const positioned = useMemo(() => vehicles.filter((v) => v.hasPosition), [vehicles]);

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
      <FitToStops stops={stops} cityKey={cityKey} />
      <PanTo target={panTarget} />

      {stops.map((stop) => {
        const isSelected = selectedStop?.code === stop.code;
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
      })}

      {positioned.map((vehicle) => (
        <Marker
          key={vehicle.vehicleCode}
          position={[vehicle.latitude, vehicle.longitude]}
          icon={busIcon(vehicle)}
          zIndexOffset={1000}
        >
          <Tooltip direction="top" offset={[0, -10]}>
            {vehicle.lineName} · {vehicle.departureMins}
            {t('minShort')}
          </Tooltip>
        </Marker>
      ))}

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
