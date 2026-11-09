import React from 'react';
import { Motorcycle, MaintenanceReminder, ActiveTab } from '../types';
import { analyzeReminder } from '../utils/storage';
import { Gauge, Navigation, SlidersHorizontal, Wrench, Clock, Bike, CheckCircle2, AlertTriangle, Edit3 } from 'lucide-react';
import { sounds } from '../utils/audio';

interface GarageHeaderProps {
  bike: Motorcycle;
  reminders: MaintenanceReminder[];
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  onAddKm: (km: number) => void;
  onOpenEditOdometer: () => void;
  onOpenEditBike: () => void;
  onOpenGpsRide: () => void;
  onOpenPaywall: () => void;
  isPro: boolean;
}

export const GarageHeader: React.FC<GarageHeaderProps> = ({
  bike,
  reminders,
  activeTab,
  onTabChange,
  onAddKm,
  onOpenEditOdometer,
  onOpenEditBike,
  onOpenGpsRide,
  onOpenPaywall,
  isPro,
}) => {
  const [showCustomInput, setShowCustomInput] = React.useState(false);
  const [customDistance, setCustomDistance] = React.useState<number | ''>('');

  const bikeReminders = reminders.filter((r) => r.bikeId === bike.id);
  const analyses = bikeReminders.map((r) => analyzeReminder(r, bike.odometer));

  const overdueCount = analyses.filter((a) => a.status === 'overdue').length;
  const dueSoonCount = analyses.filter((a) => a.status === 'due-soon').length;
  const goodCount = analyses.filter((a) => a.status === 'ok').length;

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (typeof customDistance === 'number' && customDistance > 0) {
      sounds.playSuccess();
      onAddKm(customDistance);
      setCustomDistance('');
      setShowCustomInput(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Active Bike Profile Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span
              className="w-2.5 h-2.5 rounded-full inline-block"
              style={{ backgroundColor: bike.customColorBadge || '#00C5FF' }}
            />
            <span className="text-sm font-semibold text-slate-500">
              {bike.year} {bike.brand}
            </span>
          </div>

          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight mt-0.5">
            {bike.model}
          </h1>

          {bike.nickname && (
            <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-orange-50 border border-orange-200/80 text-xs font-bold text-[#FF6B00] mt-1 shadow-2xs">
              <span>&apos;{bike.nickname}&apos;</span>
            </div>
          )}
        </div>

        {/* Transmission / Bike Type Badge */}
        <button
          type="button"
          onClick={onOpenEditBike}
          className="px-3 py-1 rounded-xl bg-cyan-50 border border-cyan-100 text-[#0097A7] text-[11px] font-bold tracking-wide uppercase shadow-sm hover:bg-cyan-100 transition-colors whitespace-nowrap shrink-0"
        >
          {bike.motorcycleType || bike.specs?.transmission || 'SCOOTER / AT'}
        </button>
      </div>

      {/* Current Odometer Card */}
      <div className="p-5 rounded-2xl bg-white border border-slate-100 shadow-sm relative overflow-hidden">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-400 tracking-wider uppercase">
            <Gauge className="w-4 h-4 text-[#FF6B00]" />
            <span>CURRENT ODOMETER</span>
          </div>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-50 text-amber-600 border border-amber-200/60 uppercase">
            {bike.unit || 'KM'}
          </span>
        </div>

        <div className="flex items-center justify-between mt-3">
          <div className="flex items-baseline gap-1.5">
            <span className="text-4xl font-extrabold text-slate-900 tracking-tight font-mono">
              {bike.odometer.toLocaleString()}
            </span>
            <span className="text-sm font-semibold text-slate-500">
              {bike.unit || 'km'}
            </span>
          </div>

          <button
            type="button"
            onClick={onOpenEditOdometer}
            className="px-5 py-2.5 bg-[#FF6B00] hover:bg-[#EA580C] text-white rounded-2xl text-xs font-bold flex items-center gap-1.5 shadow-md shadow-[#FF6B00]/25 transition-all active:scale-95"
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span>Update</span>
          </button>
        </div>
      </div>

      {/* Auto-Track Ride (PRO Banner) */}
      <div className="p-4 rounded-2xl bg-white border border-slate-100 shadow-sm flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-amber-50 border border-amber-100 flex items-center justify-center text-[#FF6B00] shrink-0">
            <Navigation className="w-5 h-5 fill-[#FF6B00]" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold text-slate-800">Auto-Track Ride</span>
              <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-slate-900 text-amber-400 font-mono">
                PRO
              </span>
            </div>
            <p className="text-[11px] text-slate-500">Live GPS auto-increments odometer</p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            if (isPro) {
              onOpenGpsRide();
            } else {
              onOpenPaywall();
            }
          }}
          className="px-4 py-2 bg-[#FF6B00] hover:bg-[#EA580C] text-white rounded-xl text-xs font-bold transition-all shadow-sm shadow-[#FF6B00]/20 whitespace-nowrap"
        >
          {isPro ? 'Launch' : 'Unlock'}
        </button>
      </div>

      {/* Quick Add After Ride Section */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium text-slate-500">Quick Add After Ride</span>
          <button
            type="button"
            onClick={() => setShowCustomInput(!showCustomInput)}
            className="text-[#FF6B00] hover:underline font-bold flex items-center gap-1"
          >
            <SlidersHorizontal className="w-3 h-3" />
            <span>+ Custom Distance</span>
          </button>
        </div>

        {/* Custom Input Dropdown if clicked */}
        {showCustomInput && (
          <form onSubmit={handleCustomSubmit} className="p-3 bg-white rounded-2xl border border-orange-200 flex items-center gap-2 animate-in fade-in duration-150">
            <input
              type="number"
              min="1"
              placeholder="e.g. 38 km"
              value={customDistance}
              onChange={(e) => setCustomDistance(e.target.value === '' ? '' : Number(e.target.value))}
              className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-800 focus:outline-none focus:border-[#FF6B00]"
              autoFocus
            />
            <button
              type="submit"
              disabled={!customDistance || customDistance <= 0}
              className="px-4 py-1.5 bg-[#FF6B00] text-white text-xs font-bold rounded-xl shadow-sm disabled:opacity-50"
            >
              Add KM
            </button>
          </form>
        )}

        {/* Preset Buttons matching screenshot */}
        <div className="grid grid-cols-5 gap-2">
          {[10, 25, 50, 100].map((km) => (
            <button
              key={km}
              type="button"
              onClick={() => {
                sounds.playSuccess();
                onAddKm(km);
              }}
              className="py-2 px-1 text-center bg-white hover:bg-orange-50 border border-slate-100 hover:border-orange-200 rounded-xl text-xs font-medium text-slate-600 hover:text-[#FF6B00] shadow-sm transition-all"
            >
              <span className="text-[#FF6B00] font-bold mr-0.5">+</span> +{km}
            </button>
          ))}

          {/* + Custom Button */}
          <button
            type="button"
            onClick={() => setShowCustomInput(true)}
            className="py-2 px-1 text-center bg-amber-50/70 hover:bg-amber-100 border border-amber-200/80 rounded-xl text-xs font-bold text-amber-700 shadow-sm flex items-center justify-center gap-0.5 transition-all"
          >
            <SlidersHorizontal className="w-3 h-3 text-[#FF6B00]" />
            <span>+ Custom</span>
          </button>
        </div>
      </div>

      {/* Status Counters Row matching screenshot */}
      <div className="flex items-center justify-around py-2 px-3 bg-white rounded-2xl border border-slate-100 shadow-sm text-xs">
        <div className="flex items-center gap-1.5 text-slate-500 font-medium">
          <AlertTriangle className="w-4 h-4 text-slate-400" />
          <span>{overdueCount} Overdue</span>
        </div>

        <div className="flex items-center gap-1.5 text-slate-500 font-medium">
          <Wrench className="w-4 h-4 text-slate-400" />
          <span>{dueSoonCount} Due Soon</span>
        </div>

        <div className="flex items-center gap-1.5 text-emerald-600 font-bold">
          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          <span>{goodCount} Good</span>
        </div>
      </div>

      {/* Tabs Navigation matching screenshot */}
      <div className="flex items-center justify-around border-b border-slate-200 pt-2">
        <button
          type="button"
          onClick={() => {
            sounds.playClick();
            onTabChange('garage');
          }}
          className={`pb-3 px-4 font-bold text-xs flex items-center gap-1.5 transition-colors relative ${
            activeTab === 'garage' || activeTab === 'reminders'
              ? 'text-[#FF6B00]'
              : 'text-slate-400 hover:text-slate-700'
          }`}
        >
          <Wrench className="w-4 h-4" />
          <span>Schedule</span>
          {(activeTab === 'garage' || activeTab === 'reminders') && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#FF6B00] rounded-full" />
          )}
        </button>

        <button
          type="button"
          onClick={() => {
            sounds.playClick();
            onTabChange('logbook');
          }}
          className={`pb-3 px-4 font-bold text-xs flex items-center gap-1.5 transition-colors relative ${
            activeTab === 'logbook'
              ? 'text-[#FF6B00]'
              : 'text-slate-400 hover:text-slate-700'
          }`}
        >
          <Clock className="w-4 h-4" />
          <span>History</span>
          {activeTab === 'logbook' && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#FF6B00] rounded-full" />
          )}
        </button>

        <button
          type="button"
          onClick={() => {
            sounds.playClick();
            onTabChange('lto');
          }}
          className={`pb-3 px-4 font-bold text-xs flex items-center gap-1.5 transition-colors relative ${
            activeTab === 'lto'
              ? 'text-[#FF6B00]'
              : 'text-slate-400 hover:text-slate-700'
          }`}
        >
          <Bike className="w-4 h-4" />
          <span>Garage / LTO</span>
          {activeTab === 'lto' && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#FF6B00] rounded-full" />
          )}
        </button>
      </div>
    </div>
  );
};
