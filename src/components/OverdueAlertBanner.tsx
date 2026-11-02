import React, { useState } from 'react';
import { MaintenanceReminder, Motorcycle } from '../types';
import { AlertTriangle, Wrench, X, Bell, Vibrate } from 'lucide-react';
import {
  vibratePhone,
  getNotificationPermission,
  requestNotificationPermission,
} from '../utils/notifications';
import { sounds } from '../utils/audio';

interface OverdueAlertBannerProps {
  overdueReminders: MaintenanceReminder[];
  bike: Motorcycle;
  onOpenServiceModal: (reminder: MaintenanceReminder) => void;
  onDismiss: () => void;
}

export const OverdueAlertBanner: React.FC<OverdueAlertBannerProps> = ({
  overdueReminders,
  bike,
  onOpenServiceModal,
  onDismiss,
}) => {
  const [permission, setPermission] = useState<NotificationPermission>(() =>
    getNotificationPermission()
  );
  const [vibrating, setVibrating] = useState(false);

  if (overdueReminders.length === 0) return null;

  const primaryOverdue = overdueReminders[0];
  const overdueDistanceKm = bike.odometer - primaryOverdue.nextDueOdo;

  const handleEnableNotifications = async () => {
    sounds.playClick();
    const newPerm = await requestNotificationPermission();
    setPermission(newPerm);
  };

  const handleReVibrate = () => {
    setVibrating(true);
    vibratePhone([300, 150, 300, 150, 500]);
    sounds.playUrgentAlert();
    setTimeout(() => setVibrating(false), 1400);
  };

  return (
    <div className="bg-gradient-to-r from-red-600 via-rose-600 to-red-700 text-white rounded-3xl p-4 sm:p-5 shadow-xl shadow-red-600/30 border-2 border-red-400 relative overflow-hidden animate-in slide-in-from-top-3 duration-300">
      {/* Background Warning Glow Pulse */}
      <div className="absolute -top-12 -right-12 w-32 h-32 bg-white/10 rounded-full blur-2xl pointer-events-none animate-pulse" />

      <div className="relative z-10 space-y-3">
        {/* Top Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="relative flex h-3.5 w-3.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
              <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-amber-300" />
            </span>
            <div className="flex items-center gap-1.5 font-extrabold text-xs uppercase tracking-wider text-amber-200">
              <AlertTriangle className="w-4 h-4 fill-amber-300 text-red-700" />
              <span>
                {overdueReminders.length > 1
                  ? `${overdueReminders.length} Tasks Overdue!`
                  : 'Maintenance Overdue!'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Re-trigger vibration */}
            <button
              type="button"
              onClick={handleReVibrate}
              className={`p-1.5 rounded-xl bg-white/15 hover:bg-white/25 text-white text-[11px] font-bold flex items-center gap-1 transition-all ${
                vibrating ? 'animate-bounce text-amber-300' : ''
              }`}
              title="Vibrate Phone Alert"
            >
              <Vibrate className="w-3.5 h-3.5" />
              <span className="hidden xs:inline">Vibrate</span>
            </button>

            {/* Dismiss */}
            <button
              type="button"
              onClick={onDismiss}
              className="p-1.5 rounded-xl text-white/70 hover:text-white hover:bg-white/15 transition-colors"
              title="Dismiss Alert"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Task Details */}
        <div className="space-y-1">
          <h4 className="text-base sm:text-lg font-black leading-tight drop-shadow-sm">
            {primaryOverdue.title}
          </h4>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-red-100">
            <span>
              Bike: <strong className="text-white">{bike.nickname || bike.model}</strong>
            </span>
            <span>·</span>
            <span>
              Current Odo: <strong className="text-white font-mono">{bike.odometer.toLocaleString()} km</strong>
            </span>
            <span>·</span>
            <span className="text-amber-200 font-bold font-mono">
              Overdue by {Math.abs(overdueDistanceKm).toLocaleString()} km
            </span>
          </div>
        </div>

        {/* Secondary warning tasks if multiple */}
        {overdueReminders.length > 1 && (
          <div className="text-[11px] text-red-100 bg-black/20 rounded-xl px-3 py-1.5 flex items-center justify-between">
            <span>Also overdue: {overdueReminders.slice(1).map((r) => r.title).join(', ')}</span>
            <span className="font-bold text-amber-200 shrink-0 ml-2">+{overdueReminders.length - 1} more</span>
          </div>
        )}

        {/* Action Row */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => {
              sounds.playSuccess();
              onOpenServiceModal(primaryOverdue);
            }}
            className="flex-1 py-2.5 px-4 bg-white hover:bg-amber-50 text-red-700 font-extrabold text-xs rounded-xl shadow-md transition-all active:scale-95 flex items-center justify-center gap-1.5"
          >
            <Wrench className="w-3.5 h-3.5" />
            <span>Mark Serviced Now</span>
          </button>

          {/* Browser Notification Permission Button if not yet granted */}
          {permission !== 'granted' && (
            <button
              type="button"
              onClick={handleEnableNotifications}
              className="py-2.5 px-3 bg-red-900/60 hover:bg-red-900/80 border border-red-300/40 text-amber-200 font-bold text-xs rounded-xl transition-all flex items-center gap-1.5 shrink-0"
              title="Allow browser notifications to alert even when screen is locked"
            >
              <Bell className="w-3.5 h-3.5" />
              <span>Allow OS Push</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
