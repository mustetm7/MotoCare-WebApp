import React from 'react';
import { PreRideItem, Motorcycle } from '../types';
import { sounds } from '../utils/audio';
import { ShieldCheck, CheckCircle2, RotateCcw, AlertCircle, Wrench, Sparkles, Check } from 'lucide-react';

interface PreRideChecklistViewProps {
  items: PreRideItem[];
  bike: Motorcycle;
  onToggleItem: (id: string) => void;
  onResetAll: () => void;
  onCheckAll: () => void;
  onLogInspectionAsService: () => void;
}

export const PreRideChecklistView: React.FC<PreRideChecklistViewProps> = ({
  items,
  bike,
  onToggleItem,
  onResetAll,
  onCheckAll,
  onLogInspectionAsService,
}) => {
  const totalCount = items.length;
  const checkedCount = items.filter((i) => i.checked).length;
  const isComplete = totalCount > 0 && checkedCount === totalCount;
  const progressPercent = Math.round((checkedCount / totalCount) * 100);

  // Group items by category
  const groups: Record<string, PreRideItem[]> = items.reduce((acc, item) => {
    if (!acc[item.group]) acc[item.group] = [];
    acc[item.group].push(item);
    return acc;
  }, {} as Record<string, PreRideItem[]>);

  const handleToggle = (id: string) => {
    sounds.playClick();
    onToggleItem(id);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight flex items-center gap-2">
            <span>T-CLOCS Pre-Ride Safety Inspection</span>
            <span className="text-xs font-mono text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/30">
              MSF Standard
            </span>
          </h2>
          <p className="text-xs text-neutral-400 mt-1">
            Perform a quick 60-second inspection before every ride on your {bike.year} {bike.brand} {bike.model} to ensure optimal mechanical safety.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onResetAll}
            className="px-3 py-1.5 text-xs font-medium text-neutral-400 hover:text-white bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded-md transition-colors flex items-center gap-1.5"
            title="Reset all checkboxes"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset</span>
          </button>

          <button
            onClick={onCheckAll}
            className="px-3 py-1.5 text-xs font-medium text-neutral-300 hover:text-white bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded-md transition-colors flex items-center gap-1.5"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Select All</span>
          </button>
        </div>
      </div>

      {/* Progress Card */}
      <div className={`p-5 rounded-2xl border transition-all ${
        isComplete
          ? 'bg-emerald-950/20 border-emerald-500/40 shadow-lg'
          : 'bg-neutral-900 border-neutral-800'
      }`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
              isComplete
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
            }`}>
              {isComplete ? (
                <ShieldCheck className="w-6 h-6 stroke-[2.2]" />
              ) : (
                <AlertCircle className="w-6 h-6" />
              )}
            </div>

            <div>
              <div className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
                <span>{isComplete ? 'Motorcycle Ready for Road!' : 'Pre-Ride Checklist in Progress'}</span>
                {isComplete && (
                  <span className="text-xs text-emerald-400 font-mono font-normal">Passed 100%</span>
                )}
              </div>
              <div className="text-xs text-neutral-400 mt-0.5">
                {checkedCount} of {totalCount} safety inspection points verified
              </div>
            </div>
          </div>

          {isComplete && (
            <button
              onClick={onLogInspectionAsService}
              className="px-4 py-2 text-xs font-semibold text-neutral-950 bg-emerald-400 hover:bg-emerald-300 rounded-md transition-colors flex items-center gap-1.5 self-start sm:self-center shadow-md font-sans"
            >
              <Wrench className="w-3.5 h-3.5" />
              <span>Log Inspection to History</span>
            </button>
          )}
        </div>

        {/* Progress bar */}
        <div className="mt-4">
          <div className="w-full h-2 bg-neutral-950 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                isComplete ? 'bg-emerald-500' : 'bg-amber-400'
              }`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* Grouped Checklist Sections */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Object.entries(groups).map(([groupName, groupItems]) => {
          const groupChecked = groupItems.filter((i) => i.checked).length;
          const isGroupComplete = groupChecked === groupItems.length;

          return (
            <div
              key={groupName}
              className="p-4 sm:p-5 rounded-xl bg-neutral-900 border border-neutral-800 space-y-3"
            >
              <div className="flex items-center justify-between border-b border-neutral-800 pb-2.5">
                <h3 className="text-sm font-bold text-white">
                  {groupName}
                </h3>
                <span className={`text-[11px] font-mono ${isGroupComplete ? 'text-emerald-400' : 'text-neutral-500'}`}>
                  {groupChecked}/{groupItems.length} checked
                </span>
              </div>

              <div className="space-y-2.5">
                {groupItems.map((item) => (
                  <label
                    key={item.id}
                    onClick={() => handleToggle(item.id)}
                    className={`flex items-start gap-3 p-2.5 rounded-lg border transition-all cursor-pointer select-none ${
                      item.checked
                        ? 'bg-neutral-950/80 border-neutral-700/60 text-neutral-300'
                        : 'bg-neutral-950/30 border-neutral-800/80 text-neutral-400 hover:border-neutral-700'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={item.checked}
                      onChange={() => {}} // handled by parent onClick
                      className="mt-0.5 w-4 h-4 rounded border-neutral-700 text-amber-500 focus:ring-0 focus:ring-offset-0 bg-neutral-900 shrink-0 cursor-pointer"
                    />
                    <div className="text-xs">
                      <div className={`font-medium ${item.checked ? 'text-neutral-200 line-through decoration-neutral-600' : 'text-neutral-200'}`}>
                        {item.label}
                      </div>
                      <div className="text-[11px] text-neutral-500 mt-0.5">
                        {item.detail}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
