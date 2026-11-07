import React, { useState } from 'react';
import { UserAccount, AccountPaymentStatus, DashboardSubscriptionStatus } from '../types';
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
  subscribeToAllUsers,
  approveProAccessInFirestore,
  revokeProAccessInFirestore,
  calculateNextMonthlyExpiry,
  getManilaDay,
  calculateDaysRemaining,
  parseExpiryToDate,
  migrateUserExpiryToTimestamp,
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

interface ApprovalPreview {
  submissionId: string;
  userId: string;
  userName: string;
  userEmail: string;
  referenceNumber: string;
  paymentMethod: string;
  isEarlyRenewal: boolean;
  currentExpiry?: string;
  newStartDate: string;
  newExpiryDate: string;
  anchorDay: number;
}

const OWNER_EMAIL = 'mustetm7@gmail.com';

function isVerifiedOwner(user: any): boolean {
  return (
    Boolean(user) &&
    user.email?.toLowerCase() === OWNER_EMAIL.toLowerCase() &&
    user.emailVerified === true
  );
}

function formatManilaDateString(dateVal?: unknown): string {
  if (!dateVal) return 'Not set';
  try {
    const d = parseExpiryToDate(dateVal);
    if (!d) return 'Not set';
    return new Intl.DateTimeFormat('en-PH', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d);
  } catch {
    return String(dateVal);
  }
}

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
  const [firestoreUsers, setFirestoreUsers] = useState<Record<string, any>[]>([]);

  // Authentication State: strictly check Firebase Auth verified owner
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    return isVerifiedOwner(auth.currentUser);
  });

  // Listen to Firebase Auth state
  React.useEffect(() => {
    const unsub = auth.onAuthStateChanged((user) => {
      setIsAuthenticated(isVerifiedOwner(user));
    });
    return () => unsub();
  }, []);

  // Listen to live Firestore payment submissions when authenticated
  React.useEffect(() => {
    if (!isAuthenticated) return;
    try {
      const unsubSubs = subscribeToAllPaymentSubmissions((subs) => {
        setFirestoreSubmissions(subs);
      });
      const unsubUsers = subscribeToAllUsers((uList) => {
        setFirestoreUsers(uList);
      });
      return () => {
        unsubSubs();
        unsubUsers();
      };
    } catch (err) {
      console.warn('Could not subscribe to live Firestore collections:', err);
    }
  }, [isAuthenticated]);

  // Login state for Google Sign-In
  const [authError, setAuthError] = useState('');
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  // Admin Dashboard State
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedRefId, setCopiedRefId] = useState<string | null>(null);
  const [isAddUserModalOpen, setIsAddUserModalOpen] = useState(false);

  // Approval confirmation modal state
  const [approvalPreview, setApprovalPreview] = useState<ApprovalPreview | null>(null);
  const [isApproving, setIsApproving] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  // Form state for adding user
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newBikeModel, setNewBikeModel] = useState('');
  const [newBikePlate, setNewBikePlate] = useState('');
  const [newPaymentMethod, setNewPaymentMethod] = useState<'gcash' | 'gotyme'>('gcash');
  const [newRefNumber, setNewRefNumber] = useState('');
  const [newInitialStatus, setNewInitialStatus] = useState<AccountPaymentStatus>('pending_approval');
  const [newNotes, setNewNotes] = useState('');

  // Combine Firestore users, live submissions, and prop users with full lifecycle calculations
  const allUsers: UserAccount[] = React.useMemo(() => {
    const list: UserAccount[] = [...users];
    const now = new Date();

    // 1. Overlay live Firestore user docs
    firestoreUsers.forEach((fUser) => {
      const idx = list.findIndex((u) => u.id === fUser.id);
      const isStoredPro = fUser.subscriptionTier === 'pro';
      const expiry = parseExpiryToDate(fUser.expiryDate);
      const isExpired = expiry !== null && expiry.getTime() <= now.getTime();
      const expiryIso = expiry ? expiry.toISOString() : undefined;

      const merged: UserAccount = {
        id: fUser.id,
        name: fUser.displayName || fUser.name || 'Rider',
        email: fUser.email || '',
        registeredAt: fUser.createdAt ? fUser.createdAt.split('T')[0] : '2026-11-01',
        bikeModel: fUser.bikeModel || (idx >= 0 ? list[idx].bikeModel : 'Motorcycle'),
        bikeNickname: fUser.bikeNickname || (idx >= 0 ? list[idx].bikeNickname : undefined),
        bikePlate: fUser.bikePlate || (idx >= 0 ? list[idx].bikePlate : undefined),
        bikeCount: typeof fUser.bikeCount === 'number' ? fUser.bikeCount : (idx >= 0 ? list[idx].bikeCount : undefined),
        subscriptionTier: isStoredPro && !isExpired ? 'pro' : 'free',
        paymentStatus: fUser.paymentStatus || 'unpaid_free',
        subscriptionStartDate: fUser.subscriptionStartDate,
        expiryDate: expiryIso,
        billingAnchorDay: fUser.billingAnchorDay,
        lastPaymentId: fUser.lastPaymentId,
        approvedAt: fUser.approvedAt,
        approvedBy: fUser.approvedBy,
      };

      if (idx >= 0) {
        list[idx] = { ...list[idx], ...merged };
      } else {
        list.push(merged);
      }
    });

    // 2. Overlay live Firestore submissions
    firestoreSubmissions.forEach((sub) => {
      const existingIdx = list.findIndex(
        (u) => u.id === sub.userId || (sub.referenceNumber && u.referenceNumber === sub.referenceNumber)
      );

      const targetUser = existingIdx >= 0 ? list[existingIdx] : null;
      const isPending = sub.status === 'pending_approval';

      const mappedUser: UserAccount = {
        id: sub.userId,
        name: sub.userName || targetUser?.name || 'Rider',
        email: sub.userEmail || targetUser?.email || '',
        registeredAt: targetUser?.registeredAt || sub.submittedAt.split('T')[0],
        bikeModel: sub.bikeModel || targetUser?.bikeModel || 'Motorcycle',
        bikePlate: sub.bikePlate || targetUser?.bikePlate || '',
        bikeNickname: targetUser?.bikeNickname,
        subscriptionTier: targetUser?.subscriptionTier || (sub.status === 'active_pro' ? 'pro' : 'free'),
        paymentStatus: isPending ? 'pending_approval' : targetUser?.paymentStatus || sub.status,
        paymentMethod: sub.paymentMethod || targetUser?.paymentMethod,
        referenceNumber: sub.referenceNumber || targetUser?.referenceNumber,
        amountPhp: sub.amountPhp || targetUser?.amountPhp,
        lastPaymentDate: sub.submittedAt,
        subscriptionStartDate: targetUser?.subscriptionStartDate,
        expiryDate: targetUser?.expiryDate,
        billingAnchorDay: targetUser?.billingAnchorDay,
        lastPaymentId: sub.id,
        approvedAt: sub.approvedAt || sub.reviewedAt || targetUser?.approvedAt,
        approvedBy: sub.approvedBy || sub.reviewedBy || targetUser?.approvedBy,
        notes: sub.notes,
      };

      if (existingIdx >= 0) {
        list[existingIdx] = mappedUser;
      } else {
        list.unshift(mappedUser);
      }
    });

    // 3. Compute effectiveStatus (FREE, ACTIVE, PENDING RENEWAL, EXPIRED, REJECTED) and daysRemaining
    return list.map((u) => {
      const pendingSub = firestoreSubmissions.find(
        (s) => s.userId === u.id && s.status === 'pending_approval'
      );
      const hasPendingRenewal = Boolean(pendingSub);

      const expiry = u.expiryDate ? new Date(u.expiryDate) : null;
      const isExpired = Boolean(u.expiryDate) && expiry !== null && expiry.getTime() <= now.getTime();
      const isPro = u.subscriptionTier === 'pro';

      let effectiveStatus: DashboardSubscriptionStatus;
      if (hasPendingRenewal) {
        effectiveStatus = 'PENDING RENEWAL';
      } else if (isPro && !isExpired) {
        effectiveStatus = 'ACTIVE';
      } else if (isExpired || (isPro && isExpired)) {
        effectiveStatus = 'EXPIRED';
      } else if (u.paymentStatus === 'rejected') {
        effectiveStatus = 'REJECTED';
      } else {
        effectiveStatus = 'FREE';
      }

      const daysRemaining = calculateDaysRemaining(u.expiryDate);

      return {
        ...u,
        effectiveStatus,
        hasPendingRenewal,
        daysRemaining: isExpired ? 0 : daysRemaining,
        referenceNumber: pendingSub?.referenceNumber || u.referenceNumber,
        paymentMethod: pendingSub?.paymentMethod || u.paymentMethod,
        amountPhp: pendingSub?.amountPhp || u.amountPhp || 49,
      };
    });
  }, [users, firestoreUsers, firestoreSubmissions]);

  // Handle Google Admin Login (Zero Trust - requires owner email + email_verified)
  const handleGoogleAdminLogin = async () => {
    setAuthError('');
    setIsAuthenticating(true);
    sounds.playClick();

    try {
      const loggedUser = await signInWithGoogle();
      if (!loggedUser) {
        setAuthError('Google Sign-In was cancelled.');
        return;
      }

      const userEmail = loggedUser.email?.toLowerCase();
      if (userEmail !== OWNER_EMAIL.toLowerCase()) {
        await logOut();
        setAuthError(
          `Signed in as ${loggedUser.email}, but this account is not authorized as the MotoCare owner (${OWNER_EMAIL}). Access denied.`
        );
        return;
      }

      if (!loggedUser.emailVerified) {
        await logOut();
        setAuthError(
          `The Google account ${loggedUser.email} is not marked as email-verified in Firebase. Please verify your email before accessing the Admin Portal.`
        );
        return;
      }

      setIsAuthenticated(true);
      sounds.playSuccess();
    } catch {
      setAuthError('Google Sign-In failed or was cancelled by user.');
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleSignOut = async () => {
    sounds.playClick();
    try {
      await logOut();
    } catch {
      // ignore
    }
    setIsAuthenticated(false);
    setAuthError('');
  };

  // Computations for Admin KPI cards
  const pendingUsers = allUsers.filter((u) => u.effectiveStatus === 'PENDING RENEWAL');
  const activeProUsers = allUsers.filter((u) => u.effectiveStatus === 'ACTIVE');
  const expiredUsers = allUsers.filter((u) => u.effectiveStatus === 'EXPIRED');
  const freeUsers = allUsers.filter((u) => u.effectiveStatus === 'FREE');
  const rejectedUsers = allUsers.filter((u) => u.effectiveStatus === 'REJECTED');

  const totalRevenue = allUsers
    .filter((u) => u.effectiveStatus === 'ACTIVE')
    .reduce((sum, u) => sum + (u.amountPhp || 49), 0);

  const filteredUsers = allUsers.filter((u) => {
    if (filterStatus === 'pending' && u.effectiveStatus !== 'PENDING RENEWAL') return false;
    if (filterStatus === 'active' && u.effectiveStatus !== 'ACTIVE') return false;
    if (filterStatus === 'expired' && u.effectiveStatus !== 'EXPIRED') return false;
    if (filterStatus === 'free' && u.effectiveStatus !== 'FREE') return false;
    if (filterStatus === 'rejected' && u.effectiveStatus !== 'REJECTED') return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = u.name.toLowerCase().includes(q);
      const matchEmail = u.email.toLowerCase().includes(q);
      const matchRef = (u.referenceNumber || '').toLowerCase().includes(q);
      const matchBike =
        (u.bikeModel || '').toLowerCase().includes(q) ||
        (u.bikeNickname || '').toLowerCase().includes(q);
      return matchName || matchEmail || matchRef || matchBike;
    }
    return true;
  });

  const handleCopyRef = (ref: string, id: string) => {
    navigator.clipboard?.writeText(ref);
    setCopiedRefId(id);
    sounds.playClick();
    setTimeout(() => setCopiedRefId(null), 2000);
  };

  // Step 1: Click "Approve PRO" -> Calculate resulting expiration date and show confirmation modal
  const handleInitiateApprove = (user: UserAccount) => {
    sounds.playClick();

    const matchedSub = firestoreSubmissions.find(
      (s) => s.userId === user.id && s.status === 'pending_approval'
    );
    const now = new Date();
    const expiry = user.expiryDate ? new Date(user.expiryDate) : null;
    const isEarlyRenewal =
      user.subscriptionTier === 'pro' && expiry !== null && expiry.getTime() > now.getTime();

    let baseDate: Date;
    let anchorDay: number;

    if (isEarlyRenewal && expiry) {
      baseDate = expiry;
      anchorDay =
        typeof user.billingAnchorDay === 'number' ? user.billingAnchorDay : getManilaDay(expiry);
    } else {
      baseDate = now;
      anchorDay = getManilaDay(now);
    }

    const calc = calculateNextMonthlyExpiry(baseDate, anchorDay);

    setApprovalPreview({
      submissionId: matchedSub ? matchedSub.id : `manual_${Date.now()}`,
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      referenceNumber: matchedSub?.referenceNumber || user.referenceNumber || 'MANUAL-PAYMENT',
      paymentMethod: matchedSub?.paymentMethod || user.paymentMethod || 'gcash',
      isEarlyRenewal,
      currentExpiry: user.expiryDate,
      newStartDate: isEarlyRenewal ? (user.subscriptionStartDate || now.toISOString()) : now.toISOString(),
      newExpiryDate: calc.expiryIso,
      anchorDay: calc.anchorDay,
    });
  };

  // Step 2: Confirm in modal -> Commit atomic Firestore transaction with double-click protection
  const handleConfirmApproval = async () => {
    if (!approvalPreview || isApproving) return;

    setIsApproving(true);
    setApprovingId(approvalPreview.userId);

    try {
      await approveProAccessInFirestore(
        approvalPreview.submissionId,
        approvalPreview.userId,
        auth.currentUser?.email || 'Owner Admin'
      );

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

      onApprovePro(approvalPreview.userId);
      setApprovalPreview(null);
    } catch (err: any) {
      console.error('Failed to commit atomic approval:', err);
      alert(err?.message || 'Approval failed. Please check Firestore security rules.');
    } finally {
      setIsApproving(false);
      setApprovingId(null);
    }
  };

  const handleRevoke = async (userId: string) => {
    sounds.playClick();
    setRevokingId(userId);

    const matchedSub = firestoreSubmissions.find((s) => s.userId === userId);
    try {
      await revokeProAccessInFirestore(
        matchedSub ? matchedSub.id : null,
        userId,
        auth.currentUser?.email || 'Owner Admin'
      );
      onRevokePro(userId);
    } catch (err) {
      console.error('Failed to revoke in Firestore:', err);
    } finally {
      setRevokingId(null);
    }
  };

  const handleAddUserSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newEmail.trim()) return;

    sounds.playSuccess();
    onAddUser({
      name: newName.trim(),
      email: newEmail.trim(),
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
          <div className="p-6 sm:p-7 bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl space-y-5">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-bold text-amber-400">
                <ShieldCheck className="w-4 h-4" />
                <span>Zero Trust Administrator Authentication</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Administrative actions (approving ₱49 monthly payments and managing rider PRO subscriptions) require verified Google Sign-In as:
              </p>
              <div className="p-2.5 bg-slate-950 border border-slate-800 rounded-xl font-mono text-xs text-amber-300 font-bold text-center">
                {OWNER_EMAIL}
              </div>
            </div>

            {authError && (
              <div className="p-3 rounded-xl bg-red-950/60 border border-red-800/80 text-red-300 text-xs flex items-start gap-2.5 animate-in fade-in">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <div className="leading-snug">{authError}</div>
              </div>
            )}

            <button
              type="button"
              onClick={handleGoogleAdminLogin}
              disabled={isAuthenticating}
              className="w-full py-3 px-4 rounded-xl font-black text-xs bg-white hover:bg-slate-100 text-slate-950 transition-all flex items-center justify-center gap-2.5 shadow-lg shadow-white/5 active:scale-98 cursor-pointer disabled:opacity-50"
            >
              {isAuthenticating ? (
                <RefreshCw className="w-4 h-4 animate-spin text-slate-900" />
              ) : (
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  />
                </svg>
              )}
              <span>Sign in with Google as Owner Admin</span>
            </button>

            {onReturnToApp && (
              <button
                type="button"
                onClick={onReturnToApp}
                className="w-full text-center text-xs text-slate-500 hover:text-slate-300 transition-colors pt-2 cursor-pointer"
              >
                ← Return to Garage
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ==========================================
  // VIEW 2: AUTHENTICATED ADMIN DASHBOARD
  // ==========================================
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-[#FF6B00] selection:text-white pb-20">
      {/* Top Navbar */}
      <header className="sticky top-0 z-30 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 px-4 sm:px-6 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-500 to-[#FF6B00] text-slate-950 flex items-center justify-center font-black text-sm shadow-md shadow-orange-500/20">
            ★
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-black text-white text-base tracking-tight">MotoCare</span>
              <span className="px-2 py-0.5 rounded-md bg-amber-400 text-slate-950 font-black text-[10px] uppercase tracking-wider">
                Admin Console
              </span>
            </div>
            <p className="text-[11px] text-slate-400 hidden sm:block">
              Monthly Subscription Lifecycle & Payment Verification • Spark Free Plan
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-slate-400">Signed in:</span>
            <span className="font-mono text-amber-300 font-bold">{auth.currentUser?.email}</span>
          </div>

          {onReturnToApp && (
            <button
              type="button"
              onClick={onReturnToApp}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition-all cursor-pointer"
            >
              Back to App
            </button>
          )}

          <button
            type="button"
            onClick={handleSignOut}
            title="Sign out of Admin Portal"
            className="p-2 rounded-xl bg-slate-800 hover:bg-red-950/60 hover:text-red-400 text-slate-400 transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 pt-6 space-y-6">
        {/* KPI Stats Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
          {/* Card 1: Total Riders */}
          <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 shadow-sm space-y-1">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-xs font-bold uppercase tracking-wider">Total Riders</span>
              <Users className="w-4 h-4 text-slate-500" />
            </div>
            <div className="text-2xl sm:text-3xl font-black text-white font-mono">
              {allUsers.length}
            </div>
            <div className="text-[11px] text-slate-500 font-medium">Registered accounts</div>
          </div>

          {/* Card 2: Pending Renewal */}
          <div className="p-4 rounded-2xl bg-slate-900 border border-amber-900/60 shadow-sm space-y-1">
            <div className="flex items-center justify-between text-amber-400">
              <span className="text-xs font-bold uppercase tracking-wider">Pending Renewal</span>
              <Clock className="w-4 h-4 text-amber-400 animate-pulse" />
            </div>
            <div className="text-2xl sm:text-3xl font-black text-amber-400 font-mono">
              {pendingUsers.length}
            </div>
            <div className="text-[11px] text-amber-400/80 font-medium">Awaiting admin review</div>
          </div>

          {/* Card 3: Active PRO */}
          <div className="p-4 rounded-2xl bg-slate-900 border border-emerald-900/60 shadow-sm space-y-1">
            <div className="flex items-center justify-between text-emerald-400">
              <span className="text-xs font-bold uppercase tracking-wider">Active PRO</span>
              <Sparkles className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-2xl sm:text-3xl font-black text-emerald-400 font-mono">
              {activeProUsers.length}
            </div>
            <div className="text-[11px] text-emerald-400/80 font-medium">Valid active term</div>
          </div>

          {/* Card 4: Expired */}
          <div className="p-4 rounded-2xl bg-slate-900 border border-rose-900/60 shadow-sm space-y-1">
            <div className="flex items-center justify-between text-rose-400">
              <span className="text-xs font-bold uppercase tracking-wider">Expired</span>
              <AlertTriangle className="w-4 h-4 text-rose-400" />
            </div>
            <div className="text-2xl sm:text-3xl font-black text-rose-400 font-mono">
              {expiredUsers.length}
            </div>
            <div className="text-[11px] text-rose-400/80 font-medium">Term has lapsed</div>
          </div>

          {/* Card 5: Verified Revenue */}
          <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 shadow-sm space-y-1 col-span-2 lg:col-span-1">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-xs font-bold uppercase tracking-wider">Active Revenue</span>
              <TrendingUp className="w-4 h-4 text-[#FF6B00]" />
            </div>
            <div className="text-2xl sm:text-3xl font-black text-white font-mono">
              ₱{totalRevenue.toLocaleString()}.00
            </div>
            <div className="text-[11px] text-slate-500 font-medium">₱49/mo active members</div>
          </div>
        </div>

        {/* Filters, Search & Action Bar */}
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            {/* Status Filter Tabs matching exact requirements */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
              <button
                type="button"
                onClick={() => setFilterStatus('all')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  filterStatus === 'all'
                    ? 'bg-[#FF6B00] text-white shadow-sm'
                    : 'bg-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                All ({allUsers.length})
              </button>

              <button
                type="button"
                onClick={() => setFilterStatus('pending')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1 cursor-pointer ${
                  filterStatus === 'pending'
                    ? 'bg-amber-500 text-slate-950 shadow-sm'
                    : 'bg-slate-800 text-amber-400 hover:bg-slate-700'
                }`}
              >
                <Clock className="w-3 h-3" />
                <span>PENDING RENEWAL ({pendingUsers.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setFilterStatus('active')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1 cursor-pointer ${
                  filterStatus === 'active'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-slate-800 text-emerald-400 hover:bg-slate-700'
                }`}
              >
                <CheckCircle2 className="w-3 h-3" />
                <span>ACTIVE ({activeProUsers.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setFilterStatus('expired')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1 cursor-pointer ${
                  filterStatus === 'expired'
                    ? 'bg-rose-600 text-white shadow-sm'
                    : 'bg-slate-800 text-rose-400 hover:bg-slate-700'
                }`}
              >
                <AlertTriangle className="w-3 h-3" />
                <span>EXPIRED ({expiredUsers.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setFilterStatus('free')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  filterStatus === 'free'
                    ? 'bg-slate-700 text-white shadow-sm'
                    : 'bg-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                FREE ({freeUsers.length})
              </button>

              <button
                type="button"
                onClick={() => setFilterStatus('rejected')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  filterStatus === 'rejected'
                    ? 'bg-red-800 text-white shadow-sm'
                    : 'bg-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                REJECTED ({rejectedUsers.length})
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
              const status = user.effectiveStatus || 'FREE';
              const isPending = status === 'PENDING RENEWAL';
              const isActive = status === 'ACTIVE';
              const isExpired = status === 'EXPIRED';

              return (
                <div
                  key={user.id}
                  className={`p-4 sm:p-5 rounded-2xl bg-slate-900 border transition-all ${
                    isPending
                      ? 'border-amber-500/70 shadow-lg shadow-amber-500/5'
                      : isActive
                      ? 'border-emerald-900/60'
                      : isExpired
                      ? 'border-rose-950/80'
                      : 'border-slate-800'
                  }`}
                >
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    {/* User Identity & Motorcycle info */}
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-extrabold text-white text-base">{user.name}</span>

                        {/* Exact Status Badges: FREE, ACTIVE, PENDING RENEWAL, EXPIRED, REJECTED */}
                        {status === 'PENDING RENEWAL' && (
                          <span className="px-2.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/40 text-amber-400 font-extrabold text-[10px] flex items-center gap-1 uppercase tracking-wider">
                            <Clock className="w-3 h-3 animate-pulse" />
                            <span>PENDING RENEWAL</span>
                          </span>
                        )}
                        {status === 'ACTIVE' && (
                          <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 font-extrabold text-[10px] flex items-center gap-1 uppercase tracking-wider">
                            <Sparkles className="w-3 h-3 text-emerald-400" />
                            <span>ACTIVE</span>
                          </span>
                        )}
                        {status === 'EXPIRED' && (
                          <span className="px-2.5 py-0.5 rounded-full bg-rose-500/15 border border-rose-500/40 text-rose-400 font-extrabold text-[10px] flex items-center gap-1 uppercase tracking-wider">
                            <AlertTriangle className="w-3 h-3 text-rose-400" />
                            <span>EXPIRED</span>
                          </span>
                        )}
                        {status === 'FREE' && (
                          <span className="px-2.5 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-400 font-bold text-[10px] uppercase tracking-wider">
                            FREE
                          </span>
                        )}
                        {status === 'REJECTED' && (
                          <span className="px-2.5 py-0.5 rounded-full bg-red-950 border border-red-800 text-red-400 font-bold text-[10px] uppercase tracking-wider">
                            REJECTED
                          </span>
                        )}

                        <span className="px-2 py-0.5 rounded-md bg-slate-950 border border-slate-800 text-[10px] font-bold text-slate-300">
                          Plan: {user.subscriptionTier === 'pro' ? 'Pro (₱49/mo)' : 'Free Tier'}
                        </span>

                        <span className="text-[10px] font-mono text-slate-500">UID: {user.id}</span>
                      </div>

                      {/* Contact & Motorcycle Badges */}
                      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
                        <div className="flex items-center gap-1">
                          <Mail className="w-3.5 h-3.5 text-slate-500" />
                          <span>{user.email}</span>
                        </div>
                        <div className="flex items-center gap-1 text-slate-300">
                          <Bike className="w-3.5 h-3.5 text-[#FF6B00]" />
                          <span className="font-semibold">{user.bikeModel}</span>
                          {user.bikePlate && (
                            <span className="text-[10px] font-mono bg-slate-800 px-1.5 py-0.5 rounded text-slate-300">
                              {user.bikePlate}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Lifecycle Timeline Details */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 text-[11px] text-slate-400">
                        <div className="p-2 rounded-xl bg-slate-950/70 border border-slate-800/80">
                          <span className="text-slate-500 block text-[10px]">Start Date:</span>
                          <span className="font-medium text-slate-300">
                            {formatManilaDateString(user.subscriptionStartDate)}
                          </span>
                        </div>
                        <div className="p-2 rounded-xl bg-slate-950/70 border border-slate-800/80">
                          <span className="text-slate-500 block text-[10px]">Expiration Date:</span>
                          <span className={`font-semibold ${isExpired ? 'text-rose-400' : 'text-slate-200'}`}>
                            {formatManilaDateString(user.expiryDate)}
                          </span>
                        </div>
                        <div className="p-2 rounded-xl bg-slate-950/70 border border-slate-800/80">
                          <span className="text-slate-500 block text-[10px]">Days Remaining:</span>
                          <span
                            className={`font-black font-mono ${
                              isExpired
                                ? 'text-rose-400'
                                : (user.daysRemaining ?? 0) <= 5
                                ? 'text-amber-400'
                                : 'text-emerald-400'
                            }`}
                          >
                            {isExpired
                              ? 'Expired'
                              : user.daysRemaining !== undefined
                              ? `${user.daysRemaining} days left`
                              : 'N/A'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Payment Details & Actions */}
                    <div className="flex flex-wrap items-center gap-3 lg:gap-4">
                      {user.referenceNumber ? (
                        <div className="p-2.5 bg-slate-950 border border-slate-800 rounded-xl space-y-1 min-w-[210px]">
                          <div className="flex items-center justify-between text-[10px] text-slate-400">
                            <span className="font-bold uppercase">
                              {user.paymentMethod ? user.paymentMethod.toUpperCase() : 'QR'} Payment
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
                        <div className="text-xs text-slate-500 italic">No payment record</div>
                      )}

                      {/* Approval / Revoke Actions with Double-Click Protection */}
                      <div className="flex items-center gap-2">
                        {isPending ? (
                          <button
                            type="button"
                            onClick={() => handleInitiateApprove(user)}
                            disabled={approvingId === user.id || isApproving}
                            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-black shadow-lg shadow-emerald-600/20 flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer disabled:opacity-50"
                          >
                            {approvingId === user.id ? (
                              <RefreshCw className="w-4 h-4 animate-spin" />
                            ) : (
                              <CheckCircle2 className="w-4 h-4" />
                            )}
                            <span>Approve & Extend PRO</span>
                          </button>
                        ) : isActive ? (
                          <button
                            type="button"
                            onClick={() => handleRevoke(user.id)}
                            disabled={revokingId === user.id}
                            className="px-3 py-1.5 bg-slate-800 hover:bg-red-950 hover:text-red-300 text-slate-400 rounded-xl text-xs font-bold transition-all cursor-pointer disabled:opacity-50"
                          >
                            {revokingId === user.id ? 'Revoking...' : 'Revoke PRO'}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleInitiateApprove(user)}
                            disabled={approvingId === user.id || isApproving}
                            className="px-3 py-1.5 bg-slate-800 hover:bg-emerald-950 hover:text-emerald-300 text-slate-400 rounded-xl text-xs font-bold transition-all cursor-pointer disabled:opacity-50"
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
      </main>

      {/* ======================================================== */}
      {/* APPROVAL CONFIRMATION MODAL WITH EXPIRATION PREVIEW      */}
      {/* ======================================================== */}
      {approvalPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-white">Confirm Subscription Approval</h3>
                  <p className="text-xs text-slate-400">Atomic Payment & Subscription Activation</p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setApprovalPreview(null)}
                disabled={isApproving}
                className="p-1.5 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Rider & Payment Summary */}
            <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-2xl text-xs space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-400">Rider:</span>
                <span className="font-bold text-white">{approvalPreview.userName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Email:</span>
                <span className="font-mono text-slate-300">{approvalPreview.userEmail}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Reference:</span>
                <span className="font-mono text-amber-400 font-bold">
                  {approvalPreview.referenceNumber} ({approvalPreview.paymentMethod.toUpperCase()})
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Renewal Mode:</span>
                <span className="font-semibold text-emerald-400">
                  {approvalPreview.isEarlyRenewal
                    ? 'Early Renewal (Extended from existing expiry)'
                    : 'New / Re-activated Subscription Period'}
                </span>
              </div>
            </div>

            {/* Expiration Calculation Preview */}
            <div className="p-4 rounded-2xl bg-gradient-to-br from-emerald-950/40 via-slate-950 to-slate-950 border border-emerald-900/60 space-y-2">
              <div className="text-xs text-slate-400">Resulting New Expiration Date (Asia/Manila):</div>
              <div className="text-lg font-black text-emerald-400 font-mono">
                {formatManilaDateString(approvalPreview.newExpiryDate)}
              </div>
              <div className="text-[11px] text-slate-400 flex items-center justify-between pt-1 border-t border-slate-800">
                <span>Billing Anchor Day:</span>
                <span className="font-bold text-slate-200">Day {approvalPreview.anchorDay} of each month</span>
              </div>
            </div>

            <div className="flex gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setApprovalPreview(null)}
                disabled={isApproving}
                className="flex-1 py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl transition-all cursor-pointer"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={handleConfirmApproval}
                disabled={isApproving}
                className="flex-1 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs rounded-xl shadow-lg shadow-emerald-600/25 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isApproving ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Committing...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Confirm & Activate</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
