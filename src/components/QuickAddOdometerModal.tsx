import React from 'react';
import { Motorcycle } from '../types';
import { Gauge, X, ArrowRight } from 'lucide-react';
import { sounds } from '../utils/audio';

interface QuickAddOdometerModalProps {
  isOpen: boolean;
  onClose: () => void;
  bike: Motorcycle;
  presets?: number[];
  onSavePresets?: (newPresets: number[]) => void;
  onUpdateOdometer: (newOdometer: number) => void;
}

export const QuickAddOdometerModal: React.FC<QuickAddOdometerModalProps> = ({
  isOpen,
  onClose,
  bike,
  onUpdateOdometer,
}) => {
  const [directOdo, setDirectOdo] = React.useState<number>(bike.odometer);
  const [customAddKm, setCustomAddKm] = React.useState<number | ''>('');

  React.useEffect(() => {
    if (isOpen) {
      setDirectOdo(bike.odometer);
      setCustomAddKm('');
    }
  }, [isOpen, bike.odometer]);

  if (!isOpen) return null;

  const handleAddKm = (km: number) => {
    if (km <= 0) return;
    sounds.playSuccess();
    const target = bike.odometer + km;
    onUpdateOdometer(target);
    onClose();
  };

  const handleDirectSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (directOdo < 0) return;
    sounds.playSuccess();
    onUpdateOdometer(directOdo);
    onClose();
  };

  const handleCustomAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (typeof customAddKm === 'number' && customAddKm > 0) {
      handleAddKm(customAddKm);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white border border-slate-100 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Gauge className="w-5 h-5 text-[#FF6B00]" />
            <h3 className="text-base font-extrabold text-slate-900">Update Odometer</h3>
          </div>
          <button
            onClick={onClose}
            title="Close odometer update modal"
            aria-label="Close odometer update modal"
            className="p-1.5 text-slate-400 hover:text-slate-800 rounded-xl hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Current Motorcycle Glance */}
          <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-between">
            <div>
              <div className="text-[11px] text-slate-400 font-medium">Active Motorcycle</div>
              <div className="text-sm font-bold text-slate-800 mt-0.5">
                {bike.year} {bike.brand} {bike.model}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-slate-400 uppercase font-mono">Current Mileage</div>
              <div className="text-lg font-black font-mono text-[#FF6B00] tabular-nums">
                {bike.odometer.toLocaleString()} km
              </div>
            </div>
          </div>

          {/* Add Custom KM Amount */}
          <form onSubmit={handleCustomAddSubmit} className="space-y-1.5 pt-1">
            <label className="block text-xs font-bold text-slate-700">
              Add Specific Ride Distance (+KM)
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs font-mono font-bold">+</span>
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  placeholder="e.g. 24.5"
                  value={customAddKm}
                  onChange={(e) => setCustomAddKm(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-7 pr-12 py-2 text-xs font-mono font-bold text-slate-800 focus:outline-none focus:border-[#FF6B00]"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-mono text-slate-400">
                  km
                </span>
              </div>
              <button
                type="submit"
                disabled={!customAddKm || customAddKm <= 0}
                className="px-4 py-2 bg-[#FF6B00] hover:bg-[#EA580C] disabled:opacity-40 text-white font-bold text-xs rounded-2xl transition-all flex items-center gap-1 shadow-sm"
              >
                Add <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </form>

          {/* 3. Direct Manual Odometer Set */}
          <form onSubmit={handleDirectSubmit} className="space-y-2 pt-3 border-t border-slate-100">
            <label className="block text-xs font-bold text-slate-700">
              Direct Total Odometer (KM)
            </label>
            <div className="flex gap-2">
              <input
                type="number"
                min="0"
                step="1"
                required
                value={directOdo}
                onChange={(e) => setDirectOdo(Number(e.target.value) || 0)}
                className="flex-1 bg-slate-50 border border-slate-200 rounded-2xl px-3 py-2 text-sm font-mono font-bold text-slate-800 focus:outline-none focus:border-[#FF6B00]"
              />
              <button
                type="submit"
                className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-2xl transition-all"
              >
                Save
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
