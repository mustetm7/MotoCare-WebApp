import React from 'react';
import { Motorcycle, UserSubscription } from '../types';
import { X, Headphones, Bike, Pause, Play, ArrowRight } from 'lucide-react';
import { sounds } from '../utils/audio';

interface GpsRideTrackerSheetProps {
  bike: Motorcycle;
  subscription: UserSubscription;
  onFinishRide: (distanceKm: number) => void;
  onClose?: () => void;
  onOpenPaywall?: () => void;
}

export const GpsRideTrackerSheet: React.FC<GpsRideTrackerSheetProps> = ({
  bike,
  subscription,
  onFinishRide,
  onClose,
  onOpenPaywall,
}) => {
  const isPro = subscription.tier === 'pro';

  // Live ride states
  const [isPaused, setIsPaused] = React.useState(false);
  const [elapsedSeconds, setElapsedSeconds] = React.useState(8);
  const [distanceKm, setDistanceKm] = React.useState(0.0);
  const [currentSpeed, setCurrentSpeed] = React.useState(0);
  const [topSpeed, setTopSpeed] = React.useState(0);
  const [isSimulating, setIsSimulating] = React.useState(false);

  // Timer interval
  React.useEffect(() => {
    if (isPaused) return;

    const timer = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);

      if (isSimulating) {
        // Generate realistic scooter ride simulation (30 - 55 km/h)
        const simSpeed = Math.floor(38 + Math.sin(Date.now() / 2000) * 12);
        setCurrentSpeed(simSpeed);
        setTopSpeed((prev) => Math.max(prev, simSpeed));
        setDistanceKm((prev) => +(prev + simSpeed / 3600).toFixed(2));
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [isPaused, isSimulating]);

  // Real GPS Geolocation Watcher if not simulating
  React.useEffect(() => {
    if (isSimulating || isPaused || !navigator.geolocation) return;

    let lastCoords: { lat: number; lng: number } | null = null;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const speedKmh = pos.coords.speed ? Math.round(pos.coords.speed * 3.6) : 0;
        setCurrentSpeed(speedKmh);
        setTopSpeed((prev) => Math.max(prev, speedKmh));

        if (lastCoords) {
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
          if (d > 0.005) {
            setDistanceKm((prev) => +(prev + d).toFixed(2));
          }
        }
        lastCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      },
      () => {
        // fallback
      },
      { enableHighAccuracy: true, maximumAge: 1000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [isSimulating, isPaused]);

  // Format mm:ss
  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remainder = secs % 60;
    return `${mins.toString().padStart(2, '0')}:${remainder.toString().padStart(2, '0')}`;
  };

  const roundedAddedKm = Math.max(1, Math.round(distanceKm || 1));
  const previewNewOdo = bike.odometer + roundedAddedKm;

  const handleFinish = () => {
    sounds.playSuccess();
    onFinishRide(roundedAddedKm);
    onClose?.();
  };

  return (
    <div className="w-full max-w-md mx-auto bg-white rounded-3xl shadow-xl border border-slate-100 p-5 space-y-5 animate-in fade-in duration-200">
      {/* Top Header matching screenshot 7 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* Live Tracking pill */}
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-[#E8FAF0] border border-emerald-300 text-emerald-700 text-xs font-bold">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="tracking-wide">LIVE TRACKING</span>
          </div>

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
            className="p-1.5 text-slate-400 hover:text-slate-800 rounded-xl hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Tracking bike label */}
      <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
        <Bike className="w-4 h-4 text-[#FF6B00]" />
        <span>Tracking for: {bike.year} {bike.brand} {bike.model}</span>
      </div>

      {/* Speedometer display matching screenshot 7 */}
      <div className="text-center py-2 space-y-0.5">
        <div className="text-[11px] font-bold tracking-widest text-slate-400 uppercase">
          SPEED
        </div>
        <div className="text-7xl font-extrabold text-slate-900 tracking-tight font-mono leading-none">
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

      {/* Status Row & Simulate Switch matching screenshot 7 */}
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5 text-slate-500 font-medium">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          <span>GPS Locked (±5m)</span>
        </div>

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
            setIsPaused(!isPaused);
          }}
          className="col-span-4 py-3 px-3 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-2xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
        >
          {isPaused ? <Play className="w-4 h-4 fill-slate-800" /> : <Pause className="w-4 h-4 fill-slate-800" />}
          <span>{isPaused ? 'Resume' : 'Pause'}</span>
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
