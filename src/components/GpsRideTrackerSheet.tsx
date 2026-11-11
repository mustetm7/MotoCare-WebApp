import React from 'react';
import { Motorcycle, UserSubscription } from '../types';
import { X, Headphones, Bike, Pause, Play, ArrowRight, MapPin, Navigation } from 'lucide-react';
import { sounds } from '../utils/audio';
import L from 'leaflet';

interface GpsRideTrackerSheetProps {
  bike: Motorcycle;
  subscription: UserSubscription;
  hasProAccess?: boolean;
  onFinishRide: (distanceKm: number) => void;
  onClose?: () => void;
  onOpenPaywall?: () => void;
}

const DEFAULT_MANILA_COORDS: [number, number] = [14.5995, 120.9842];
export const AUTO_PAUSE_STATIONARY_THRESHOLD_SECONDS = 300; // 5 minutes

export const GpsRideTrackerSheet: React.FC<GpsRideTrackerSheetProps> = ({
  bike,
  subscription,
  hasProAccess,
  onFinishRide,
  onClose,
  onOpenPaywall,
}) => {
  const isPro =
    hasProAccess ??
    (subscription.tier === 'pro' &&
      subscription.status === 'active' &&
      !subscription.isExpired);

  // Live ride states
  const [isPaused, setIsPaused] = React.useState(false);
  const [autoPauseEnabled, setAutoPauseEnabled] = React.useState(true);
  const [isAutoPaused, setIsAutoPaused] = React.useState(false);
  const [stationarySeconds, setStationarySeconds] = React.useState(0);
  const [elapsedSeconds, setElapsedSeconds] = React.useState(8);
  const [distanceKm, setDistanceKm] = React.useState(0.0);
  const [currentSpeed, setCurrentSpeed] = React.useState(0);
  const [topSpeed, setTopSpeed] = React.useState(0);
  const [isSimulating, setIsSimulating] = React.useState(false);
  const [routeCoords, setRouteCoords] = React.useState<[number, number][]>([
    DEFAULT_MANILA_COORDS,
  ]);

  const stationarySecondsRef = React.useRef(0);
  const isAutoPausedRef = React.useRef(false);
  const lastMoveTimestampRef = React.useRef<number | null>(null);

  // Leaflet Mini-Map refs
  const mapContainerRef = React.useRef<HTMLDivElement | null>(null);
  const leafletMapRef = React.useRef<L.Map | null>(null);
  const routePolylineRef = React.useRef<L.Polyline | null>(null);
  const startMarkerRef = React.useRef<L.CircleMarker | null>(null);
  const currentMarkerRef = React.useRef<L.CircleMarker | null>(null);

  // Initialize Leaflet Mini-Map
  React.useEffect(() => {
    if (!isPro || !mapContainerRef.current || leafletMapRef.current) return;

    try {
      const map = L.map(mapContainerRef.current, {
        center: DEFAULT_MANILA_COORDS,
        zoom: 15,
        zoomControl: false,
        attributionControl: false,
      });

      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
      }).addTo(map);

      const polyline = L.polyline([DEFAULT_MANILA_COORDS], {
        color: '#FF6B00',
        weight: 4,
        opacity: 0.9,
        lineJoin: 'round',
      }).addTo(map);

      const startMarker = L.circleMarker(DEFAULT_MANILA_COORDS, {
        radius: 5,
        fillColor: '#10B981',
        color: '#FFFFFF',
        weight: 2,
        fillOpacity: 1,
      }).addTo(map);

      const currentMarker = L.circleMarker(DEFAULT_MANILA_COORDS, {
        radius: 7,
        fillColor: '#FF6B00',
        color: '#FFFFFF',
        weight: 2.5,
        fillOpacity: 1,
      }).addTo(map);

      leafletMapRef.current = map;
      routePolylineRef.current = polyline;
      startMarkerRef.current = startMarker;
      currentMarkerRef.current = currentMarker;
    } catch {
      // Safe fallback in headless/test environments
    }

    return () => {
      if (leafletMapRef.current) {
        try {
          leafletMapRef.current.remove();
        } catch {
          // ignore cleanup error in JSDOM
        }
        leafletMapRef.current = null;
        routePolylineRef.current = null;
        startMarkerRef.current = null;
        currentMarkerRef.current = null;
      }
    };
  }, [isPro]);

  // Sync route coordinates to Leaflet polyline & rider position marker
  React.useEffect(() => {
    if (!leafletMapRef.current || routeCoords.length === 0) return;
    try {
      const firstCoord = routeCoords[0];
      const latestCoord = routeCoords[routeCoords.length - 1];

      routePolylineRef.current?.setLatLngs(routeCoords);
      startMarkerRef.current?.setLatLng(firstCoord);
      currentMarkerRef.current?.setLatLng(latestCoord);
      leafletMapRef.current.panTo(latestCoord, { animate: false });
    } catch {
      // Safe fallback in JSDOM
    }
  }, [routeCoords]);

  const handleRecenterMap = () => {
    if (!leafletMapRef.current || routeCoords.length === 0) return;
    const latestCoord = routeCoords[routeCoords.length - 1];
    try {
      leafletMapRef.current.setView(latestCoord, 15, { animate: false });
    } catch {
      // Safe fallback
    }
  };

  // Active ride timer & stationary >5-minute auto-pause detector
  React.useEffect(() => {
    if (!isPro || isPaused) return;

    const timer = setInterval(() => {
      if (isSimulating) {
        stationarySecondsRef.current = 0;
        setStationarySeconds(0);
        setIsAutoPaused(false);
        setElapsedSeconds((prev) => prev + 1);

        // Generate realistic scooter ride simulation (30 - 55 km/h)
        const simSpeed = Math.floor(38 + Math.sin(Date.now() / 2000) * 12);
        setCurrentSpeed(simSpeed);
        setTopSpeed((prev) => Math.max(prev, simSpeed));
        setDistanceKm((prev) => +(prev + simSpeed / 3600).toFixed(4));
        setRouteCoords((prev) => {
          const last = prev[prev.length - 1] || DEFAULT_MANILA_COORDS;
          const nextLat = +(last[0] + 0.00012).toFixed(6);
          const nextLng = +(last[1] + 0.00009 * Math.cos(prev.length / 3)).toFixed(6);
          return [...prev, [nextLat, nextLng]];
        });
        return;
      }

      if (currentSpeed <= 1) {
        const nextStationary = stationarySecondsRef.current + 1;
        stationarySecondsRef.current = nextStationary;
        setStationarySeconds(nextStationary);

        if (autoPauseEnabled && nextStationary >= AUTO_PAUSE_STATIONARY_THRESHOLD_SECONDS) {
          isAutoPausedRef.current = true;
          setIsAutoPaused(true);
          return;
        }
      } else {
        stationarySecondsRef.current = 0;
        setStationarySeconds(0);
        isAutoPausedRef.current = false;
        setIsAutoPaused(false);
      }

      if (!isAutoPausedRef.current && !isAutoPaused) {
        setElapsedSeconds((prev) => prev + 1);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [isPro, isPaused, isSimulating, currentSpeed, autoPauseEnabled, isAutoPaused]);

  // Real GPS Geolocation Watcher if not simulating
  React.useEffect(() => {
    if (!isPro || isSimulating || isPaused || !navigator.geolocation) return;

    let lastCoords: { lat: number; lng: number } | null = null;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const speedKmh = pos.coords.speed ? Math.round(pos.coords.speed * 3.6) : 0;
        setCurrentSpeed(speedKmh);
        setTopSpeed((prev) => Math.max(prev, speedKmh));

        const fixTimestamp = typeof pos.timestamp === 'number' ? pos.timestamp : Date.now();
        const nextCoord: [number, number] = [
          +pos.coords.latitude.toFixed(6),
          +pos.coords.longitude.toFixed(6),
        ];

        if (!lastCoords) {
          lastCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          lastMoveTimestampRef.current = fixTimestamp;
          setRouteCoords([nextCoord]);
          return;
        }

        // Haversine formula
        const R = 6371; // km
        const dLat = ((pos.coords.latitude - lastCoords.lat) * Math.PI) / 180;
        const dLon = ((pos.coords.longitude - lastCoords.lng) * Math.PI) / 180;
        const a =
          Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos((lastCoords.lat * Math.PI) / 180) *
            Math.cos((pos.coords.latitude * Math.PI) / 180) *
            Math.sin(dLon / 2) *
            Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const d = R * c;

        if (d > 0.005 && (!isAutoPausedRef.current || speedKmh > 1 || d > 0.025)) {
          // Significant movement detected (> 5m): clear stationary counter & auto-resume if auto-paused
          stationarySecondsRef.current = 0;
          setStationarySeconds(0);
          isAutoPausedRef.current = false;
          setIsAutoPaused(false);
          lastMoveTimestampRef.current = fixTimestamp;

          setDistanceKm((prev) => +(prev + d).toFixed(4));
          lastCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setRouteCoords((prev) => [...prev, nextCoord]);
        } else if (
          lastMoveTimestampRef.current !== null &&
          fixTimestamp - lastMoveTimestampRef.current >=
            AUTO_PAUSE_STATIONARY_THRESHOLD_SECONDS * 1000
        ) {
          // No significant movement for 5 consecutive minutes based on GPS fix timestamps: pause session
          const elapsedStationarySec = Math.floor(
            (fixTimestamp - lastMoveTimestampRef.current) / 1000
          );
          stationarySecondsRef.current = elapsedStationarySec;
          setStationarySeconds(elapsedStationarySec);
          if (autoPauseEnabled) {
            isAutoPausedRef.current = true;
            setIsAutoPaused(true);
          }
        }
      },
      () => {
        // fallback
      },
      { enableHighAccuracy: true, maximumAge: 1000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [isPro, isSimulating, isPaused, autoPauseEnabled]);

  // Format mm:ss
  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remainder = secs % 60;
    return `${mins.toString().padStart(2, '0')}:${remainder.toString().padStart(2, '0')}`;
  };

  const roundedAddedKm = Math.max(1, Math.round(distanceKm || 1));
  const previewNewOdo = bike.odometer + roundedAddedKm;
  const latestPosition = routeCoords[routeCoords.length - 1] || DEFAULT_MANILA_COORDS;
  const effectivelyPaused = isPaused || isAutoPaused;

  const handleFinish = () => {
    if (!isPro) {
      onClose?.();
      onOpenPaywall?.();
      return;
    }
    sounds.playSuccess();
    onFinishRide(roundedAddedKm);
    onClose?.();
  };

  if (!isPro) {
    return (
      <div className="w-full max-w-md mx-auto bg-white rounded-3xl shadow-xl border border-slate-100 p-6 text-center space-y-4">
        <h3 className="text-lg font-extrabold text-slate-900">
          Zero-Touch GPS Auto-Odometer is a Pro Feature
        </h3>
        <p className="text-xs text-slate-500">
          Upgrade to MotoCare Pro (₱49/mo) to unlock live GPS ride tracking and automatic odometer updates.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 text-xs font-bold text-slate-600 bg-slate-100 rounded-2xl"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              onClose?.();
              onOpenPaywall?.();
            }}
            className="flex-1 py-2.5 text-xs font-bold text-white bg-[#FF6B00] rounded-2xl"
          >
            Upgrade to Pro (₱49/mo)
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md mx-auto bg-white rounded-3xl shadow-xl border border-slate-100 p-5 space-y-4 animate-in fade-in duration-200 max-h-[92vh] overflow-y-auto">
      {/* Top Header matching screenshot 7 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* Live Tracking or Auto-Paused pill */}
          {isAutoPaused ? (
            <div
              data-testid="gps-auto-paused-badge"
              className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-amber-50 border border-amber-300 text-amber-800 text-xs font-bold"
            >
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              <span className="tracking-wide">AUTO-PAUSED (STATIONARY &gt;5M)</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-[#E8FAF0] border border-emerald-300 text-emerald-700 text-xs font-bold">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="tracking-wide">LIVE TRACKING</span>
            </div>
          )}

          {/* BT Auto-Sync */}
          <div className="flex items-center gap-1 text-xs font-bold text-[#00ACC1]">
            <Headphones className="w-3.5 h-3.5" />
            <span>BT Auto-Sync</span>
          </div>
        </div>

        {onClose && (
          <button
            type="button"
            onClick={onClose}
            title="Close GPS Ride Tracker"
            aria-label="Close GPS Ride Tracker"
            className="p-1.5 text-slate-400 hover:text-slate-800 rounded-xl hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Stationary Auto-Pause Notification Indicator Banner */}
      {isAutoPaused && (
        <div
          role="status"
          aria-live="polite"
          data-testid="gps-auto-pause-banner"
          className="p-3.5 rounded-2xl bg-amber-50 border border-amber-300 text-amber-900 text-xs font-medium flex items-center justify-between gap-2.5 shadow-xs"
        >
          <div className="space-y-0.5">
            <div className="font-extrabold text-amber-950 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
              <span>Ride Session Auto-Paused (5+ Mins No Movement)</span>
            </div>
            <p className="text-[11px] text-amber-800 leading-snug">
              No significant GPS movement detected for {Math.max(5, Math.floor(stationarySeconds / 60))} consecutive minutes. Timer and distance calculation are paused until you resume riding.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              sounds.playClick();
              stationarySecondsRef.current = 0;
              setStationarySeconds(0);
              isAutoPausedRef.current = false;
              setIsAutoPaused(false);
              setIsPaused(false);
            }}
            className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-[11px] shrink-0 cursor-pointer shadow-xs"
          >
            Resume Now
          </button>
        </div>
      )}

      {/* Tracking bike label */}
      <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
        <Bike className="w-4 h-4 text-[#FF6B00]" />
        <span>Tracking for: {bike.year} {bike.brand} {bike.model}</span>
      </div>

      {/* Live Leaflet Route Mini-Map View */}
      <div
        data-testid="gps-ride-leaflet-minimap"
        className="rounded-2xl border border-slate-200 overflow-hidden bg-slate-100 shadow-inner"
      >
        <div className="px-3 py-1.5 bg-slate-900 text-white flex items-center justify-between text-[10px]">
          <div className="flex items-center gap-1.5 font-bold">
            <MapPin className="w-3 h-3 text-[#FF6B00]" />
            <span>Live Route Mini-Map</span>
            <span className="text-slate-400 font-mono">
              ({latestPosition[0].toFixed(4)}, {latestPosition[1].toFixed(4)})
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-1.5 py-0.5 rounded bg-white/10 text-emerald-300 font-mono font-bold">
              {routeCoords.length} {routeCoords.length === 1 ? 'pt' : 'pts'}
            </span>
            <button
              type="button"
              onClick={handleRecenterMap}
              className="text-orange-300 hover:text-white font-bold flex items-center gap-0.5 cursor-pointer"
              title="Recenter map on current position"
              aria-label="Recenter map on current position"
            >
              <Navigation className="w-2.5 h-2.5" />
              <span>Recenter</span>
            </button>
          </div>
        </div>
      </div>

      {/* Speedometer display matching screenshot 7 */}
      <div className="text-center py-1 space-y-0.5">
        <div className="text-[11px] font-bold tracking-widest text-slate-400 uppercase">
          SPEED
        </div>
        <div className="text-6xl font-extrabold text-slate-900 tracking-tight font-mono leading-none">
          {currentSpeed}
        </div>
        <div className="text-sm font-bold text-[#FF6B00]">
          km/h
        </div>
      </div>

      {/* 3 Metrics Row matching screenshot 7 */}
      <div className="grid grid-cols-3 gap-2 text-center py-2 border-y border-slate-100">
        <div>
          <div className="text-[10px] font-bold text-slate-400 tracking-wider uppercase">DISTANCE</div>
          <div className="text-base font-extrabold text-[#FF6B00] font-mono mt-0.5">
            +{distanceKm.toFixed(2)} km
          </div>
        </div>

        <div>
          <div className="text-[10px] font-bold text-slate-400 tracking-wider uppercase">DURATION</div>
          <div className="text-base font-extrabold text-slate-900 font-mono mt-0.5">
            {formatTime(elapsedSeconds)}
          </div>
        </div>

        <div>
          <div className="text-[10px] font-bold text-slate-400 tracking-wider uppercase">TOP SPEED</div>
          <div className="text-base font-extrabold text-[#00ACC1] font-mono mt-0.5">
            {topSpeed} km/h
          </div>
        </div>
      </div>

      {/* Status Row, Auto-Pause Switch & Simulate Switch */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-1.5 text-slate-500 font-medium">
          <span className={`w-2 h-2 rounded-full ${isAutoPaused ? 'bg-amber-500' : 'bg-emerald-500'}`} />
          <span>{isAutoPaused ? 'Stationary Auto-Pause' : 'GPS Locked (±5m)'}</span>
        </div>

        <div className="flex items-center gap-3">
          <label
            className="flex items-center gap-1.5 cursor-pointer text-slate-600 font-medium"
            title="Automatically pause ride timer after 5 minutes stationary"
          >
            <input
              type="checkbox"
              checked={autoPauseEnabled}
              onChange={(e) => {
                const enabled = e.target.checked;
                setAutoPauseEnabled(enabled);
                if (!enabled) {
                  setIsAutoPaused(false);
                }
              }}
              className="w-3.5 h-3.5 rounded border-slate-300 text-[#FF6B00] focus:ring-[#FF6B00] cursor-pointer"
            />
            <span>Auto-Pause (5m)</span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer text-slate-600 font-medium">
            <span>Simulate Ride</span>
            <input
              type="checkbox"
              checked={isSimulating}
              onChange={(e) => setIsSimulating(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#FF6B00] relative"></div>
          </label>
        </div>
      </div>

      {/* Auto-Increment Preview Banner matching screenshot 7 */}
      <div className="p-3.5 rounded-2xl bg-[#FFFDF0] border border-amber-200 flex items-center justify-between">
        <div>
          <div className="text-[10px] font-bold text-amber-700 uppercase tracking-wide">
            Auto-Increment Preview
          </div>
          <div className="flex items-center gap-2 text-sm font-extrabold text-slate-900 font-mono mt-0.5">
            <span>{bike.odometer} km</span>
            <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
            <span>{previewNewOdo} km</span>
          </div>
        </div>

        <span className="px-3 py-1 rounded-xl bg-[#FF6B00] text-white text-xs font-black font-mono shadow-sm">
          +{roundedAddedKm} km
        </span>
      </div>

      {/* Bottom Action Buttons matching screenshot 7 */}
      <div className="grid grid-cols-12 gap-2.5 pt-1">
        <button
          type="button"
          onClick={() => {
            sounds.playClick();
            if (effectivelyPaused) {
              stationarySecondsRef.current = 0;
              setStationarySeconds(0);
              setIsAutoPaused(false);
              setIsPaused(false);
            } else {
              setIsPaused(true);
            }
          }}
          title={effectivelyPaused ? 'Resume GPS ride tracking' : 'Pause GPS ride tracking'}
          aria-label={effectivelyPaused ? 'Resume GPS ride tracking' : 'Pause GPS ride tracking'}
          className="col-span-4 py-3 px-3 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-2xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
        >
          {effectivelyPaused ? <Play className="w-4 h-4 fill-slate-800" /> : <Pause className="w-4 h-4 fill-slate-800" />}
          <span>{effectivelyPaused ? 'Resume' : 'Pause'}</span>
        </button>

        <button
          type="button"
          onClick={handleFinish}
          className="col-span-8 py-3 px-4 bg-[#FF6B00] hover:bg-[#EA580C] text-white rounded-2xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-md shadow-[#FF6B00]/25 transition-all active:scale-98"
        >
          <span>Finish & Add to Odometer</span>
        </button>
      </div>
    </div>
  );
};

