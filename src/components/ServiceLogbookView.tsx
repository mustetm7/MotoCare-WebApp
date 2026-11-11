import React from 'react';
import { MaintenanceReminder, Motorcycle, ServiceRecord, UserSubscription } from '../types';
import {
  exportCasaServiceCsv,
  generatePrintableMaintenancePdfReport,
} from '../utils/storage';
import { Plus, Download, FileText, Search, Wrench, Trash2, ArrowLeft, X } from 'lucide-react';
import { sounds } from '../utils/audio';

interface ServiceLogbookViewProps {
  records: ServiceRecord[];
  reminders?: MaintenanceReminder[];
  bike: Motorcycle;
  subscription: UserSubscription;
  hasProAccess?: boolean;
  onOpenAddService: () => void;
  onOpenCasaBooklet: () => void;
  onDeleteRecord: (recordId: string) => void;
  onOpenPaywall: () => void;
  onBack: () => void;
}

export const ServiceLogbookView: React.FC<ServiceLogbookViewProps> = ({
  records,
  reminders = [],
  bike,
  subscription,
  hasProAccess,
  onOpenAddService,
  onDeleteRecord,
  onOpenPaywall,
  onBack,
}) => {
  const isPro =
    hasProAccess ??
    (subscription.tier === 'pro' &&
      subscription.status === 'active' &&
      !subscription.isExpired);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [typeFilter, setTypeFilter] = React.useState<'all' | 'Casa / Official 3S' | 'Independent Shop' | 'DIY'>('all');
  const [confirmDeleteRecordId, setConfirmDeleteRecordId] = React.useState<string | null>(null);
  const hasArchivedBikeRecords = React.useMemo(
    () => records.some((r) => !bike?.id || r.bikeId !== bike.id),
    [records, bike?.id]
  );
  const [showAllBikes, setShowAllBikes] = React.useState(false);

  const bikeRecords = records
    .filter((r) => (!bike?.id || showAllBikes ? true : r.bikeId === bike.id))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const bikeReminders = reminders.filter((r) => (!bike?.id || showAllBikes ? true : r.bikeId === bike.id));

  const totalSpentPhp = bikeRecords.reduce((sum, r) => sum + r.totalCostPhp, 0);
  const diyRecords = bikeRecords.filter((r) => r.type === 'DIY');
  const casaRecords = bikeRecords.filter((r) => r.type === 'Casa / Official 3S');
  const estimatedDiyLaborSaved = diyRecords.length * 250;

  const filteredRecords = bikeRecords.filter((r) => {
    if (typeFilter !== 'all' && r.type !== typeFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchTitle = r.title.toLowerCase().includes(q);
      const matchNotes = (r.notes || '').toLowerCase().includes(q);
      const matchShop = (r.shopName || '').toLowerCase().includes(q);
      const matchOil = (r.oilBrandGrade || '').toLowerCase().includes(q);
      const matchReceipt = (r.receiptNumber || '').toLowerCase().includes(q);
      if (!matchTitle && !matchNotes && !matchShop && !matchOil && !matchReceipt) return false;
    }
    return true;
  });

  const handleExportCsv = () => {
    if (!isPro) {
      onOpenPaywall();
      return;
    }
    exportCasaServiceCsv(bike, bikeRecords, bikeReminders);
  };

  const handleExportPdf = () => {
    generatePrintableMaintenancePdfReport(bike, bikeRecords, bikeReminders);
  };

  return (
    <div className="space-y-5">
      {/* Top Back Navigation Bar */}
      <div className="flex items-center justify-between pb-1 border-b border-slate-100">
        <button
          type="button"
          onClick={() => {
            sounds.playClick();
            onBack();
          }}
          className="flex items-center gap-1.5 text-xs font-bold text-slate-700 hover:text-[#FF6B00] transition-colors py-1.5 px-3 rounded-xl bg-white border border-slate-200 hover:border-[#FF6B00] shadow-2xs group"
        >
          <ArrowLeft className="w-4 h-4 text-[#FF6B00] group-hover:-translate-x-0.5 transition-transform" />
          <span>Back to Schedule</span>
        </button>

        <div className="flex items-center gap-2">
          {bike?.id && hasArchivedBikeRecords && (
            <button
              type="button"
              onClick={() => setShowAllBikes((v) => !v)}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-colors ${
                showAllBikes
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
              }`}
            >
              {showAllBikes ? 'Showing All / Retired Bikes' : 'Include Retired Bikes'}
            </button>
          )}
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider font-mono">
            History Ledger
          </span>
        </div>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 tracking-tight">
            Service History
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {bike?.id && !showAllBikes ? (
              <>
                Logbook for <strong className="text-slate-800">{bike.year} {bike.brand} {bike.model}</strong>
              </>
            ) : (
              <span>Complete preserved service records across active &amp; retired motorcycles</span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="export-pdf-btn"
            onClick={handleExportPdf}
            className="px-3 py-1.5 text-xs font-bold text-slate-700 hover:text-slate-900 bg-white border border-slate-200 hover:border-[#FF6B00] rounded-xl transition-colors flex items-center gap-1.5 shadow-2xs cursor-pointer"
            title="Download Report"
            aria-label="Export service history and maintenance records as PDF"
          >
            <FileText className="w-3.5 h-3.5 text-[#FF6B00]" />
            <span>Download Report</span>
          </button>

          <button
            type="button"
            data-testid="export-csv-btn"
            onClick={handleExportCsv}
            className="px-3 py-1.5 text-xs font-bold text-slate-600 hover:text-slate-900 bg-white border border-slate-200 rounded-xl transition-colors flex items-center gap-1 shadow-2xs cursor-pointer"
            title={isPro ? 'Export CSV' : 'Upgrade to Pro to Export CSV'}
            aria-label={isPro ? 'Export service history and maintenance records as CSV' : 'Upgrade to Pro to Export CSV'}
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{isPro ? 'CSV' : 'CSV (Pro)'}</span>
          </button>

          {bike?.id && (
            <button
              type="button"
              onClick={onOpenAddService}
              className="px-3.5 py-1.5 text-xs font-bold text-white bg-[#FF6B00] hover:bg-[#EA580C] rounded-xl transition-all flex items-center gap-1 shadow-sm cursor-pointer"
              title="Log new service record"
              aria-label="Log new service record"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Log</span>
            </button>
          )}
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        <div className="p-3.5 rounded-2xl bg-white border border-slate-100 shadow-sm">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Total Documented</div>
          <div className="text-lg font-extrabold font-mono text-slate-900 mt-0.5">
            ₱{totalSpentPhp.toLocaleString()}
          </div>
          <div className="text-[10px] text-slate-400">{bikeRecords.length} services</div>
        </div>

        <div className="p-3.5 rounded-2xl bg-white border border-slate-100 shadow-sm">
          <div className="text-[10px] font-bold text-emerald-600 uppercase tracking-wide">DIY Saved</div>
          <div className="text-lg font-extrabold font-mono text-emerald-600 mt-0.5">
            +₱{estimatedDiyLaborSaved.toLocaleString()}
          </div>
          <div className="text-[10px] text-slate-400">{diyRecords.length} home services</div>
        </div>

        <div className="p-3.5 rounded-2xl bg-white border border-slate-100 shadow-sm col-span-2 sm:col-span-1">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Casa 3S Stamps</div>
          <div className="text-lg font-extrabold font-mono text-[#00ACC1] mt-0.5">
            {casaRecords.length} Verified
          </div>
          <div className="text-[10px] text-slate-400">Authorized dealers</div>
        </div>
      </div>

      {/* Search & Type filter */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl text-xs overflow-x-auto">
          {(['all', 'Casa / Official 3S', 'Independent Shop', 'DIY'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`px-3 py-1 rounded-lg font-bold text-[11px] whitespace-nowrap transition-colors ${
                typeFilter === t ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {t === 'all' ? 'All' : t === 'Casa / Official 3S' ? 'Casa' : t === 'Independent Shop' ? 'Shop' : 'DIY'}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search records..."
            className="w-full sm:w-48 bg-white border border-slate-200 rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-[#FF6B00]"
          />
        </div>
      </div>

      {/* Record cards */}
      {filteredRecords.length > 0 ? (
        <div className="space-y-2.5">
          {filteredRecords.map((record) => (
            <div
              key={record.id}
              className="p-4 rounded-2xl bg-white border border-slate-100 shadow-sm hover:shadow-md transition-shadow flex items-start justify-between gap-3 text-xs"
            >
              <div className="space-y-1 flex-1">
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="font-bold text-slate-500 font-mono">{record.date}</span>
                  <span className="text-slate-300">·</span>
                  <span className="font-bold text-[#FF6B00] font-mono">{record.odometer.toLocaleString()} km</span>
                  {record.isCasaVerified && (
                    <>
                      <span className="text-slate-300">·</span>
                      <span className="px-1.5 py-0.2 rounded bg-emerald-50 text-emerald-700 font-bold text-[9px] border border-emerald-200">
                        Casa Verified
                      </span>
                    </>
                  )}
                </div>

                <h4 className="text-sm font-bold text-slate-900">{record.title}</h4>

                <div className="text-[11px] text-slate-500">
                  {record.shopName || 'Workshop'} {record.oilBrandGrade ? `· ${record.oilBrandGrade}` : ''}
                </div>

                {record.notes && (
                  <p className="text-[11px] text-slate-400 pt-0.5">{record.notes}</p>
                )}
              </div>

              <div className="text-right shrink-0">
                <div className="font-extrabold text-sm font-mono text-slate-900">
                  ₱{record.totalCostPhp.toLocaleString()}
                </div>
                {confirmDeleteRecordId === record.id ? (
                  <div className="flex items-center gap-1 mt-2 justify-end animate-in fade-in">
                    <span className="text-[10px] text-red-600 font-bold">Delete?</span>
                    <button
                      type="button"
                      onClick={() => {
                        sounds.playClick();
                        onDeleteRecord(record.id);
                        setConfirmDeleteRecordId(null);
                      }}
                      className="px-2 py-0.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-extrabold text-[10px] transition-colors"
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteRecordId(null)}
                      className="p-0.5 text-slate-400 hover:text-slate-600 rounded"
                      title="Cancel delete record"
                      aria-label="Cancel delete record"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      sounds.playClick();
                      setConfirmDeleteRecordId(record.id);
                    }}
                    className="p-1 text-slate-300 hover:text-red-500 transition-colors mt-2"
                    title={`Delete service record: ${record.title}`}
                    aria-label={`Delete service record: ${record.title}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="p-8 text-center bg-white border border-slate-100 rounded-3xl space-y-2 shadow-sm">
          <Wrench className="w-8 h-8 mx-auto text-slate-300" />
          <h4 className="text-sm font-bold text-slate-800">No Service Records</h4>
          <p className="text-xs text-slate-500">Log your maintenance visits to track costs and service history.</p>
          <button
            onClick={onOpenAddService}
            className="px-4 py-2 text-xs font-bold text-white bg-[#FF6B00] hover:bg-[#EA580C] rounded-xl shadow-sm"
          >
            Log Service
          </button>
        </div>
      )}
    </div>
  );
};
