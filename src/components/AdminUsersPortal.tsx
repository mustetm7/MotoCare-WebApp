import React, { useState, useEffect, useCallback, useDeferredValue } from 'react';
import { UserAccountRecord, PaymentSubmissionRecord } from '../types';
import {
  ShieldCheck,
  Search,
  CheckCircle2,
  XCircle,
  Clock,
  Crown,
  Smartphone,
  ArrowLeft,
  Bike,
  Lock,
  DollarSign,
  LogOut,
  Calendar,
  AlertTriangle,
  Database,
  RefreshCw,
} from 'lucide-react';
import { sounds } from '../utils/audio';
import { useAuth } from '../context/AuthContext';
import { auth, OWNER_ADMIN_EMAIL } from '../utils/firebase';
import {
  getOfflineMutationQueue,
  getQuarantinedMutationQueue,
  getCloudSyncOperationLogs,
} from '../utils/storage';
import {
  subscribeToAllPaymentSubmissions,
  fetchReviewedPaymentSubmissionsOnce,
  fetchAdminUsersPage,
  approveProAccessInFirestore,
  grantProAccessInFirestore,
  revokeProAccessInFirestore,
  parseExpiryToDate,
  formatManilaDateTime,
  calculateDaysRemaining,
  reconcileAllUserBikeCounts,
  BikeCountReconciliationReport,
} from '../utils/firestoreService';

/**
 * Pure helper to determine whether a Firestore user document should be counted as an
 * active PAID Pro subscriber in Admin metrics.
 *
 * The verified owner account is NEVER counted as a paying Pro subscriber unless
 * their user document has an actual paid Pro subscription with a valid future `expiryDate`.
 */
export function isCountedAsActivePaidProSubscriber(
  userDoc: Record<string, any> | null | undefined,
  now: Date = new Date()
): boolean {
  if (!userDoc) return false;
  if (userDoc.subscriptionTier !== 'pro') return false;
  if (userDoc.subscriptionStatus === 'revoked') return false;

  const exp = parseExpiryToDate(userDoc.expiryDate);
  if (!exp) return false;

  return exp.getTime() > now.getTime();
}

interface AdminUsersPortalProps {
  users?: UserAccountRecord[];
  onApprovePro?: (userId: string) => void;
  onRevokePro?: (userId: string) => void;
  onAddUser?: (user: Omit<UserAccountRecord, 'id' | 'submittedAt'>) => void;
  onResetUsersToDefault?: () => void;
  onReturnToApp?: () => void;
}

