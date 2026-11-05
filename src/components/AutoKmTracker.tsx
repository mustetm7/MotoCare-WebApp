import React, { useEffect, useState, useRef } from 'react';
import { Motorcycle } from '../types';
import { Zap, Play, Check, ChevronUp, ChevronDown } from 'lucide-react';
import { sounds } from '../utils/audio';

interface AutoKmTrackerProps {
  bike: Motorcycle;
  enabled: boolean;
  intervalMinutes: number; // default: 5
  incrementKm: number; // default: 5
  onAutoAddKm: (km: number) => void;
}

export const AutoKmTracker: React.FC<AutoKmTrackerProps> = ({
  bike,
  enabled,
  intervalMinutes,
  incrementKm,
  onAutoAddKm,
}) => {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isMinimized, setIsMinimized] = useState(false);
  const lastActivityRef = useRef<number>(Date.now());
  const targetSeconds = intervalMinutes * 60; // 5 mins = 300s

  useEffect(() => {
    if (!enabled || !bike.id) return;

    // Reset activity timestamp on user interaction
    const handleUserActivity = () => {
      lastActivityRef.current = Date.now();
    };

    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'];
    events.forEach((evt) => window.addEventListener(evt, handleUserActivity, { passive: true }));

    // Ticker every 1 second
    const interval = setInterval(() => {
      const secondsIdle = Math.floor((Date.now() - lastActivityRef.current) / 1000);
      setElapsedSeconds(secondsIdle);

      // When 5 minutes of no action have elapsed:
      if (secondsIdle >= targetSeconds) {
        lastActivityRef.current = Date.now();
        setElapsedSeconds(0);
        onAutoAddKm(incrementKm);
      }
    }, 1000);

    return () => {
      events.forEach((evt) => window.removeEventListener(evt, handleUserActivity));
      clearInterval(interval);
    };
  }, [enabled, bike.id, intervalMinutes, incrementKm, targetSeconds, onAutoAddKm]);

  if (!enabled || !bike.id) return null;

  const remainingSeconds = Math.max(targetSeconds - elapsedSeconds, 0);
  const remMinutes = Math.floor(remainingSeconds / 60);
  const remSecs = remainingSeconds % 60;
  const progressPercent = Math.min((elapsedSeconds / targetSeconds) * 100, 100);

  const handleManualTrigger = () => {
    sounds.playClick();
    lastActivityRef.current = Date.now();
    setElapsedSeconds(0);
    onAutoAddKm(incrementKm);
  };

  return (
    <aside aria-label="Auto-Commute Tracker" className="fixed bottom-3 left-3 sm:left-auto sm:right-4 z-30 max-w-[calc(100vw-24px)]">
      <div className="bg-slate-900/95 backdrop-blur-md text-white border border-slate-700/80 rounded-2xl shadow-xl shadow-black/30 p-2 sm:p-2.5 text-xs flex items-center gap-2.5 transition-all">
        {/* Pulsing Motor/Timer Icon */}
        <div className="w-7 h-7 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
          <Zap className="w-3.5 h-3.5 fill-amber-400 animate-pulse" />
        </div>

        {!isMinimized ? (
          <>
            <div className="min-w-0 pr-1">
              <div className="flex items-center gap-1.5 leading-none">
                <span className="font-extrabold text-[11px] text-amber-300">Auto-Commute (5m)</span>
                <span className="text-[10px] text-slate-400 font-mono">
                  {remMinutes}m {remSecs.toString().padStart(2, '0')}s
                </span>
              </div>
              <div className="text-[10px] text-slate-300 truncate mt-0.5">
                Adds <strong className="text-white font-mono">+{incrementKm} km</strong> if idle for 5 mins
              </div>

              {/* Progress bar */}
              <div className="w-full bg-slate-800 h-1 rounded-full mt-1.5 overflow-hidden">
                <div
                  className="bg-gradient-to-r from-amber-500 to-[#F95A00] h-full transition-all duration-1000 ease-linear rounded-full"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>

            {/* Quick Test / Trigger Button */}
            <button
              type="button"
              onClick={handleManualTrigger}
              className="px-2 py-1 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-[10px] rounded-lg shadow-sm transition-all active:scale-95 shrink-0 flex items-center gap-1"
              title="Test: Add +5 km immediately without waiting 5 mins"
            >
              <Play className="w-2.5 h-2.5 fill-slate-950" />
              <span>Add Now</span>
            </button>

            <button
              type="button"
              onClick={() => setIsMinimized(true)}
              className="p-1 text-slate-400 hover:text-white rounded"
              title="Minimize Auto-Commute Indicator"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setIsMinimized(false)}
            className="flex items-center gap-1 text-[11px] font-bold text-amber-300"
          >
            <span>Auto-Km ({remMinutes}:{remSecs.toString().padStart(2, '0')})</span>
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </aside>
  );
};
