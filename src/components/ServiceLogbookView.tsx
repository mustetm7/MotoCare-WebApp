import React from 'react';
import { MaintenanceReminder, Motorcycle, ServiceRecord, UserSubscription } from '../types';
import {
  exportCasaServiceCsv,
  generatePrintableMaintenancePdfReport,
  parseAndValidateMaintenanceCsv,
  MaintenanceCsvImportValidationResult,
} from '../utils/storage';
import {
  Plus,
  Download,
  Upload,
  FileText,
  Search,
  Wrench,
  Trash2,
  ArrowLeft,
  X,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { sounds } from '../utils/audio';

interface ServiceLogbookViewProps {
  records: ServiceRecord[];
  reminders?: MaintenanceReminder[];
  bike: Motorcycle;
  subscription: UserSubscription;
  hasProAccess?: boolean;
  onOpenAddService: () => void;
  onImportRecords?: (records: ServiceRecord[]) => void | Promise<void>;
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
  onImportRecords,
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

  // CSV Import State
  const [isCsvImportOpen, setIsCsvImportOpen] = React.useState(false);
  const [csvRawText, setCsvRawText] = React.useState('');
  const [csvValidation, setCsvValidation] =
    React.useState<MaintenanceCsvImportValidationResult | null>(null);
  const [csvImportSuccessCount, setCsvImportSuccessCount] = React.useState<number | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

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

  const handleValidateCsvText = (text: string) => {
    setCsvRawText(text);
    setCsvImportSuccessCount(null);
    if (!text.trim()) {
      setCsvValidation(null);
      return;
    }
    const result = parseAndValidateMaintenanceCsv(text, bike, bike.userId);
    setCsvValidation(result);
  };

  const handleCsvFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const content = typeof reader.result === 'string' ? reader.result : '';
      handleValidateCsvText(content);
    };
    reader.readAsText(file);
  };

  const handleLoadSampleCsv = () => {
    const sample = [
      'Date,Kilometer,Service Description,Total Cost (PHP),Shop Name,Notes',
      `2025-09-15,${Math.max(1000, (bike?.odometer || 3000) - 1500)},Engine Oil & Gear Oil Change,650,Yamaha 3S Shop,Yamalube Blue Core`,
      `2025-11-02,${Math.max(2000, (bike?.odometer || 3000) - 500)},CVT Cleaning & Air Filter Check,450,MotoCare Garage,Smooth acceleration`,
    ].join('\n');
    handleValidateCsvText(sample);
  };

  const handleConfirmCsvImport = async () => {
    if (!csvValidation || csvValidation.validRecords.length === 0 || !onImportRecords) return;
    const count = csvValidation.validRecords.length;
    await onImportRecords(csvValidation.validRecords);
    sounds.playSuccess();
    setCsvImportSuccessCount(count);
    setCsvRawText('');
    setCsvValidation(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-5">
      {/* Top Back Navigation Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-1 border-b border-slate-100">
        <button
          type="button"
          onClick={() => {
            sounds.playClick();
            onBack();
          }}
          className="flex items-center gap-1.5 text-xs font-bold text-slate-700 hover:text-[#FF6B00] transition-colors py-1.5 px-3 rounded-xl bg-white border border-slate-200 hover:border-[#FF6B00] shadow-2xs group"
        >
          <ArrowLeft className="w-4 h-4 text-[#FF6B00] group-hover:-translate-x-0.5 transition-transform shrink-0" />
          <span>Back to Schedule</span>
        </button>

        <div className="flex flex-wrap items-center gap-2">
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
      <div className="flex flex-wrap items-center justify-between gap-3">
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

        <div className="flex flex-wrap items-center gap-2">
          {bike?.id && onImportRecords && (
            <button
              type="button"
              data-testid="import-csv-btn"
              onClick={() => {
                sounds.playClick();
                setIsCsvImportOpen((v) => !v);
                setCsvImportSuccessCount(null);
              }}
              className="px-3 py-1.5 text-xs font-bold text-slate-700 hover:text-[#FF6B00] bg-white border border-slate-200 hover:border-[#FF6B00] rounded-xl transition-colors flex items-center gap-1.5 shadow-2xs cursor-pointer"
              title="Import Legacy Records from CSV"
              aria-label="Import maintenance history from CSV"
            >
              <Upload className="w-3.5 h-3.5 text-[#FF6B00]" />
              <span>Import CSV</span>
            </button>
          )}

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

      {/* CSV Import Panel */}
      {isCsvImportOpen && (
        <div
          data-testid="csv-import-panel"
          className="p-4 sm:p-5 rounded-3xl bg-white border-2 border-orange-200/80 shadow-sm space-y-3.5"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-1.5">
                <Upload className="w-4 h-4 text-[#FF6B00]" />
                <span>Import Legacy Maintenance History (CSV)</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Upload a <code className="font-mono text-slate-700">.csv</code> file or paste rows with required columns:{' '}
                <strong className="text-slate-700">Date</strong>,{' '}
                <strong className="text-slate-700">Kilometer</strong> (or Odometer), and{' '}
                <strong className="text-slate-700">Service Description</strong>.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsCsvImportOpen(false)}
              className="p-1 text-slate-400 hover:text-slate-700 rounded-lg"
              aria-label="Close CSV import panel"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              data-testid="csv-file-input"
              onChange={handleCsvFileChange}
              className="text-xs text-slate-600 file:mr-2.5 file:py-1.5 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-orange-50 file:text-[#FF6B00] hover:file:bg-orange-100 cursor-pointer"
            />
            <button
              type="button"
              data-testid="csv-load-sample-btn"
              onClick={handleLoadSampleCsv}
              className="px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-[11px] font-bold text-slate-700 transition-colors cursor-pointer"
            >
              Load Sample Template
            </button>
          </div>

          <textarea
            rows={4}
            data-testid="csv-textarea-input"
            value={csvRawText}
            onChange={(e) => handleValidateCsvText(e.target.value)}
            placeholder={'Date,Kilometer,Service Description,Total Cost (PHP)\n2025-08-12,4500,Engine Oil Change,450'}
            className="w-full rounded-2xl bg-slate-50 border border-slate-200 p-3 text-xs font-mono text-slate-800 focus:outline-none focus:border-[#FF6B00]"
          />

          {csvImportSuccessCount !== null && (
            <div
              role="status"
              data-testid="csv-import-success-banner"
              className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold flex items-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>
                Successfully imported {csvImportSuccessCount} legacy maintenance record
                {csvImportSuccessCount === 1 ? '' : 's'}!
              </span>
            </div>
          )}

          {csvValidation && (
            <div className="space-y-2.5">
              {csvValidation.errors.length > 0 && (
                <div
                  role="alert"
                  data-testid="csv-validation-errors"
                  className="p-3 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-xs space-y-1"
                >
                  <div className="font-extrabold flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                    <span>Validation Issues ({csvValidation.errors.length})</span>
                  </div>
                  <ul className="list-disc pl-5 space-y-0.5 text-[11px]">
                    {csvValidation.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}

              {csvValidation.validRecords.length > 0 && (
                <div
                  data-testid="csv-valid-preview"
                  className="p-3 rounded-2xl bg-slate-50 border border-slate-200 space-y-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="font-extrabold text-emerald-700">
                      Ready to Import: {csvValidation.validRecords.length} valid record
                      {csvValidation.validRecords.length === 1 ? '' : 's'}
                    </span>
                    <button
                      type="button"
                      data-testid="confirm-csv-import-btn"
                      onClick={() => void handleConfirmCsvImport()}
                      className="px-4 py-1.5 rounded-xl bg-[#FF6B00] hover:bg-[#EA580C] text-white font-extrabold text-xs shadow-xs cursor-pointer"
                    >
                      Import {csvValidation.validRecords.length} Record
                      {csvValidation.validRecords.length === 1 ? '' : 's'}
                    </button>
                  </div>

                  <div className="max-h-36 overflow-y-auto space-y-1 text-[11px] font-mono text-slate-600">
                    {csvValidation.validRecords.slice(0, 10).map((rec) => (
                      <div
                        key={rec.id}
                        className="flex items-center justify-between py-1 px-2 rounded-lg bg-white border border-slate-100"
                      >
                        <span className="truncate">
                          {rec.date} • {rec.odometer.toLocaleString()} km •{' '}
                          <strong className="font-sans text-slate-800">{rec.title}</strong>
                        </span>
                        <span className="text-slate-900 font-bold shrink-0 ml-2">
                          ₱{rec.totalCostPhp.toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Metric Cards */}
      <div className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-3 gap-2.5">
        <div className="p-3.5 rounded-2xl bg-white border border-slate-100 shadow-sm min-w-0">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide truncate">Total Documented</div>
          <div className="text-lg font-extrabold font-mono text-slate-900 mt-0.5 truncate">
            ₱{totalSpentPhp.toLocaleString()}
          </div>
          <div className="text-[10px] text-slate-400">{bikeRecords.length} services</div>
        </div>

        <div className="p-3.5 rounded-2xl bg-white border border-slate-100 shadow-sm min-w-0">
          <div className="text-[10px] font-bold text-emerald-600 uppercase tracking-wide truncate">DIY Saved</div>
          <div className="text-lg font-extrabold font-mono text-emerald-600 mt-0.5 truncate">
            +₱{estimatedDiyLaborSaved.toLocaleString()}
          </div>
          <div className="text-[10px] text-slate-400">{diyRecords.length} home services</div>
        </div>

        <div className="p-3.5 rounded-2xl bg-white border border-slate-100 shadow-sm xs:col-span-2 sm:col-span-1 min-w-0">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide truncate">Casa 3S Stamps</div>
          <div className="text-lg font-extrabold font-mono text-[#00ACC1] mt-0.5 truncate">
            {casaRecords.length} Verified
          </div>
          <div className="text-[10px] text-slate-400">Authorized dealers</div>
        </div>
      </div>

      {/* Search & Type filter */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl text-xs overflow-x-auto no-scrollbar">
          {(['all', 'Casa / Official 3S', 'Independent Shop', 'DIY'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`px-3 py-1.5 rounded-lg font-bold text-[11px] whitespace-nowrap transition-colors shrink-0 ${
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
            className="w-full sm:w-48 bg-white border border-slate-200 rounded-xl pl-8 pr-3 py-2 sm:py-1.5 text-xs text-slate-800 focus:outline-none focus:border-[#FF6B00]"
          />
        </div>
      </div>

      {/* Record cards */}
      {filteredRecords.length > 0 ? (
        <div className="space-y-2.5">
          {filteredRecords.map((record) => (
            <div
              key={record.id}
              className="p-3.5 sm:p-4 rounded-2xl bg-white border border-slate-100 shadow-sm hover:shadow-md transition-shadow flex flex-col xs:flex-row xs:items-start justify-between gap-2.5 xs:gap-3 text-xs"
            >
              <div className="space-y-1 flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 text-[11px]">
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

                <h4 className="text-sm font-bold text-slate-900 break-words">{record.title}</h4>

                <div className="text-[11px] text-slate-500 break-words">
                  {record.shopName || 'Workshop'} {record.oilBrandGrade ? `· ${record.oilBrandGrade}` : ''}
                </div>

                {record.notes && (
                  <p className="text-[11px] text-slate-400 pt-0.5 break-words">{record.notes}</p>
                )}
              </div>

              <div className="flex xs:block items-center justify-between pt-2 xs:pt-0 border-t xs:border-t-0 border-slate-100 xs:text-right shrink-0">
                <div className="font-extrabold text-sm font-mono text-slate-900">
                  ₱{record.totalCostPhp.toLocaleString()}
                </div>
                {confirmDeleteRecordId === record.id ? (
                  <div className="flex items-center gap-1 xs:mt-2 justify-end animate-in fade-in">
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
                    className="p-1 text-slate-300 hover:text-red-500 transition-colors xs:mt-2"
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