export const AdminUsersPortal: React.FC<AdminUsersPortalProps> = ({
  onReturnToApp = () => {},
}) => {
  const { user: contextUser, signIn, signOut } = useAuth();
  const user = contextUser || auth.currentUser;

  // Strict Zero-Trust Check: Must be authenticated with Google as the verified owner admin
  const isVerifiedAdmin =
    Boolean(user) &&
    user?.email?.toLowerCase() === OWNER_ADMIN_EMAIL &&
    user?.emailVerified === true;

  const [pendingSubmissions, setPendingSubmissions] = useState<PaymentSubmissionRecord[]>([]);
  const [reviewedSubmissions, setReviewedSubmissions] = useState<PaymentSubmissionRecord[]>([]);
  const [firestoreUsers, setFirestoreUsers] = useState<any[]>([]);
  const lastUsersCursorRef = React.useRef<any>(null);
  const [hasMoreUsers, setHasMoreUsers] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadingMoreUsers, setLoadingMoreUsers] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'pending_approval' | 'active_pro' | 'rejected' | 'users'
  >('all');
  const [authError, setAuthError] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Manual "Grant Pro" Modal state
  const [grantTargetUser, setGrantTargetUser] = useState<any | null>(null);
  const [grantMonths, setGrantMonths] = useState<number>(1);
  const [grantNote, setGrantNote] = useState<string>('');
  const [grantMarkAsPaid, setGrantMarkAsPaid] = useState<boolean>(false);
  const [grantSubmitting, setGrantSubmitting] = useState<boolean>(false);
  const [grantModalError, setGrantModalError] = useState<string | null>(null);

  // Bike Counter Reconciliation state
  const [reconciling, setReconciling] = useState(false);
  const [reconciliationReport, setReconciliationReport] =
    useState<BikeCountReconciliationReport | null>(null);

  // Load users on demand with getDocs + limit(100) and startAfter(cursor).
  // Uses lastUsersCursorRef instead of state in useCallback dependencies so updating
  // the pagination cursor never recreates the callback or triggers an infinite useEffect loop.
  const loadUsersOnDemand = useCallback(
    async (reset = true) => {
      if (!isVerifiedAdmin) {
        setLoadingUsers(false);
        setLoadingMoreUsers(false);
        return;
      }
      if (reset) {
        setLoadingUsers(true);
      } else {
        setLoadingMoreUsers(true);
      }
      try {
        const cursor = reset ? null : lastUsersCursorRef.current;
        const page = await fetchAdminUsersPage(100, cursor);
        if (reset) {
          setFirestoreUsers(page.users);
        } else {
          setFirestoreUsers((prev) => {
            const byId = new Map<string, any>();
            for (const existing of prev) {
              const key = String(existing.id || existing.uid || '');
              if (key) byId.set(key, existing);
            }
            for (const incoming of page.users) {
              const key = String(incoming.id || incoming.uid || '');
              if (key) {
                byId.set(key, incoming);
              }
            }
            return Array.from(byId.values());
          });
        }
        lastUsersCursorRef.current = page.lastDoc;
        setHasMoreUsers(page.hasMore);
      } catch (err: any) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn('Admin users on-demand fetch error:', msg);
        setActionError(msg);
      } finally {
        setLoadingUsers(false);
        setLoadingMoreUsers(false);
      }
    },
    [isVerifiedAdmin]
  );

  const loadReviewedSubmissionsOnDemand = useCallback(async () => {
    if (!isVerifiedAdmin) return;
    try {
      const [approved, rejected] = await Promise.all([
        fetchReviewedPaymentSubmissionsOnce('active_pro', 100),
        fetchReviewedPaymentSubmissionsOnce('rejected', 100),
      ]);
      const combined = [...approved, ...rejected].sort(
        (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
      );
      setReviewedSubmissions(combined);
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('Admin reviewed submissions fetch error:', msg);
      setActionError(msg);
    }
  }, [isVerifiedAdmin]);

  const handleRefreshAdminConsole = useCallback(async () => {
    if (!isVerifiedAdmin) {
      setLoadingUsers(false);
      return;
    }
    setLoadingUsers(true);
    setActionError(null);
    try {
      await Promise.all([loadUsersOnDemand(true), loadReviewedSubmissionsOnDemand()]);
    } finally {
      setLoadingUsers(false);
    }
  }, [isVerifiedAdmin, loadUsersOnDemand, loadReviewedSubmissionsOnDemand]);

  // Subscribe only to pending_approval paymentSubmissions in real time, and load initial users page once
  useEffect(() => {
    if (!isVerifiedAdmin) return;

    const unsubSubs = subscribeToAllPaymentSubmissions(
      (subs) => {
        setPendingSubmissions(subs);
      },
      (errMsg) => {
        setActionError(errMsg);
      }
    );

    loadUsersOnDemand(true);
    loadReviewedSubmissionsOnDemand();

    return () => {
      unsubSubs();
    };
  }, [isVerifiedAdmin, loadUsersOnDemand, loadReviewedSubmissionsOnDemand]);

  const handleGoogleAdminLogin = async () => {
    setAuthError(null);
    try {
      const loggedInUser = await signIn();
      if (loggedInUser && loggedInUser.email?.toLowerCase() !== OWNER_ADMIN_EMAIL) {
        setAuthError(
          `Access Denied: "${loggedInUser.email}" is not an authorized MotoCare administrator. Administrator access only.`
        );
      } else if (loggedInUser && !loggedInUser.emailVerified) {
        setAuthError(
          'Access Denied: Your administrator email must be verified by Google.'
        );
      } else {
        sounds.playSuccess();
      }
    } catch (err: any) {
      setAuthError(err?.message || 'Google Sign-In failed or was cancelled.');
    }
  };

  const handleApproveSubmission = async (sub: PaymentSubmissionRecord) => {
    if (!user?.email) return;
    setActionLoadingId(sub.id);
    setActionError(null);
    try {
      await approveProAccessInFirestore(sub.id, sub.userId, user.email);
      sounds.playSuccess();
      await Promise.all([loadUsersOnDemand(true), loadReviewedSubmissionsOnDemand()]);
    } catch (err: any) {
      console.error('Failed to approve Pro access:', err);
      setActionError(err?.message || 'Failed to approve payment submission.');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleRejectSubmission = async (sub: PaymentSubmissionRecord) => {
    if (!user?.email) return;
    setActionLoadingId(sub.id);
    setActionError(null);
    try {
      await revokeProAccessInFirestore(sub.id, sub.userId, user.email);
      sounds.playClick();
      await Promise.all([loadUsersOnDemand(true), loadReviewedSubmissionsOnDemand()]);
    } catch (err: any) {
      console.error('Failed to reject/revoke Pro access:', err);
      setActionError(err?.message || 'Failed to reject or revoke subscription.');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleRevokeUserProDirect = async (targetUser: any) => {
    const targetUserId = targetUser?.id || targetUser?.uid;
    if (!user?.email || !targetUserId) return;
    setActionLoadingId(`user_${targetUserId}`);
    setActionError(null);
    try {
      // Pass null for submissionId so revocation works even for manually granted Pro users
      // who have no paymentSubmission document.
      await revokeProAccessInFirestore(null, targetUserId, user.email);
      sounds.playClick();
      await Promise.all([loadUsersOnDemand(true), loadReviewedSubmissionsOnDemand()]);
    } catch (err: any) {
      console.error('Failed to revoke user Pro access:', err);
      setActionError(err?.message || 'Failed to revoke user Pro subscription.');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleOpenGrantProModal = (targetUser: any) => {
    setGrantTargetUser(targetUser);
    setGrantMonths(1);
    setGrantNote('');
    setGrantMarkAsPaid(false);
    setGrantModalError(null);
  };

  const handleConfirmGrantPro = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetUserId = grantTargetUser?.id || grantTargetUser?.uid;
    if (!user?.email || !targetUserId) return;
    const trimmedNote = grantNote.trim();
    if (!trimmedNote) {
      setGrantModalError('Please enter a required note or reason for granting Pro.');
      return;
    }
    const validMonths =
      Number.isFinite(grantMonths) && grantMonths >= 1 ? Math.min(120, Math.floor(grantMonths)) : 1;

    setGrantSubmitting(true);
    setGrantModalError(null);
    setActionError(null);
    try {
      await grantProAccessInFirestore({
        userId: targetUserId,
        adminEmail: user.email,
        months: validMonths,
        note: trimmedNote,
        markAsPaid: grantMarkAsPaid,
      });
      sounds.playSuccess();
      setGrantTargetUser(null);
      await loadUsersOnDemand(true);
    } catch (err: any) {
      console.error('Failed to manually grant Pro access:', err);
      setGrantModalError(err?.message || 'Failed to grant Pro access.');
    } finally {
      setGrantSubmitting(false);
    }
  };

  const handleRunBikeCountReconciliation = async (dryRun: boolean) => {
    setReconciling(true);
    setActionError(null);
    try {
      const report = await reconcileAllUserBikeCounts(dryRun);
      setReconciliationReport(report);
      sounds.playSuccess();
      if (!dryRun) {
        await loadUsersOnDemand(true);
      }
    } catch (err: any) {
      console.error('Failed to reconcile bike counts:', err);
      setActionError(err?.message || 'Failed to run bike count reconciliation.');
    } finally {
      setReconciling(false);
    }
  };

  const submissions = React.useMemo(() => {
    const byId = new Map<string, PaymentSubmissionRecord>();
    for (const s of pendingSubmissions) byId.set(s.id, s);
    for (const s of reviewedSubmissions) {
      if (!byId.has(s.id)) byId.set(s.id, s);
    }
    return Array.from(byId.values()).sort(
      (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
    );
  }, [pendingSubmissions, reviewedSubmissions]);

  const userProfileMap = React.useMemo(() => {
    const map = new Map<string, any>();
    firestoreUsers.forEach((u) => {
      if (u.id) map.set(u.id, u);
      if (u.uid) map.set(u.uid, u);
    });
    return map;
  }, [firestoreUsers]);

  const pendingCount = pendingSubmissions.length;
  const approvedPaymentsCount = submissions.filter((u) => u.status === 'active_pro').length;
  const manualPaidGrantsRevenuePhp = firestoreUsers.reduce((sum, u) => {
    if (
      u &&
      u.grantPaid === true &&
      u.subscriptionStatus !== 'revoked' &&
      typeof u.grantedPaidAmountPhp === 'number' &&
      u.grantedPaidAmountPhp > 0
    ) {
      return sum + u.grantedPaidAmountPhp;
    }
    return sum;
  }, 0);
  const totalRevenuePhp = approvedPaymentsCount * 49 + manualPaidGrantsRevenuePhp;

  // Count active Pro users based on server expiryDate in `/users`
  const now = new Date();
  const activeProSubscribersCount = firestoreUsers.filter((u) =>
    isCountedAsActivePaidProSubscriber(u, now)
  ).length;

  const filteredSubmissions = submissions.filter((u) => {
    const matchesSearch =
      (u.userName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (u.userEmail || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (u.referenceNumber || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (u.bikeModel || '').toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus = statusFilter === 'all' || u.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // Pre-compute normalized lowercase search keys once per loaded batch to optimize
  // local name/email filtering performance across large user datasets.
  const indexedUsers = React.useMemo(() => {
    return firestoreUsers.map((u) => ({
      raw: u,
      searchName: String(u.displayName || u.name || '').toLowerCase(),
      searchEmail: String(u.email || '').toLowerCase(),
      searchUid: String(u.id || u.uid || '').toLowerCase(),
      searchTier: String(u.subscriptionTier || 'free').toLowerCase(),
      searchNote: String(u.grantNote || '').toLowerCase(),
    }));
  }, [firestoreUsers]);

  const filteredUsers = React.useMemo(() => {
    const q = deferredSearchQuery.trim().toLowerCase();
    if (!q) return firestoreUsers;
    const matched: any[] = [];
    for (let i = 0; i < indexedUsers.length; i++) {
      const item = indexedUsers[i];
      if (
        item.searchName.includes(q) ||
        item.searchEmail.includes(q) ||
        item.searchUid.includes(q) ||
        item.searchTier.includes(q) ||
        item.searchNote.includes(q)
      ) {
        matched.push(item.raw);
      }
    }
    return matched;
  }, [firestoreUsers, indexedUsers, deferredSearchQuery]);

  // ============================================================================
  // ZERO-TRUST GOOGLE AUTHENTICATION GATE (Unauthenticated or Non-Admin User)
  // ============================================================================
  if (!isVerifiedAdmin) {
    return (
      <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-[#070B12] text-white flex flex-col justify-center items-center p-3.5 sm:p-4 selection:bg-[#FF6B00] selection:text-white">
        <div className="w-full max-w-md bg-[#0E1525] border border-slate-800 rounded-3xl p-5 sm:p-8 shadow-2xl space-y-5 sm:space-y-6">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-gradient-to-br from-[#FF6B00] to-amber-500 flex items-center justify-center shadow-lg shadow-orange-500/20 shrink-0">
                <Lock className="w-5 h-5 sm:w-6 sm:h-6 text-slate-950" />
              </div>
              <div className="min-w-0">
                <span className="inline-block text-[10px] font-extrabold uppercase tracking-widest px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  Zero-Trust RBAC
                </span>
                <h1 className="text-lg sm:text-xl font-black text-white mt-1 truncate">
                  MotoCare Admin Portal
                </h1>
              </div>
            </div>
          </div>

          <div className="p-3.5 sm:p-4 rounded-2xl bg-slate-900/90 border border-slate-800/80 text-xs text-slate-300 space-y-1.5">
            <p className="font-bold text-amber-300 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span>Zero Trust Administrator Authentication</span>
            </p>
            <p className="text-slate-400 leading-relaxed">
              Administrator access only. All read and write operations are cryptographically enforced by Cloud Firestore Security Rules.
            </p>
          </div>

          {user && !isVerifiedAdmin && (
            <div className="p-3.5 sm:p-4 rounded-2xl bg-red-500/10 border border-red-500/30 text-xs text-red-300 space-y-2">
              <div className="font-bold text-red-200">Unauthorized Account</div>
              <p className="leading-relaxed">
                You are currently signed in as{' '}
                <span className="font-mono font-bold text-white break-all">{user.email}</span>.
                Administrator access only.
              </p>
              <button
                type="button"
                onClick={signOut}
                className="w-full xs:w-auto justify-center px-3 py-2 rounded-xl bg-red-500/20 hover:bg-red-500/30 text-red-200 font-bold text-[11px] flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5 shrink-0" />
                <span>Sign Out &amp; Switch Account</span>
              </button>
            </div>
          )}

          {authError && (
            <div className="p-3 rounded-xl bg-red-500/15 border border-red-500/30 text-red-300 text-xs font-semibold break-words">
              {authError}
            </div>
          )}

          <button
            type="button"
            onClick={handleGoogleAdminLogin}
            className="w-full py-3.5 px-4 rounded-2xl bg-white hover:bg-slate-100 text-slate-900 font-extrabold text-xs sm:text-sm shadow-lg transition-all flex items-center justify-center gap-2.5 cursor-pointer"
          >
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
            </svg>
            <span>Sign in with Google as Administrator</span>
          </button>

          <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <button
              type="button"
              onClick={onReturnToApp}
              className="hover:text-slate-300 flex items-center gap-1.5 font-semibold transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5 shrink-0" />
              <span>Return to MotoCare App</span>
            </button>
            <span className="font-mono text-[10px]">Firestore RBAC v2</span>
          </div>
        </div>
      </div>
    );
  }

  // ============================================================================
  // VERIFIED ADMIN DASHBOARD
  // ============================================================================
  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-[#070B12] text-white pb-16">
      {/* Top Admin Navbar */}
      <header className="sticky top-0 z-30 bg-[#0B111E]/90 backdrop-blur-xl border-b border-slate-800/80">
        <div className="max-w-5xl mx-auto px-3 sm:px-6 min-h-16 py-2.5 sm:py-0 flex flex-wrap items-center justify-between gap-2.5 sm:gap-3">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br from-[#FF6B00] to-amber-500 flex items-center justify-center shadow-md shadow-orange-500/20 shrink-0">
              <ShieldCheck className="w-5 h-5 text-slate-950" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-black text-sm xs:text-base sm:text-lg tracking-tight text-white truncate">
                  Moto<span className="text-[#FF6B00]">Care</span> Admin Console
                </span>
                <span className="hidden sm:inline-block text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  Owner Portal
                </span>
              </div>
              <p className="text-[10px] sm:text-[11px] text-slate-400 leading-tight truncate max-w-[230px] xs:max-w-[300px] sm:max-w-none">
                Administrator access only • 1-Month Rolling Subscriptions (Asia/Manila)
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 w-full sm:w-auto justify-end">
            <button
              type="button"
              onClick={handleRefreshAdminConsole}
              disabled={loadingUsers}
              className="px-2.5 sm:px-3 py-1.5 min-h-[36px] rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold text-slate-200 flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Refresh Users and Payment Submissions (limit 100)"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 shrink-0 ${loadingUsers ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">{loadingUsers ? 'Refreshing...' : 'Refresh'}</span>
            </button>
            <button
              type="button"
              onClick={() => handleRunBikeCountReconciliation(true)}
              disabled={reconciling}
              className="px-2.5 sm:px-3 py-1.5 min-h-[36px] rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold text-slate-200 flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Audit /users.bikeCount against /motorcycles documents"
            >
              <Database className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="hidden sm:inline">
                {reconciling ? 'Scanning...' : 'Reconcile Counters (Dry Run)'}
              </span>
            </button>
            <button
              type="button"
              onClick={onReturnToApp}
              className="px-2.5 sm:px-3 py-1.5 min-h-[36px] rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold text-slate-200 flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5 shrink-0" />
              <span>App View</span>
            </button>
            <button
              type="button"
              onClick={signOut}
              className="px-2.5 sm:px-3 py-1.5 min-h-[36px] rounded-xl bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-xs font-bold text-red-300 transition-colors cursor-pointer"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-3 sm:px-6 pt-4 sm:pt-6 space-y-5 sm:space-y-6">
        {actionError && (
          <div className="p-3.5 sm:p-4 rounded-2xl bg-red-500/15 border border-red-500/40 text-red-200 text-xs font-bold flex flex-col xs:flex-row items-start xs:items-center justify-between gap-2.5">
            <div className="flex items-start gap-2 min-w-0">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <span className="break-words">{actionError}</span>
            </div>
            <button
              type="button"
              onClick={() => setActionError(null)}
              className="text-red-300 hover:text-white underline text-[11px] shrink-0 self-end xs:self-auto"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Bike Count Reconciliation Audit Banner */}
        {reconciliationReport && (
          <div className="p-3.5 sm:p-4 rounded-2xl bg-slate-900/95 border border-amber-500/40 text-xs space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Database className="w-4 h-4 text-amber-400 shrink-0" />
                <span className="font-black text-white text-xs sm:text-sm">
                  Bike Counter Reconciliation Report ({reconciliationReport.dryRun ? 'DRY RUN' : 'APPLIED'})
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {reconciliationReport.dryRun && reconciliationReport.discrepanciesFound > 0 && (
                  <button
                    type="button"
                    onClick={() => handleRunBikeCountReconciliation(false)}
                    disabled={reconciling}
                    className="px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-black text-xs flex items-center gap-1.5 cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5 shrink-0" />
                    <span>Apply {reconciliationReport.discrepanciesFound} Counter Fix(es)</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setReconciliationReport(null)}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-400 hover:text-white text-[11px] font-bold"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 xs:grid-cols-3 gap-2 text-[11px]">
              <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800">
                <span className="text-slate-400 block">Users Scanned</span>
                <span className="text-base font-black text-white">{reconciliationReport.totalUsersScanned}</span>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800">
                <span className="text-slate-400 block">Discrepancies Found</span>
                <span className="text-base font-black text-amber-400">{reconciliationReport.discrepanciesFound}</span>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800">
                <span className="text-slate-400 block">Users Reconciled</span>
                <span className="text-base font-black text-emerald-400">{reconciliationReport.usersUpdated}</span>
              </div>
            </div>
          </div>
        )}

        {/* KPI Summary Cards */}
        <div className="grid grid-cols-1 xs:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <div className="p-3.5 sm:p-4 rounded-2xl bg-[#0E1525] border border-slate-800/90 min-w-0">
            <div className="flex items-center justify-between text-slate-400 text-xs font-semibold gap-2">
              <span className="truncate">Registered Users</span>
              <Smartphone className="w-4 h-4 text-cyan-400 shrink-0" />
            </div>
            <div className="text-2xl sm:text-3xl font-black text-white mt-1.5 font-mono">
              {firestoreUsers.length}
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              Loaded via on-demand query (limit 100)
            </div>
          </div>

          <div className="p-3.5 sm:p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 min-w-0">
            <div className="flex items-center justify-between text-amber-300 text-xs font-semibold gap-2">
              <span className="truncate">Pending Approval</span>
              <Clock className="w-4 h-4 text-amber-400 shrink-0" />
            </div>
            <div className="text-2xl sm:text-3xl font-black text-amber-300 mt-1.5 font-mono">
              {pendingCount}
            </div>
            <div className="text-[11px] text-amber-200/80 mt-1">
              Awaiting GCash ref check
            </div>
          </div>

          <div className="p-3.5 sm:p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 min-w-0">
            <div className="flex items-center justify-between text-emerald-300 text-xs font-semibold gap-2">
              <span className="truncate">Active Pro Users</span>
              <Crown className="w-4 h-4 text-emerald-400 shrink-0" />
            </div>
            <div className="text-2xl sm:text-3xl font-black text-emerald-300 mt-1.5 font-mono">
              {activeProSubscribersCount}
            </div>
            <div className="text-[11px] text-emerald-200/80 mt-1">
              Unexpired Pro memberships
            </div>
          </div>

          <div className="p-3.5 sm:p-4 rounded-2xl bg-[#FF6B00]/10 border border-[#FF6B00]/30 min-w-0">
            <div className="flex items-center justify-between text-orange-300 text-xs font-semibold gap-2">
              <span className="truncate">Verified Revenue</span>
              <DollarSign className="w-4 h-4 text-[#FF6B00] shrink-0" />
            </div>
            <div className="text-2xl sm:text-3xl font-black text-white mt-1.5 font-mono">
              ₱{totalRevenuePhp.toLocaleString()}
            </div>
            <div className="text-[11px] text-orange-200/80 mt-1">
              {approvedPaymentsCount} approved @ ₱49/mo
              {manualPaidGrantsRevenuePhp > 0 ? ` (+₱${manualPaidGrantsRevenuePhp} paid grants)` : ''}
            </div>
          </div>
        </div>

        {/* Search & Filter Bar */}
        <div className="bg-[#0E1525] border border-slate-800 rounded-2xl p-3 sm:p-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="relative flex-1 min-w-0">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={
                statusFilter === 'users'
                  ? 'Search registered users by name, email, plan (Free/Pro), or grant note...'
                  : 'Search by rider name, email, motorcycle, or GCash reference #...'
              }
              className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700/80 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#FF6B00]"
            />
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1 sm:pb-0 -mx-1 px-1">
            {[
              { id: 'all', label: `All (${submissions.length})` },
              { id: 'pending_approval', label: `Pending (${pendingCount})` },
              { id: 'active_pro', label: `Approved (${approvedPaymentsCount})` },
              { id: 'rejected', label: 'Rejected' },
              { id: 'users', label: `Users (${firestoreUsers.length})` },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id as any)}
                className={`px-3 py-2 min-h-[36px] rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer shrink-0 ${
                  statusFilter === tab.id
                    ? 'bg-[#FF6B00] text-slate-950 font-black shadow-md shadow-orange-500/20'
                    : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {statusFilter === 'users' ? (
          /* Registered Users Tab */
          <div className="space-y-3" data-testid="admin-users-tab-list">
            <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-slate-400">
              <span>
                Showing <strong className="text-white font-mono">{filteredUsers.length}</strong> of{' '}
                <strong className="text-white font-mono">{firestoreUsers.length}</strong> loaded user
                {firestoreUsers.length === 1 ? '' : 's'}
                {searchQuery.trim() ? ` matching "${searchQuery.trim()}"` : ''}
              </span>
              {searchQuery.trim() && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="text-cyan-400 hover:text-cyan-300 font-bold underline cursor-pointer"
                >
                  Clear search filter
                </button>
              )}
            </div>

            {filteredUsers.length === 0 ? (
              <div className="p-8 sm:p-12 rounded-3xl bg-[#0E1525] border border-slate-800 text-center space-y-2">
                <p className="text-sm font-bold text-slate-300">No registered users match your search</p>
                <p className="text-xs text-slate-500">
                  {hasMoreUsers
                    ? 'Try clearing the search query or click "Load more" below to fetch the next batch of 100 users.'
                    : 'Try clearing the search query or click Refresh to reload users from Firestore.'}
                </p>
              </div>
            ) : (
              filteredUsers.map((u) => {
                const uid = u.id || u.uid || '';
                const displayName = u.displayName || u.name || 'MotoCare Rider';
                const email = u.email || 'No email';
                const bikeCount = typeof u.bikeCount === 'number' ? u.bikeCount : 0;
                const rawExpiry = parseExpiryToDate(u.expiryDate);
                const validExpiry = rawExpiry && rawExpiry.getTime() > 0 ? rawExpiry : null;
                const isRevoked = u.subscriptionStatus === 'revoked';
                const isExpired =
                  u.subscriptionTier === 'pro' &&
                  !isRevoked &&
                  validExpiry !== null &&
                  validExpiry.getTime() <= now.getTime();
                const isActivePro =
                  u.subscriptionTier === 'pro' &&
                  !isRevoked &&
                  validExpiry !== null &&
                  validExpiry.getTime() > now.getTime();
                const daysLeft = validExpiry ? calculateDaysRemaining(validExpiry, now) : 0;
                const isBusy = actionLoadingId === `user_${uid}`;

                return (
                  <div
                    key={uid}
                    className={`p-3.5 sm:p-5 rounded-2xl border transition-all overflow-hidden ${
                      isActivePro
                        ? 'bg-[#0E1525] border-emerald-500/30'
                        : 'bg-[#0E1525]/90 border-slate-800'
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 sm:gap-4">
                      <div className="space-y-1.5 min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                          <span className="font-extrabold text-sm sm:text-base text-white break-words">
                            {displayName}
                          </span>
                          <span className="text-xs text-slate-400 font-mono break-all sm:break-normal">
                            {email}
                          </span>

                          {isActivePro ? (
                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1 shrink-0">
                              <Crown className="w-3 h-3" />
                              Pro
                            </span>
                          ) : (
                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-slate-800 text-slate-300 border border-slate-700 shrink-0">
                              Free
                            </span>
                          )}

                          {isExpired && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-red-500/15 text-red-300 border border-red-500/30 shrink-0">
                              Expired
                            </span>
                          )}
                          {isRevoked && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-red-500/15 text-red-300 border border-red-500/30 shrink-0">
                              Revoked
                            </span>
                          )}
                          {u.paymentStatus === 'manual_grant' && isActivePro && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 shrink-0">
                              Manual Grant (Unpaid)
                            </span>
                          )}
                          {u.grantPaid === true && isActivePro && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-amber-500/15 text-amber-300 border border-amber-500/30 shrink-0">
                              Manual Grant (Paid)
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px]">
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md font-mono font-bold bg-slate-800 text-slate-200 border border-slate-700">
                            <Bike className="w-3 h-3 text-[#FF6B00] shrink-0" />
                            <span>Bikes: {bikeCount}</span>
                          </span>

                          <span
                            className={`inline-flex flex-wrap items-center gap-1 px-2.5 py-0.5 rounded-md font-mono font-bold ${
                              validExpiry
                                ? isActivePro
                                  ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
                                  : 'bg-red-500/15 text-red-300 border border-red-500/30'
                                : 'bg-slate-900 text-slate-400 border border-slate-800'
                            }`}
                          >
                            <Calendar className="w-3 h-3 shrink-0" />
                            <span>
                              Expiry (Manila):{' '}
                              {validExpiry
                                ? `${formatManilaDateTime(validExpiry)}${
                                    isActivePro ? ` (${daysLeft}d left)` : ' (EXPIRED)'
                                  }`
                                : isRevoked
                                ? 'Revoked'
                                : '—'}
                            </span>
                          </span>
                        </div>

                        {u.grantedBy && u.grantedAt && (
                          <div className="text-[11px] text-slate-400 pt-0.5 break-words">
                            Granted by <span className="font-mono text-slate-300 break-all">{u.grantedBy}</span> on{' '}
                            <span className="font-mono text-slate-300">
                              {formatManilaDateTime(u.grantedAt)}
                            </span>
                            {u.grantedMonths ? ` (${u.grantedMonths} mo)` : ''}
                            {u.grantNote ? ` • Note: "${u.grantNote}"` : ''}
                          </div>
                        )}
                      </div>

                      {/* User Row Actions */}
                      <div className="w-full sm:w-auto flex flex-wrap sm:flex-nowrap items-center gap-2 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-800/80">
                        {!isActivePro && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleOpenGrantProModal(u)}
                            className="w-full sm:w-auto justify-center min-h-[40px] px-3.5 py-2 rounded-xl bg-gradient-to-r from-[#FF6B00] to-amber-500 hover:from-orange-600 hover:to-amber-600 disabled:opacity-50 text-slate-950 font-black text-xs shadow-md shadow-orange-500/20 flex items-center gap-1.5 transition-all cursor-pointer"
                          >
                            <Crown className="w-3.5 h-3.5 shrink-0" />
                            <span>Grant Pro</span>
                          </button>
                        )}

                        {isActivePro && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleRevokeUserProDirect(u)}
                            className="w-full sm:w-auto justify-center min-h-[40px] px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-red-500/20 border border-slate-700 hover:border-red-500/30 text-slate-300 hover:text-red-300 font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer"
                            title="Immediately revoke this user's Pro subscription"
                          >
                            <XCircle className="w-3.5 h-3.5 shrink-0" />
                            <span>{isBusy ? 'Revoking...' : 'Revoke User Pro'}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}

            {/* Cursor-based "Load more" pagination inside Users tab */}
            {hasMoreUsers && (
              <div className="pt-2 text-center">
                <button
                  type="button"
                  data-testid="admin-load-more-users-btn"
                  disabled={loadingUsers || loadingMoreUsers}
                  onClick={() => loadUsersOnDemand(false)}
                  className="w-full xs:w-auto px-5 py-2.5 min-h-[40px] rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 border border-slate-700 text-xs font-bold text-slate-200 transition-colors cursor-pointer"
                >
                  {loadingMoreUsers || loadingUsers
                    ? 'Loading more users...'
                    : 'Load more (Next 100)'}
                </button>
              </div>
            )}
          </div>
        ) : (
          /* Payment Submissions Queue */
          <>
            <div className="space-y-3">
              {filteredSubmissions.length === 0 ? (
                <div className="p-8 sm:p-12 rounded-3xl bg-[#0E1525] border border-slate-800 text-center space-y-2">
                  <p className="text-sm font-bold text-slate-300">No payment submissions match your filter</p>
                  <p className="text-xs text-slate-500">
                    When riders submit a GCash reference number from the app, it will appear here in real time.
                  </p>
                </div>
              ) : (
                filteredSubmissions.map((record) => {
                  const linkedUser = userProfileMap.get(record.userId);
                  const isUserRevoked = linkedUser?.subscriptionStatus === 'revoked';
                  const isPending = record.status === 'pending_approval';
                  const isPro = record.status === 'active_pro' && !isUserRevoked;
                  const isRejected = record.status === 'rejected' || isUserRevoked;
                  const isBusy = actionLoadingId === record.id;

                  const rawExpiryDate = parseExpiryToDate(linkedUser?.expiryDate);
                  const userExpiryDate =
                    rawExpiryDate && rawExpiryDate.getTime() > 0 ? rawExpiryDate : null;
                  const userDaysLeft = calculateDaysRemaining(userExpiryDate, now);
                  const isUserExpired =
                    linkedUser?.subscriptionTier === 'pro' &&
                    userExpiryDate !== null &&
                    userExpiryDate.getTime() <= now.getTime();

                  return (
                    <div
                      key={record.id}
                      className={`p-3.5 sm:p-5 rounded-2xl border transition-all overflow-hidden ${
                        isPending
                          ? 'bg-gradient-to-r from-amber-500/10 via-[#0E1525] to-[#0E1525] border-amber-500/40 shadow-lg shadow-amber-500/5'
                          : isPro
                          ? 'bg-[#0E1525] border-emerald-500/30'
                          : 'bg-[#0E1525]/90 border-slate-800'
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 sm:gap-4">
                        <div className="space-y-1.5 min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                            <span className="font-extrabold text-sm sm:text-base text-white break-words">
                              {record.userName}
                            </span>
                            <span className="text-xs text-slate-400 font-mono break-all sm:break-normal">
                              {record.userEmail}
                            </span>

                            {isPending && (
                              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-1 shrink-0">
                                <Clock className="w-3 h-3" />
                                Pending Verification
                              </span>
                            )}
                            {isPro && (
                              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1 shrink-0">
                                <CheckCircle2 className="w-3 h-3" />
                                Approved (+1 Month)
                              </span>
                            )}
                            {isRejected && (
                              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-red-500/20 text-red-300 border border-red-500/40 flex items-center gap-1 shrink-0">
                                <XCircle className="w-3 h-3" />
                                Rejected
                              </span>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-x-3 sm:gap-x-4 gap-y-1.5 text-xs text-slate-300">
                            <span className="flex flex-wrap items-center gap-1.5 text-slate-400">
                              <Bike className="w-3.5 h-3.5 text-[#FF6B00] shrink-0" />
                              <strong className="text-slate-200">{record.bikeModel}</strong>
                              {record.bikePlate && (
                                <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                                  {record.bikePlate}
                                </span>
                              )}
                            </span>

                            {record.paymentMethod && (
                              <span className="text-xs">
                                Via:{' '}
                                <strong className="uppercase text-cyan-300">
                                  {record.paymentMethod}
                                </strong>
                              </span>
                            )}

                            {record.referenceNumber && (
                              <span className="font-mono text-xs bg-slate-900 px-2.5 py-0.5 rounded-lg border border-slate-700 text-amber-300 font-bold break-all sm:break-normal">
                                Ref: {record.referenceNumber}
                              </span>
                            )}

                            {record.amountPhp && (
                              <span className="font-mono text-xs font-bold text-emerald-400">
                                ₱{record.amountPhp}
                              </span>
                            )}
                          </div>

                          {userExpiryDate && (
                            <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px]">
                              <span
                                className={`inline-flex flex-wrap items-center gap-1 px-2 py-0.5 rounded-md font-mono font-bold ${
                                  isUserExpired
                                    ? 'bg-red-500/15 text-red-300 border border-red-500/30'
                                    : 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
                                }`}
                              >
                                <Calendar className="w-3 h-3 shrink-0" />
                                <span>
                                  Expires: {formatManilaDateTime(userExpiryDate)}
                                  {!isUserExpired && ` (${userDaysLeft}d remaining)`}
                                  {isUserExpired && ' (EXPIRED)'}
                                </span>
                              </span>
                              {typeof linkedUser?.bikeCount === 'number' && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-mono font-bold bg-slate-800 text-slate-300">
                                  Bikes: {linkedUser.bikeCount}
                                </span>
                              )}
                            </div>
                          )}

                          <div className="text-[11px] text-slate-500 break-words">
                            Submitted: {formatManilaDateTime(record.submittedAt)}
                            {record.reviewedAt &&
                              ` • Reviewed: ${formatManilaDateTime(record.reviewedAt)}`}
                          </div>
                        </div>

                        {/* Admin Action Buttons */}
                        <div className="w-full sm:w-auto flex flex-wrap sm:flex-nowrap items-center gap-2 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-800/80">
                          {isPending && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleApproveSubmission(record)}
                              className="flex-1 sm:flex-initial justify-center min-h-[40px] px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 disabled:opacity-50 text-slate-950 font-black text-xs shadow-lg shadow-emerald-500/20 flex items-center gap-1.5 transition-all cursor-pointer"
                            >
                              <CheckCircle2 className="w-4 h-4 shrink-0" />
                              <span>{isBusy ? 'Approving...' : 'Approve (+1 Month)'}</span>
                            </button>
                          )}

                          {isPending && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleRejectSubmission(record)}
                              className="flex-1 sm:flex-initial justify-center min-h-[40px] px-3.5 py-2.5 rounded-xl bg-red-500/15 hover:bg-red-500/25 disabled:opacity-50 border border-red-500/30 text-red-300 font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer"
                            >
                              <XCircle className="w-4 h-4 shrink-0" />
                              <span>Reject</span>
                            </button>
                          )}

                          {isPro && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleRejectSubmission(record)}
                              className="w-full sm:w-auto justify-center min-h-[40px] px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-red-500/20 border border-slate-700 hover:border-red-500/30 text-slate-300 hover:text-red-300 font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer"
                              title="Immediately revoke this user's Pro subscription"
                            >
                              <XCircle className="w-3.5 h-3.5 shrink-0" />
                              <span>Revoke User Pro</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Pagination button for loading more users on demand */}
            {hasMoreUsers && (
              <div className="pt-2 text-center">
                <button
                  type="button"
                  disabled={loadingUsers}
                  onClick={() => loadUsersOnDemand(false)}
                  className="w-full xs:w-auto px-4 py-2 min-h-[40px] rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold text-slate-200 transition-colors cursor-pointer"
                >
                  {loadingUsers ? 'Loading...' : 'Load More Users (Next 100)'}
                </button>
              </div>
            )}
          </>
        )}

        {/* Manual Grant Pro Modal */}
        {grantTargetUser && (
          <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-3.5 sm:p-4">
            <div className="w-full max-w-md max-h-[92vh] overflow-y-auto rounded-3xl bg-[#0E1525] border border-slate-700 p-4 sm:p-6 shadow-2xl space-y-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#FF6B00] to-amber-500 flex items-center justify-center shrink-0">
                    <Crown className="w-5 h-5 text-slate-950" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-base font-black text-white">Grant Pro Access</h3>
                    <p className="text-xs text-slate-400 font-mono truncate">
                      {grantTargetUser.email || grantTargetUser.displayName || grantTargetUser.id}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setGrantTargetUser(null)}
                  className="text-xs text-slate-400 hover:text-white font-bold shrink-0 px-2 py-1"
                >
                  Cancel
                </button>
              </div>

              <form onSubmit={handleConfirmGrantPro} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1.5">
                    Number of Months (Asia/Manila Calendar Months)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={120}
                    value={grantMonths}
                    onChange={(e) => setGrantMonths(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-sm text-white font-mono focus:outline-none focus:border-[#FF6B00]"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">
                    Expires on the same calendar day at 11:59:59 PM Manila time (clamped to month end if needed).
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1.5">
                    Note / Reason <span className="text-red-400">*</span>
                  </label>
                  <textarea
                    rows={3}
                    required
                    value={grantNote}
                    onChange={(e) => setGrantNote(e.target.value)}
                    placeholder="e.g., Beta tester reward, direct cash payment, promo giveaway..."
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#FF6B00]"
                  />
                </div>

                <label className="flex items-start gap-2.5 p-3 rounded-xl bg-slate-900/90 border border-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={grantMarkAsPaid}
                    onChange={(e) => setGrantMarkAsPaid(e.target.checked)}
                    className="mt-0.5 rounded border-slate-600 text-[#FF6B00] focus:ring-[#FF6B00] shrink-0"
                  />
                  <div className="text-xs min-w-0">
                    <span className="font-bold text-white block">
                      Mark as paid (+₱{(Math.max(1, grantMonths || 1) * 49).toLocaleString()} to Verified Revenue)
                    </span>
                    <span className="text-slate-400 text-[11px]">
                      Leave unchecked for complimentary grants so Verified Revenue is not affected.
                    </span>
                  </div>
                </label>

                {grantModalError && (
                  <div className="p-3 rounded-xl bg-red-500/15 border border-red-500/30 text-red-300 text-xs font-bold break-words">
                    {grantModalError}
                  </div>
                )}

                <div className="flex flex-col-reverse xs:flex-row items-stretch xs:items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    disabled={grantSubmitting}
                    onClick={() => setGrantTargetUser(null)}
                    className="px-4 py-2.5 min-h-[40px] rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-300 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={grantSubmitting}
                    className="px-4 py-2.5 min-h-[40px] rounded-xl bg-gradient-to-r from-[#FF6B00] to-amber-500 hover:from-orange-600 hover:to-amber-600 disabled:opacity-50 text-slate-950 font-black text-xs shadow-lg shadow-orange-500/20 cursor-pointer"
                  >
                    {grantSubmitting ? 'Granting Pro...' : `Confirm Grant (${grantMonths} Mo)`}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Cloud Sync Diagnostic Panel (Write Queue Size, Last 5 Success/Failed Logs, Quarantined Mutations) */}
        {user?.uid && (() => {
          const writeQueue = getOfflineMutationQueue(user.uid);
          const quarantinedQueue = getQuarantinedMutationQueue(user.uid);
          const syncLogs = getCloudSyncOperationLogs(user.uid);

          return (
            <div
              data-testid="admin-cloud-sync-diagnostic-panel"
              className="p-3.5 sm:p-5 rounded-2xl bg-[#0E1525] border border-slate-800 space-y-4 overflow-hidden"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Database className="w-4 h-4 text-cyan-400 shrink-0" />
                  <h3 className="text-xs sm:text-sm font-extrabold text-white">
                    Cloud Sync Diagnostics &amp; Write Queue
                  </h3>
                </div>
                <span
                  data-testid="firestore-write-queue-size-badge"
                  className="px-2.5 py-1 rounded-full text-[11px] font-mono font-bold bg-slate-900 border border-slate-700 text-cyan-300"
                >
                  Write Queue Size: {writeQueue.length}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div
                  data-testid="sync-logs-successful-column"
                  className="p-3 rounded-xl bg-slate-900/90 border border-emerald-500/20 space-y-2 min-w-0 overflow-hidden"
                >
                  <div className="flex items-center justify-between font-bold text-emerald-400 gap-2">
                    <span className="truncate">Last 5 Successful Syncs</span>
                    <span className="font-mono text-[11px] shrink-0">
                      {syncLogs.last5Successful.length} / 5
                    </span>
                  </div>
                  {syncLogs.last5Successful.length === 0 ? (
                    <p className="text-[11px] text-slate-500">No recent successful sync logs.</p>
                  ) : (
                    <ul className="space-y-1 text-[11px] text-slate-300 font-mono">
                      {syncLogs.last5Successful.map((log) => (
                        <li key={log.id} className="truncate">
                          ✓ {log.operation} ({log.targetId}) {log.detail ? `— ${log.detail}` : ''}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div
                  data-testid="sync-logs-failed-column"
                  className="p-3 rounded-xl bg-slate-900/90 border border-red-500/20 space-y-2 min-w-0 overflow-hidden"
                >
                  <div className="flex items-center justify-between font-bold text-red-400 gap-2">
                    <span className="truncate">Last 5 Failed Syncs</span>
                    <span className="font-mono text-[11px] shrink-0">
                      {syncLogs.last5Failed.length} / 5
                    </span>
                  </div>
                  {syncLogs.last5Failed.length === 0 ? (
                    <p className="text-[11px] text-slate-500">No recent failed sync logs.</p>
                  ) : (
                    <ul className="space-y-1 text-[11px] text-red-300 font-mono">
                      {syncLogs.last5Failed.map((log) => (
                        <li key={log.id} className="truncate">
                          ✕ {log.operation} ({log.targetId}) — {log.errorMessage}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              <div
                data-testid="quarantined-mutations-section"
                className="p-3 rounded-xl bg-slate-900/90 border border-amber-500/25 space-y-2 text-xs min-w-0 overflow-hidden"
              >
                <div className="flex items-center justify-between font-bold text-amber-300 gap-2">
                  <span className="truncate">Quarantined Offline Mutations</span>
                  <span className="font-mono text-[11px] shrink-0">{quarantinedQueue.length} item(s)</span>
                </div>
                {quarantinedQueue.length === 0 ? (
                  <p className="text-[11px] text-slate-500">No quarantined mutations.</p>
                ) : (
                  <ul className="space-y-1.5 text-[11px] text-slate-200 font-mono">
                    {quarantinedQueue.map((q) => (
                      <li
                        key={q.id}
                        className="p-2 rounded-lg bg-slate-950 border border-slate-800 space-y-0.5 break-words"
                      >
                        <div>
                          [{q.failureClassification}] {q.entity}:{q.targetId} ({q.action})
                        </div>
                        {q.failureClassification === 'version_conflict' && (
                          <div className="text-amber-300">
                            Version Conflict: Base={String(q.baseCloudUpdatedAt ?? 'none')} | Conflict:{' '}
                            {String(q.conflictCloudUpdatedAt ?? 'unknown')} — {q.conflictReason}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          );
        })()}
      </main>
    </div>
  );
};
