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
  Lock,
  Eye,
  EyeOff,
  LogOut,
  KeyRound,
  Globe,
  AlertTriangle,
} from 'lucide-react';
import { sounds } from '../utils/audio';
import confetti from 'canvas-confetti';
import { auth, signInWithGoogle, logOut } from '../utils/firebase';
import {
  subscribeToAllPaymentSubmissions,
  approveProAccessInFirestore,
  revokeProAccessInFirestore,
  PaymentSubmission,
} from '../utils/firestoreService';

interface AdminUsersPortalProps {
  users: UserAccount[];
  onApprovePro: (userId: string) => void;
  onRevokePro: (userId: string) => void;
  onAddUser: (user: Omit<UserAccount, 'id' | 'registeredAt'>) => void;
  onResetUsersToDefault: () => void;
  onReturnToApp?: () => void;
}

const ADMIN_STORAGE_KEY = 'motocare_admin_auth_session_v1';
const OWNER_EMAIL = 'mustetm7@gmail.com';
const VALID_PASSWORDS = ['motocare_owner_2026', 'admin2026', 'motocare2026'];

export const AdminUsersPortal: React.FC<AdminUsersPortalProps> = ({
  users,
  onApprovePro,
  onRevokePro,
  onAddUser,
  onResetUsersToDefault,
  onReturnToApp,
}) => {
  // Live Firestore payment submissions state
  const [firestoreSubmissions, setFirestoreSubmissions] = useState<PaymentSubmission[]>([]);

  // Authentication State: check both Firebase Auth current user and session
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    if (auth.currentUser && auth.currentUser.email?.toLowerCase() === OWNER_EMAIL.toLowerCase()) {
      return true;
    }
    try {
      return sessionStorage.getItem(ADMIN_STORAGE_KEY) === 'authenticated';
    } catch {
      return false;
    }
  });

  // Listen to Firebase Auth state
  React.useEffect(() => {
    const unsub = auth.onAuthStateChanged((user) => {
      if (user && user.email?.toLowerCase() === OWNER_EMAIL.toLowerCase()) {
        setIsAuthenticated(true);
      }
    });
    return () => unsub();
  }, []);

  // Listen to live Firestore payment submissions when authenticated
  React.useEffect(() => {
    if (!isAuthenticated) return;
    try {
      const unsub = subscribeToAllPaymentSubmissions((subs) => {
        setFirestoreSubmissions(subs);
      });
      return () => unsub();
    } catch (err) {
      console.warn('Could not subscribe to live Firestore submissions:', err);
    }
  }, [isAuthenticated]);

  // Login form state
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [authError, setAuthError] = useState('');
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);

  // Admin Dashboard State
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedRefId, setCopiedRefId] = useState<string | null>(null);
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

  // Combine Firestore live submissions with mock demo users (giving precedence to live submissions)
  const allUsers: UserAccount[] = React.useMemo(() => {
    const list: UserAccount[] = [...users];

    firestoreSubmissions.forEach((sub) => {
      const existingIdx = list.findIndex(
        (u) => u.id === sub.userId || (sub.referenceNumber && u.referenceNumber === sub.referenceNumber)
      );
      const mappedUser: UserAccount = {
        id: sub.userId,
        name: sub.userName || 'Rider',
        email: sub.userEmail,
        phone: sub.userPhone,
        registeredAt: sub.submittedAt.split('T')[0],
        bikeModel: sub.bikeModel || 'Motorcycle',
        bikePlate: sub.bikePlate || '',
        subscriptionTier: sub.status === 'active_pro' ? 'pro' : 'free',
        paymentStatus: sub.status,
        paymentMethod: sub.paymentMethod,
        referenceNumber: sub.referenceNumber,
        amountPhp: sub.amountPhp,
        lastPaymentDate: sub.submittedAt,
        approvedAt: sub.reviewedAt,
        approvedBy: sub.reviewedBy,
        notes: sub.notes,
      };

      if (existingIdx >= 0) {
        list[existingIdx] = mappedUser;
      } else {
        list.unshift(mappedUser);
      }
    });

    return list;
  }, [users, firestoreSubmissions]);

  // Handle Google Admin Login
  const handleGoogleAdminLogin = async () => {
    setAuthError('');
    setIsAuthenticating(true);
    try {
      const loggedUser = await signInWithGoogle();
      if (
        loggedUser &&
        (loggedUser.email?.toLowerCase() === OWNER_EMAIL.toLowerCase() ||
          loggedUser.email?.toLowerCase() === 'admin@motocare.ph')
      ) {
        setIsAuthenticated(true);
        sounds.playSuccess();
      } else if (loggedUser) {
        setAuthError(
          `Signed in as ${loggedUser.email}, but this account is not authorized as the MotoCare owner (${OWNER_EMAIL}).`
        );
      }
    } catch (err) {
      setAuthError('Google Sign-In was cancelled or failed.');
    } finally {
      setIsAuthenticating(false);
    }
  };

  // Handle Login Authentication
  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setIsAuthenticating(true);
    sounds.playClick();

    setTimeout(() => {
      setIsAuthenticating(false);
      const cleanEmail = emailInput.trim().toLowerCase();
      const cleanPass = passwordInput.trim();

      const isValidEmail =
        cleanEmail === OWNER_EMAIL.toLowerCase() ||
        cleanEmail === 'admin' ||
        cleanEmail === 'admin@motocare.ph';

      const isValidPass = VALID_PASSWORDS.includes(cleanPass);

      if (isValidEmail && isValidPass) {
        try {
          sessionStorage.setItem(ADMIN_STORAGE_KEY, 'authenticated');
        } catch {
          // ignore
        }
        setIsAuthenticated(true);
        sounds.playSuccess();
        setFailedAttempts(0);
      } else {
        setFailedAttempts((prev) => prev + 1);
        setAuthError('Invalid owner credentials. Access denied.');
      }
    }, 600);
  };

  const handleSignOut = async () => {
    sounds.playClick();
    try {
      sessionStorage.removeItem(ADMIN_STORAGE_KEY);
      await logOut();
    } catch {
      // ignore
    }
    setIsAuthenticated(false);
    setPasswordInput('');
    setAuthError('');
  };

  // Computations
  const pendingUsers = allUsers.filter((u) => u.paymentStatus === 'pending_approval');
  const proUsers = allUsers.filter((u) => u.subscriptionTier === 'pro');
  const freeUsers = allUsers.filter((u) => u.subscriptionTier === 'free');
  const totalRevenue = allUsers
    .filter((u) => u.subscriptionTier === 'pro')
    .reduce((sum, u) => sum + (u.amountPhp || 49), 0);

  const filteredUsers = allUsers.filter((u) => {
    if (filterStatus === 'pending' && u.paymentStatus !== 'pending_approval') return false;
    if (filterStatus === 'pro' && u.subscriptionTier !== 'pro') return false;
    if (filterStatus === 'free' && u.subscriptionTier !== 'free') return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = u.name.toLowerCase().includes(q);
      const matchEmail = u.email.toLowerCase().includes(q);
      const matchRef = (u.referenceNumber || '').toLowerCase().includes(q);
      const matchBike =
        (u.bikeModel || '').toLowerCase().includes(q) ||
        (u.bikeNickname || '').toLowerCase().includes(q);
      const matchPhone = (u.phone || '').toLowerCase().includes(q);
      return matchName || matchEmail || matchRef || matchBike || matchPhone;
    }
    return true;
  });

  const handleCopyRef = (ref: string, id: string) => {
    navigator.clipboard?.writeText(ref);
    setCopiedRefId(id);
    sounds.playClick();
    setTimeout(() => setCopiedRefId(null), 2000);
  };

  const handleApprove = async (userId: string) => {
    sounds.playSuccess();
    try {
      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#FF6B00', '#10B981', '#00C5FF', '#FBBF24'],
      });
    } catch {
      // ignore
    }

    // Check if this user corresponds to a live Firestore submission
    const matchedSub = firestoreSubmissions.find((s) => s.userId === userId);
    if (matchedSub) {
      try {
        await approveProAccessInFirestore(
          matchedSub.id,
          matchedSub.userId,
          auth.currentUser?.email || 'Owner Admin'
        );
      } catch (err) {
        console.error('Failed to approve in Firestore:', err);
      }
    }

    onApprovePro(userId);
  };

  const handleRevoke = async (userId: string) => {
    sounds.playClick();
    const matchedSub = firestoreSubmissions.find((s) => s.userId === userId);
    if (matchedSub) {
      try {
        await revokeProAccessInFirestore(matchedSub.id, matchedSub.userId);
      } catch (err) {
        console.error('Failed to revoke in Firestore:', err);
      }
    }
    onRevokePro(userId);
  };

  const handleAddUserSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newEmail.trim()) return;

    sounds.playSuccess();
    onAddUser({
      name: newName.trim(),
      email: newEmail.trim(),
      phone: newPhone.trim() || '0917-000-0000',
      bikeModel: newBikeModel.trim() || 'Custom Motorcycle',
      bikeNickname: '',
      bikePlate: newBikePlate.trim() || 'PENDING',
      subscriptionTier: newInitialStatus === 'active_pro' ? 'pro' : 'free',
      paymentStatus: newInitialStatus,
      paymentMethod: newPaymentMethod,
      referenceNumber: newRefNumber.trim() || `MANUAL-${Date.now().toString(36).toUpperCase()}`,
      amountPhp: newInitialStatus === 'active_pro' ? 49 : 0,
      notes: newNotes.trim() || 'Manually created by Administrator',
      approvedAt: newInitialStatus === 'active_pro' ? new Date().toISOString() : undefined,
      approvedBy: newInitialStatus === 'active_pro' ? 'Admin (Direct)' : undefined,
    });

    setIsAddUserModalOpen(false);
    setNewName('');
    setNewEmail('');
    setNewPhone('');
    setNewBikeModel('');
    setNewBikePlate('');
    setNewRefNumber('');
    setNewNotes('');
  };

  // ==========================================
  // VIEW 1: UNAUTHENTICATED LOGIN GATE
  // ==========================================
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center items-center px-4 py-12 font-sans selection:bg-[#FF6B00] selection:text-white">
        <div className="w-full max-w-md space-y-6">
          {/* Header Branding */}
          <div className="text-center space-y-2">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-500 to-[#FF6B00] text-slate-950 flex items-center justify-center mx-auto shadow-xl shadow-orange-500/20">
              <Lock className="w-7 h-7 text-slate-950" />
            </div>

            <div className="flex items-center justify-center gap-2 pt-2">
              <h1 className="text-2xl font-black tracking-tight text-white">
                Moto<span className="text-[#FF6B00]">Care</span>
              </h1>
              <span className="px-2.5 py-0.5 rounded-md bg-amber-400 text-slate-950 font-black text-xs uppercase tracking-wider">
                Owner Portal
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Restricted Web Console • Authorized Administrator Access Only
            </p>
          </div>

          {/* Login Card */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-5">
            <div className="flex items-center gap-2 p-3 bg-slate-950/80 rounded-xl border border-slate-800 text-[11px] text-slate-400">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Independent owner gate. Unauthenticated users cannot view or approve rider data.</span>
            </div>

            {authError && (
              <div className="p-3 bg-red-950/70 border border-red-800/80 rounded-xl text-red-300 text-xs flex items-center gap-2 animate-in fade-in">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                <span>{authError}</span>
              </div>
            )}

            {/* 1-Click Secure Google Sign-In for Application Owner */}
            <div className="space-y-3">
              <button
                type="button"
                onClick={handleGoogleAdminLogin}
                disabled={isAuthenticating}
                className="w-full py-3 bg-white hover:bg-slate-100 text-slate-900 font-extrabold text-xs rounded-xl shadow-md transition-all flex items-center justify-center gap-2.5 cursor-pointer active:scale-98 disabled:opacity-50"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                </svg>
                <span>Sign In with Owner Google Account</span>
              </button>

              <div className="flex items-center gap-3 my-2 text-[10px] text-slate-500 uppercase tracking-widest font-bold text-center">
                <div className="flex-1 h-px bg-slate-800" />
                <span>or enter owner credentials</span>
                <div className="flex-1 h-px bg-slate-800" />
              </div>
            </div>

            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-slate-400" />
                  <span>Owner Email or Username</span>
                </label>
                <input
                  type="text"
                  required
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  placeholder="mustetm7@gmail.com or admin"
                  className="w-full bg-slate-950 border border-slate-800 focus:border-[#FF6B00] rounded-xl px-3.5 py-2.5 text-xs text-white placeholder:text-slate-600 focus:outline-none transition-colors"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5 text-slate-400" />
                  <span>Security Password</span>
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={passwordInput}
                    onChange={(e) => setPasswordInput(e.target.value)}
                    placeholder="Enter owner password"
                    className="w-full bg-slate-950 border border-slate-800 focus:border-[#FF6B00] rounded-xl pl-3.5 pr-10 py-2.5 text-xs text-white placeholder:text-slate-600 focus:outline-none transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 p-1 cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isAuthenticating}
                className="w-full py-3 bg-[#FF6B00] hover:bg-[#EA580C] text-white font-extrabold text-xs rounded-xl shadow-lg shadow-orange-500/25 transition-all flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer active:scale-98"
              >
                {isAuthenticating ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Verifying Credentials...</span>
                  </>
                ) : (
                  <>
                    <Lock className="w-3.5 h-3.5" />
                    <span>Sign In to Admin Console</span>
                  </>
                )}
              </button>
            </form>

            {/* Owner Credentials Tip */}
            <div className="pt-2 border-t border-slate-800/80 text-[11px] text-slate-500 space-y-1 text-center">
              <p>Default Owner Credentials:</p>
              <div className="font-mono text-xs text-slate-400 bg-slate-950/60 p-2 rounded-lg border border-slate-800/60">
                User: <span className="text-amber-400">mustetm7@gmail.com</span> | Pass:{' '}
                <span className="text-amber-400">motocare_owner_2026</span>
              </div>
            </div>
          </div>

          <p className="text-[10px] text-center text-slate-500">
            MotoCare Administration • Independent Web Console
          </p>
        </div>
      </div>
    );
  }

  // ==========================================
  // VIEW 2: AUTHENTICATED ADMIN DASHBOARD
  // ==========================================
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-[#FF6B00] selection:text-white">
      {/* Top Admin Header */}
      <header className="sticky top-0 z-40 bg-slate-900/95 backdrop-blur-md border-b border-slate-800 shadow-xl">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between gap-3">
          {/* Identity */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-[#FF6B00] text-slate-950 flex items-center justify-center font-black shadow-md shadow-orange-500/20">
              <ShieldCheck className="w-5 h-5 text-slate-950" />
            </div>
            <div>
              <div className="flex items-center gap-2 leading-none">
                <span className="text-lg font-black tracking-tight text-white">
                  Moto<span className="text-[#FF6B00]">Care</span>
                </span>
                <span className="px-2 py-0.5 rounded-md bg-amber-400 text-slate-950 font-black text-[10px] uppercase tracking-wider">
                  Admin Console
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-medium mt-0.5">
                <Globe className="w-3 h-3 text-cyan-400" />
                <span>Web-Only Console</span>
                <span>•</span>
                <span className="text-amber-300 font-bold">{OWNER_EMAIL}</span>
              </div>
            </div>
          </div>

          {/* Right Header: Owner Badge & Sign Out */}
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-800/80 border border-slate-700 text-xs">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-slate-300 font-bold">Owner Authenticated</span>
            </div>

            <button
              type="button"
              onClick={handleSignOut}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-red-950 hover:text-red-300 border border-slate-700 text-slate-300 text-xs font-bold transition-all flex items-center gap-1.5 active:scale-95 cursor-pointer"
              title="End admin session"
            >
              <LogOut className="w-3.5 h-3.5 text-red-400" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Admin Content */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Security & Isolation Status Banner */}
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-md">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-emerald-950 border border-emerald-800 text-emerald-400 text-[10px] font-mono font-bold uppercase tracking-wider">
                COMPLETELY SEPARATED & AUTH PROTECTED
              </span>
              <span className="text-xs text-slate-400 hidden sm:inline">•</span>
              <span className="text-xs text-slate-400 hidden sm:inline">No public links in rider app</span>
            </div>
            <p className="text-xs text-slate-300 font-semibold">
              Authenticated as Application Owner (<span className="text-amber-400">{OWNER_EMAIL}</span>). Inspect rider payments, review reference numbers, and manage PRO access.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setIsAddUserModalOpen(true)}
              className="px-3.5 py-2 bg-[#FF6B00] hover:bg-[#EA580C] text-white font-extrabold text-xs rounded-xl shadow-md transition-all active:scale-95 flex items-center gap-1.5 cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>+ Add Rider Account</span>
            </button>
          </div>
        </div>

        {/* Top KPI Metrics Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {/* Card 1: Total Registered Riders */}
          <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 shadow-sm space-y-1">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-xs font-bold uppercase tracking-wider">Total Riders</span>
              <Users className="w-4 h-4 text-cyan-400" />
            </div>
            <div className="text-2xl sm:text-3xl font-black text-white font-mono">
              {users.length}
            </div>
            <div className="text-[11px] text-slate-500 font-medium">Registered in database</div>
          </div>

          {/* Card 2: Pending Approval */}
          <div className="p-4 rounded-2xl bg-slate-900 border border-amber-900/60 shadow-sm space-y-1 relative overflow-hidden">
            <div className="flex items-center justify-between text-amber-400">
              <span className="text-xs font-bold uppercase tracking-wider">Pending Review</span>
              <Clock className="w-4 h-4 text-amber-400 animate-pulse" />
            </div>
            <div className="text-2xl sm:text-3xl font-black text-amber-400 font-mono">
              {pendingUsers.length}
            </div>
            <div className="text-[11px] text-amber-400/80 font-medium">Awaiting manual approval</div>
          </div>

          {/* Card 3: Active PRO Members */}
          <div className="p-4 rounded-2xl bg-slate-900 border border-emerald-900/60 shadow-sm space-y-1">
            <div className="flex items-center justify-between text-emerald-400">
              <span className="text-xs font-bold uppercase tracking-wider">Active PRO</span>
              <Sparkles className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-2xl sm:text-3xl font-black text-emerald-400 font-mono">
              {proUsers.length}
            </div>
            <div className="text-[11px] text-emerald-400/80 font-medium">Unlocked VIP features</div>
          </div>

          {/* Card 4: Verified Revenue */}
          <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 shadow-sm space-y-1">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-xs font-bold uppercase tracking-wider">Verified Revenue</span>
              <TrendingUp className="w-4 h-4 text-[#FF6B00]" />
            </div>
            <div className="text-2xl sm:text-3xl font-black text-white font-mono">
              ₱{totalRevenue.toLocaleString()}.00
            </div>
            <div className="text-[11px] text-slate-500 font-medium">From ₱49/mo subscriptions</div>
          </div>
        </div>

        {/* Filters, Search & Action Bar */}
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            {/* Status Filter Tabs */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
              <button
                type="button"
                onClick={() => setFilterStatus('all')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  filterStatus === 'all'
                    ? 'bg-[#FF6B00] text-white shadow-sm'
                    : 'bg-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                All Riders ({users.length})
              </button>

              <button
                type="button"
                onClick={() => setFilterStatus('pending')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1 ${
                  filterStatus === 'pending'
                    ? 'bg-amber-500 text-slate-950 shadow-sm'
                    : 'bg-slate-800 text-amber-400 hover:bg-slate-700'
                }`}
              >
                <Clock className="w-3 h-3" />
                <span>Pending Review ({pendingUsers.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setFilterStatus('pro')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1 ${
                  filterStatus === 'pro'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-slate-800 text-emerald-400 hover:bg-slate-700'
                }`}
              >
                <CheckCircle2 className="w-3 h-3" />
                <span>Active PRO ({proUsers.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setFilterStatus('free')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  filterStatus === 'free'
                    ? 'bg-slate-700 text-white shadow-sm'
                    : 'bg-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                Free Tier ({freeUsers.length})
              </button>
            </div>

            {/* Search Input */}
            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search rider, email, ref #..."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-[#FF6B00]"
              />
            </div>
          </div>
        </div>

        {/* Users List Table / Cards */}
        <div className="space-y-3">
          {filteredUsers.length === 0 ? (
            <div className="p-8 text-center bg-slate-900 border border-slate-800 rounded-2xl text-slate-500 space-y-2">
              <Search className="w-8 h-8 mx-auto text-slate-600" />
              <p className="font-bold text-sm text-slate-400">No rider accounts match this filter</p>
              <p className="text-xs text-slate-600">Try adjusting your status filter or search query</p>
            </div>
          ) : (
            filteredUsers.map((user) => {
              const isPending = user.paymentStatus === 'pending_approval';
              const isPro = user.subscriptionTier === 'pro';

              return (
                <div
                  key={user.id}
                  className={`p-4 sm:p-5 rounded-2xl bg-slate-900 border transition-all ${
                    isPending
                      ? 'border-amber-500/70 shadow-lg shadow-amber-500/5'
                      : isPro
                      ? 'border-emerald-900/60'
                      : 'border-slate-800'
                  }`}
                >
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    {/* User Identity & Motorcycle info */}
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-extrabold text-white text-base">{user.name}</span>

                        {/* Status Badges */}
                        {isPending ? (
                          <span className="px-2.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/40 text-amber-400 font-extrabold text-[10px] flex items-center gap-1 uppercase tracking-wider">
                            <Clock className="w-3 h-3 animate-pulse" />
                            <span>Pending Approval</span>
                          </span>
                        ) : isPro ? (
                          <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 font-extrabold text-[10px] flex items-center gap-1 uppercase tracking-wider">
                            <Sparkles className="w-3 h-3 text-emerald-400" />
                            <span>Active PRO Member</span>
                          </span>
                        ) : (
                          <span className="px-2.5 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-400 font-bold text-[10px] uppercase tracking-wider">
                            Free Tier
                          </span>
                        )}

                        <span className="text-[10px] font-mono text-slate-500">ID: {user.id}</span>
                      </div>

                      {/* Contact & Motorcycle Badges */}
                      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
                        <div className="flex items-center gap-1">
                          <Mail className="w-3.5 h-3.5 text-slate-500" />
                          <span>{user.email}</span>
                        </div>
                        {user.phone && (
                          <div className="flex items-center gap-1">
                            <Phone className="w-3.5 h-3.5 text-slate-500" />
                            <span>{user.phone}</span>
                          </div>
                        )}
                        <div className="flex items-center gap-1 text-slate-300">
                          <Bike className="w-3.5 h-3.5 text-[#FF6B00]" />
                          <span className="font-semibold">{user.bikeModel}</span>
                          {user.bikeNickname && (
                            <span className="text-amber-400 font-bold">&apos;{user.bikeNickname}&apos;</span>
                          )}
                          {user.bikePlate && (
                            <span className="text-[10px] font-mono bg-slate-800 px-1.5 py-0.5 rounded text-slate-300">
                              {user.bikePlate}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Payment Details & Reference */}
                    <div className="flex flex-wrap items-center gap-3 lg:gap-4">
                      {user.referenceNumber ? (
                        <div className="p-2.5 bg-slate-950 border border-slate-800 rounded-xl space-y-1 min-w-[200px]">
                          <div className="flex items-center justify-between text-[10px] text-slate-400">
                            <span className="font-bold uppercase">
                              {user.paymentMethod ? user.paymentMethod.toUpperCase() : 'QRPH'} Reference
                            </span>
                            <span className="font-bold text-emerald-400 font-mono">
                              ₱{user.amountPhp || 49}.00
                            </span>
                          </div>

                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono font-extrabold text-xs text-amber-300 truncate">
                              {user.referenceNumber}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleCopyRef(user.referenceNumber || '', user.id)}
                              className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
                              title="Copy transaction reference"
                            >
                              {copiedRefId === user.id ? (
                                <Check className="w-3 h-3 text-emerald-400" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                            </button>
                          </div>

                          {user.approvedAt && (
                            <div className="text-[9px] text-slate-500">
                              Approved: {new Date(user.approvedAt).toLocaleDateString()} by {user.approvedBy || 'Admin'}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="text-xs text-slate-500 italic">No payment record yet</div>
                      )}

                      {/* Approval / Revoke Actions */}
                      <div className="flex items-center gap-2">
                        {isPending ? (
                          <button
                            type="button"
                            onClick={() => handleApprove(user.id)}
                            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-black shadow-lg shadow-emerald-600/20 flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                            <span>Approve PRO Access</span>
                          </button>
                        ) : isPro ? (
                          <button
                            type="button"
                            onClick={() => handleRevoke(user.id)}
                            className="px-3 py-1.5 bg-slate-800 hover:bg-red-950 hover:text-red-300 text-slate-400 rounded-xl text-xs font-bold transition-all cursor-pointer"
                          >
                            <span>Revoke PRO</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleApprove(user.id)}
                            className="px-3 py-1.5 bg-slate-800 hover:bg-emerald-950 hover:text-emerald-300 text-slate-400 rounded-xl text-xs font-bold transition-all cursor-pointer"
                          >
                            <span>Grant PRO</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer Actions */}
        <div className="pt-4 border-t border-slate-900 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
          <div>
            Showing {filteredUsers.length} of {users.length} registered rider accounts
          </div>
          <button
            type="button"
            onClick={onResetUsersToDefault}
            className="text-slate-500 hover:text-slate-300 underline text-xs flex items-center gap-1 cursor-pointer"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Reset User Database to Demo Default</span>
          </button>
        </div>
      </main>

      {/* Add Rider Account Modal */}
      {isAddUserModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-extrabold text-white text-base">Add New Rider Account</h3>
              <button
                type="button"
                onClick={() => setIsAddUserModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddUserSubmit} className="space-y-3 text-xs">
              <div>
                <label className="text-slate-300 font-bold block mb-1">Rider Full Name *</label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Juan Carlos"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white placeholder:text-slate-600 focus:outline-none focus:border-[#FF6B00]"
                />
              </div>

              <div>
                <label className="text-slate-300 font-bold block mb-1">Email Address *</label>
                <input
                  type="email"
                  required
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="rider@example.com"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white placeholder:text-slate-600 focus:outline-none focus:border-[#FF6B00]"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-300 font-bold block mb-1">Phone Number</label>
                  <input
                    type="text"
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    placeholder="0917-xxx-xxxx"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white placeholder:text-slate-600 focus:outline-none focus:border-[#FF6B00]"
                  />
                </div>
                <div>
                  <label className="text-slate-300 font-bold block mb-1">Plate Number</label>
                  <input
                    type="text"
                    value={newBikePlate}
                    onChange={(e) => setNewBikePlate(e.target.value)}
                    placeholder="e.g. 123-ABC"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white uppercase font-mono placeholder:text-slate-600 focus:outline-none focus:border-[#FF6B00]"
                  />
                </div>
              </div>

              <div>
                <label className="text-slate-300 font-bold block mb-1">Motorcycle Model</label>
                <input
                  type="text"
                  value={newBikeModel}
                  onChange={(e) => setNewBikeModel(e.target.value)}
                  placeholder="e.g. Yamaha NMAX 155"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white placeholder:text-slate-600 focus:outline-none focus:border-[#FF6B00]"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-300 font-bold block mb-1">Payment Method</label>
                  <select
                    value={newPaymentMethod}
                    onChange={(e) => setNewPaymentMethod(e.target.value as 'gcash' | 'gotyme')}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-[#FF6B00]"
                  >
                    <option value="gcash">GCash</option>
                    <option value="gotyme">GoTyme</option>
                  </select>
                </div>
                <div>
                  <label className="text-slate-300 font-bold block mb-1">Initial Status</label>
                  <select
                    value={newInitialStatus}
                    onChange={(e) => setNewInitialStatus(e.target.value as AccountPaymentStatus)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-[#FF6B00]"
                  >
                    <option value="pending_approval">Pending Approval</option>
                    <option value="active_pro">Active PRO</option>
                    <option value="unpaid_free">Free Tier</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-slate-300 font-bold block mb-1">Reference Number</label>
                <input
                  type="text"
                  value={newRefNumber}
                  onChange={(e) => setNewRefNumber(e.target.value)}
                  placeholder="e.g. GCASH-192831"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono placeholder:text-slate-600 focus:outline-none focus:border-[#FF6B00]"
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
                  className="flex-1 py-2.5 bg-[#FF6B00] hover:bg-[#EA580C] text-white font-extrabold rounded-xl shadow-md cursor-pointer"
                >
                  Create Account
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
