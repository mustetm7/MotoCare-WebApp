import React from 'react';
import { MaintenanceReminder, Motorcycle, ServiceCategory } from '../types';
import { analyzeReminder } from '../utils/storage';
import { MaintenanceCard } from './MaintenanceCard';
import { Plus, Search, Filter, AlertTriangle, Clock, CheckCircle2, Sparkles, Wrench } from 'lucide-react';
import { PHILIPPINE_MOTORCYCLE_PRESETS, generateOemSchedule } from '../data/philippinePresets';
import { sounds } from '../utils/audio';

interface RemindersViewProps {
  reminders: MaintenanceReminder[];
  bike: Motorcycle;
  onOpenAddReminder: () => void;
  onCompleteReminder: (reminder: MaintenanceReminder) => void;
  onEditReminder: (reminder: MaintenanceReminder) => void;
  onDeleteReminder: (reminderId: string) => void;
  onUpdateBadgeColor: (reminderId: string, colorHex: string) => void;
  onResetOemSchedule: (newReminders: MaintenanceReminder[]) => void;
}

export const RemindersView: React.FC<RemindersViewProps> = ({
  reminders,
  bike,
  onOpenAddReminder,
  onCompleteReminder,
  onEditReminder,
  onDeleteReminder,
  onUpdateBadgeColor,
  onResetOemSchedule,
}) => {
  const [statusFilter, setStatusFilter] = React.useState<'all' | 'overdue' | 'due-soon' | 'ok'>('all');
  const [categoryFilter, setCategoryFilter] = React.useState<string>('all');
  const [searchQuery, setSearchQuery] = React.useState('');

  const bikeReminders = reminders.filter((r) => r.bikeId === bike.id);

  const analyzed = bikeReminders.map((r) => ({
    reminder: r,
    analysis: analyzeReminder(r, bike.odometer),
  }));

  const overdueCount = analyzed.filter((a) => a.analysis.status === 'overdue').length;
  const dueSoonCount = analyzed.filter((a) => a.analysis.status === 'due-soon').length;
  const okCount = analyzed.filter((a) => a.analysis.status === 'ok').length;

  const filtered = analyzed.filter(({ reminder, analysis }) => {
    if (statusFilter !== 'all' && analysis.status !== statusFilter) return false;
    if (categoryFilter !== 'all' && reminder.category !== categoryFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchTitle = reminder.title.toLowerCase().includes(q);
      const matchNotes = (reminder.notes || '').toLowerCase().includes(q);
      const matchCat = reminder.category.toLowerCase().includes(q);
      if (!matchTitle && !matchNotes && !matchCat) return false;
    }
    return true;
  });

  const categories = [
    'all',
    'Engine Oil',
    'Gear Oil',
    'CVT & Belt',
    'Drive Chain',
    'Brakes',
    'Spark Plug',
    'Coolant',
    'Air Filter',
    'Valve Clearance',
  ];

  const handleReloadOem = () => {
    if (window.confirm(`Reload Philippine OEM Factory PMS intervals for ${bike.brand} ${bike.model}? This will add recommended intervals.`)) {
      sounds.playSuccess();
      const preset = PHILIPPINE_MOTORCYCLE_PRESETS.find(
        (p) => p.model.toLowerCase().includes(bike.model.toLowerCase()) || p.brand === bike.brand
      ) || PHILIPPINE_MOTORCYCLE_PRESETS[0];

      const oemReminders = generateOemSchedule(bike.id, preset, bike.odometer);
      onResetOemSchedule(oemReminders);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
            Motorcycle PMS Schedule & Reminders
          </h2>
          <p className="text-xs text-neutral-400 mt-1">
            Active tracking for <strong className="text-white">{bike.year} {bike.brand} {bike.model}</strong> at{' '}
            <span className="font-mono text-[#FF6B00] font-bold">{bike.odometer.toLocaleString()} km</span>.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
          <button
            onClick={handleReloadOem}
            className="px-3 py-2 text-xs font-semibold text-neutral-300 hover:text-white bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded-lg transition-colors flex items-center gap-1.5"
            title="Load Philippine Factory Manual Intervals"
          >
            <Sparkles className="w-3.5 h-3.5 text-[#FF6B00]" />
            <span className="hidden sm:inline">Load OEM Schedule</span>
          </button>

          <button
            onClick={onOpenAddReminder}
            className="px-4 py-2 text-xs font-bold text-neutral-950 bg-[#FF6B00] hover:bg-[#FF8533] rounded-lg transition-colors flex items-center gap-1.5 shadow-md shadow-[#FF6B00]/20"
          >
            <Plus className="w-4 h-4 stroke-[3]" />
            <span>New Task</span>
          </button>
        </div>
      </div>

      {/* Filter Controls Strip */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-[#18181b] p-2.5 rounded-2xl border border-neutral-800">
        {/* Status Filter Buttons */}
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setStatusFilter('all')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap transition-colors ${
              statusFilter === 'all'
                ? 'bg-neutral-800 text-white'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            All Tasks <span className="font-mono text-[11px] text-neutral-500">({bikeReminders.length})</span>
          </button>

          <button
            onClick={() => setStatusFilter('overdue')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap transition-colors flex items-center gap-1.5 ${
              statusFilter === 'overdue'
                ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                : 'text-neutral-400 hover:text-red-400'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
            Overdue
            <span className="font-mono text-[11px] text-red-400 font-bold">({overdueCount})</span>
          </button>

          <button
            onClick={() => setStatusFilter('due-soon')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap transition-colors flex items-center gap-1.5 ${
              statusFilter === 'due-soon'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                : 'text-neutral-400 hover:text-amber-400'
            }`}
          >
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            Due Soon
            <span className="font-mono text-[11px] text-amber-400 font-bold">({dueSoonCount})</span>
          </button>

          <button
            onClick={() => setStatusFilter('ok')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap transition-colors flex items-center gap-1.5 ${
              statusFilter === 'ok'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                : 'text-neutral-400 hover:text-emerald-400'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            Good
            <span className="font-mono text-[11px] text-neutral-500">({okCount})</span>
          </button>
        </div>

        {/* Search */}
        <div className="relative min-w-[200px]">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search PMS tasks, oil, belt..."
            className="w-full bg-neutral-950 border border-neutral-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:border-[#FF6B00]"
          />
        </div>
      </div>

      {/* Category Pills */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar text-xs">
        <span className="text-[11px] text-neutral-500 font-semibold mr-1 flex items-center gap-1 shrink-0">
          <Filter className="w-3 h-3" /> Category:
        </span>
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setCategoryFilter(cat)}
            className={`px-2.5 py-1 rounded-lg text-xs transition-colors whitespace-nowrap ${
              categoryFilter === cat
                ? 'bg-[#FF6B00]/20 text-[#FF6B00] font-bold border border-[#FF6B00]/40'
                : 'bg-neutral-900 text-neutral-400 hover:text-white border border-neutral-800'
            }`}
          >
            {cat === 'all' ? 'All Systems' : cat}
          </button>
        ))}
      </div>

      {/* Task Cards Grid */}
      {filtered.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(({ reminder }) => (
            <MaintenanceCard
              key={reminder.id}
              reminder={reminder}
              bike={bike}
              onComplete={onCompleteReminder}
              onEdit={onEditReminder}
              onDelete={onDeleteReminder}
              onUpdateBadgeColor={onUpdateBadgeColor}
            />
          ))}
        </div>
      ) : (
        <div className="p-12 text-center bg-[#18181b] border border-neutral-800 rounded-2xl space-y-3">
          <Wrench className="w-10 h-10 mx-auto text-neutral-600" />
          <h3 className="text-base font-bold text-neutral-200">No Reminders Found</h3>
          <p className="text-xs text-neutral-400 max-w-sm mx-auto">
            {searchQuery || categoryFilter !== 'all' || statusFilter !== 'all'
              ? 'No tasks match your active filters. Try clearing search or status filters.'
              : 'You haven\'t set up PMS maintenance tasks for this motorcycle yet.'}
          </p>
          <div className="flex items-center justify-center gap-2 pt-1">
            <button
              onClick={handleReloadOem}
              className="px-4 py-2 text-xs font-bold bg-[#FF6B00] hover:bg-[#FF8533] text-neutral-950 rounded-lg shadow-sm"
            >
              Load Factory OEM Schedule
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
