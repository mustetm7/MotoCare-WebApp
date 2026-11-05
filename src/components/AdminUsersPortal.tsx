import React, { useState } from 'react';
import { UserAccount, AccountPaymentStatus } from '../types';
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
  TrendingUp,
  CreditCard,
  UserPlus,
  Users,
  ExternalLink,
  Bike,
  Mail,
  Phone,
  Calendar,
  X,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { sounds } from '../utils/audio';
import confetti from 'canvas-confetti';

interface AdminUsersPortalProps {
  users: UserAccount[];
  onApprovePro: (userId: string) => void;
  onRevokePro: (userId: string) => void;
  onAddUser: (user: Omit<UserAccount, 'id' | 'registeredAt'>) => void;
  onResetUsersToDefault: () => void;
  onReturnToApp: () => void;
}

export const AdminUsersPortal: React.FC<AdminUsersPortalProps> = ({
  users,
  onApprovePro,
  onRevokePro,
  onAddUser,
  onResetUsersToDefault,
  onReturnToApp,
}) => {
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedRefId, setCopiedRefId] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [isAddUserModalOpen, setIsAddUserModalOpen] = useState(false);

  // Form state for adding user
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newBikeModel, setNewBikeModel] = useState('');
  const [newBikePlate, setNewBikePlate] = useState('');
  const [newPaymentMethod, setNewPaymentMethod] = useState<'gcash' | 'gotyme'>('gcash');
  const [newRefNumber, setNewRefNumber] = useState('');
  const [newInitialStatus, setNewInitialStatus] = useState<AccountPaymentStatus>('pending_approval');
  const [newNotes, setNewNotes] = useState('');

  // Computations
  const pendingUsers = users.filter((u) => u.paymentStatus === 'pending_approval');
  const proUsers = users.filter((u) => u.subscriptionTier === 'pro');
  const freeUsers = users.filter((u) => u.subscriptionTier === 'free');
  const totalRevenue = users
    .filter((u) => u.subscriptionTier === 'pro')
    .reduce((sum, u) => sum + (u.amountPhp || 49), 0);

  const filteredUsers = users.filter((u) => {
    if (filterStatus === 'pending' && u.paymentStatus !== 'pending_approval') return false;
    if (filterStatus === 'pro' && u.subscriptionTier !== 'pro') return false;
    if (filterStatus === 'free' && u.subscriptionTier !== 'free') return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = u.name.toLowerCase().includes(q);
      const matchEmail = u.email.toLowerCase().includes(q);
      const matchRef = (u.referenceNumber || '').toLowerCase().includes(q);
      const matchBike = (u.bikeModel || '').toLowerCase().includes(q) || (u.bikeNickname || '').toLowerCase().includes(q);
      const matchPhone = (u.phone || '').toLowerCase().includes(q);
      return matchName || matchEmail || matchRef || matchBike || matchPhone;
    }
    return true;
  });

  const getDirectAdminUrl = () => {
    if (typeof window === 'undefined') return 'https://motocare.ph/#admin';
    return `${window.location.origin}${window.location.pathname}#admin`;
  };

  const handleCopyDirectLink = () => {
    const url = getDirectAdminUrl();
    navigator.clipboard?.writeText(url);
    sounds.playClick();
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  };

  const handleCopyRef = (ref: string, id: string) => {
    navigator.clipboard?.writeText(ref);
    setCopiedRefId(id);
    sounds.playClick();
    setTimeout(() => setCopiedRefId(null), 2000);
  };

  const handleApprove = (userId: string) => {
    sounds.playSuccess();
    try {
      confetti({
        particleCount: 80,
        spread: 75,
        origin: { y: 0.6 },
        colors: ['#FF6B00', '#10B981', '#00C5FF', '#FBBF24'],
      });
    } catch {
      // ignore
    }
    onApprovePro(userId);
  };

  const handleCreateUserSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newEmail.trim()) return;

    onAddUser({
      name: newName.trim(),
      email: newEmail.trim(),
      phone: newPhone.trim() || undefined,
      bikeModel: newBikeModel.trim() || 'Motorcycle',
      bikePlate: newBikePlate.trim() || undefined,
      subscriptionTier: newInitialStatus === 'active_pro' ? 'pro' : 'free',
      paymentStatus: newInitialStatus,
      paymentMethod: newPaymentMethod,
      referenceNumber: newRefNumber.trim() || undefined,
      amountPhp: 49,
      lastPaymentDate: newRefNumber.trim() ? new Date().toISOString() : undefined,
      notes: newNotes.trim() || undefined,
    });

    sounds.playSuccess();
    setIsAddUserModalOpen(false);

    // Reset form
    setNewName('');
    setNewEmail('');
    setNewPhone('');
    setNewBikeModel('');
    setNewBikePlate('');
    setNewRefNumber('');
    setNewNotes('');
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-[#FF6B00] selection:text-white">
      {/* Top Admin Navigation Header */}
      <header className="sticky top-0 z-40 bg-slate-900/95 backdrop-blur-md border-b border-slate-800 shadow-xl">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between gap-3">
          {/* Logo & Portal Identity */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onReturnToApp}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
              title="Return to MotoCare Rider App"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-500 to-[#FF6B00] text-slate-950 flex items-center justify-center font-black shadow-md shadow-orange-500/20">
                <ShieldCheck className="w-5 h-5 text-slate-950" />
              </div>
              <div>
                <div className="flex items-center gap-1.5 leading-none">
                  <span className="text-base sm:text-lg font-black tracking-tight text-white">
                    Moto<span className="text-[#FF6B00]">Care</span>
                  </span>
                  <span className="px-2 py-0.5 rounded-md bg-amber-400 text-slate-950 font-black text-[10px] uppercase tracking-wider">
                    Admin Portal
                  </span>
                </div>
                <p className="text-[10px] text-slate-400 font-medium mt-0.5 hidden xs:block">
                  User Management & PRO Access Gate
                </p>
              </div>
            </div>
          </div>

          {/* Right Header Quick Controls */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopyDirectLink}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm active:scale-95"
              title="Copy the direct standalone link to this admin portal"
            >
              {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <ExternalLink className="w-3.5 h-3.5 text-amber-400" />}
              <span className="hidden sm:inline">{copiedLink ? 'Link Copied!' : 'Copy Admin Direct Link'}</span>
              <span className="sm:hidden">{copiedLink ? 'Copied' : 'Direct Link'}</span>
            </button>

            <button
              type="button"
              onClick={onReturnToApp}
              className="px-3 py-1.5 rounded-xl bg-[#FF6B00] hover:bg-[#EA580C] text-white text-xs font-bold transition-all shadow-md shadow-orange-500/20 flex items-center gap-1 active:scale-95"
            >
              <span>Back to App</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Admin Content */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Direct Link Banner */}
        <div className="p-4 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 border border-slate-800 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-md">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-black uppercase text-amber-400 flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5" />
                <span>Dedicated Admin Link</span>
              </span>
              <span className="text-[10px] px-2 py-0.2 rounded-full bg-slate-800 border border-slate-700 text-slate-300 font-mono">
                #admin
              </span>
            </div>
            <p className="text-xs text-slate-300">
              Bookmark or open this direct URL anytime to view users, verify reference codes, and approve Pro access without navigating through the rider app.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl font-mono text-[11px] text-slate-400 max-w-[200px] sm:max-w-[260px] truncate select-all">
              {getDirectAdminUrl()}
            </div>
            <button
              type="button"
              onClick={handleCopyDirectLink}
              className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-extrabold text-xs rounded-xl shadow-sm transition-all active:scale-95 shrink-0 flex items-center gap-1"
            >
              {copiedLink ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedLink ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
        </div>

        {/* Top Metrics Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 shadow-sm space-y-1">
            <div className="flex items-center justify-between text-[11px] font-bold text-slate-400 uppercase">
              <span>Total Riders</span>
              <Users className="w-4 h-4 text-blue-400" />
            </div>
            <div className="text-2xl font-black font-mono text-white">
              {users.length}
            </div>
            <div className="text-[10px] text-slate-400">Registered accounts</div>
          </div>

          <div className="p-4 rounded-2xl bg-slate-900 border border-amber-500/40 shadow-sm space-y-1 relative overflow-hidden">
            <div className="flex items-center justify-between text-[11px] font-bold text-amber-300 uppercase">
              <span>Pending Approval</span>
              <Clock className="w-4 h-4 text-amber-400" />
            </div>
            <div className="text-2xl font-black font-mono text-amber-400">
              {pendingUsers.length}
            </div>
            <div className="text-[10px] text-amber-300/90 font-bold flex items-center gap-1">
              {pendingUsers.length > 0 && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />}
              <span>{pendingUsers.length > 0 ? 'Requires your manual approval' : 'Queue all clear'}</span>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 shadow-sm space-y-1">
            <div className="flex items-center justify-between text-[11px] font-bold text-slate-400 uppercase">
              <span>Active PRO Members</span>
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-2xl font-black font-mono text-emerald-400">
              {proUsers.length}
            </div>
            <div className="text-[10px] text-slate-400">VIP Unlimited Garage</div>
          </div>

          <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 shadow-sm space-y-1">
            <div className="flex items-center justify-between text-[11px] font-bold text-slate-400 uppercase">
              <span>Verified Revenue</span>
              <TrendingUp className="w-4 h-4 text-orange-400" />
            </div>
            <div className="text-2xl font-black font-mono text-white">
              ₱{totalRevenue.toLocaleString()}.00
            </div>
            <div className="text-[10px] text-slate-400">₱49/mo rider subscriptions</div>
          </div>
        </div>

        {/* Controls Bar: Filters, Search, Add User */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-900 p-3.5 rounded-2xl border border-slate-800">
          {/* Status Tabs */}
          <div className="flex items-center gap-1 p-1 bg-slate-950 rounded-xl text-xs overflow-x-auto no-scrollbar">
            <button
              type="button"
              onClick={() => setFilterStatus('all')}
              className={`px-3 py-1.5 rounded-lg font-bold text-xs transition-colors whitespace-nowrap ${
                filterStatus === 'all'
                  ? 'bg-slate-800 text-white shadow-2xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All Users ({users.length})
            </button>

            <button
              type="button"
              onClick={() => setFilterStatus('pending')}
              className={`px-3 py-1.5 rounded-lg font-bold text-xs flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                filterStatus === 'pending'
                  ? 'bg-amber-500 text-slate-950 shadow-2xs font-black'
                  : 'text-amber-400 hover:text-amber-300'
              }`}
            >
              <span>Pending Review</span>
              {pendingUsers.length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-slate-950 text-amber-300 text-[10px] font-mono">
                  {pendingUsers.length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setFilterStatus('pro')}
              className={`px-3 py-1.5 rounded-lg font-bold text-xs transition-colors whitespace-nowrap ${
                filterStatus === 'pro'
                  ? 'bg-emerald-600 text-white shadow-2xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Active PRO ({proUsers.length})
            </button>

            <button
              type="button"
              onClick={() => setFilterStatus('free')}
              className={`px-3 py-1.5 rounded-lg font-bold text-xs transition-colors whitespace-nowrap ${
                filterStatus === 'free'
                  ? 'bg-slate-800 text-white shadow-2xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Free Tier ({freeUsers.length})
            </button>
          </div>

          {/* Search Bar & Add Button */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1 sm:w-60">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search name, email, ref #..."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-[#FF6B00]"
              />
            </div>

            <button
              type="button"
              onClick={() => setIsAddUserModalOpen(true)}
              className="px-3 py-1.5 bg-[#FF6B00] hover:bg-orange-600 text-white font-bold text-xs rounded-xl shadow-md transition-all active:scale-95 flex items-center gap-1.5 shrink-0"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>+ Add User</span>
            </button>
          </div>
        </div>

        {/* User Account Cards List */}
        <div className="space-y-3.5">
          {filteredUsers.length > 0 ? (
            filteredUsers.map((user) => {
              const isPending = user.paymentStatus === 'pending_approval';
              const isPro = user.subscriptionTier === 'pro';

              return (
                <div
                  key={user.id}
                  className={`p-4 sm:p-5 rounded-2xl border transition-all space-y-4 ${
                    isPending
                      ? 'bg-slate-900/90 border-amber-500/50 shadow-md shadow-amber-500/5'
                      : isPro
                      ? 'bg-slate-900/60 border-slate-800'
                      : 'bg-slate-900/30 border-slate-800/80'
                  }`}
                >
                  {/* Card Header: User Identity & Status Tag */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-slate-800 to-slate-700 border border-slate-700 text-amber-300 font-black text-sm flex items-center justify-center shrink-0">
                        {user.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-extrabold text-sm sm:text-base text-white">
                            {user.name}
                          </h3>
                          {isPro ? (
                            <span className="px-2 py-0.5 rounded-md bg-amber-400 text-slate-950 text-[10px] font-black uppercase tracking-wider flex items-center gap-1">
                              <span>★ PRO</span>
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-md bg-slate-800 text-slate-400 text-[10px] font-bold uppercase tracking-wider">
                              FREE
                            </span>
                          )}
                        </div>

                        <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400 mt-0.5">
                          <span className="flex items-center gap-1 text-slate-300">
                            <Mail className="w-3 h-3 text-slate-500" />
                            <span>{user.email}</span>
                          </span>
                          {user.phone && (
                            <span className="flex items-center gap-1">
                              <Phone className="w-3 h-3 text-slate-500" />
                              <span>{user.phone}</span>
                            </span>
                          )}
                          <span className="flex items-center gap-1 text-slate-500 font-mono text-[11px]">
                            <Calendar className="w-3 h-3" />
                            <span>Joined {user.registeredAt}</span>
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Status Pill */}
                    <div className="flex items-center gap-2 self-start sm:self-center">
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider flex items-center gap-1.5 ${
                          isPending
                            ? 'bg-amber-400 text-slate-950 animate-pulse'
                            : isPro
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : 'bg-slate-800 text-slate-400 border border-slate-700'
                        }`}
                      >
                        {isPending && <Clock className="w-3.5 h-3.5 text-slate-950" />}
                        {isPro && <CheckCircle2 className="w-3.5 h-3.5" />}
                        <span>{user.paymentStatus.replace('_', ' ')}</span>
                      </span>
                    </div>
                  </div>

                  {/* Details Grid: Motorcycle & Payment Info */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    {/* Motorcycle Info */}
                    <div className="p-3 bg-slate-950 rounded-xl border border-slate-800/80 space-y-1.5">
                      <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                        <Bike className="w-3 h-3 text-orange-400" />
                        <span>Motorcycle Information</span>
                      </div>
                      <div className="font-bold text-slate-200 text-sm">
                        {user.bikeNickname ? `"${user.bikeNickname}" — ` : ''}
                        {user.bikeModel}
                      </div>
                      <div className="text-slate-400 text-[11px] flex items-center gap-2">
                        <span>Plate: <strong className="text-slate-300 font-mono">{user.bikePlate || 'Not registered'}</strong></span>
                      </div>
                    </div>

                    {/* Payment Info */}
                    <div className="p-3 bg-slate-950 rounded-xl border border-slate-800/80 space-y-1.5">
                      <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center justify-between">
                        <span className="flex items-center gap-1">
                          <CreditCard className="w-3 h-3 text-blue-400" />
                          <span>Payment Details</span>
                        </span>
                        {user.amountPhp && (
                          <span className="font-black font-mono text-amber-400">
                            ₱{user.amountPhp}.00
                          </span>
                        )}
                      </div>

                      {user.referenceNumber ? (
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5 font-mono font-bold text-slate-200">
                            <span className="text-[11px] text-slate-500 uppercase font-sans">
                              {user.paymentMethod || 'GCash'}:
                            </span>
                            <span>{user.referenceNumber}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleCopyRef(user.referenceNumber!, user.id)}
                            className="p-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
                            title="Copy reference number"
                          >
                            {copiedRefId === user.id ? (
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      ) : (
                        <div className="text-slate-500 text-[11px]">No payment reference submitted yet.</div>
                      )}

                      {user.approvedAt && (
                        <div className="text-[10px] text-emerald-400/90 font-medium">
                          Approved by {user.approvedBy || 'Admin'} on {new Date(user.approvedAt).toLocaleDateString()}
                        </div>
                      )}
                    </div>
                  </div>

                  {user.notes && (
                    <div className="p-2.5 bg-slate-950/60 rounded-xl border border-slate-800/50 text-[11px] text-slate-400">
                      <strong className="text-slate-300">Rider Note:</strong> {user.notes}
                    </div>
                  )}

                  {/* Admin Actions Bar */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <div className="flex items-center gap-2">
                      {/* Approve Button */}
                      {!isPro ? (
                        <button
                          type="button"
                          onClick={() => handleApprove(user.id)}
                          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs rounded-xl shadow-md transition-all active:scale-95 flex items-center gap-1.5"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          <span>Approve PRO Access</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            sounds.playClick();
                            onRevokePro(user.id);
                          }}
                          className="px-3.5 py-1.5 bg-slate-800 hover:bg-red-950 text-slate-300 hover:text-red-400 border border-slate-700 hover:border-red-800 font-bold text-xs rounded-xl transition-all"
                        >
                          Revoke PRO (Set to Free)
                        </button>
                      )}
                    </div>

                    <div className="text-[11px] text-slate-500 font-mono">
                      User ID: {user.id}
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="p-12 text-center bg-slate-900 rounded-3xl border border-slate-800 space-y-3">
              <Users className="w-10 h-10 text-slate-600 mx-auto" />
              <h4 className="text-sm font-bold text-slate-300">No Users Match Your Filter</h4>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Try adjusting your search query or status tab, or manually add a new rider account.
              </p>
              <button
                type="button"
                onClick={() => {
                  setFilterStatus('all');
                  setSearchQuery('');
                }}
                className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl"
              >
                Reset Filters
              </button>
            </div>
          )}
        </div>

        {/* Footer Reset & Help */}
        <div className="pt-6 border-t border-slate-900 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
            <span>MotoCare PH Admin Portal · Standalone Admin Link Active</span>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                sounds.playClick();
                onResetUsersToDefault();
              }}
              className="text-slate-400 hover:text-red-400 transition-colors flex items-center gap-1 text-[11px]"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Reset Sample Users</span>
            </button>
            <span>•</span>
            <button
              type="button"
              onClick={onReturnToApp}
              className="text-amber-400 hover:underline font-bold"
            >
              ← Back to Rider App
            </button>
          </div>
        </div>
      </main>

      {/* Modal: Add New Rider User Manually */}
      {isAddUserModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-amber-400" />
                <h3 className="font-extrabold text-base text-white">Add Rider User Account</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsAddUserModalOpen(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateUserSubmit} className="space-y-3.5 text-xs">
              <div className="space-y-1">
                <label className="font-bold text-slate-300">Rider Full Name *</label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Richard Gomez"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white placeholder:text-slate-600 focus:outline-none focus:border-[#FF6B00]"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-300">Email Address *</label>
                <input
                  type="email"
                  required
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="rider@example.ph"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white placeholder:text-slate-600 focus:outline-none focus:border-[#FF6B00]"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div className="space-y-1">
                  <label className="font-bold text-slate-300">Mobile Phone</label>
                  <input
                    type="text"
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    placeholder="+63 917..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white placeholder:text-slate-600 focus:outline-none focus:border-[#FF6B00]"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-bold text-slate-300">Plate Number</label>
                  <input
                    type="text"
                    value={newBikePlate}
                    onChange={(e) => setNewBikePlate(e.target.value)}
                    placeholder="e.g. 123 ABC"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white uppercase font-mono placeholder:text-slate-600 focus:outline-none focus:border-[#FF6B00]"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-300">Motorcycle Model</label>
                <input
                  type="text"
                  value={newBikeModel}
                  onChange={(e) => setNewBikeModel(e.target.value)}
                  placeholder="e.g. 2026 Yamaha NMAX 155"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white placeholder:text-slate-600 focus:outline-none focus:border-[#FF6B00]"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div className="space-y-1">
                  <label className="font-bold text-slate-300">Payment Channel</label>
                  <select
                    value={newPaymentMethod}
                    onChange={(e) => setNewPaymentMethod(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-[#FF6B00]"
                  >
                    <option value="gcash">GCash QRPH</option>
                    <option value="gotyme">GoTyme Bank</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-300">Payment Status</label>
                  <select
                    value={newInitialStatus}
                    onChange={(e) => setNewInitialStatus(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-[#FF6B00]"
                  >
                    <option value="pending_approval">Pending Approval</option>
                    <option value="active_pro">Active PRO</option>
                    <option value="unpaid_free">Free Tier</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-300">Payment Reference Number (Optional)</label>
                <input
                  type="text"
                  value={newRefNumber}
                  onChange={(e) => setNewRefNumber(e.target.value)}
                  placeholder="e.g. GCASH-192834"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono placeholder:text-slate-600 focus:outline-none focus:border-[#FF6B00]"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-300">Admin Notes (Optional)</label>
                <textarea
                  rows={2}
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  placeholder="Verification details..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white placeholder:text-slate-600 focus:outline-none focus:border-[#FF6B00]"
                />
              </div>

              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddUserModalOpen(false)}
                  className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-[#FF6B00] hover:bg-orange-600 text-white font-extrabold rounded-xl shadow-md"
                >
                  Create User
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
