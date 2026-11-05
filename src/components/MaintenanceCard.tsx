import React from 'react';
import { MaintenanceReminder, Motorcycle } from '../types';
import { analyzeReminder } from '../utils/storage';
import { Trash2, Check, Sparkles, X } from 'lucide-react';
import { sounds } from '../utils/audio';

interface MaintenanceCardProps {
  reminder: MaintenanceReminder;
  bike: Motorcycle;
  onComplete: (reminder: MaintenanceReminder) => void;
  onEdit: (reminder: MaintenanceReminder) => void;
  onDelete: (id: string) => void;
  onUpdateBadgeColor?: (reminderId: string, colorHex: string) => void;
}

export const MaintenanceCard: React.FC<MaintenanceCardProps> = ({
  reminder,
  bike,
  onComplete,
  onEdit,
  onDelete,
}) => {
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const analysis = analyzeReminder(reminder, bike.odometer);
  const remainingKm = reminder.nextDueOdo - bike.odometer;

  // Determine category display tag
  const categoryTag =
    reminder.categoryTag ||
    (reminder.category === 'Engine Oil' || reminder.category === 'Air Filter' || reminder.category === 'Valve Clearance'
      ? 'ENGINE'
      : reminder.category === 'Gear Oil' || reminder.category === 'Coolant'
      ? 'FLUIDS'
      : reminder.category === 'CVT & Belt'
      ? 'CVT & DRIVE'
      : reminder.category === 'Spark Plug'
      ? 'ELECTRICAL'
      : reminder.category === 'Brakes'
      ? 'BRAKES'
      : 'GENERAL');

  // Pill styling based on health
  const isOverdue = analysis.status === 'overdue';
  const isDueSoon = analysis.status === 'due-soon';

  const pillBgClass = isOverdue
    ? 'bg-red-50 text-red-700'
    : isDueSoon
    ? 'bg-amber-50 text-amber-800'
    : 'bg-[#E8FAF0] text-[#1B5E20]';

  const remainingText = isOverdue
    ? `Overdue by ${Math.abs(remainingKm).toLocaleString()} km`
    : `In ${remainingKm.toLocaleString()} km`;

  return (
    <div className="bg-white rounded-3xl border border-slate-100 p-5 shadow-sm space-y-3 relative hover:shadow-md transition-shadow">
      {/* Top Header: Category Tag & Delete Icon */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-black tracking-wider uppercase text-[#00ACC1]">
          {categoryTag}
        </span>

        {confirmDelete ? (
          <div className="flex items-center gap-1.5 animate-in fade-in duration-100 bg-red-50 border border-red-200 px-2 py-0.5 rounded-xl">
            <span className="text-[10px] text-red-700 font-bold">Delete?</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                sounds.playClick();
                onDelete(reminder.id);
              }}
              className="px-2 py-0.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-extrabold text-[10px] transition-colors"
            >
              Yes
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setConfirmDelete(false);
              }}
              className="p-0.5 text-slate-400 hover:text-slate-600 rounded"
              title="Cancel"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              sounds.playClick();
              setConfirmDelete(true);
            }}
            className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
            title="Delete task"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Title */}
      <h3
        onClick={() => onEdit(reminder)}
        className="text-base font-bold text-slate-900 cursor-pointer hover:text-[#FF6B00] transition-colors leading-snug"
      >
        {reminder.title}
      </h3>

      {/* Progress Pill Bar matching screenshot */}
      <div className={`p-2.5 px-3.5 rounded-2xl flex items-center justify-between text-xs font-semibold ${pillBgClass}`}>
        <span>{remainingText}</span>
        <span className="text-slate-500 font-normal">Next: {reminder.nextDueOdo.toLocaleString()} km</span>
      </div>

      {/* Interval, Last Done & Mark Serviced Row */}
      <div className="flex items-end justify-between pt-1">
        <div className="text-xs text-slate-500 space-y-0.5">
          <div>Interval: every {reminder.intervalKm.toLocaleString()} km</div>
          <div className="text-[11px] text-slate-400">
            Last done: {reminder.lastCompletedOdo.toLocaleString()} km
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            sounds.playSuccess();
            onComplete(reminder);
          }}
          className="flex items-center gap-1.5 text-xs font-bold text-slate-800 hover:text-[#FF6B00] px-3 py-1.5 rounded-xl hover:bg-orange-50 transition-colors"
        >
          <Check className="w-4 h-4 text-slate-700" />
          <span>Mark Serviced</span>
        </button>
      </div>

      {/* Philippine OEM Manual Spec Box */}
      {reminder.manualSpecNote && (
        <div className="pt-2 border-t border-slate-100 text-xs space-y-1">
          <div className="flex items-center gap-1 text-[10px] font-bold text-[#FF6B00] tracking-wider uppercase">
            <span>🇵🇭</span>
            <span>PH MANUAL SPEC</span>
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed font-sans">
            {reminder.manualSpecNote}
          </p>
        </div>
      )}

      {/* Tiny Status Indicator Dot on bottom right edge */}
      <div
        className={`absolute bottom-3 right-3 w-1.5 h-1.5 rounded-full ${
          isOverdue ? 'bg-red-500' : isDueSoon ? 'bg-amber-500' : 'bg-emerald-500'
        }`}
      />
    </div>
  );
};
