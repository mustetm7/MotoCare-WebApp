import React from 'react';
import { Motorcycle, ServiceRecord, MaintenanceReminder } from '../types';
import { analyzeReminder } from '../utils/storage';
import { DollarSign, TrendingUp, ShieldCheck, PieChart, Calendar, BarChart3 } from 'lucide-react';

interface AnalyticsViewProps {
  bike: Motorcycle;
  records: ServiceRecord[];
  reminders: MaintenanceReminder[];
}

export const AnalyticsView: React.FC<AnalyticsViewProps> = ({
  bike,
  records,
  reminders,
}) => {
  const bikeRecords = records.filter((r) => r.bikeId === bike.id);
  const bikeReminders = reminders.filter((r) => r.bikeId === bike.id);

  const totalSpentPhp = bikeRecords.reduce((sum, r) => sum + r.totalCostPhp, 0);
  const totalPartsPhp = bikeRecords.reduce((sum, r) => sum + r.parts.reduce((pSum, p) => pSum + p.costPhp, 0), 0);
  const totalLaborPhp = bikeRecords.reduce((sum, r) => sum + r.laborCostPhp, 0);

  const diyCount = bikeRecords.filter((r) => r.type === 'DIY').length;
  const casaCount = bikeRecords.filter((r) => r.type === 'Casa / Official 3S').length;
  const shopCount = bikeRecords.filter((r) => r.type === 'Independent Shop').length;
  const estimatedDiySavingsPhp = diyCount * 250;

  const costPerKm = bike.odometer > 0 ? (totalSpentPhp / bike.odometer) : 0;

  // Category breakdown
  const categoryTotals: Record<string, number> = {};
  bikeRecords.forEach((r) => {
    categoryTotals[r.category] = (categoryTotals[r.category] || 0) + r.totalCostPhp;
  });

  const categoryEntries = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]);
  const projectedUpcomingPhp = bikeReminders.reduce((sum, r) => sum + (r.estimatedCostPhp || 0), 0);

  // Health score
  const analyses = bikeReminders.map((r) => analyzeReminder(r, bike.odometer));
  const overdueCount = analyses.filter((a) => a.status === 'overdue').length;
  const dueSoonCount = analyses.filter((a) => a.status === 'due-soon').length;
  const healthScore = Math.max(0, 100 - overdueCount * 25 - dueSoonCount * 10);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
          Maintenance Cost & Ownership Analytics
        </h2>
        <p className="text-xs text-neutral-400 mt-1">
          Financial and mechanical health insights for <strong className="text-white">{bike.year} {bike.brand} {bike.model}</strong>.
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="p-4 rounded-2xl bg-[#18181b] border border-neutral-800">
          <div className="text-[11px] text-neutral-400 font-mono font-medium flex items-center gap-1.5">
            <DollarSign className="w-3.5 h-3.5 text-[#FF6B00]" />
            Total Spent (PHP)
          </div>
          <div className="text-2xl font-black text-white font-mono tabular-nums mt-1">
            ₱{totalSpentPhp.toLocaleString()}
          </div>
          <div className="text-[10px] text-neutral-500 mt-1 font-mono">
            ₱{costPerKm.toFixed(2)} per kilometer
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-[#18181b] border border-neutral-800">
          <div className="text-[11px] text-emerald-400 font-mono font-medium flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5" />
            DIY Labor Saved
          </div>
          <div className="text-2xl font-black text-emerald-400 font-mono tabular-nums mt-1">
            +₱{estimatedDiySavingsPhp.toLocaleString()}
          </div>
          <div className="text-[10px] text-neutral-500 mt-1">
            {diyCount} DIY vs {casaCount + shopCount} Shop visits
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-[#18181b] border border-neutral-800">
          <div className="text-[11px] text-blue-400 font-mono font-medium flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5" />
            Reliability Index
          </div>
          <div className="text-2xl font-black text-white font-mono tabular-nums mt-1 flex items-center gap-2">
            <span>{healthScore}%</span>
            <span className={`text-[10px] font-sans px-1.5 py-0.5 rounded font-bold ${
              healthScore >= 80 ? 'text-emerald-400 bg-emerald-500/20' : healthScore >= 60 ? 'text-amber-400 bg-amber-500/20' : 'text-red-400 bg-red-500/20'
            }`}>
              {healthScore >= 80 ? 'Nominal' : healthScore >= 60 ? 'Attention' : 'Urgent'}
            </span>
          </div>
          <div className="text-[10px] text-neutral-500 mt-1">
            {overdueCount} overdue · {dueSoonCount} due soon
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-[#18181b] border border-neutral-800">
          <div className="text-[11px] text-purple-400 font-mono font-medium flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5" />
            Upcoming PMS Est.
          </div>
          <div className="text-2xl font-black text-white font-mono tabular-nums mt-1">
            ~₱{projectedUpcomingPhp.toLocaleString()}
          </div>
          <div className="text-[10px] text-neutral-500 mt-1">
            Next {bikeReminders.length} scheduled PMS cycles
          </div>
        </div>
      </div>

      {/* Grid: Category Breakdown + Cost Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Category Breakdown (7 cols) */}
        <div className="lg:col-span-7 p-5 rounded-2xl bg-[#18181b] border border-neutral-800 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <PieChart className="w-4 h-4 text-[#FF6B00]" />
              Maintenance Spend by System
            </h3>
            <span className="text-xs text-neutral-400 font-mono">
              {categoryEntries.length} Categories
            </span>
          </div>

          {categoryEntries.length > 0 ? (
            <div className="space-y-3 pt-1">
              {categoryEntries.map(([category, amount]) => {
                const percent = totalSpentPhp > 0 ? Math.round((amount / totalSpentPhp) * 100) : 0;
                return (
                  <div key={category} className="space-y-1">
                    <div className="flex items-center justify-between text-xs font-medium">
                      <span className="text-neutral-300">{category}</span>
                      <div>
                        <span className="text-white font-mono font-bold">₱{amount.toLocaleString()}</span>
                        <span className="text-neutral-500 text-[11px] ml-2 font-mono">({percent}%)</span>
                      </div>
                    </div>
                    <div className="w-full h-2 bg-neutral-950 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#FF6B00] rounded-full transition-all duration-300"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="py-8 text-center text-xs text-neutral-500">
              No service expenditures logged yet.
            </div>
          )}
        </div>

        {/* Parts vs Labor Breakdown */}
        <div className="lg:col-span-5 p-5 rounded-2xl bg-[#18181b] border border-neutral-800 space-y-4">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-emerald-400" />
            Parts vs. Labor Invoiced
          </h3>

          <div className="p-4 rounded-xl bg-neutral-950 border border-neutral-800 space-y-2.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-neutral-400">Parts & Supplies:</span>
              <span className="font-mono text-white font-bold">₱{totalPartsPhp.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-neutral-400">Shop Labor Fees:</span>
              <span className="font-mono text-white font-bold">₱{totalLaborPhp.toLocaleString()}</span>
            </div>
            <div className="pt-2 border-t border-neutral-800 flex items-center justify-between">
              <span className="text-emerald-400 font-semibold">DIY Labor Savings:</span>
              <span className="font-mono text-emerald-400 font-black">+₱{estimatedDiySavingsPhp.toLocaleString()}</span>
            </div>
          </div>

          <div className="pt-1">
            <div className="text-xs font-bold text-neutral-300 mb-2">
              Next Upcoming PMS Forecast
            </div>
            {bikeReminders
              .slice()
              .sort((a, b) => a.nextDueOdo - b.nextDueOdo)
              .slice(0, 3)
              .map((r) => (
                <div key={r.id} className="py-2 border-b border-neutral-800/80 last:border-0 flex items-center justify-between text-xs">
                  <div>
                    <div className="text-neutral-200 font-semibold truncate max-w-[190px]">{r.title}</div>
                    <div className="text-[10px] text-neutral-500 font-mono">
                      Due at {r.nextDueOdo.toLocaleString()} km
                    </div>
                  </div>
                  <span className="font-mono text-[#FF6B00] font-bold text-xs shrink-0">
                    ~₱{r.estimatedCostPhp.toLocaleString()}
                  </span>
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
};
