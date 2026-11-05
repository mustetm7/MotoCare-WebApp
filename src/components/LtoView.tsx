import React from 'react';
import { Motorcycle } from '../types';
import { calculateLtoRenewal } from '../utils/ltoCalculator';
import { AlertTriangle, Calendar, FileText, CheckCircle, Clock, Info, ArrowLeft } from 'lucide-react';
import { sounds } from '../utils/audio';

interface LtoViewProps {
  bike: Motorcycle;
  onUpdatePlate: (newPlate: string) => void;
  onBack: () => void;
}

export const LtoView: React.FC<LtoViewProps> = ({
  bike,
  onUpdatePlate,
  onBack,
}) => {
  const [plateInput, setPlateInput] = React.useState(bike.licensePlate || 'ND 8492');
  const renewalInfo = calculateLtoRenewal(bike.licensePlate || 'ND 8492');

  const handlePlateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (plateInput.trim()) {
      onUpdatePlate(plateInput.trim());
    }
  };

  const isOverdue = renewalInfo.status === 'overdue';
  const isDueThisMonth = renewalInfo.status === 'due-this-month';

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

        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider font-mono">
          LTO Tracker
        </span>
      </div>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
            <span>Philippine LTO Registration</span>
            <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-lg bg-blue-50 text-blue-600 border border-blue-200">
              RA 4136
            </span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Annual registration renewal for <strong className="text-slate-800">{bike.year} {bike.brand} {bike.model}</strong>
          </p>
        </div>

        {/* Plate editor */}
        <form onSubmit={handlePlateSubmit} className="flex items-center gap-1.5">
          <input
            type="text"
            placeholder="e.g. ND 8492"
            value={plateInput}
            onChange={(e) => setPlateInput(e.target.value.toUpperCase())}
            className="w-32 bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-mono font-bold text-slate-900 uppercase text-center focus:outline-none focus:border-[#FF6B00]"
          />
          <button
            type="submit"
            className="px-3 py-1.5 text-xs font-bold bg-[#FF6B00] text-white rounded-xl shadow-2xs hover:bg-[#EA580C]"
          >
            Update
          </button>
        </form>
      </div>

      {/* Plate Card */}
      <div className="p-5 rounded-3xl bg-white border border-slate-100 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row items-center gap-5">
          {/* Virtual Plate */}
          <div className="w-full sm:w-56 p-3.5 rounded-2xl bg-white text-slate-900 border-2 border-slate-900 shadow-md text-center select-none shrink-0">
            <div className="text-[9px] uppercase font-bold tracking-widest text-slate-400 border-b border-slate-100 pb-1">
              PILIPINAS · REGION NCR
            </div>
            <div className="text-2xl font-black font-mono tracking-wider py-1.5 text-slate-900">
              {bike.licensePlate || 'ND 8492'}
            </div>
            <div className="flex items-center justify-between text-[8px] font-bold text-slate-400 pt-1 border-t border-slate-100">
              <span>MC REGISTERED</span>
              <span className="text-[#FF6B00] font-mono">LTO PH</span>
            </div>
          </div>

          {/* Details */}
          <div className="flex-1 space-y-2.5 w-full">
            <div className="flex items-center gap-2">
              <span
                className={`text-xs font-bold uppercase px-2.5 py-1 rounded-xl flex items-center gap-1.5 ${
                  isOverdue
                    ? 'bg-red-50 text-red-700 border border-red-200'
                    : isDueThisMonth
                    ? 'bg-amber-50 text-amber-800 border border-amber-200'
                    : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                }`}
              >
                {isOverdue && <AlertTriangle className="w-3.5 h-3.5" />}
                {isDueThisMonth && <Clock className="w-3.5 h-3.5" />}
                {!isOverdue && !isDueThisMonth && <CheckCircle className="w-3.5 h-3.5" />}
                {isOverdue
                  ? 'Registration Overdue'
                  : isDueThisMonth
                  ? 'Renewal Due This Month'
                  : 'LTO Registration Up to Date'}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="p-2.5 rounded-2xl bg-slate-50 border border-slate-100">
                <div className="text-[10px] text-slate-400 uppercase font-bold">Month (Last: {renewalInfo.lastDigit})</div>
                <div className="font-extrabold text-slate-800 mt-0.5">{renewalInfo.renewalMonthName}</div>
              </div>

              <div className="p-2.5 rounded-2xl bg-slate-50 border border-slate-100">
                <div className="text-[10px] text-slate-400 uppercase font-bold">Week (Mid: {renewalInfo.middleDigit})</div>
                <div className="font-bold text-slate-800 text-[11px] mt-0.5">{renewalInfo.renewalWeekRange}</div>
              </div>

              <div className="p-2.5 rounded-2xl bg-slate-50 border border-slate-100">
                <div className="text-[10px] text-slate-400 uppercase font-bold">Countdown</div>
                <div className="font-extrabold font-mono text-[#FF6B00] mt-0.5">{renewalInfo.daysRemaining} days</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* LTO Checklist */}
      <div className="p-5 rounded-3xl bg-white border border-slate-100 shadow-sm space-y-3">
        <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
          <FileText className="w-4 h-4 text-[#FF6B00]" />
          Motorcycle LTO Renewal Requirements
        </h3>

        <div className="space-y-2 text-xs text-slate-600">
          <div className="p-3 rounded-2xl bg-slate-50 border border-slate-100 flex items-start gap-2.5">
            <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
            <div>
              <strong className="text-slate-800">Compulsory Third Party Liability (CTPL)</strong>
              <p className="text-[11px] text-slate-400">1-year insurance policy for motorcycles (approx. ₱350 - ₱450).</p>
            </div>
          </div>

          <div className="p-3 rounded-2xl bg-slate-50 border border-slate-100 flex items-start gap-2.5">
            <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
            <div>
              <strong className="text-slate-800">Emission & Inspection (PMVIC / PETC)</strong>
              <p className="text-[11px] text-slate-400">Passed smoke emission testing certificate.</p>
            </div>
          </div>

          <div className="p-3 rounded-2xl bg-slate-50 border border-slate-100 flex items-start gap-2.5">
            <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
            <div>
              <strong className="text-slate-800">Original Certificate of Registration & OR</strong>
              <p className="text-[11px] text-slate-400">Current LTO Certificate of Registration (CR) and latest Official Receipt (OR).</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
