import React, { useState } from 'react';
import {
  UserAccount,
  AccountPaymentStatus,
  DashboardSubscriptionStatus,
  OfflineMutationItem,
  QuarantinedMutationItem,
  CloudSyncLogEntry,
} from '../types';
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
  Activity,
  Database,
  Bell,
  History,
} from 'lucide-react';
import { sounds } from '../utils/audio';
import confetti from 'canvas-confetti';
import { auth, db, signInWithGoogle, logOut } from '../utils/firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';
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
  generateCounterReconciliationDryRun,
  executeCounterReconciliation,
  generateTimestampMigrationDryRun,
  executeTimestampMigration,
  flushOfflineMutationQueue,
  recoverQuarantinedMutationSafely,
  CounterReconciliationReport,
  TimestampMigrationReport,
  PaymentSubmission,
} from '../utils/firestoreService';
import {
  getOfflineMutationQueue,
  getQuarantinedMutationQueue,
  removeQuarantinedMutation,
  getCloudSyncOperationLogs,
  clearCloudSyncOperationLogs,
} from '../utils/storage';
import {
  isProExpiredWithinLast7Days,
  getRecentlyExpiredProUsers,
  triggerRenewalReminderNotification,
  triggerRecentExpiryRenewalReminders,
  RenewalReminderResult,
} from '../utils/subscription';

interface AdminUsersPortalProps {
  users: UserAccount[];
  onApprovePro: (userId: string) => void;
  onRevokePro: (userId: string) => void;
  onAddUser: (user: Omit<UserAccount, 'id' | 'registeredAt'>) => void;
  onResetUsersToDefault: () => void;
  onReturnToApp?: () => void;
}

/**
 * Determines whether a Firestore user record represents an active paying Pro subscriber
 * for Admin Portal metrics (activeProUsers and totalRevenue).
 * Requires:
 * - subscriptionTier === 'pro'
 * - subscriptionStatus !== 'revoked' and !== 'expired' and !== 'free'
 * - a valid, parseable expiryDate strictly in the future (expiry > now)
 *
 * The owner account (mustetm7@gmail.com) is NEVER counted as a paying Pro subscriber
 * unless an actual paid Pro subscription with a future expiryDate exists.
 */
