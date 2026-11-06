import React from 'react';
import { MaintenanceReminder, Motorcycle } from '../types';
import { analyzeReminder } from '../utils/storage';
import {
  Trash2,
  Check,
  X,
  Droplets,
  Gauge,
  Link2,
  Disc,
  RotateCw,
  Wind,
  Zap,
  Thermometer,
  CircleDashed,
  BatteryCharging,
  Sliders,
  Wrench,
} from 'lucide-react';
import { sounds } from '../utils/audio';

interface MaintenanceCardProps {
  reminder: MaintenanceReminder;
  bike: Motorcycle;
  onComplete: (reminder: MaintenanceReminder) => void;
  onEdit: (reminder: MaintenanceReminder) => void;
  onDelete: (id: string) => void;
  onUpdateBadgeColor?: (reminderId: string, colorHex: string) => void;
}

interface TaskVisual {
  Icon: React.ComponentType<{ className?: string }>;
  iconClass: string;
  tagClass: string;
  categoryName: string;
}

/**
 * Assign unique SVG icons & color cues to common motorcycle maintenance tasks
 */
export function getTaskVisual(category?: string, title?: string): TaskVisual {
  const text = `${category || ''} ${title || ''}`.toLowerCase();

  // 1. Engine Oil
  if (text.includes('engine oil') || text.includes('motor oil') || text.includes('oil change')) {
    return {
      Icon: Droplets,
      iconClass: 'bg-amber-500/15 text-amber-600 border-amber-300/80 shadow-amber-500/10',
      tagClass: 'text-amber-600',
      categoryName: 'ENGINE OIL',
    };
  }

  // 2. Gear Oil / Final Drive Oil
  if (text.includes('gear oil') || text.includes('transmission oil') || text.includes('final drive')) {
    return {
      Icon: Gauge,
      iconClass: 'bg-cyan-500/15 text-cyan-700 border-cyan-300/80 shadow-cyan-500/10',
      tagClass: 'text-cyan-700',
      categoryName: 'GEAR OIL',
    };
  }

  // 3. Drive Chain & Sprockets
  if (text.includes('chain') || text.includes('sprocket') || text.includes('drive chain')) {
    return {
      Icon: Link2,
      iconClass: 'bg-purple-500/15 text-purple-700 border-purple-300/80 shadow-purple-500/10',
      tagClass: 'text-purple-700',
      categoryName: 'DRIVE CHAIN',
    };
  }

  // 4. Brakes (Brake Pads, Calipers, Brake Fluid, Rotors)
  if (text.includes('brake') || text.includes('pad') || text.includes('rotor') || text.includes('caliper')) {
    return {
      Icon: Disc,
      iconClass: 'bg-rose-500/15 text-rose-600 border-rose-300/80 shadow-rose-500/10',
      tagClass: 'text-rose-600',
      categoryName: 'BRAKES',
    };
  }

  // 5. CVT, Belt & Rollers
  if (text.includes('cvt') || text.includes('belt') || text.includes('drive belt') || text.includes('roller') || text.includes('pulley')) {
    return {
      Icon: RotateCw,
      iconClass: 'bg-orange-500/15 text-[#FF6B00] border-orange-300/80 shadow-orange-500/10',
      tagClass: 'text-[#FF6B00]',
      categoryName: 'CVT & DRIVE',
    };
  }

  // 6. Air Filter
  if (text.includes('air filter') || text.includes('air cleaner') || text.includes('filter')) {
    return {
      Icon: Wind,
      iconClass: 'bg-sky-500/15 text-sky-600 border-sky-300/80 shadow-sky-500/10',
      tagClass: 'text-sky-600',
      categoryName: 'AIR FILTER',
    };
  }

  // 7. Spark Plug
  if (text.includes('spark') || text.includes('plug') || text.includes('ignition')) {
    return {
      Icon: Zap,
      iconClass: 'bg-yellow-500/20 text-yellow-700 border-yellow-300/80 shadow-yellow-500/10',
      tagClass: 'text-yellow-700',
      categoryName: 'SPARK PLUG',
    };
  }

  // 8. Coolant & Radiator
  if (text.includes('coolant') || text.includes('radiator') || text.includes('antifreeze')) {
    return {
      Icon: Thermometer,
      iconClass: 'bg-blue-500/15 text-blue-600 border-blue-300/80 shadow-blue-500/10',
      tagClass: 'text-blue-600',
      categoryName: 'COOLANT',
    };
  }

  // 9. Tires & Pressure
  if (text.includes('tire') || text.includes('tyre') || text.includes('wheel') || text.includes('pressure')) {
    return {
      Icon: CircleDashed,
      iconClass: 'bg-slate-600/15 text-slate-700 border-slate-300/80 shadow-slate-500/10',
      tagClass: 'text-slate-700',
      categoryName: 'TIRES',
    };
  }

  // 10. Battery & Electrical
  if (text.includes('battery') || text.includes('voltage') || text.includes('charging') || text.includes('starter')) {
    return {
      Icon: BatteryCharging,
      iconClass: 'bg-emerald-500/15 text-emerald-700 border-emerald-300/80 shadow-emerald-500/10',
      tagClass: 'text-emerald-700',
      categoryName: 'BATTERY',
    };
  }

  // 11. Valve Clearance & Engine Tappets
  if (text.includes('valve') || text.includes('tappet') || text.includes('clearance')) {
    return {
      Icon: Sliders,
      iconClass: 'bg-amber-700/15 text-amber-800 border-amber-300/80 shadow-amber-700/10',
      tagClass: 'text-amber-800',
      categoryName: 'VALVE CLEARANCE',
    };
  }

  // Fallback / General Mechanical Task
  return {
    Icon: Wrench,
    iconClass: 'bg-slate-100 text-slate-700 border-slate-200 shadow-slate-500/10',
    tagClass: 'text-[#00ACC1]',
    categoryName: category?.toUpperCase() || 'MAINTENANCE',
  };
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

  // Visual cues based on task type
  const taskVisual = getTaskVisual(reminder.category, reminder.title);
  const TaskIcon = taskVisual.Icon;

  // Category Tag
  const categoryTag = reminder.categoryTag || taskVisual.categoryName;

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
    <div className="bg-white rounded-3xl border border-slate-100 p-5 shadow-sm space-y-3.5 relative hover:shadow-md transition-shadow">
      {/* Top Header: Unique SVG Task Icon + Category Tag & Delete Icon */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {/* Unique SVG Task Icon with Visual Cue Accent */}
          <div
            className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 border shadow-2xs ${taskVisual.iconClass}`}
            title={categoryTag}
          >
            <TaskIcon className="w-5 h-5 stroke-[2.2]" />
          </div>

          <div className="min-w-0">
            <span className={`text-[10px] font-black tracking-wider uppercase block leading-tight ${taskVisual.tagClass}`}>
              {categoryTag}
            </span>
            <h3
              onClick={() => onEdit(reminder)}
              className="text-base font-bold text-slate-900 cursor-pointer hover:text-[#FF6B00] transition-colors leading-snug truncate"
              title={reminder.title}
            >
              {reminder.title}
            </h3>
          </div>
        </div>

        {/* Delete Confirmation or Trash icon */}
        {confirmDelete ? (
          <div className="flex items-center gap-1.5 animate-in fade-in duration-100 bg-red-50 border border-red-200 px-2 py-0.5 rounded-xl shrink-0 mt-0.5">
            <span className="text-[10px] text-red-700 font-bold">Delete?</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                sounds.playClick();
                onDelete(reminder.id);
              }}
              className="px-2 py-0.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-extrabold text-[10px] transition-colors cursor-pointer"
            >
              Yes
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setConfirmDelete(false);
              }}
              className="p-0.5 text-slate-400 hover:text-slate-600 rounded cursor-pointer"
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
            className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors shrink-0 mt-0.5 cursor-pointer"
            title="Delete task"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

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
          className="flex items-center gap-1.5 text-xs font-bold text-slate-800 hover:text-[#FF6B00] px-3 py-1.5 rounded-xl hover:bg-orange-50 transition-colors cursor-pointer"
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
