import React, { useState } from 'react';
import { PaymentSubmission, Motorcycle, UserSubscription } from '../types';
import {
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Clock,
  Search,
  Copy,
  Check,
  ArrowLeft,
  Sparkles,
  Zap,
  TrendingUp,
  CreditCard,
  PlusCircle,
  Sliders,
  AlertCircle,
} from 'lucide-react';
import { sounds } from '../utils/audio';
import confetti from 'canvas-confetti';
import { AutoKmConfig } from '../utils/storage';

interface AdminDashboardProps {
  submissions: PaymentSubmission[];
  activeBike: Motorcycle;
  subscription: UserSubscription;
  autoKmConfig: AutoKmConfig;
  onApprovePayment: (submissionId: string) => void;
  onRejectPayment: (submissionId: string, reason?: string) => void;
  onCreateMockPayment: () => void;
  onUpdateAutoKmConfig: (config: AutoKmConfig) => void;
  onTriggerAutoKmNow: () => void;
  onBack: () => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  submissions,
  activeBike,
  subscription,
  autoKmConfig,
  onApprovePayment,
  onRejectPayment,
  onCreateMockPayment,
  onUpdateAutoKmConfig,
  onTriggerAutoKmNow,
  onBack,
}) => {
  const [activeTab, setActiveTab] = useState<'pending' | 'approved' | 'all' | 'settings'>('pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedRefId, setCopiedRefId] = useState<string | null>(null);

  const pendingSubmissions = submissions.filter((s) => s.status === 'pending');
  const approvedSubmissions = submissions.filter((s) => s.status === 'approved');
  const totalVerifiedRevenue = approvedSubmissions.reduce((sum, s) => sum + s.amountPhp, 0);

  const filteredSubmissions = submissions.filter((s) => {
    if (activeTab === 'pending' && s.status !== 'pending') return false;
    if (activeTab === 'approved' && s.status !== 'approved') return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchRef = s.referenceNumber.toLowerCase().includes(q);
      const matchName = (s.userName || '').toLowerCase().includes(q);
      const matchBike = (s.bikeNickname || '').toLowerCase().includes(q) || (s.bikeModel || '').toLowerCase().includes(q);
      return matchRef || matchName || matchBike;
    }
    return true;
  });

  const handleCopy = (ref: string, id: string) => {
    navigator.clipboard?.writeText(ref);
    setCopiedRefId(id);
    sounds.playClick();
    setTimeout(() => setCopiedRefId(null), 2000);
  };

  const handleApprove = (id: string) => {
    sounds.playSuccess();
    try {
      confetti({
        particleCount: 75,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#F95A00', '#10B981', '#00C5FF'],
      });
    } catch {
      // ignore
    }
    onApprovePayment(id);
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-150">
      {/* Top Header */}
      <div className="flex items-center justify-between pb-2 border-b border-slate-200">
        <button
          type="button"
          onClick={() => {
            sounds.playClick();
            onBack();
          }}
          className="flex items-center gap-1.5 text-xs font-bold text-slate-700 hover:text-[#F95A00] transition-colors py-1.5 px-3 rounded-xl bg-white border border-slate-200 hover:border-[#F95A00] shadow-2xs group"
        >
          <ArrowLeft className="w-4 h-4 text-[#F95A00] group-hover:-translate-x-0.5 transition-transform" />
          <span>Back to Garage</span>
        </button>

        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900 text-amber-300 font-mono text-[10px] font-extrabold shadow-sm">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span>ADMIN PORTAL</span>
        </div>
      </div>

      {/* Hero Title & Info */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-gradient-to-r from-slate-900 to-slate-800 text-white p-5 rounded-3xl shadow-lg border border-slate-800">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-extrabold tracking-tight">Payment Verification & Approvals</h2>
            <span className="px-2 py-0.5 rounded-full bg-amber-400 text-slate-900 text-[10px] font-black uppercase">
              Pro Access Gate
            </span>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            Verify rider GCash & GoTyme QRPH payments, confirm reference numbers, and approve instant VIP Pro access.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            sounds.playSuccess();
            onCreateMockPayment();
          }}
          className="self-start sm:self-auto px-3.5 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs flex items-center gap-1.5 shadow-md transition-all active:scale-95 shrink-0"
        >
          <PlusCircle className="w-4 h-4" />
          <span>+ Mock Rider Payment</span>
        </button>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="p-3.5 rounded-2xl bg-white border border-slate-200 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase">
            <span>Pending Review</span>
            <Clock className="w-3.5 h-3.5 text-amber-500" />
          </div>
          <div className="text-2xl font-black font-mono text-slate-900">
            {pendingSubmissions.length}
          </div>
          <div className="text-[10px] text-amber-600 font-semibold flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping" />
            <span>Requires confirmation</span>
          </div>
        </div>

        <div className="p-3.5 rounded-2xl bg-white border border-slate-200 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase">
            <span>Approved Pro</span>
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
          </div>
          <div className="text-2xl font-black font-mono text-emerald-600">
            {approvedSubmissions.length}
          </div>
          <div className="text-[10px] text-slate-400">Riders unlocked</div>
        </div>

        <div className="p-3.5 rounded-2xl bg-white border border-slate-200 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase">
            <span>Verified Revenue</span>
            <TrendingUp className="w-3.5 h-3.5 text-blue-500" />
          </div>
          <div className="text-2xl font-black font-mono text-slate-900">
            ₱{totalVerifiedRevenue.toLocaleString()}
          </div>
          <div className="text-[10px] text-slate-400">₱49/mo subscriptions</div>
        </div>

        <div className="p-3.5 rounded-2xl bg-white border border-slate-200 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase">
            <span>5-Min Auto-Km</span>
            <Zap className="w-3.5 h-3.5 text-amber-500" />
          </div>
          <div className="text-sm font-extrabold font-mono text-slate-900 flex items-center gap-1 pt-1">
            <span className={`w-2 h-2 rounded-full ${autoKmConfig.enabled ? 'bg-emerald-500' : 'bg-slate-300'}`} />
            <span>+{autoKmConfig.incrementKm} km / 5m</span>
          </div>
          <button
            type="button"
            onClick={() => {
              sounds.playClick();
              onTriggerAutoKmNow();
            }}
            className="text-[10px] font-bold text-[#F95A00] hover:underline block"
          >
            ⚡ Test Auto-Add Now →
          </button>
        </div>
      </div>

      {/* Tabs and Search */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 pt-1">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-2xl text-xs overflow-x-auto no-scrollbar">
          <button
            type="button"
            onClick={() => setActiveTab('pending')}
            className={`px-3 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-colors whitespace-nowrap ${
              activeTab === 'pending'
                ? 'bg-white text-slate-900 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span>Pending Review</span>
            {pendingSubmissions.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-amber-500 text-white text-[10px] font-extrabold animate-pulse">
                {pendingSubmissions.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('approved')}
            className={`px-3 py-1.5 rounded-xl font-bold text-xs transition-colors whitespace-nowrap ${
              activeTab === 'approved'
                ? 'bg-white text-slate-900 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Approved ({approvedSubmissions.length})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('all')}
            className={`px-3 py-1.5 rounded-xl font-bold text-xs transition-colors whitespace-nowrap ${
              activeTab === 'all'
                ? 'bg-white text-slate-900 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            All Submissions ({submissions.length})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('settings')}
            className={`px-3 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1 transition-colors whitespace-nowrap ${
              activeTab === 'settings'
                ? 'bg-white text-slate-900 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Auto-Km Rules</span>
          </button>
        </div>

        {activeTab !== 'settings' && (
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter by Ref # or rider..."
              className="w-full sm:w-56 bg-white border border-slate-200 rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-[#F95A00]"
            />
          </div>
        )}
      </div>

      {/* Tab: Settings for 5-min Auto-Km Rule */}
      {activeTab === 'settings' ? (
        <div className="p-5 bg-white rounded-3xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-amber-500" />
            <div>
              <h3 className="text-base font-extrabold text-slate-900">
                Automatic 5-Minute Inactivity Odometer Engine
              </h3>
              <p className="text-xs text-slate-500">
                Automatically increments the rider&apos;s odometer when no action is performed within 5 minutes.
              </p>
            </div>
          </div>

          <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-bold text-slate-800 block text-xs">Engine Status:</span>
                <span className="text-[11px] text-slate-500">
                  {autoKmConfig.enabled
                    ? 'Active — auto-adds distance after 5 minutes of idle riding'
                    : 'Disabled — manual updates only'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  sounds.playClick();
                  onUpdateAutoKmConfig({
                    ...autoKmConfig,
                    enabled: !autoKmConfig.enabled,
                  });
                }}
                className={`px-3.5 py-1.5 rounded-xl font-bold text-xs transition-colors ${
                  autoKmConfig.enabled
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                }`}
              >
                {autoKmConfig.enabled ? 'ENABLED' : 'PAUSED'}
              </button>
            </div>

            <div className="pt-2 border-t border-slate-200 flex items-center justify-between">
              <div>
                <span className="font-bold text-slate-800 block text-xs">Distance Added per 5 Minutes:</span>
                <span className="text-[11px] text-slate-500">Standard Philippine city commute speed</span>
              </div>
              <div className="flex items-center gap-1.5">
                {[1, 2, 5, 10].map((km) => (
                  <button
                    key={km}
                    type="button"
                    onClick={() => {
                      sounds.playClick();
                      onUpdateAutoKmConfig({
                        ...autoKmConfig,
                        incrementKm: km,
                      });
                    }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                      autoKmConfig.incrementKm === km
                        ? 'bg-[#F95A00] text-white shadow-sm'
                        : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    +{km} km
                  </button>
                ))}
              </div>
            </div>

            <div className="pt-2 border-t border-slate-200 flex items-center justify-between">
              <div>
                <span className="font-bold text-slate-800 block text-xs">Test Auto-Commute Now:</span>
                <span className="text-[11px] text-slate-500">
                  Fires the 5-minute trigger, adds +{autoKmConfig.incrementKm} km, vibrates phone, and posts notification
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  sounds.playClick();
                  onTriggerAutoKmNow();
                }}
                className="px-3.5 py-2 rounded-xl bg-[#F95A00] hover:bg-[#EA580C] text-white font-bold text-xs shadow-md shadow-orange-500/20 active:scale-95 transition-all"
              >
                ⚡ Trigger 5-Min Commute Now
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* Submissions List */
        <div className="space-y-3">
          {filteredSubmissions.length > 0 ? (
            filteredSubmissions.map((sub) => {
              const isPending = sub.status === 'pending';
              const isApproved = sub.status === 'approved';

              return (
                <div
                  key={sub.id}
                  className={`p-4 sm:p-5 rounded-3xl border transition-all space-y-3 ${
                    isPending
                      ? 'bg-amber-50/40 border-amber-200 shadow-sm'
                      : isApproved
                      ? 'bg-white border-slate-200 shadow-2xs'
                      : 'bg-slate-50 border-slate-200 opacity-75'
                  }`}
                >
                  {/* Top Row: Provider, Status & Amount */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-7 h-7 rounded-xl text-white font-extrabold text-xs flex items-center justify-center shadow-2xs"
                        style={{
                          backgroundColor: sub.paymentMethod === 'gcash' ? '#007DFE' : '#00BFA5',
                        }}
                      >
                        {sub.paymentMethod === 'gcash' ? 'G' : 'Go'}
                      </div>
                      <div>
                        <div className="font-extrabold text-xs text-slate-900 uppercase">
                          {sub.paymentMethod} QRPH
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono">{sub.submittedAt}</div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-sm font-black font-mono text-slate-900">
                        ₱{sub.amountPhp}.00
                      </span>
                      <span
                        className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${
                          isPending
                            ? 'bg-amber-100 text-amber-800 border border-amber-300 animate-pulse'
                            : isApproved
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                            : 'bg-red-100 text-red-800 border border-red-300'
                        }`}
                      >
                        {sub.status}
                      </span>
                    </div>
                  </div>

                  {/* Details Card */}
                  <div className="p-3 bg-white/80 rounded-2xl border border-slate-200/80 text-xs space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 text-[11px]">Payment Reference Code:</span>
                      <div className="flex items-center gap-1.5 font-mono font-bold text-slate-900">
                        <span>{sub.referenceNumber}</span>
                        <button
                          type="button"
                          onClick={() => handleCopy(sub.referenceNumber, sub.id)}
                          className="p-1 text-slate-400 hover:text-slate-800 rounded"
                          title="Copy reference number"
                        >
                          {copiedRefId === sub.id ? (
                            <Check className="w-3.5 h-3.5 text-emerald-600" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 text-[11px]">Rider / Account:</span>
                      <span className="font-bold text-slate-800">
                        {sub.userName || 'MotoCare Rider'} ({sub.userEmail || 'subscriber@motocare.ph'})
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 text-[11px]">Motorcycle:</span>
                      <span className="font-bold text-[#F95A00]">
                        {sub.bikeNickname ? `"${sub.bikeNickname}"` : ''} {sub.bikeModel || 'Philippine Motorcycle'}
                      </span>
                    </div>

                    {sub.notes && (
                      <div className="pt-1 border-t border-slate-100 text-[11px] text-slate-500">
                        Note: {sub.notes}
                      </div>
                    )}
                  </div>

                  {/* Action Buttons */}
                  {isPending && (
                    <div className="flex gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => handleApprove(sub.id)}
                        className="flex-1 py-2.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs rounded-xl shadow-md transition-all active:scale-95 flex items-center justify-center gap-1.5"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>Confirm Payment & Approve Pro</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          sounds.playClick();
                          onRejectPayment(sub.id, 'Invalid reference number');
                        }}
                        className="py-2.5 px-3 bg-white hover:bg-red-50 text-red-600 border border-red-200 font-bold text-xs rounded-xl transition-all"
                      >
                        <XCircle className="w-4 h-4" />
                      </button>
                    </div>
                  )}

                  {isApproved && (
                    <div className="flex items-center justify-between text-[11px] text-emerald-700 font-semibold px-2">
                      <span className="flex items-center gap-1">
                        <Check className="w-3.5 h-3.5" />
                        <span>Approved by Admin</span>
                      </span>
                      <span className="text-slate-400 font-mono text-[10px]">
                        {sub.approvedAt ? new Date(sub.approvedAt).toLocaleTimeString() : ''}
                      </span>
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <div className="p-10 text-center bg-white rounded-3xl border border-slate-200 space-y-2">
              <CreditCard className="w-8 h-8 text-slate-300 mx-auto" />
              <h4 className="text-sm font-bold text-slate-800">No Submissions Found</h4>
              <p className="text-xs text-slate-400">
                {activeTab === 'pending'
                  ? 'There are no pending payments awaiting verification.'
                  : 'No payment submissions matched your filter.'}
              </p>
              <button
                type="button"
                onClick={() => {
                  sounds.playSuccess();
                  onCreateMockPayment();
                }}
                className="mt-2 px-4 py-2 bg-[#F95A00] text-white text-xs font-bold rounded-xl shadow-sm hover:bg-orange-600"
              >
                + Generate Test Payment
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