export function isCountedAsActivePaidProSubscriber(
  fUser: {
    subscriptionTier?: string;
    subscriptionStatus?: string;
    expiryDate?: unknown;
  },
  now: Date = new Date()
): boolean {
  const isStoredPro = fUser.subscriptionTier === 'pro';
  const rawStatus = fUser.subscriptionStatus || 'free';
  if (!isStoredPro || rawStatus === 'revoked' || rawStatus === 'expired' || rawStatus === 'free') {
    return false;
  }
  const expiry = parseExpiryToDate(fUser.expiryDate);
  return expiry !== null && expiry.getTime() > now.getTime();
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

export interface CounterHealthUserItem {
  userId: string;
  email: string;
  displayName: string;
  storedBikeCount: number;
  calculatedDocCount: number;
  delta: number;
  needsCorrection: boolean;
}

export interface CounterHealthSummaryReport {
  totalUsers: number;
  totalMotorcycleDocs: number;
  matchingCount: number;
  discrepancyCount: number;
  items: CounterHealthUserItem[];
  inspectedAt: string;
}

/**
 * Dry-run utility function in AdminUsersPortal.tsx:
 * Fetches all users, compares their current document count against their stored bikeCount,
 * and returns a summary report object without performing any writes.
 */
export async function runCounterDryRunHealthAudit(): Promise<CounterHealthSummaryReport> {
  const usersSnap = await getDocs(collection(db, 'users'));
  const items: CounterHealthUserItem[] = [];
  let totalMotorcycleDocs = 0;
  let matchingCount = 0;
  let discrepancyCount = 0;

  for (const userDoc of usersSnap.docs) {
    const userData = userDoc.data();
    const storedCount = typeof userData.bikeCount === 'number' ? userData.bikeCount : 0;

    const bikesQuery = query(collection(db, 'motorcycles'), where('userId', '==', userDoc.id));
    const bikesSnap = await getDocs(bikesQuery);
    const calculatedDocCount = bikesSnap.size;
    totalMotorcycleDocs += calculatedDocCount;

    const delta = calculatedDocCount - storedCount;
    const needsCorrection = delta !== 0;

    if (needsCorrection) {
      discrepancyCount++;
    } else {
      matchingCount++;
    }

    items.push({
      userId: userDoc.id,
      email: userData.email || 'No email',
      displayName: userData.displayName || userData.name || 'Rider',
      storedBikeCount: storedCount,
      calculatedDocCount,
      delta,
      needsCorrection,
    });
  }

  return {
    totalUsers: usersSnap.size,
    totalMotorcycleDocs,
    matchingCount,
    discrepancyCount,
    items,
    inspectedAt: new Date().toISOString(),
  };
}

export interface ExpiryDateDiagnosticItem {
  userId: string;
  email: string;
  displayName: string;
  subscriptionTier: string;
  currentFormat: 'ISO_8601_STRING' | 'FIRESTORE_TIMESTAMP' | 'EPOCH_NUMBER' | 'NONE_OR_FREE';
  rawValue: string;
  isIso8601String: boolean;
  needsConversion: boolean;
  equivalentTimestampPreview: {
    seconds: number;
    nanoseconds: number;
    isoDateString: string;
    formattedManila: string;
  } | null;
}

export interface ExpiryDateDiagnosticReport {
  totalUsers: number;
  iso8601Count: number;
  nativeTimestampCount: number;
  epochNumberCount: number;
  noneOrFreeCount: number;
  items: ExpiryDateDiagnosticItem[];
  inspectedAt: string;
}

/**
 * Diagnostic view utility in AdminUsersPortal.tsx:
 * Iterates through all user documents, checks for the presence of an ISO 8601 string
 * in the expiryDate field, and flags those needing conversion to Firestore Timestamps.
 * Previews the equivalent Timestamp conversion without applying it to production data.
 */
export async function runExpiryDateDiagnosticAudit(): Promise<ExpiryDateDiagnosticReport> {
  const usersSnap = await getDocs(collection(db, 'users'));
  const items: ExpiryDateDiagnosticItem[] = [];
  let iso8601Count = 0;
  let nativeTimestampCount = 0;
  let epochNumberCount = 0;
  let noneOrFreeCount = 0;

  for (const userDoc of usersSnap.docs) {
    const data = userDoc.data();
    const rawVal = data.expiryDate;
    let currentFormat: 'ISO_8601_STRING' | 'FIRESTORE_TIMESTAMP' | 'EPOCH_NUMBER' | 'NONE_OR_FREE' = 'NONE_OR_FREE';
    let rawValue = 'None / Free';
    let isIso8601String = false;
    let needsConversion = false;
    let equivalentTimestampPreview: {
      seconds: number;
      nanoseconds: number;
      isoDateString: string;
      formattedManila: string;
    } | null = null;

    if (!rawVal) {
      currentFormat = 'NONE_OR_FREE';
      noneOrFreeCount++;
    } else if (typeof (rawVal as any)?.toDate === 'function' || ('seconds' in rawVal && 'nanoseconds' in rawVal)) {
      currentFormat = 'FIRESTORE_TIMESTAMP';
      nativeTimestampCount++;
      const seconds = (rawVal as any).seconds ?? 0;
      const nanoseconds = (rawVal as any).nanoseconds ?? 0;
      const d = typeof (rawVal as any)?.toDate === 'function' ? (rawVal as any).toDate() : new Date(seconds * 1000);
      rawValue = `Timestamp(seconds=${seconds}, nanos=${nanoseconds})`;
      equivalentTimestampPreview = {
        seconds,
        nanoseconds,
        isoDateString: d.toISOString(),
        formattedManila: formatManilaDateString(d),
      };
    } else if (typeof rawVal === 'string') {
      currentFormat = 'ISO_8601_STRING';
      isIso8601String = true;
      rawValue = rawVal;
      const d = new Date(rawVal);
      if (!isNaN(d.getTime())) {
        iso8601Count++;
        needsConversion = true;
        const seconds = Math.floor(d.getTime() / 1000);
        const nanoseconds = (d.getTime() % 1000) * 1_000_000;
        equivalentTimestampPreview = {
          seconds,
          nanoseconds,
          isoDateString: d.toISOString(),
          formattedManila: formatManilaDateString(d),
        };
      }
    } else if (typeof rawVal === 'number') {
      currentFormat = 'EPOCH_NUMBER';
      epochNumberCount++;
      rawValue = String(rawVal);
      const d = new Date(rawVal);
      if (!isNaN(d.getTime())) {
        needsConversion = true;
        const seconds = Math.floor(d.getTime() / 1000);
        const nanoseconds = (d.getTime() % 1000) * 1_000_000;
        equivalentTimestampPreview = {
          seconds,
          nanoseconds,
          isoDateString: d.toISOString(),
          formattedManila: formatManilaDateString(d),
        };
      }
    }

    items.push({
      userId: userDoc.id,
      email: data.email || 'No email',
      displayName: data.displayName || data.name || 'Rider',
      subscriptionTier: data.subscriptionTier || 'free',
      currentFormat,
      rawValue,
      isIso8601String,
      needsConversion,
      equivalentTimestampPreview,
    });
  }

  return {
    totalUsers: usersSnap.size,
    iso8601Count,
    nativeTimestampCount,
    epochNumberCount,
    noneOrFreeCount,
    items,
    inspectedAt: new Date().toISOString(),
  };
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

  const [approvalPreview, setApprovalPreview] = useState<ApprovalPreview | null>(null);
  const [isApproving, setIsApproving] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  // Counter Reconciliation Dry Run & Execution State
  const [counterReport, setCounterReport] = useState<CounterReconciliationReport | null>(null);
  const [showCounterModal, setShowCounterModal] = useState(false);
  const [isInspectingCounters, setIsInspectingCounters] = useState(false);
  const [isExecutingCounters, setIsExecutingCounters] = useState(false);
  const [confirmExecuteCounters, setConfirmExecuteCounters] = useState(false);

  // Timestamp Migration Dry Run & Execution State
  const [timestampReport, setTimestampReport] = useState<TimestampMigrationReport | null>(null);
  const [showTimestampModal, setShowTimestampModal] = useState(false);
  const [isInspectingTimestamps, setIsInspectingTimestamps] = useState(false);
  const [isExecutingTimestamps, setIsExecutingTimestamps] = useState(false);
  const [confirmExecuteTimestamps, setConfirmExecuteTimestamps] = useState(false);
  const [portalToast, setPortalToast] = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(null);

  // Admin Navigation: 'directory' for rider subscriptions list, 'payment_history' for audit trail, 'system_health' for System Health section
  const [activeAdminTab, setActiveAdminTab] = useState<'directory' | 'payment_history' | 'system_health'>('directory');
  const [paymentHistoryFilter, setPaymentHistoryFilter] = useState<'all' | 'approved' | 'rejected'>('all');
  const [paymentHistorySearch, setPaymentHistorySearch] = useState('');
  const [sentRenewalReminders, setSentRenewalReminders] = useState<Record<string, RenewalReminderResult>>({});
  const [healthCounterReport, setHealthCounterReport] = useState<CounterHealthSummaryReport | null>(null);
  const [healthExpiryReport, setHealthExpiryReport] = useState<ExpiryDateDiagnosticReport | null>(null);
  const [isLoadingHealth, setIsLoadingHealth] = useState(false);
  const [healthFilter, setHealthFilter] = useState<'all' | 'flagged'>('all');

  // Cloud Sync Queue & Operation Telemetry State for Current User
  const currentDiagnosticUserId = auth.currentUser?.uid || '';
  const [syncDiagQueue, setSyncDiagQueue] = useState<OfflineMutationItem[]>(() =>
    getOfflineMutationQueue(auth.currentUser?.uid || '')
  );
  const [syncDiagQuarantined, setSyncDiagQuarantined] = useState<QuarantinedMutationItem[]>(() =>
    getQuarantinedMutationQueue(auth.currentUser?.uid || '')
  );
  const [syncDiagLogs, setSyncDiagLogs] = useState<{
    allLogs: CloudSyncLogEntry[];
    last5Successful: CloudSyncLogEntry[];
    last5Failed: CloudSyncLogEntry[];
  }>(() => getCloudSyncOperationLogs(auth.currentUser?.uid || ''));
  const [isFlushingDiagQueue, setIsFlushingDiagQueue] = useState(false);

  const refreshCloudSyncDiagnostics = React.useCallback(() => {
    const uid = auth.currentUser?.uid || '';
    setSyncDiagQueue(getOfflineMutationQueue(uid));
    setSyncDiagQuarantined(getQuarantinedMutationQueue(uid));
    setSyncDiagLogs(getCloudSyncOperationLogs(uid));
  }, []);

  React.useEffect(() => {
    refreshCloudSyncDiagnostics();
  }, [isAuthenticated, activeAdminTab, refreshCloudSyncDiagnostics]);

  const handleFlushDiagnosticQueue = async () => {
    const uid = auth.currentUser?.uid || '';
    if (!uid) return;
    setIsFlushingDiagQueue(true);
    try {
      const res = await flushOfflineMutationQueue(uid);
      refreshCloudSyncDiagnostics();
      if (res.skippedOffline) {
        setPortalToast({
          msg: 'Flush skipped: Device is currently offline. Queued mutations are preserved without incrementing retry counts.',
          type: 'info',
        });
      } else {
        setPortalToast({
          msg: `Queue replay finished: ${res.flushedCount} flushed, ${res.failedCount} failed, ${res.quarantinedCount} quarantined.`,
          type: res.failedCount > 0 ? 'info' : 'success',
        });
      }
    } catch (err: any) {
      refreshCloudSyncDiagnostics();
      setPortalToast({
        msg: `Queue replay error: ${err?.message || 'Unknown error'}`,
        type: 'error',
      });
    } finally {
      setIsFlushingDiagQueue(false);
    }
  };

  const handleRecoverQuarantinedMutation = async (mutationId: string) => {
    const uid = auth.currentUser?.uid || '';
    if (!uid) return;
    const result = await recoverQuarantinedMutationSafely(uid, mutationId);
    refreshCloudSyncDiagnostics();
    setPortalToast({
      msg: result.detail,
      type: result.status === 'requeued' ? 'success' : 'info',
    });
  };

  const handleDismissQuarantinedMutation = (mutationId: string) => {
    const uid = auth.currentUser?.uid || '';
    if (!uid) return;
    removeQuarantinedMutation(uid, mutationId);
    refreshCloudSyncDiagnostics();
  };

  const handleClearDiagnosticLogs = () => {
    const uid = auth.currentUser?.uid || '';
    if (!uid) return;
    clearCloudSyncOperationLogs(uid);
    refreshCloudSyncDiagnostics();
  };

  const handleRunSystemHealthAudit = async () => {
    setIsLoadingHealth(true);
    sounds.playClick();
    try {
      const [cReport, eReport] = await Promise.all([
        runCounterDryRunHealthAudit(),
        runExpiryDateDiagnosticAudit(),
      ]);
      setHealthCounterReport(cReport);
      setHealthExpiryReport(eReport);
      sounds.playSuccess();
      setPortalToast({
        msg: `System Health dry-run complete: ${cReport.discrepancyCount} counter discrepancies, ${eReport.iso8601Count} ISO-8601 strings flagged. 0 database writes executed.`,
        type: (cReport.discrepancyCount > 0 || eReport.iso8601Count > 0) ? 'info' : 'success',
      });
    } catch (err: any) {
      console.error('System health audit failed:', err);
      setPortalToast({ msg: 'Health audit failed: ' + (err?.message || 'Check permissions'), type: 'error' });
    } finally {
      setIsLoadingHealth(false);
    }
  };

  const handleOpenCounterDryRun = async () => {
    setIsInspectingCounters(true);
    sounds.playClick();
    try {
      const report = await generateCounterReconciliationDryRun();
      setCounterReport(report);
      setConfirmExecuteCounters(false);
      setShowCounterModal(true);
      sounds.playSuccess();
    } catch (err: any) {
      console.error('Failed to generate counter dry run:', err);
      setPortalToast({ msg: 'Counter inspection failed: ' + (err?.message || 'Check permissions'), type: 'error' });
    } finally {
      setIsInspectingCounters(false);
    }
  };

  const handleExecuteConfirmedCounterReconciliation = async () => {
    if (!counterReport) return;
    setIsExecutingCounters(true);
    sounds.playClick();
    try {
      const res = await executeCounterReconciliation(counterReport.items);
      sounds.playSuccess();
      setPortalToast({
        msg: `Reconciliation committed: ${res.successCount} users corrected, ${res.failedCount} failures.`,
        type: res.failedCount > 0 ? 'info' : 'success',
      });
      setShowCounterModal(false);
      setConfirmExecuteCounters(false);
    } catch (err: any) {
      console.error('Failed to execute reconciliation:', err);
      setPortalToast({ msg: 'Reconciliation error: ' + (err?.message || 'Unknown error'), type: 'error' });
    } finally {
      setIsExecutingCounters(false);
    }
  };

  const handleOpenTimestampDryRun = async () => {
    setIsInspectingTimestamps(true);
    sounds.playClick();
    try {
      const report = await generateTimestampMigrationDryRun();
      setTimestampReport(report);
      setConfirmExecuteTimestamps(false);
      setShowTimestampModal(true);
      sounds.playSuccess();
    } catch (err: any) {
      console.error('Failed to generate timestamp dry run:', err);
      setPortalToast({ msg: 'Timestamp inspection failed: ' + (err?.message || 'Check permissions'), type: 'error' });
    } finally {
      setIsInspectingTimestamps(false);
    }
  };

  const handleExecuteConfirmedTimestampMigration = async () => {
    if (!timestampReport) return;
    setIsExecutingTimestamps(true);
    sounds.playClick();
    try {
      const res = await executeTimestampMigration(timestampReport.items);
      sounds.playSuccess();
      setPortalToast({
        msg: `Timestamp migration committed: ${res.successCount} converted to native Timestamp, ${res.failedCount} failures.`,
        type: res.failedCount > 0 ? 'info' : 'success',
      });
      setShowTimestampModal(false);
      setConfirmExecuteTimestamps(false);
    } catch (err: any) {
      console.error('Failed to execute timestamp migration:', err);
      setPortalToast({ msg: 'Migration error: ' + (err?.message || 'Unknown error'), type: 'error' });
    } finally {
      setIsExecutingTimestamps(false);
    }
  };

  // Form state for adding user
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newBikeModel, setNewBikeModel] = useState('');
  const [newBikePlate, setNewBikePlate] = useState('');
  const newPaymentMethod: 'gcash' = 'gcash';
  const [newRefNumber, setNewRefNumber] = useState('');
  const [newInitialStatus, setNewInitialStatus] = useState<AccountPaymentStatus>('pending_approval');
  const [newNotes, setNewNotes] = useState('');

  // Build directory exclusively from live Firestore user records and live Firestore submissions
  const allUsers: UserAccount[] = React.useMemo(() => {
    const list: UserAccount[] = [];
    const now = new Date();

    // 1. Load live Firestore user docs
    firestoreUsers.forEach((fUser) => {
      const idx = list.findIndex((u) => u.id === fUser.id);
      const isStoredPro = fUser.subscriptionTier === 'pro';
      const rawSubStatus = fUser.subscriptionStatus || 'free';
      const expiry = parseExpiryToDate(fUser.expiryDate);
      const hasValidFutureExpiry = expiry !== null && expiry.getTime() > now.getTime();
      const isExpired = expiry !== null && expiry.getTime() <= now.getTime();
      const isActivePaidPro =
        isStoredPro &&
        hasValidFutureExpiry &&
        rawSubStatus !== 'revoked' &&
        rawSubStatus !== 'expired' &&
        rawSubStatus !== 'free';
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
        subscriptionTier: isActivePaidPro ? 'pro' : 'free',
        paymentStatus: isExpired ? 'expired' : fUser.paymentStatus || 'unpaid_free',
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
      const targetExpiry = targetUser?.expiryDate ? new Date(targetUser.expiryDate) : null;
      const targetHasFutureExpiry = targetExpiry !== null && targetExpiry.getTime() > now.getTime();

      const mappedUser: UserAccount = {
        id: sub.userId,
        name: sub.userName || targetUser?.name || 'Rider',
        email: sub.userEmail || targetUser?.email || '',
        registeredAt: targetUser?.registeredAt || sub.submittedAt.split('T')[0],
        bikeModel: sub.bikeModel || targetUser?.bikeModel || 'Motorcycle',
        bikePlate: sub.bikePlate || targetUser?.bikePlate || '',
        bikeNickname: targetUser?.bikeNickname,
        subscriptionTier:
          targetUser?.subscriptionTier === 'pro' && targetHasFutureExpiry ? 'pro' : 'free',
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
      const hasValidFutureExpiry = expiry !== null && expiry.getTime() > now.getTime();
      const isExpired = Boolean(u.expiryDate) && expiry !== null && expiry.getTime() <= now.getTime();
      const isPro = u.subscriptionTier === 'pro' && hasValidFutureExpiry;

      let effectiveStatus: DashboardSubscriptionStatus;
      if (hasPendingRenewal) {
        effectiveStatus = 'PENDING RENEWAL';
      } else if (isPro) {
        effectiveStatus = 'ACTIVE';
      } else if (isExpired) {
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
  }, [firestoreUsers, firestoreSubmissions]);

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

  // Identify users whose Pro subscription expired in the last 7 days
  const recentlyExpiredProUsers = React.useMemo(
    () => getRecentlyExpiredProUsers(allUsers),
    [allUsers]
  );

  // Manual override handler to trigger Renewal Reminders for all users expired in the last 7 days
  const handleManualOverrideAllRenewalReminders = () => {
    const report = triggerRecentExpiryRenewalReminders(allUsers, { manualOverride: true });
    if (report.notifications.length > 0) {
      setSentRenewalReminders((prev) => {
        const next = { ...prev };
        report.notifications.forEach((n) => {
          next[n.userId] = n;
        });
        return next;
      });
    }
    setPortalToast({
      msg: report.summaryMessage,
      type: report.expiredUsers.length > 0 ? 'success' : 'info',
    });
  };

  // Manual override handler to trigger a Renewal Reminder for a specific user
  const handleManualOverrideSingleRenewalReminder = (targetUser: UserAccount) => {
    const res = triggerRenewalReminderNotification(targetUser, { manualOverride: true });
    setSentRenewalReminders((prev) => ({
      ...prev,
      [targetUser.id]: res,
    }));
    setPortalToast({
      msg: `Renewal Reminder sent to ${targetUser.name} (${targetUser.email || targetUser.id}).`,
      type: 'success',
    });
  };

  // Compile Payment History audit records (previously approved and rejected payment reference numbers)
  const paymentHistoryRecords = React.useMemo(() => {
    const records: Array<{
      id: string;
      userId: string;
      userName: string;
      userEmail: string;
      bikeModel: string;
      paymentMethod: string;
      referenceNumber: string;
      amountPhp: number;
      auditStatus: 'approved' | 'rejected';
      submittedAt?: string;
      reviewedAt?: string;
      reviewedBy?: string;
      notes?: string;
    }> = [];
    const seenKeys = new Set<string>();

    // 1. Live Firestore paymentSubmissions that have been approved (active_pro) or rejected
    firestoreSubmissions.forEach((sub) => {
      if ((sub.status === 'active_pro' || sub.status === 'rejected') && sub.referenceNumber) {
        const key = `${sub.userId}_${sub.referenceNumber.trim().toUpperCase()}`;
        seenKeys.add(key);
        records.push({
          id: sub.id,
          userId: sub.userId,
          userName: sub.userName || 'Rider',
          userEmail: sub.userEmail || '',
          bikeModel: sub.bikeModel || 'Motorcycle',
          paymentMethod: sub.paymentMethod || 'gcash',
          referenceNumber: sub.referenceNumber,
          amountPhp: sub.amountPhp || 49,
          auditStatus: sub.status === 'active_pro' ? 'approved' : 'rejected',
          submittedAt: sub.submittedAt,
          reviewedAt: sub.approvedAt || sub.reviewedAt || sub.submittedAt,
          reviewedBy: sub.approvedBy || sub.reviewedBy || 'Owner Admin',
          notes: sub.notes,
        });
      }
    });

    // 2. Fallback/supplement from merged allUsers and passed users prop
    const combinedUsers = [...allUsers, ...(users || [])];
    combinedUsers.forEach((u) => {
      const isApprovedRecord =
        u.paymentStatus === 'active_pro' ||
        Boolean(u.approvedAt) ||
        u.effectiveStatus === 'ACTIVE';
      const isRejectedRecord =
        u.paymentStatus === 'rejected' || u.effectiveStatus === 'REJECTED';

      if ((isApprovedRecord || isRejectedRecord) && u.referenceNumber) {
        const key = `${u.id}_${u.referenceNumber.trim().toUpperCase()}`;
        if (seenKeys.has(key)) return;
        seenKeys.add(key);

        records.push({
          id: u.lastPaymentId || `hist_${u.id}_${u.referenceNumber}`,
          userId: u.id,
          userName: u.name || 'Rider',
          userEmail: u.email || '',
          bikeModel: u.bikeModel || 'Motorcycle',
          paymentMethod: u.paymentMethod || 'gcash',
          referenceNumber: u.referenceNumber,
          amountPhp: u.amountPhp || 49,
          auditStatus: isRejectedRecord ? 'rejected' : 'approved',
          submittedAt: u.lastPaymentDate || u.registeredAt,
          reviewedAt: u.approvedAt || u.lastPaymentDate || u.registeredAt,
          reviewedBy: u.approvedBy || 'Owner Admin',
          notes: u.notes,
        });
      }
    });

    return records.sort((a, b) => {
      const tA = a.reviewedAt ? new Date(a.reviewedAt).getTime() : 0;
      const tB = b.reviewedAt ? new Date(b.reviewedAt).getTime() : 0;
      return tB - tA;
    });
  }, [firestoreSubmissions, allUsers, users]);

  const filteredPaymentHistory = React.useMemo(() => {
    return paymentHistoryRecords.filter((rec) => {
      if (paymentHistoryFilter === 'approved' && rec.auditStatus !== 'approved') return false;
      if (paymentHistoryFilter === 'rejected' && rec.auditStatus !== 'rejected') return false;
      if (paymentHistorySearch.trim()) {
        const q = paymentHistorySearch.toLowerCase();
        return (
          rec.referenceNumber.toLowerCase().includes(q) ||
          rec.userName.toLowerCase().includes(q) ||
          rec.userEmail.toLowerCase().includes(q) ||
          rec.paymentMethod.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [paymentHistoryRecords, paymentHistoryFilter, paymentHistorySearch]);

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

          <button
            type="button"
            onClick={handleOpenCounterDryRun}
            disabled={isInspectingCounters}
            title="Inspect all user motorcycle counts in Dry-Run mode without updating records"
            className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isInspectingCounters ? 'animate-spin text-amber-400' : ''}`} />
            <span className="hidden sm:inline">{isInspectingCounters ? 'Inspecting...' : 'Reconcile Counters (Dry Run)'}</span>
          </button>

          <button
            type="button"
            onClick={handleOpenTimestampDryRun}
            disabled={isInspectingTimestamps}
            title="Inspect user subscription expiration date types in Dry-Run mode"
            className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-300 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <Clock className={`w-3.5 h-3.5 ${isInspectingTimestamps ? 'animate-spin text-cyan-400' : ''}`} />
            <span className="hidden sm:inline">{isInspectingTimestamps ? 'Auditing...' : 'Timestamp Audit (Dry Run)'}</span>
          </button>

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

      {portalToast && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-3">
          <div
            className={`p-3 rounded-2xl text-xs flex items-center justify-between border ${
              portalToast.type === 'error'
                ? 'bg-red-500/10 border-red-500/30 text-red-300'
                : portalToast.type === 'info'
                ? 'bg-blue-500/10 border-blue-500/30 text-blue-300'
                : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
            }`}
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{portalToast.msg}</span>
            </div>
            <button
              type="button"
              onClick={() => setPortalToast(null)}
              className="hover:opacity-75 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 pt-6 space-y-6">
        {/* Navigation Tabs: Rider Subscriptions vs System Health */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveAdminTab('directory')}
              className={`px-4 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-2 cursor-pointer ${
                activeAdminTab === 'directory'
                  ? 'bg-[#FF6B00] text-white shadow-lg shadow-orange-500/20'
                  : 'bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              <Users className="w-4 h-4" />
              <span>Rider Directory & Subscriptions</span>
              <span className="ml-1 px-1.5 py-0.5 rounded bg-slate-950/50 text-[10px] font-mono">
                {allUsers.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveAdminTab('payment_history')}
              className={`px-4 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-2 cursor-pointer ${
                activeAdminTab === 'payment_history'
                  ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/25'
                  : 'bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              <History className="w-4 h-4 text-emerald-400" />
              <span>Payment History</span>
              <span className="ml-1 px-1.5 py-0.5 rounded bg-slate-950/50 text-[10px] font-mono">
                {paymentHistoryRecords.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveAdminTab('system_health');
                if (!healthCounterReport && !isLoadingHealth) {
                  handleRunSystemHealthAudit();
                }
              }}
              className={`px-4 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-2 cursor-pointer ${
                activeAdminTab === 'system_health'
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/25'
                  : 'bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              <Activity className="w-4 h-4 text-cyan-300" />
              <span>System Health</span>
              {healthCounterReport && ((healthCounterReport.discrepancyCount > 0) || ((healthExpiryReport?.iso8601Count ?? 0) > 0)) ? (
                <span className="px-2 py-0.5 rounded-full bg-amber-500 text-slate-950 text-[10px] font-bold">
                  {(healthCounterReport.discrepancyCount) + (healthExpiryReport?.iso8601Count ?? 0)}
                </span>
              ) : (
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
              )}
            </button>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              data-testid="manual-renewal-reminder-override-btn"
              onClick={handleManualOverrideAllRenewalReminders}
              className="px-3.5 py-2 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
              title="Identify users whose Pro subscription expired in the last 7 days and trigger a Renewal Reminder notification"
            >
              <Bell className="w-3.5 h-3.5 text-amber-400" />
              <span>Send Renewal Reminders (7d Expired)</span>
              <span className="px-1.5 py-0.5 rounded bg-amber-500 text-slate-950 text-[10px] font-black font-mono">
                {recentlyExpiredProUsers.length}
              </span>
            </button>
          </div>

          {activeAdminTab === 'system_health' && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setHealthFilter(healthFilter === 'all' ? 'flagged' : 'all')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  healthFilter === 'flagged'
                    ? 'bg-amber-500 text-slate-950 font-black'
                    : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                {healthFilter === 'flagged' ? 'Showing Flagged Issues Only' : 'Show All Inspected'}
              </button>

              <button
                type="button"
                onClick={handleRunSystemHealthAudit}
                disabled={isLoadingHealth}
                className="px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-cyan-300 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingHealth ? 'animate-spin text-cyan-400' : ''}`} />
                <span>{isLoadingHealth ? 'Auditing Database...' : 'Run Full Health Audit'}</span>
              </button>
            </div>
          )}
        </div>

        {/* ======================================================== */}
        {/* CLOUD SYNC WRITE QUEUE & TELEMETRY DIAGNOSTIC PANEL      */}
        {/* ======================================================== */}
        <section
          data-testid="admin-cloud-sync-diagnostic-panel"
          className="p-5 bg-slate-900 border border-slate-800 rounded-3xl space-y-4 shadow-xl"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-cyan-500/15 border border-cyan-500/30 text-cyan-400 rounded-2xl">
                <Database className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-sm sm:text-base font-black text-white">
                    Cloud Sync Write Queue & Operation Diagnostics
                  </h2>
                  <span
                    data-testid="firestore-write-queue-size-badge"
                    className={`px-2 py-0.5 rounded-md font-mono text-[10px] font-black uppercase ${
                      syncDiagQueue.length > 0
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                        : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                    }`}
                  >
                    Write Queue Size: {syncDiagQueue.length}
                  </span>
                  <span
                    data-testid="quarantined-queue-size-badge"
                    className={`px-2 py-0.5 rounded-md font-mono text-[10px] font-black uppercase ${
                      syncDiagQuarantined.length > 0
                        ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                        : 'bg-slate-800 text-slate-400 border border-slate-700'
                    }`}
                  >
                    Quarantined: {syncDiagQuarantined.length}
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  Real-time Firestore offline write queue depth, recoverable quarantine store, and the last 5 successful vs. failed cloud sync operations for current user (
                  <code className="text-cyan-300 font-mono">{currentDiagnosticUserId || 'unauthenticated'}</code>).
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 self-start sm:self-auto">
              <button
                type="button"
                onClick={refreshCloudSyncDiagnostics}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Refresh</span>
              </button>
              {syncDiagQueue.length > 0 && (
                <button
                  type="button"
                  disabled={isFlushingDiagQueue}
                  onClick={handleFlushDiagnosticQueue}
                  className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isFlushingDiagQueue ? 'animate-spin' : ''}`} />
                  <span>{isFlushingDiagQueue ? 'Flushing...' : 'Flush Queue'}</span>
                </button>
              )}
              {syncDiagLogs.allLogs.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearDiagnosticLogs}
                  className="px-2.5 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-800 text-slate-400 hover:text-slate-200 text-[11px] font-bold cursor-pointer"
                >
                  Clear Log
                </button>
              )}
            </div>
          </div>

          {/* Pending Write Queue Items (if any) */}
          {syncDiagQueue.length > 0 && (
            <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/30 space-y-2">
              <div className="text-[11px] font-black uppercase tracking-wider text-amber-300 flex items-center justify-between">
                <span>Queued Offline Mutations ({syncDiagQueue.length})</span>
                <span className="font-mono text-[10px]">Coalesced FIFO Queue</span>
              </div>
              <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                {syncDiagQueue.map((qItem) => (
                  <div
                    key={qItem.id}
                    className="p-2 rounded-xl bg-slate-950/70 border border-amber-500/20 text-[11px] flex items-center justify-between gap-2"
                  >
                    <div className="font-mono text-slate-200 truncate">
                      <span className="text-amber-300 font-bold uppercase">{qItem.action}</span>{' '}
                      <span className="text-slate-400">[{qItem.entity}]</span> →{' '}
                      <span className="text-white">{qItem.targetId}</span>
                    </div>
                    <div className="text-[10px] font-mono text-slate-400 shrink-0">
                      Retries: {qItem.retryCount}
                      {qItem.lastError ? ` • Err: ${qItem.lastError.slice(0, 32)}` : ''}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Quarantined Mutations (Recoverable Payload Store) */}
          {syncDiagQuarantined.length > 0 && (
            <div
              data-testid="quarantined-mutations-section"
              className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 space-y-2.5"
            >
              <div className="text-[11px] font-black uppercase tracking-wider text-rose-300 flex items-center justify-between">
                <span>Quarantined Mutations ({syncDiagQuarantined.length}) — Recoverable Payloads</span>
                <span className="font-mono text-[10px]">UID-Scoped Quarantine</span>
              </div>
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {syncDiagQuarantined.map((qItem) => {
                  const payloadSummary = qItem.payload
                    ? Object.entries(qItem.payload)
                        .filter(([k]) => ['odometer', 'title', 'brand', 'model', 'licensePlate'].includes(k))
                        .map(([k, v]) => `${k}: ${String(v)}`)
                        .join(', ')
                    : 'No payload body';
                  return (
                    <div
                      key={qItem.id}
                      data-testid={`quarantined-item-${qItem.id}`}
                      className="p-2.5 rounded-xl bg-slate-950/80 border border-rose-500/30 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                    >
                      <div className="min-w-0 space-y-0.5">
                        <div className="font-mono font-bold text-rose-200 flex items-center gap-1.5 flex-wrap">
                          <span className="uppercase text-amber-300">{qItem.action}</span>
                          <span className="px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 text-[10px]">
                            {qItem.entity}
                          </span>
                          <span className="text-white">#{qItem.targetId}</span>
                          <span
                            className={`px-1.5 py-0.2 rounded text-[10px] border ${
                              qItem.failureClassification === 'version_conflict'
                                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                                : 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                            }`}
                          >
                            {qItem.failureClassification}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-300 font-mono truncate">
                          Payload: {payloadSummary || ' preserved'} • Retries: {qItem.retryCount}
                        </div>
                        {qItem.failureClassification === 'version_conflict' && (
                          <div className="text-[10px] text-amber-300 font-mono truncate">
                            Version Conflict: Base={qItem.baseCloudUpdatedAt ?? 'untrusted/legacy'} vs Cloud={qItem.conflictCloudUpdatedAt ?? 'newer'}
                          </div>
                        )}
                        <div className="text-[10px] text-rose-300/90 font-mono truncate">
                          {qItem.conflictReason
                            ? `Conflict: ${qItem.conflictReason}`
                            : `Error: ${qItem.lastError}`}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          data-testid={`requeue-quarantined-${qItem.id}`}
                          onClick={() => handleRecoverQuarantinedMutation(qItem.id)}
                          className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] transition-colors cursor-pointer"
                        >
                          Requeue Safely
                        </button>
                        <button
                          type="button"
                          data-testid={`dismiss-quarantined-${qItem.id}`}
                          onClick={() => handleDismissQuarantinedMutation(qItem.id)}
                          className="px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white font-bold text-[11px] transition-colors cursor-pointer"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Last 5 Successful vs Last 5 Failed Operations */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Last 5 Successful */}
            <div
              data-testid="sync-logs-successful-column"
              className="p-3.5 rounded-2xl bg-slate-950/60 border border-emerald-500/25 space-y-2.5"
            >
              <div className="flex items-center justify-between">
                <div className="text-xs font-black uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Last 5 Successful Sync Operations</span>
                </div>
                <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 font-mono text-[10px] font-bold">
                  {syncDiagLogs.last5Successful.length} / 5
                </span>
              </div>

              {syncDiagLogs.last5Successful.length === 0 ? (
                <div className="py-6 text-center text-xs text-slate-500 italic">
                  No successful cloud sync operations recorded in this session yet.
                </div>
              ) : (
                <div className="space-y-2">
                  {syncDiagLogs.last5Successful.map((entry) => (
                    <div
                      key={entry.id}
                      data-testid={`sync-log-success-${entry.id}`}
                      className="p-2.5 rounded-xl bg-slate-900 border border-slate-800/90 text-xs flex items-start justify-between gap-2"
                    >
                      <div className="min-w-0 space-y-0.5">
                        <div className="font-mono font-bold text-emerald-300 flex items-center gap-1.5 flex-wrap">
                          <span>{entry.operation}</span>
                          <span className="px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 text-[10px]">
                            {entry.entity}
                          </span>
                          {entry.targetId && (
                            <span className="text-slate-400 text-[10px]">#{entry.targetId}</span>
                          )}
                        </div>
                        {entry.detail && (
                          <div className="text-[11px] text-slate-300 truncate">{entry.detail}</div>
                        )}
                      </div>
                      <div className="text-[10px] font-mono text-slate-500 shrink-0">
                        {entry.timestampIso.slice(11, 19)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Last 5 Failed */}
            <div
              data-testid="sync-logs-failed-column"
              className="p-3.5 rounded-2xl bg-slate-950/60 border border-rose-500/25 space-y-2.5"
            >
              <div className="flex items-center justify-between">
                <div className="text-xs font-black uppercase tracking-wider text-rose-400 flex items-center gap-1.5">
                  <XCircle className="w-4 h-4" />
                  <span>Last 5 Failed Sync Operations</span>
                </div>
                <span className="px-2 py-0.5 rounded bg-rose-500/15 text-rose-300 font-mono text-[10px] font-bold">
                  {syncDiagLogs.last5Failed.length} / 5
                </span>
              </div>

              {syncDiagLogs.last5Failed.length === 0 ? (
                <div className="py-6 text-center text-xs text-slate-500 italic">
                  0 failed cloud sync operations recorded for this rider.
                </div>
              ) : (
                <div className="space-y-2">
                  {syncDiagLogs.last5Failed.map((entry) => (
                    <div
                      key={entry.id}
                      data-testid={`sync-log-failed-${entry.id}`}
                      className="p-2.5 rounded-xl bg-rose-950/20 border border-rose-500/30 text-xs flex items-start justify-between gap-2"
                    >
                      <div className="min-w-0 space-y-0.5">
                        <div className="font-mono font-bold text-rose-300 flex items-center gap-1.5 flex-wrap">
                          <span>{entry.operation}</span>
                          <span className="px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 text-[10px]">
                            {entry.entity}
                          </span>
                          {entry.targetId && (
                            <span className="text-slate-400 text-[10px]">#{entry.targetId}</span>
                          )}
                        </div>
                        {entry.errorMessage && (
                          <div className="text-[11px] text-rose-200/90 font-mono break-all">
                            {entry.errorMessage}
                          </div>
                        )}
                      </div>
                      <div className="text-[10px] font-mono text-slate-500 shrink-0">
                        {entry.timestampIso.slice(11, 19)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        {activeAdminTab === 'directory' ? (
          <>
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
              {allUsers.length === 0 ? (
                <>
                  <Users className="w-8 h-8 mx-auto text-slate-600" />
                  <p className="font-bold text-sm text-slate-300">No registered riders in Firestore yet</p>
                  <p className="text-xs text-slate-500">
                    Live rider profiles and payment submissions will automatically appear here as users sign in or submit payments.
                  </p>
                </>
              ) : (
                <>
                  <Search className="w-8 h-8 mx-auto text-slate-600" />
                  <p className="font-bold text-sm text-slate-400">No rider accounts match this filter</p>
                  <p className="text-xs text-slate-600">Try adjusting your status filter or search query</p>
                </>
              )}
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

                       {/* Approval / Revoke / Manual Renewal Reminder Override Actions */}
                      <div className="flex items-center gap-2 flex-wrap">
                        {(isExpired || isProExpiredWithinLast7Days(user)) && (
                          <button
                            type="button"
                            data-testid={`send-renewal-reminder-${user.id}`}
                            onClick={() => handleManualOverrideSingleRenewalReminder(user)}
                            className="px-3 py-1.5 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer"
                            title="Manual Override: Trigger Renewal Reminder notification for this rider"
                          >
                            <Bell className="w-3.5 h-3.5 text-amber-400" />
                            <span>
                              {sentRenewalReminders[user.id]
                                ? 'Reminder Sent ✓'
                                : 'Renewal Reminder'}
                            </span>
                          </button>
                        )}

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
      </>
    ) : null}

    {(activeAdminTab === 'directory' || activeAdminTab === 'payment_history') && (
      /* ======================================================== */
      /* PAYMENT HISTORY AUDIT SECTION (APPROVED & REJECTED REFS) */
      /* ======================================================== */
      <section
        data-testid="admin-payment-history-section"
        className="p-5 bg-slate-900 border border-slate-800 rounded-3xl space-y-4 shadow-xl"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 rounded-2xl">
              <History className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm sm:text-base font-black text-white">
                  Payment History
                </h2>
                <span className="px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 font-mono text-[10px] font-bold uppercase">
                  Audit Log • {paymentHistoryRecords.length} Reference{paymentHistoryRecords.length === 1 ? '' : 's'}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Complete audit record of all previously approved and rejected payment reference numbers.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
              <button
                type="button"
                onClick={() => setPaymentHistoryFilter('all')}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
                  paymentHistoryFilter === 'all'
                    ? 'bg-[#FF6B00] text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                All ({paymentHistoryRecords.length})
              </button>
              <button
                type="button"
                onClick={() => setPaymentHistoryFilter('approved')}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
                  paymentHistoryFilter === 'approved'
                    ? 'bg-emerald-600 text-white'
                    : 'text-emerald-400 hover:bg-slate-800'
                }`}
              >
                Approved ({paymentHistoryRecords.filter((r) => r.auditStatus === 'approved').length})
              </button>
              <button
                type="button"
                onClick={() => setPaymentHistoryFilter('rejected')}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
                  paymentHistoryFilter === 'rejected'
                    ? 'bg-rose-600 text-white'
                    : 'text-rose-400 hover:bg-slate-800'
                }`}
              >
                Rejected ({paymentHistoryRecords.filter((r) => r.auditStatus === 'rejected').length})
              </button>
            </div>

            <div className="relative w-full sm:w-56">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={paymentHistorySearch}
                onChange={(e) => setPaymentHistorySearch(e.target.value)}
                placeholder="Search reference # or rider..."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-[#FF6B00]"
              />
            </div>
          </div>
        </div>

        {filteredPaymentHistory.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500 italic bg-slate-950/40 rounded-2xl border border-slate-800/60">
            No previously approved or rejected payment reference numbers match the current filter.
          </div>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
            {filteredPaymentHistory.map((item) => (
              <div
                key={item.id}
                data-testid={`payment-history-row-${item.referenceNumber}`}
                className={`p-3.5 rounded-2xl border text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                  item.auditStatus === 'approved'
                    ? 'bg-emerald-950/15 border-emerald-500/25'
                    : 'bg-rose-950/15 border-rose-500/25'
                }`}
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-black text-amber-300 text-sm">
                      {item.referenceNumber}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopyRef(item.referenceNumber, `hist-${item.id}`)}
                      className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
                      title="Copy reference number"
                    >
                      {copiedRefId === `hist-${item.id}` ? (
                        <Check className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                    {item.auditStatus === 'approved' ? (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-black text-[10px] uppercase tracking-wider flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>APPROVED</span>
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full bg-rose-500/20 border border-rose-500/40 text-rose-300 font-black text-[10px] uppercase tracking-wider flex items-center gap-1">
                        <XCircle className="w-3 h-3" />
                        <span>REJECTED</span>
                      </span>
                    )}
                    <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[10px] uppercase">
                      {item.paymentMethod} • ₱{item.amountPhp}.00
                    </span>
                  </div>

                  <div className="text-[11px] text-slate-300 flex flex-wrap items-center gap-2">
                    <span className="font-bold text-white">{item.userName}</span>
                    {item.userEmail && <span className="text-slate-400">({item.userEmail})</span>}
                    <span className="text-slate-600">•</span>
                    <span className="text-slate-400">{item.bikeModel}</span>
                    <span className="text-slate-600">•</span>
                    <span className="font-mono text-[10px] text-slate-500">UID: {item.userId}</span>
                  </div>
                </div>

                <div className="text-left sm:text-right shrink-0 space-y-0.5 text-[10px] text-slate-400 font-mono">
                  <div>
                    Reviewed: <span className="text-slate-200">{formatManilaDateString(item.reviewedAt)}</span>
                  </div>
                  <div>
                    By: <span className="text-slate-300">{item.reviewedBy || 'Owner Admin'}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    )}

    {activeAdminTab === 'system_health' && (
      /* ======================================================== */
      /* SYSTEM HEALTH & INTEGRITY DIAGNOSTIC VIEW                */
      /* ======================================================== */
      <div className="space-y-6 animate-in fade-in duration-150">
        {/* Health KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 shadow-sm space-y-1">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-xs font-bold uppercase tracking-wider">Total Users Inspected</span>
              <Users className="w-4 h-4 text-slate-500" />
            </div>
            <div className="text-2xl sm:text-3xl font-black text-white font-mono">
              {healthCounterReport?.totalUsers ?? allUsers.length}
            </div>
            <div className="text-[11px] text-slate-500 font-medium">Production Firestore profiles</div>
          </div>

          <div className={`p-4 rounded-2xl bg-slate-900 border shadow-sm space-y-1 ${
            (healthCounterReport?.discrepancyCount ?? 0) > 0 ? 'border-amber-500/50 bg-amber-500/5' : 'border-emerald-500/30'
          }`}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-300">Counter Synchronicity</span>
              <Bike className="w-4 h-4 text-orange-400" />
            </div>
            <div className="text-2xl sm:text-3xl font-black font-mono text-white">
              {healthCounterReport ? (
                healthCounterReport.discrepancyCount === 0 ? (
                  <span className="text-emerald-400">100% Sync</span>
                ) : (
                  <span className="text-amber-400">{healthCounterReport.discrepancyCount} Desynced</span>
                )
              ) : (
                '...'
              )}
            </div>
            <div className="text-[11px] text-slate-400 font-medium">
              {healthCounterReport ? `${healthCounterReport.matchingCount} aligned, ${healthCounterReport.totalMotorcycleDocs} bikes` : 'Awaiting audit'}
            </div>
          </div>

          <div className={`p-4 rounded-2xl bg-slate-900 border shadow-sm space-y-1 ${
            (healthExpiryReport?.iso8601Count ?? 0) > 0 ? 'border-blue-500/50 bg-blue-500/5' : 'border-emerald-500/30'
          }`}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-300">Expiry Format Audit</span>
              <Clock className="w-4 h-4 text-cyan-400" />
            </div>
            <div className="text-2xl sm:text-3xl font-black font-mono text-white">
              {healthExpiryReport ? (
                healthExpiryReport.iso8601Count === 0 ? (
                  <span className="text-emerald-400">All Native</span>
                ) : (
                  <span className="text-blue-400">{healthExpiryReport.iso8601Count} ISO String</span>
                )
              ) : (
                '...'
              )}
            </div>
            <div className="text-[11px] text-slate-400 font-medium">
              {healthExpiryReport ? `${healthExpiryReport.nativeTimestampCount} native Timestamps` : 'Awaiting audit'}
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 shadow-sm space-y-1">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-xs font-bold uppercase tracking-wider">Dry-Run Safety</span>
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-2xl sm:text-3xl font-black text-emerald-400 font-mono">
              0 Writes
            </div>
            <div className="text-[11px] text-slate-500 font-medium">Read-only diagnostic analysis</div>
          </div>
        </div>

        {/* Diagnostic Panel 1: Motorcycle Counter Synchronicity Dry-Run */}
        <div className="p-5 bg-slate-900 border border-slate-800 rounded-3xl space-y-4 shadow-xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-orange-500/15 border border-orange-500/30 text-orange-400 rounded-2xl">
                <Bike className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-black text-white flex items-center gap-2">
                  <span>Motorcycle Counter Synchronicity Dry-Run</span>
                  <span className="px-2 py-0.5 rounded-full bg-slate-800 text-[10px] font-mono text-slate-400">
                    Read-Only
                  </span>
                </h3>
                <p className="text-xs text-slate-400">
                  Fetches all user profiles and compares stored <code className="text-orange-300">bikeCount</code> against actual count of motorcycle documents in <code className="text-orange-300">/motorcycles</code>.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleOpenCounterDryRun}
              className="px-3.5 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-orange-600/20 flex items-center gap-1.5 cursor-pointer self-start sm:self-auto"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Review Counter Reconciliation</span>
            </button>
          </div>

          {isLoadingHealth && !healthCounterReport ? (
            <div className="py-12 text-center text-slate-400 text-xs flex flex-col items-center justify-center gap-2">
              <RefreshCw className="w-6 h-6 animate-spin text-orange-400" />
              <span>Comparing stored bikeCount with live motorcycle documents across all users...</span>
            </div>
          ) : healthCounterReport ? (
            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {(healthFilter === 'flagged'
                ? healthCounterReport.items.filter((item) => item.needsCorrection)
                : healthCounterReport.items
              )
                .sort((a, b) => (b.needsCorrection ? 1 : 0) - (a.needsCorrection ? 1 : 0))
                .map((item) => (
                  <div
                    key={item.userId}
                    className={`p-3 rounded-2xl border text-xs flex items-center justify-between ${
                      item.needsCorrection
                        ? 'bg-amber-500/10 border-amber-500/30 text-slate-200'
                        : 'bg-slate-950/40 border-slate-800/60 text-slate-400'
                    }`}
                  >
                    <div className="min-w-0 pr-3">
                      <div className="font-bold text-white truncate flex items-center gap-2">
                        <span>{item.email || item.displayName || item.userId}</span>
                        {item.needsCorrection && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[9px] font-black uppercase">
                            Count Discrepancy Flagged
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono mt-0.5 flex items-center gap-2">
                        <span>UID: {item.userId}</span>
                        <span>•</span>
                        <span>Stored bikeCount: <strong className="text-slate-200">{item.storedBikeCount}</strong></span>
                        <span>•</span>
                        <span>Calculated docs: <strong className="text-white">{item.calculatedDocCount}</strong></span>
                      </div>
                    </div>

                    <div className="text-right shrink-0 flex items-center gap-3">
                      <div className="text-right">
                        <span className="text-[10px] text-slate-500 block">Delta</span>
                        <span className={`font-mono font-bold text-xs ${
                          item.delta > 0 ? 'text-amber-400' : item.delta < 0 ? 'text-rose-400' : 'text-slate-500'
                        }`}>
                          {item.delta > 0 ? `+${item.delta}` : item.delta}
                        </span>
                      </div>
                      {item.needsCorrection ? (
                        <span className="px-2.5 py-1 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded-lg text-[10px] font-black">
                          Target: {item.calculatedDocCount}
                        </span>
                      ) : (
                        <span className="px-2.5 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-lg text-[10px] font-bold">
                          Synchronized ✓
                        </span>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          ) : (
            <div className="py-8 text-center text-slate-400 text-xs">
              Click "Run Full Health Audit" to inspect all user motorcycle counters.
            </div>
          )}
        </div>

        {/* Diagnostic Panel 2: ISO 8601 String Expiry Date Diagnostic View */}
        <div className="p-5 bg-slate-900 border border-slate-800 rounded-3xl space-y-4 shadow-xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-blue-500/15 border border-blue-500/30 text-blue-400 rounded-2xl">
                <Clock className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-black text-white flex items-center gap-2">
                  <span>ISO 8601 String Expiry Date Diagnostic View</span>
                  <span className="px-2 py-0.5 rounded-full bg-slate-800 text-[10px] font-mono text-slate-400">
                    Diagnostic Only
                  </span>
                </h3>
                <p className="text-xs text-slate-400">
                  Iterates through all user documents, checks for the presence of an ISO 8601 string in the <code className="text-blue-300">expiryDate</code> field, and shows the equivalent Timestamp conversion without applying it to production data.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleOpenTimestampDryRun}
              className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-blue-600/20 flex items-center gap-1.5 cursor-pointer self-start sm:self-auto"
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Review Timestamp Migration</span>
            </button>
          </div>

          {isLoadingHealth && !healthExpiryReport ? (
            <div className="py-12 text-center text-slate-400 text-xs flex flex-col items-center justify-center gap-2">
              <RefreshCw className="w-6 h-6 animate-spin text-blue-400" />
              <span>Inspecting user expiryDate fields and generating equivalent Timestamp previews...</span>
            </div>
          ) : healthExpiryReport ? (
            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {(healthFilter === 'flagged'
                ? healthExpiryReport.items.filter((item) => item.needsConversion)
                : healthExpiryReport.items
              )
                .sort((a, b) => (b.needsConversion ? 1 : 0) - (a.needsConversion ? 1 : 0))
                .map((item) => (
                  <div
                    key={item.userId}
                    className={`p-3 rounded-2xl border text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                      item.needsConversion
                        ? 'bg-blue-500/10 border-blue-500/30 text-slate-200'
                        : 'bg-slate-950/40 border-slate-800/60 text-slate-400'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-white truncate flex items-center gap-2">
                        <span>{item.email || item.displayName || item.userId}</span>
                        <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] font-mono text-slate-400 uppercase">
                          {item.subscriptionTier}
                        </span>
                        {item.isIso8601String && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[9px] font-black uppercase">
                            Flagged: ISO 8601 String
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono mt-1 space-y-0.5">
                        <div>
                          <span>Stored Value: </span>
                          <strong className={item.isIso8601String ? 'text-amber-300' : 'text-slate-300'}>
                            {item.rawValue}
                          </strong>
                          <span className="mx-2 text-slate-600">|</span>
                          <span>Format: </span>
                          <span className="text-slate-300">{item.currentFormat}</span>
                        </div>
                        {item.equivalentTimestampPreview && (
                          <div className="text-blue-300 flex items-center gap-2 flex-wrap">
                            <span>Equivalent Timestamp:</span>
                            <code className="bg-slate-950/80 px-1.5 py-0.5 rounded text-emerald-400">
                              Timestamp(seconds={item.equivalentTimestampPreview.seconds}, nanoseconds={item.equivalentTimestampPreview.nanoseconds})
                            </code>
                            <span className="text-slate-400 text-[10px]">
                              ({item.equivalentTimestampPreview.formattedManila})
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      {item.needsConversion ? (
                        <span className="px-2.5 py-1 bg-blue-500/20 text-blue-300 border border-blue-500/40 rounded-lg text-[10px] font-black">
                          Needs Timestamp Conversion
                        </span>
                      ) : item.currentFormat === 'FIRESTORE_TIMESTAMP' ? (
                        <span className="px-2.5 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-lg text-[10px] font-bold">
                          Native Timestamp Compliant ✓
                        </span>
                      ) : (
                        <span className="px-2.5 py-1 bg-slate-800 text-slate-400 border border-slate-700 rounded-lg text-[10px]">
                          Free Plan / No Expiry
                        </span>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          ) : (
            <div className="py-8 text-center text-slate-400 text-xs">
              Click "Run Full Health Audit" to inspect all user expiration date formats.
            </div>
          )}
        </div>
      </div>
    )}
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

      {/* Counter Reconciliation Dry Run Modal */}
      {showCounterModal && counterReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-orange-500/10 border border-orange-500/20 text-orange-400 rounded-xl">
                  <RefreshCw className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-white">Motorcycle Counter Reconciliation Dry Run</h3>
                  <p className="text-xs text-slate-400">Non-destructive inspection of stored vs actual bike counts</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowCounterModal(false);
                  setConfirmExecuteCounters(false);
                }}
                className="text-slate-400 hover:text-white p-2 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 my-4">
              <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800 text-center">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Inspected</span>
                <span className="text-lg font-black text-white">{counterReport.totalUsersInspected}</span>
                <span className="text-[10px] text-slate-500 block">riders</span>
              </div>
              <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800 text-center">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Motorcycles Found</span>
                <span className="text-lg font-black text-white">{counterReport.totalMotorcyclesFound}</span>
                <span className="text-[10px] text-slate-500 block">documents</span>
              </div>
              <div className="bg-emerald-500/10 p-3 rounded-xl border border-emerald-500/20 text-center">
                <span className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider block">Already Matching</span>
                <span className="text-lg font-black text-emerald-400">{counterReport.usersAlreadyMatching}</span>
                <span className="text-[10px] text-emerald-500/80 block">no action needed</span>
              </div>
              <div className="bg-amber-500/10 p-3 rounded-xl border border-amber-500/20 text-center">
                <span className="text-[10px] text-amber-400 font-bold uppercase tracking-wider block">Count Differences</span>
                <span className="text-lg font-black text-amber-400">{counterReport.usersRequiringCorrection}</span>
                <span className="text-[10px] text-amber-500/80 block">requires sync</span>
              </div>
            </div>

            {/* User List with Discrepancy Indicators */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1 my-2">
              <div className="flex items-center justify-between px-1 text-xs font-bold text-slate-400 uppercase tracking-wider">
                <span>Rider Account & Stored vs Calculated Difference</span>
                <span>Delta</span>
              </div>
              {[...counterReport.items]
                .sort((a, b) => (b.needsCorrection ? 1 : 0) - (a.needsCorrection ? 1 : 0))
                .map((item) => {
                  const diff = item.actualMotorcycleCount - item.storedBikeCount;
                  return (
                    <div
                      key={item.userId}
                      className={`p-3 rounded-xl border text-xs flex items-center justify-between ${
                        item.needsCorrection
                          ? 'bg-amber-500/10 border-amber-500/30 text-slate-200'
                          : 'bg-slate-950/40 border-slate-800/60 text-slate-400'
                      }`}
                    >
                      <div className="min-w-0 pr-3">
                        <div className="font-bold text-white truncate flex items-center gap-2">
                          <span>{item.userEmail || item.userName || item.userId}</span>
                          {item.needsCorrection && (
                            <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[9px] font-black uppercase">
                              Discrepancy Detected
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono flex items-center gap-2 mt-0.5">
                          <span>UID: {item.userId}</span>
                          <span>•</span>
                          <span>Stored bikeCount: <strong className="text-slate-200">{item.storedBikeCount}</strong></span>
                          <span>•</span>
                          <span>Calculated docs: <strong className="text-white">{item.actualMotorcycleCount}</strong></span>
                        </div>
                      </div>
                      <div className="text-right shrink-0 flex items-center gap-2">
                        {item.needsCorrection ? (
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-0.5 rounded font-mono font-bold text-[11px] ${
                              diff > 0 ? 'bg-amber-500/20 text-amber-300' : 'bg-red-500/20 text-red-300'
                            }`}>
                              Δ {diff > 0 ? `+${diff}` : diff}
                            </span>
                            <span className="px-2.5 py-1 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded-lg text-[10px] font-black">
                              Update to {item.actualMotorcycleCount}
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-mono text-slate-500">Δ 0</span>
                            <span className="px-2.5 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-lg text-[10px] font-bold">
                              Aligned ({item.storedBikeCount})
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>

            {/* Separate Confirmation Step */}
            <div className="pt-4 border-t border-slate-800 space-y-3">
              {counterReport.usersRequiringCorrection > 0 ? (
                <label className="flex items-start gap-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl cursor-pointer hover:bg-amber-500/15 transition-colors">
                  <input
                    type="checkbox"
                    checked={confirmExecuteCounters}
                    onChange={(e) => setConfirmExecuteCounters(e.target.checked)}
                    className="mt-0.5 accent-orange-500 h-4 w-4 rounded cursor-pointer"
                  />
                  <div className="text-xs text-amber-200">
                    <span className="font-bold block">Require Admin Authorization</span>
                    <span>
                      I have verified the dry-run differences above and authorize writing updated bikeCount values for {counterReport.usersRequiringCorrection} users in Firestore. No user data will be deleted.
                    </span>
                  </div>
                </label>
              ) : (
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-xs text-emerald-300 font-medium">
                  ✓ All user motorcycle counters are synchronized with actual motorcycle documents. No write operations required.
                </div>
              )}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowCounterModal(false);
                    setConfirmExecuteCounters(false);
                  }}
                  className="flex-1 py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl transition-all cursor-pointer"
                >
                  Cancel / Close Dry Run
                </button>
                {counterReport.usersRequiringCorrection > 0 && (
                  <button
                    type="button"
                    onClick={handleExecuteConfirmedCounterReconciliation}
                    disabled={!confirmExecuteCounters || isExecutingCounters}
                    className="flex-1 py-2.5 px-4 bg-orange-600 hover:bg-orange-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-black text-xs rounded-xl shadow-lg shadow-orange-600/25 transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {isExecutingCounters ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Committing Reconciliations...</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4" />
                        <span>Commit {counterReport.usersRequiringCorrection} Reconciliations</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Timestamp Migration Dry Run Modal */}
      {showTimestampModal && timestampReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-xl">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-white">ISO-8601 String to Firestore Timestamp Audit</h3>
                  <p className="text-xs text-slate-400">Previews conversion of string expiryDate values without modifying database records</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowTimestampModal(false);
                  setConfirmExecuteTimestamps(false);
                }}
                className="text-slate-400 hover:text-white p-2 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 my-4">
              <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800 text-center">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Inspected</span>
                <span className="text-lg font-black text-white">{timestampReport.totalUsersInspected}</span>
                <span className="text-[10px] text-slate-500 block">users</span>
              </div>
              <div className="bg-emerald-500/10 p-3 rounded-xl border border-emerald-500/20 text-center">
                <span className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider block">Native Timestamp</span>
                <span className="text-lg font-black text-emerald-400">{timestampReport.timestampCount}</span>
                <span className="text-[10px] text-emerald-500/80 block">compliant</span>
              </div>
              <div className="bg-blue-500/10 p-3 rounded-xl border border-blue-500/20 text-center">
                <span className="text-[10px] text-blue-400 font-bold uppercase tracking-wider block">ISO String / MS</span>
                <span className="text-lg font-black text-blue-400">{timestampReport.isoStringCount + timestampReport.epochMillisCount}</span>
                <span className="text-[10px] text-blue-500/80 block">need conversion</span>
              </div>
              <div className="bg-slate-800/60 p-3 rounded-xl border border-slate-700 text-center">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Free / Missing</span>
                <span className="text-lg font-black text-slate-300">{timestampReport.missingCount}</span>
                <span className="text-[10px] text-slate-500 block">no expiry</span>
              </div>
            </div>

            {/* User List with Conversion Details */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1 my-2">
              <div className="flex items-center justify-between px-1 text-xs font-bold text-slate-400 uppercase tracking-wider">
                <span>Rider & Expiry Format Detection</span>
                <span>Target Conversion Preview</span>
              </div>
              {[...timestampReport.items]
                .sort((a, b) => (b.needsMigration ? 1 : 0) - (a.needsMigration ? 1 : 0))
                .map((item) => (
                  <div
                    key={item.userId}
                    className={`p-3 rounded-xl border text-xs flex items-center justify-between ${
                      item.needsMigration
                        ? 'bg-blue-500/10 border-blue-500/30 text-slate-200'
                        : 'bg-slate-950/40 border-slate-800/60 text-slate-400'
                    }`}
                  >
                    <div className="min-w-0 pr-3">
                      <div className="font-bold text-white truncate flex items-center gap-2">
                        <span>{item.userEmail || item.userName || item.userId}</span>
                        <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                          {item.subscriptionTier}
                        </span>
                        {item.needsMigration && (
                          <span className="px-1.5 py-0.2 rounded bg-blue-500/20 text-blue-300 border border-blue-500/40 text-[9px] font-black uppercase">
                            ISO-8601 String Detected
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono mt-0.5 truncate">
                        Current Value: <span className="text-slate-200 font-semibold">{item.rawExpiryValue}</span>
                        <span className="mx-1.5 text-slate-600">|</span>
                        Detected Type: <span className="text-amber-300">{item.currentType}</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      {item.needsMigration ? (
                        <div className="text-right">
                          <span className="px-2.5 py-1 bg-blue-500/20 text-blue-300 border border-blue-500/40 rounded-lg text-[10px] font-bold block mb-1">
                            ➔ Timestamp Preview
                          </span>
                          <span className="text-[10px] font-mono text-emerald-400 block truncate max-w-[200px]">
                            {item.parsedDateIso}
                          </span>
                        </div>
                      ) : item.currentType === 'Timestamp' ? (
                        <span className="px-2.5 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-lg text-[10px] font-bold">
                          Native Timestamp ✓
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 bg-slate-800 text-slate-400 border border-slate-700 rounded text-[10px]">
                          Free Tier (No Expiry)
                        </span>
                      )}
                    </div>
                  </div>
                ))}
            </div>

            {/* Separate Confirmation Step */}
            <div className="pt-4 border-t border-slate-800 space-y-3">
              {timestampReport.usersRequiringMigration > 0 ? (
                <label className="flex items-start gap-3 p-3 bg-blue-500/10 border border-blue-500/30 rounded-xl cursor-pointer hover:bg-blue-500/15 transition-colors">
                  <input
                    type="checkbox"
                    checked={confirmExecuteTimestamps}
                    onChange={(e) => setConfirmExecuteTimestamps(e.target.checked)}
                    className="mt-0.5 accent-blue-500 h-4 w-4 rounded cursor-pointer"
                  />
                  <div className="text-xs text-blue-200">
                    <span className="font-bold block">Require Admin Authorization</span>
                    <span>
                      I have verified the preview conversions above and authorize updating expiryDate to native Firestore Timestamps for {timestampReport.usersRequiringMigration} users. No subscription tiers, payment statuses, or dates will be altered.
                    </span>
                  </div>
                </label>
              ) : (
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-xs text-emerald-300 font-medium">
                  ✓ All user expiration dates are already native Firestore Timestamps or null. No conversion writes required.
                </div>
              )}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowTimestampModal(false);
                    setConfirmExecuteTimestamps(false);
                  }}
                  className="flex-1 py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl transition-all cursor-pointer"
                >
                  Cancel / Close Dry Run
                </button>
                {timestampReport.usersRequiringMigration > 0 && (
                  <button
                    type="button"
                    onClick={handleExecuteConfirmedTimestampMigration}
                    disabled={!confirmExecuteTimestamps || isExecutingTimestamps}
                    className="flex-1 py-2.5 px-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-black text-xs rounded-xl shadow-lg shadow-blue-600/25 transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {isExecutingTimestamps ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Committing Migrations...</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4" />
                        <span>Commit {timestampReport.usersRequiringMigration} Migrations</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
