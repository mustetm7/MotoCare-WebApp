import React from 'react';
import { Motorcycle, ServiceRecord, UserSubscription } from '../types';
import { exportCasaServiceCsv } from '../utils/storage';
import { X, Printer, Download, ShieldCheck, CheckCircle, Sparkles, Building2 } from 'lucide-react';

interface CasaBookletModalProps {
  isOpen: boolean;
  onClose: () => void;
  bike: Motorcycle;
  records: ServiceRecord[];
  subscription: UserSubscription;
  hasProAccess?: boolean;
  onOpenPaywall: () => void;
}

export const CasaBookletModal: React.FC<CasaBookletModalProps> = ({
  isOpen,
  onClose,
  bike,
  records,
  subscription,
  hasProAccess,
  onOpenPaywall,
}) => {
  if (!isOpen) return null;

  const isPro =
    hasProAccess ??
    (subscription.tier === 'pro' &&
      subscription.status === 'active' &&
      !subscription.isExpired);
  const bikeRecords = records.filter((r) => r.bikeId === bike.id);
  const totalSpent = bikeRecords.reduce((sum, r) => sum + r.totalCostPhp, 0);
  const casaCount = bikeRecords.filter((r) => r.type === 'Casa / Official 3S').length;

  const handlePrint = () => {
    if (!isPro) {
      onOpenPaywall();
      return;
    }
    window.print();
  };

  const handleExportCsv = () => {
    if (!isPro) {
      onOpenPaywall();
      return;
    }
    exportCasaServiceCsv(bike, bikeRecords);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md overflow-y-auto animate-in fade-in duration-200">
      <div className="bg-[#18181b] border border-neutral-700/80 rounded-2xl w-full max-w-3xl my-6 overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-neutral-800 flex items-center justify-between bg-neutral-900/60 shrink-0">
          <div className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-[#FF6B00]" />
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span>Verified Philippine Casa Service Booklet</span>
                <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  OFFICIAL PASSPORT
                </span>
              </h3>
              <p className="text-[11px] text-neutral-400">
                Tamper-resistant digital maintenance booklet for warranty compliance & high resale valuation.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="px-3 py-1.5 text-xs font-semibold bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg border border-neutral-700 flex items-center gap-1.5 transition-colors"
              title="Print booklet or Save as PDF"
            >
              <Printer className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Print / PDF</span>
            </button>

            <button
              onClick={handleExportCsv}
              className="px-3 py-1.5 text-xs font-semibold bg-[#FF6B00] hover:bg-[#FF8533] text-neutral-950 rounded-lg flex items-center gap-1.5 transition-colors shadow-sm"
              title="Download CSV Booklet"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>

            <button
              onClick={onClose}
              className="p-1 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition-colors ml-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Free Banner Lock notice if not pro */}
        {!isPro && (
          <div className="p-3 bg-[#FF6B00]/15 border-b border-[#FF6B00]/30 px-5 flex items-center justify-between gap-3 text-xs shrink-0">
            <div className="flex items-center gap-2 text-neutral-200">
              <Sparkles className="w-4 h-4 text-[#FF6B00] shrink-0" />
              <span>Previewing Casa Booklet. Upgrade to <strong>MotoCare Pro (₱49/mo)</strong> to export official PDF/CSV without watermarks.</span>
            </div>
            <button
              onClick={onOpenPaywall}
              className="px-3 py-1 bg-[#FF6B00] hover:bg-[#FF8533] text-neutral-950 font-bold rounded text-xs whitespace-nowrap shadow-sm"
            >
              Upgrade (₱49)
            </button>
          </div>
        )}

        {/* Printable Booklet Sheet Content */}
        <div className="p-6 overflow-y-auto space-y-6 bg-neutral-950 text-neutral-100 print:bg-white print:text-neutral-900">
          {/* Certificate Header Banner */}
          <div className="p-5 rounded-2xl bg-gradient-to-r from-neutral-900 via-neutral-900 to-neutral-950 border border-neutral-800 relative overflow-hidden flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="text-[10px] uppercase font-mono tracking-widest text-[#FF6B00] font-bold">
                PHILIPPINE MOTORCYCLE PMS RECORD
              </div>
              <h2 className="text-2xl font-black tracking-tight text-white">
                {bike.year} {bike.brand} {bike.model}
              </h2>
              <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-400 font-mono">
                <span>Plate: <strong className="text-white">{bike.licensePlate || 'N/A'}</strong></span>
                <span>·</span>
                <span>Displacement: {bike.specs?.displacementCc}cc</span>
                <span>·</span>
                <span>Transmission: {bike.specs?.transmission}</span>
                <span>·</span>
                <span>Total Mileage: <strong className="text-[#FF6B00]">{bike.odometer.toLocaleString()} km</strong></span>
              </div>
            </div>

            {/* Simulated Verified Casa Seal */}
            <div className="p-3 rounded-xl bg-neutral-900/90 border border-emerald-500/40 text-center shrink-0 flex items-center gap-3">
              <ShieldCheck className="w-10 h-10 text-emerald-400" />
              <div className="text-left">
                <div className="text-xs font-black text-emerald-400 tracking-wider">
                  CASA VERIFIED
                </div>
                <div className="text-[10px] text-neutral-400 font-mono">
                  {casaCount} Official 3S Stamps
                </div>
                <div className="text-[9px] text-neutral-500">
                  MOTOCARE PH CERTIFIED
                </div>
              </div>
            </div>
          </div>

          {/* Investment Summary */}
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 rounded-xl bg-[#18181b] border border-neutral-800 text-xs">
              <span className="text-neutral-400 text-[11px]">Total Documented Spend</span>
              <div className="text-lg font-bold font-mono text-white mt-0.5">
                ₱{totalSpent.toLocaleString()}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-[#18181b] border border-neutral-800 text-xs">
              <span className="text-neutral-400 text-[11px]">Recorded PMS Services</span>
              <div className="text-lg font-bold font-mono text-white mt-0.5">
                {bikeRecords.length} Entries
              </div>
            </div>
            <div className="p-3 rounded-xl bg-[#18181b] border border-neutral-800 text-xs">
              <span className="text-neutral-400 text-[11px]">Recommended Oil Grade</span>
              <div className="text-xs font-bold font-mono text-amber-400 mt-1 truncate">
                {bike.specs?.oilViscosity || '10W-40 JASO MB'}
              </div>
            </div>
          </div>

          {/* Service Passport Table */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-400">
              Chronological Service & Inspection Passport Stamps
            </h4>

            {bikeRecords.length > 0 ? (
              <div className="border border-neutral-800 rounded-xl overflow-hidden divide-y divide-neutral-800/80">
                {bikeRecords.map((r) => (
                  <div key={r.id} className="p-4 bg-[#18181b] flex flex-col md:flex-row md:items-start justify-between gap-3 text-xs">
                    <div className="space-y-1.5 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono font-bold text-white text-sm">
                          {r.odometer.toLocaleString()} km
                        </span>
                        <span className="text-neutral-500">·</span>
                        <span className="font-mono text-neutral-400">{r.date}</span>
                        <span className="text-neutral-500">·</span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-neutral-900 border border-neutral-700 text-neutral-300">
                          {r.category}
                        </span>
                        {r.isCasaVerified && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                            CASA STAMP ✓
                          </span>
                        )}
                      </div>

                      <div className="font-bold text-white text-sm">
                        {r.title}
                      </div>

                      <div className="text-neutral-400">
                        Service Center: <strong className="text-neutral-200">{r.shopName || 'Workshop'}</strong>
                        {r.oilBrandGrade && (
                          <span> · Oil: <span className="font-mono text-amber-400">{r.oilBrandGrade}</span></span>
                        )}
                        {r.receiptNumber && (
                          <span> · OR/Invoice: <span className="font-mono text-neutral-300">{r.receiptNumber}</span></span>
                        )}
                      </div>

                      {r.notes && (
                        <p className="text-[11px] text-neutral-400 italic">
                          &ldquo;{r.notes}&rdquo;
                        </p>
                      )}
                    </div>

                    <div className="text-left md:text-right shrink-0">
                      <div className="text-sm font-bold font-mono text-white">
                        ₱{r.totalCostPhp.toLocaleString()}
                      </div>
                      <div className="text-[10px] text-neutral-500">
                        Labor: ₱{r.laborCostPhp}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-8 text-center text-xs text-neutral-500 border border-dashed border-neutral-800 rounded-xl">
                No service records entered yet. Log your first PMS service to generate passport stamps.
              </div>
            )}
          </div>

          <div className="p-3 rounded-xl bg-neutral-900/50 border border-neutral-800 text-[10px] text-neutral-400 flex items-center justify-between">
            <span>Verified by MotoCare PH Digital Garage Engine · Document Hash: #{bike.id.slice(-6).toUpperCase()}</span>
            <span>Accredited Philippine Maintenance Log</span>
          </div>
        </div>
      </div>
    </div>
  );
};
