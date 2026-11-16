import React from 'react';
import { Motorcycle, UserSubscription } from '../types';
import { X, Bike, Pause, Play, ArrowRight } from 'lucide-react';
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
export const AUTO_PAUSE_STATIONARY_THRESHOLD_SECONDS = 60; // 1 minute (60 seconds)
export const MIN_MOVEMENT_DISTANCE_KM = 0.005; // 5 meters minimum displacement
export const JITTER_DISPLACEMENT_THRESHOLD_KM = 0.015; // 15 meters threshold when speed is low/unavailable

export function calculateHaversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function isGenuineMotorcycleMovement(params: {
  distanceKm: number;
  speedKmh: number;
  isAutoPaused: boolean;
  accuracyMeters?: number | null;
}): boolean {
  const { distanceKm, speedKmh, isAutoPaused, accuracyMeters } = params;

  // Reject fixes with severe GPS signal degradation (>100m accuracy radius)
  if (typeof accuracyMeters === 'number' && accuracyMeters > 100) {
    return false;
  }

  // Sub-5m fluctuations are always stationary GPS jitter
  if (distanceKm <= MIN_MOVEMENT_DISTANCE_KM) {
    return false;
  }

  // While auto-paused, require clear physical movement (>=15m displacement or >8m with >=5 km/h speed)
  // so stationary GPS drift does not falsely resume tracking
  if (isAutoPaused) {
    return (
      distanceKm >= JITTER_DISPLACEMENT_THRESHOLD_KM ||
      (distanceKm > 0.008 && speedKmh >= 5)
    );
  }

  // During active tracking, require either >=15m displacement or >5m displacement with >=3 km/h speed
  return distanceKm >= JITTER_DISPLACEMENT_THRESHOLD_KM || speedKmh >= 3;
}

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
  const [isResuming, setIsResuming] = React.useState(false);
  const [stationarySeconds, setStationarySeconds] = React.useState(0);
  const [elapsedSeconds, setElapsedSeconds] = React.useState(8);
  const [distanceKm, setDistanceKm] = React.useState(0.0);
  const [currentSpeed, setCurrentSpeed] = React.useState(0);
  const [topSpeed, setTopSpeed] = React.useState(0);
  const [isSimulating, setIsSimulating] = React.useState(false);
  const [routeCoords, setRouteCoords] = React.useState<[number, number][]>([
    DEFAULT_MANILA_COORDS,
  ]);

  // Mutable refs to prevent duplicate intervals/listeners across state updates
  const stationarySecondsRef = React.useRef(0);
  const isAutoPausedRef = React.useRef(false);
  const isPausedRef = React.useRef(false);
  const autoPauseEnabledRef = React.useRef(true);
  const isSimulatingRef = React.useRef(false);
  const currentSpeedRef = React.useRef(0);
  const lastMoveTimestampRef = React.useRef<number | null>(null);
  const lastFixTimestampRef = React.useRef<number | null>(null);
  const lastCoordsRef = React.useRef<{ lat: number; lng: number } | null>(null);
  const reanchorAfterManualPauseRef = React.useRef(false);
  const resumingTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const watchIdRef = React.useRef<number | null>(null);
  const timerIdRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  isPausedRef.current = isPaused;
  autoPauseEnabledRef.current = autoPauseEnabled;
  isSimulatingRef.current = isSimulating;

  const triggerResumingIndicator = React.useCallback(() => {
    setIsResuming(true);
    if (resumingTimeoutRef.current !== null) {
      clearTimeout(resumingTimeoutRef.current);
    }
    resumingTimeoutRef.current = setTimeout(() => {
      setIsResuming(false);
      resumingTimeoutRef.current = null;
    }, 1500);
  }, []);

  React.useEffect(() => {
    return () => {
      if (resumingTimeoutRef.current !== null) {
        clearTimeout(resumingTimeoutRef.current);
        resumingTimeoutRef.current = null;
      }
    };
  }, []);

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

  // Active ride timer & stationary >=60-second (1-minute) auto-pause detector
  React.useEffect(() => {
    if (timerIdRef.current !== null) {
      clearInterval(timerIdRef.current);
      timerIdRef.current = null;
    }

    if (!isPro || isPaused) return;

    const timer = setInterval(() => {
      if (isSimulatingRef.current) {
        const wasAutoPaused = isAutoPausedRef.current;
        stationarySecondsRef.current = 0;
        setStationarySeconds(0);
        if (wasAutoPaused) {
          isAutoPausedRef.current = false;
          setIsAutoPaused(false);
          triggerResumingIndicator();
        }
        setElapsedSeconds((prev) => prev + 1);

        // Generate realistic scooter ride simulation (30 - 55 km/h)
        const simSpeed = Math.floor(38 + Math.sin(Date.now() / 2000) * 12);
        currentSpeedRef.current = simSpeed;
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

      if (currentSpeedRef.current <= 1) {
        const nextStationary = stationarySecondsRef.current + 1;
        stationarySecondsRef.current = nextStationary;
        setStationarySeconds(nextStationary);

        if (
          autoPauseEnabledRef.current &&
          nextStationary >= AUTO_PAUSE_STATIONARY_THRESHOLD_SECONDS
        ) {
          if (!isAutoPausedRef.current) {
            isAutoPausedRef.current = true;
            setIsAutoPaused(true);
            setIsResuming(false);
          }
          return;
        }
      } else {
        const wasAutoPaused = isAutoPausedRef.current;
        stationarySecondsRef.current = 0;
        setStationarySeconds(0);
        if (wasAutoPaused) {
          isAutoPausedRef.current = false;
          setIsAutoPaused(false);
          triggerResumingIndicator();
        }
      }

      if (!isAutoPausedRef.current) {
        setElapsedSeconds((prev) => prev + 1);
      }
    }, 1000);

    timerIdRef.current = timer;

    return () => {
      if (timerIdRef.current !== null) {
        clearInterval(timerIdRef.current);
        timerIdRef.current = null;
      }
    };
  }, [isPro, isPaused, triggerResumingIndicator]);

  // Real GPS Geolocation Watcher if not simulating
  React.useEffect(() => {
    if (watchIdRef.current !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    if (!isPro || isSimulating || isPaused || !navigator.geolocation) return;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const rawSpeedMps = pos.coords.speed;
        const reportedSpeedKmh =
          typeof rawSpeedMps === 'number' && !Number.isNaN(rawSpeedMps) && rawSpeedMps > 0
            ? Math.round(rawSpeedMps * 3.6)
            : 0;

        const fixTimestamp = typeof pos.timestamp === 'number' ? pos.timestamp : Date.now();
        const nextCoord: [number, number] = [
          +pos.coords.latitude.toFixed(6),
          +pos.coords.longitude.toFixed(6),
        ];

        // First GPS fix of the session or first fix after manual pause/resume
        if (!lastCoordsRef.current || reanchorAfterManualPauseRef.current) {
          reanchorAfterManualPauseRef.current = false;
          lastCoordsRef.current = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          };
          lastFixTimestampRef.current = fixTimestamp;
          if (lastMoveTimestampRef.current === null || reportedSpeedKmh >= 3) {
            lastMoveTimestampRef.current = fixTimestamp;
          }
          currentSpeedRef.current = reportedSpeedKmh;
          setCurrentSpeed(reportedSpeedKmh);
          if (reportedSpeedKmh > 0) {
            setTopSpeed((prev) => Math.max(prev, reportedSpeedKmh));
          }
          setRouteCoords((prev) =>
            prev.length === 1 &&
            prev[0][0] === DEFAULT_MANILA_COORDS[0] &&
            prev[0][1] === DEFAULT_MANILA_COORDS[1]
              ? [nextCoord]
              : [...prev, nextCoord]
          );
          return;
        }

        // Ignore exact duplicate timestamp fixes to prevent duplicate mileage
        if (
          lastFixTimestampRef.current !== null &&
          fixTimestamp === lastFixTimestampRef.current &&
          pos.coords.latitude === lastCoordsRef.current.lat &&
          pos.coords.longitude === lastCoordsRef.current.lng
        ) {
          return;
        }

        const d = calculateHaversineDistanceKm(
          lastCoordsRef.current.lat,
          lastCoordsRef.current.lng,
          pos.coords.latitude,
          pos.coords.longitude
        );

        const timeDeltaSec =
          lastFixTimestampRef.current !== null && fixTimestamp > lastFixTimestampRef.current
            ? (fixTimestamp - lastFixTimestampRef.current) / 1000
            : 1;
        lastFixTimestampRef.current = fixTimestamp;

        // Guard against unrealistic teleportation spikes after temporary GPS signal loss
        if (timeDeltaSec > 120 && d / (timeDeltaSec / 3600) > 180) {
          lastCoordsRef.current = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          };
          return;
        }

        const genuineMove = isGenuineMotorcycleMovement({
          distanceKm: d,
          speedKmh: reportedSpeedKmh,
          isAutoPaused: isAutoPausedRef.current,
          accuracyMeters: pos.coords.accuracy,
        });

        if (genuineMove) {
          const wasAutoPaused = isAutoPausedRef.current;
          stationarySecondsRef.current = 0;
          setStationarySeconds(0);
          isAutoPausedRef.current = false;
          setIsAutoPaused(false);
          if (wasAutoPaused) {
            triggerResumingIndicator();
          }
          lastMoveTimestampRef.current = fixTimestamp;

          const effectiveSpeedKmh =
            reportedSpeedKmh > 0
              ? reportedSpeedKmh
              : Math.min(80, Math.max(12, Math.round(d / (Math.max(1, timeDeltaSec) / 3600))));

          currentSpeedRef.current = effectiveSpeedKmh;
          setCurrentSpeed(effectiveSpeedKmh);
          setTopSpeed((prev) => Math.max(prev, effectiveSpeedKmh));

          setDistanceKm((prev) => +(prev + d).toFixed(4));
          lastCoordsRef.current = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          };
          setRouteCoords((prev) => [...prev, nextCoord]);
        } else {
          // Motorcycle is stationary or experiencing minor GPS drift/jitter:
          // Do not accumulate distance and do not update anchor coordinates
          currentSpeedRef.current = 0;
          setCurrentSpeed(0);

          if (lastMoveTimestampRef.current !== null && fixTimestamp >= lastMoveTimestampRef.current) {
            const elapsedStationarySec = Math.floor(
              (fixTimestamp - lastMoveTimestampRef.current) / 1000
            );
            if (elapsedStationarySec > stationarySecondsRef.current) {
              stationarySecondsRef.current = elapsedStationarySec;
              setStationarySeconds(elapsedStationarySec);
            }
            if (
              autoPauseEnabledRef.current &&
              stationarySecondsRef.current >= AUTO_PAUSE_STATIONARY_THRESHOLD_SECONDS
            ) {
              isAutoPausedRef.current = true;
              setIsAutoPaused(true);
              setIsResuming(false);
            }
          }
        }
      },
      () => {
        // Temporary GPS signal loss fallback: preserve existing session & accumulated mileage
      },
      { enableHighAccuracy: true, maximumAge: 1000 }
    );

    watchIdRef.current = watchId;

    return () => {
      if (watchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [isPro, isSimulating, isPaused, triggerResumingIndicator]);

  // Format mm:ss
  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remainder = secs % 60;
    return `${mins.toString().padStart(2, '0')}:${remainder.toString().padStart(2, '0')}`;
  };

  const roundedAddedKm = Math.max(1, Math.round(distanceKm || 1));
  const previewNewOdo = bike.odometer + roundedAddedKm;
  const effectivelyPaused = isPaused || isAutoPaused;

  const trackingStatusLabel = isPaused
    ? 'Paused'
    : isAutoPaused
    ? 'Paused - Motorcycle Stationary'
    : isResuming
    ? 'Resuming Tracking'
    : 'Tracking';

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
      {/* Top Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isAutoPaused ? (
            <div
              data-testid="gps-auto-paused-badge"
              className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-amber-50 border border-amber-300 text-amber-800 text-xs font-bold"
            >
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              <span className="tracking-wide">{trackingStatusLabel}</span>
            </div>
          ) : isPaused ? (
            <div
              data-testid="gps-manual-paused-badge"
              className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-slate-100 border border-slate-300 text-slate-700 text-xs font-bold"
            >
              <span className="w-2 h-2 rounded-full bg-slate-500" />
              <span className="tracking-wide">{trackingStatusLabel}</span>
            </div>
          ) : isResuming ? (
            <div
              data-testid="gps-resuming-badge"
              className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-cyan-50 border border-cyan-300 text-cyan-800 text-xs font-bold"
            >
              <span className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse" />
              <span className="tracking-wide">{trackingStatusLabel}</span>
            </div>
          ) : (
            <div
              data-testid="gps-active-tracking-badge"
              className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-[#E8FAF0] border border-emerald-300 text-emerald-700 text-xs font-bold"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="tracking-wide">{trackingStatusLabel}</span>
            </div>
          )}
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
              <span>Paused - Motorcycle Stationary</span>
            </div>
            <p className="text-[11px] text-amber-800 leading-snug">
              No significant GPS movement detected for {Math.max(60, stationarySeconds)} consecutive seconds (1 minute). Timer and distance calculation are paused until you start moving again.
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
              triggerResumingIndicator();
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

      {/* Speedometer display */}
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

      {/* 3 Metrics Row */}
      <div className="grid grid-cols-3 gap-2 text-center py-2 border-y border-slate-100">
        <div>
          <div className="text-[10px] font-bold text-slate-400 tracking-wider uppercase">DISTANCE</div>
          <div
            data-testid="gps-accumulated-distance"
            className="text-base font-extrabold text-[#FF6B00] font-mono mt-0.5"
          >
            +{distanceKm.toFixed(2)} km
          </div>
        </div>

        <div>
          <div className="text-[10px] font-bold text-slate-400 tracking-wider uppercase">DURATION</div>
          <div
            data-testid="gps-elapsed-duration"
            className="text-base font-extrabold text-slate-900 font-mono mt-0.5"
          >
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
          <span
            className={`w-2 h-2 rounded-full ${
              isAutoPaused || isPaused
                ? 'bg-amber-500'
                : isResuming
                ? 'bg-cyan-500'
                : 'bg-emerald-500'
            }`}
          />
          <span data-testid="gps-status-row-label">{trackingStatusLabel}</span>
        </div>

        <div className="flex items-center gap-3">
          <label
            className="flex items-center gap-1.5 cursor-pointer text-slate-600 font-medium"
            title="Automatically pause ride timer after 1 minute stationary"
          >
            <input
              type="checkbox"
              checked={autoPauseEnabled}
              onChange={(e) => {
                const enabled = e.target.checked;
                autoPauseEnabledRef.current = enabled;
                setAutoPauseEnabled(enabled);
                if (!enabled) {
                  isAutoPausedRef.current = false;
                  setIsAutoPaused(false);
                }
              }}
              className="w-3.5 h-3.5 rounded border-slate-300 text-[#FF6B00] focus:ring-[#FF6B00] cursor-pointer"
            />
            <span>Auto-Pause (1m)</span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer text-slate-600 font-medium">
            <span>Simulate Ride</span>
            <input
              type="checkbox"
              checked={isSimulating}
              onChange={(e) => {
                isSimulatingRef.current = e.target.checked;
                setIsSimulating(e.target.checked);
              }}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#FF6B00] relative"></div>
          </label>
        </div>
      </div>

      {/* Auto-Increment Preview Banner */}
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

      {/* Bottom Action Buttons */}
      <div className="grid grid-cols-12 gap-2.5 pt-1">
        <button
          type="button"
          data-testid="gps-manual-pause-resume-btn"
          onClick={() => {
            sounds.playClick();
            if (effectivelyPaused) {
              const wasAutoPaused = isAutoPausedRef.current;
              stationarySecondsRef.current = 0;
              setStationarySeconds(0);
              isAutoPausedRef.current = false;
              setIsAutoPaused(false);
              isPausedRef.current = false;
              setIsPaused(false);
              reanchorAfterManualPauseRef.current = true;
              lastMoveTimestampRef.current = Date.now();
              if (wasAutoPaused) {
                triggerResumingIndicator();
              }
            } else {
              isPausedRef.current = true;
              setIsPaused(true);
              setIsResuming(false);
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


