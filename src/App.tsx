import React from 'react';
import {
  Motorcycle,
  MaintenanceReminder,
  ServiceRecord,
  ActiveTab,
  UserSubscription,
  PaymentMethod,
  UserAccount,
  CloudSyncStatus,
  LegacyMigrationDryRun,
  SyncConflictItem,
} from './types';
import {
  loadMotorcycles,
  saveMotorcycles,
  loadReminders,
  saveReminders,
  loadServiceRecords,
  saveServiceRecords,
  loadActiveBikeId,
  saveActiveBikeId,
  loadQuickKmPresets,
  saveQuickKmPresets,
  analyzeReminder,
  loadUserAccounts,
  saveUserAccounts,
  INITIAL_USER_ACCOUNTS,
  loadUserScopedMotorcycles,
  saveUserScopedMotorcycles,
  loadUserScopedReminders,
  saveUserScopedReminders,
  loadUserScopedServiceRecords,
  saveUserScopedServiceRecords,
  loadUserScopedActiveBikeId,
  saveUserScopedActiveBikeId,
  enqueueOfflineMutation,
  removeOfflineMutation,
  getOfflineMutationQueue,
  createImmutablePreMigrationBackup,
  loadMigrationLedger,
  skipLegacyMigrationForUser,
  inspectLegacyDataDryRun,
  resolveMotorcycleConflict,
  getKnownCloudVersion,
  getKnownCloudRevision,
} from './utils/storage';
import { sounds } from './utils/audio';

// Components
import { Navbar } from './components/Navbar';
import { GarageHeader } from './components/GarageHeader';
import { MaintenanceCard } from './components/MaintenanceCard';
import { ServiceLogbookView } from './components/ServiceLogbookView';
import { LtoView } from './components/LtoView';
import { OnboardingView } from './components/OnboardingView';
import { OfflineIndicator } from './components/OfflineIndicator';
import { OverdueAlertBanner } from './components/OverdueAlertBanner';
import { triggerOverdueAlert } from './utils/notifications';
import { AdminUsersPortal } from './components/AdminUsersPortal';

// Lazy-loaded modals for optimal bundle splitting
const GpsRideTrackerSheet = React.lazy(() =>
  import('./components/GpsRideTrackerSheet').then((m) => ({ default: m.GpsRideTrackerSheet }))
);
const QuickAddOdometerModal = React.lazy(() =>
  import('./components/QuickAddOdometerModal').then((m) => ({ default: m.QuickAddOdometerModal }))
);
const GarageModal = React.lazy(() =>
  import('./components/GarageModal').then((m) => ({ default: m.GarageModal }))
);
const AddReminderModal = React.lazy(() =>
  import('./components/AddReminderModal').then((m) => ({ default: m.AddReminderModal }))
);
const AddServiceRecordModal = React.lazy(() =>
  import('./components/AddServiceRecordModal').then((m) => ({ default: m.AddServiceRecordModal }))
);
const PaywallModal = React.lazy(() =>
  import('./components/PaywallModal').then((m) => ({ default: m.PaywallModal }))
);
const LegacyMigrationModal = React.lazy(() =>
  import('./components/LegacyMigrationModal').then((m) => ({ default: m.LegacyMigrationModal }))
);

import { Plus } from 'lucide-react';
import { generateOemSchedule, PhilippineModelPreset } from './data/philippinePresets';
import { useAuth } from './context/AuthContext';
import {
  saveMotorcycleToFirestore,
  updateMotorcycleFieldsInFirestore,
  deleteMotorcycleFromFirestore,
  subscribeToUserMotorcycles,
  saveReminderToFirestore,
  saveRemindersBatchToFirestore,
  deleteReminderFromFirestore,
  subscribeToUserReminders,
  saveServiceRecordToFirestore,
  deleteServiceRecordFromFirestore,
  subscribeToUserServiceRecords,
  flushOfflineMutationQueue,
  syncStorageToFirestore,
  resolveEntityBaseCloudVersion,
  scheduleDirectOnlineOdometerUpdate,
  executeDirectOnlineWrite,
} from './utils/firestoreService';

/**
 * `useHydrateUserData`:
 * Fetches and subscribes to user-scoped Firestore documents (/motorcycles, /reminders, /serviceRecords)
 * when a user is authenticated, merging them into UID-scoped LocalStorage with timestamp-based
 * conflict resolution, managing safe account switching, and preparing the dry-run preview for
 * legacy unscoped LocalStorage records without automatically migrating them.
 */
export function useHydrateUserData(params: {
  user: { uid: string; email?: string | null } | null;
  hasProAccess: boolean;
  setMotorcycles: React.Dispatch<React.SetStateAction<Motorcycle[]>>;
  setReminders: React.Dispatch<React.SetStateAction<MaintenanceReminder[]>>;
  setServiceRecords: React.Dispatch<React.SetStateAction<ServiceRecord[]>>;
  setActiveBikeId: React.Dispatch<React.SetStateAction<string>>;
}) {
  const {
    user,
    hasProAccess,
    setMotorcycles,
    setReminders,
    setServiceRecords,
    setActiveBikeId,
  } = params;

  const [syncStatus, setSyncStatus] = React.useState<CloudSyncStatus>('synced');
  const [hydratedUid, setHydratedUid] = React.useState<string | null>(() => user?.uid || null);
  const [migrationDryRun, setMigrationDryRun] = React.useState<LegacyMigrationDryRun | null>(null);
  const [isMigrationModalOpen, setIsMigrationModalOpen] = React.useState(false);
  const [isMigrating, setIsMigrating] = React.useState(false);
  const [activeConflicts, setActiveConflicts] = React.useState<SyncConflictItem[]>([]);
  const [isConflictModalOpen, setIsConflictModalOpen] = React.useState(false);

  const prevUidRef = React.useRef<string | null>(null);
  const latestCloudBikesRef = React.useRef<Motorcycle[]>([]);
  const latestCloudRemindersRef = React.useRef<MaintenanceReminder[]>([]);
  const latestCloudRecordsRef = React.useRef<ServiceRecord[]>([]);
  const hasEvaluatedLegacyForUidRef = React.useRef<string | null>(null);

  // Handle Account Switching & Real-Time Firestore Hydration
  React.useEffect(() => {
    const currentUid = user?.uid || null;
    const prevUid = prevUidRef.current;

    // 1. If switching from a signed-in user to another user or signing out:
    // Clear in-memory state immediately so User A's garage never bleeds into User B's session.
    if (prevUid && prevUid !== currentUid) {
      flushOfflineMutationQueue(prevUid).catch(() => {});
      if (!currentUid) {
        setMotorcycles([]);
        setReminders([]);
        setServiceRecords([]);
        setActiveBikeId('');
        setMigrationDryRun(null);
        setIsMigrationModalOpen(false);
        setActiveConflicts([]);
        setHydratedUid(null);
        prevUidRef.current = null;
        return;
      }
    }

    prevUidRef.current = currentUid;
    if (!currentUid) {
      setHydratedUid(null);
      return;
    }

    // 2. Hydrate immediately from UID-scoped read-through cache for 0ms offline-capable UI
    const cachedBikes = loadUserScopedMotorcycles(currentUid);
    const cachedReminders = loadUserScopedReminders(currentUid);
    const cachedRecords = loadUserScopedServiceRecords(currentUid);

    setMotorcycles(cachedBikes);
    setReminders(cachedReminders);
    setServiceRecords(cachedRecords);
    setActiveBikeId(loadUserScopedActiveBikeId(currentUid, cachedBikes));
    setHydratedUid(currentUid);

    const pendingQueue = getOfflineMutationQueue(currentUid);
    const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
    if (pendingQueue.length > 0 && !isOffline) {
      setSyncStatus('syncing');
      flushOfflineMutationQueue(currentUid)
        .then((res) => {
          if (res.skippedOffline) {
            setSyncStatus('offline_cache');
          } else {
            setSyncStatus(res.failedCount > 0 ? 'offline_cache' : 'synced');
          }
        })
        .catch(() => setSyncStatus('offline_cache'));
    } else {
      setSyncStatus(isOffline ? 'offline_cache' : 'synced');
    }

    let initialBikesLoaded = false;

    const evaluateLegacyMigrationIfNeeded = () => {
      if (hasEvaluatedLegacyForUidRef.current === currentUid) return;
      hasEvaluatedLegacyForUidRef.current = currentUid;

      const ledger = loadMigrationLedger(currentUid);
      if (ledger && (ledger.status === 'completed' || ledger.status === 'skipped')) {
        return;
      }

      const dryRun = inspectLegacyDataDryRun({
        userId: currentUid,
        userEmail: user?.email || 'Rider',
        hasProAccess,
        cloudMotorcycles: latestCloudBikesRef.current,
        cloudReminders: latestCloudRemindersRef.current,
        cloudServiceRecords: latestCloudRecordsRef.current,
      });

      if (dryRun.hasLegacyDataToReview || ledger?.status === 'in_progress') {
        createImmutablePreMigrationBackup(currentUid, user?.email || 'Rider');
        setMigrationDryRun(dryRun);
        setIsMigrationModalOpen(true);
      }
    };

    // 3. Attach scoped Firestore real-time listeners
    const unsubBikes = subscribeToUserMotorcycles(
      currentUid,
      (cloudBikes) => {
        latestCloudBikesRef.current = cloudBikes;
        initialBikesLoaded = true;

        setMotorcycles((prevLocal) => {
          const localById = new Map(prevLocal.map((b) => [b.id, b]));
          const newConflicts: SyncConflictItem[] = [];
          const merged: Motorcycle[] = cloudBikes.map((cBike) => {
            const lBike = localById.get(cBike.id);
            if (!lBike) return cBike;
            const res = resolveMotorcycleConflict(lBike, cBike);
            if (res.conflict) {
              newConflicts.push(res.conflict);
            }
            return res.resolved;
          });

          // Preserve any offline-queued newly created motorcycles not yet confirmed by server
          const pendingUpsertIds = new Set(
            getOfflineMutationQueue(currentUid)
              .filter((q) => q.entity === 'motorcycle' && q.action === 'upsert')
              .map((q) => q.targetId)
          );
          for (const lBike of prevLocal) {
            if (pendingUpsertIds.has(lBike.id) && !merged.some((m) => m.id === lBike.id)) {
              merged.push(lBike);
            }
          }

          if (newConflicts.length > 0) {
            setActiveConflicts((prev) => {
              const existingIds = new Set(prev.map((c) => c.id));
              return [...prev, ...newConflicts.filter((c) => !existingIds.has(c.id))];
            });
          }

          saveUserScopedMotorcycles(currentUid, merged);
          return merged;
        });

        setActiveBikeId((prevActive) => {
          if (prevActive && cloudBikes.some((b) => b.id === prevActive)) {
            return prevActive;
          }
          const nextId = loadUserScopedActiveBikeId(currentUid, cloudBikes);
          if (nextId) saveUserScopedActiveBikeId(currentUid, nextId);
          return nextId;
        });

        evaluateLegacyMigrationIfNeeded();
      },
      () => {
        setSyncStatus('offline_cache');
        if (!initialBikesLoaded) {
          evaluateLegacyMigrationIfNeeded();
        }
      }
    );

    const unsubReminders = subscribeToUserReminders(
      currentUid,
      (cloudReminders) => {
        latestCloudRemindersRef.current = cloudReminders;
        saveUserScopedReminders(currentUid, cloudReminders);
        setReminders(cloudReminders);
      },
      () => {
        setSyncStatus('offline_cache');
      }
    );

    const unsubRecords = subscribeToUserServiceRecords(
      currentUid,
      (cloudRecords) => {
        latestCloudRecordsRef.current = cloudRecords;
        saveUserScopedServiceRecords(currentUid, cloudRecords);
        setServiceRecords(cloudRecords);
      },
      () => {
        setSyncStatus('offline_cache');
      }
    );

    // Fallback check for environments where snapshot is mocked or delayed
    const fallbackTimer = setTimeout(() => {
      if (!initialBikesLoaded) {
        evaluateLegacyMigrationIfNeeded();
      }
    }, 150);

    return () => {
      clearTimeout(fallbackTimer);
      unsubBikes();
      unsubReminders();
      unsubRecords();
    };
  }, [user?.uid, hasProAccess]);

  // Listen to online/offline & page lifecycle events to flush queued mutations safely
  React.useEffect(() => {
    const uid = user?.uid;
    if (!uid) return;

    const handleOnline = async () => {
      setSyncStatus('syncing');
      const res = await flushOfflineMutationQueue(uid);
      setSyncStatus(res.failedCount > 0 ? 'sync_error' : 'synced');
    };

    const handleOffline = () => {
      setSyncStatus('offline_cache');
    };

    const handleVisibilityOrUnload = () => {
      if (document.visibilityState === 'hidden') {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          return;
        }
        flushOfflineMutationQueue(uid).catch(() => {});
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibilityOrUnload);
    window.addEventListener('pagehide', handleVisibilityOrUnload);
    window.addEventListener('beforeunload', handleVisibilityOrUnload);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibilityOrUnload);
      window.removeEventListener('pagehide', handleVisibilityOrUnload);
      window.removeEventListener('beforeunload', handleVisibilityOrUnload);
    };
  }, [user?.uid]);

  const handleConfirmLegacyMigration = async (selectedBikeIds?: string[]) => {
    if (!user?.uid || !migrationDryRun) return;
    setIsMigrating(true);
    setSyncStatus('syncing');
    try {
      const res = await syncStorageToFirestore({
        userId: user.uid,
        userEmail: user.email || 'Rider',
        hasProAccess,
        userConfirmedOwnership: true,
        selectedBikeIds,
        motorcyclesToSync: migrationDryRun.eligibleMotorcycles,
        remindersToSync: migrationDryRun.eligibleReminders,
        serviceRecordsToSync: migrationDryRun.eligibleServiceRecords,
        existingCloudMotorcycles: latestCloudBikesRef.current,
        existingCloudReminders: latestCloudRemindersRef.current,
        existingCloudServiceRecords: latestCloudRecordsRef.current,
      });

      if (res.conflicts.length > 0) {
        setActiveConflicts(res.conflicts);
      }

      // Immediately reflect migrated records in state and UID-scoped cache
      const bikesToKeep =
        selectedBikeIds && selectedBikeIds.length > 0
          ? migrationDryRun.eligibleMotorcycles.filter((b) => selectedBikeIds.includes(b.id))
          : migrationDryRun.eligibleMotorcycles;
      const mergedBikes = [
        ...latestCloudBikesRef.current,
        ...bikesToKeep.filter((b) => !latestCloudBikesRef.current.some((cb) => cb.id === b.id)),
      ];
      const mergedRems = [
        ...latestCloudRemindersRef.current,
        ...migrationDryRun.eligibleReminders.filter(
          (r) => !latestCloudRemindersRef.current.some((cr) => cr.id === r.id)
        ),
      ];
      const mergedRecs = [
        ...latestCloudRecordsRef.current,
        ...migrationDryRun.eligibleServiceRecords.filter(
          (r) => !latestCloudRecordsRef.current.some((cr) => cr.id === r.id)
        ),
      ];

      setMotorcycles(mergedBikes);
      setReminders(mergedRems);
      setServiceRecords(mergedRecs);
      if (mergedBikes.length > 0) {
        setActiveBikeId(mergedBikes[0].id);
      }

      setIsMigrationModalOpen(false);
      setMigrationDryRun(null);
      setSyncStatus('synced');
    } catch (err) {
      console.error('Migration error:', err);
      setSyncStatus('sync_error');
    } finally {
      setIsMigrating(false);
    }
  };

  const handleSkipLegacyMigration = () => {
    if (!user?.uid) return;
    skipLegacyMigrationForUser(user.uid, user.email || 'Rider');
    setIsMigrationModalOpen(false);
    setMigrationDryRun(null);
  };

  const handleResolveConflict = async (
    conflictId: string,
    resolution: 'keep_cloud' | 'use_local'
  ) => {
    const conflict = activeConflicts.find((c) => c.id === conflictId);
    if (!conflict || !user?.uid) return;

    if (resolution === 'use_local') {
      const cloudRec = conflict.cloudRecord as {
        updatedAt?: string;
        createdAt?: string;
        cloudVersion?: number;
      };
      const concurrencyOptions = {
        enforceVersionCheck: true,
        baseCloudUpdatedAt: cloudRec?.updatedAt || cloudRec?.createdAt || null,
        baseCloudVersion:
          typeof cloudRec?.cloudVersion === 'number' ? cloudRec.cloudVersion : null,
        expectedCloudAbsent: false,
      };

      setSyncStatus('syncing');
      try {
        if (conflict.entity === 'motorcycle') {
          const localBike = conflict.localRecord as Motorcycle;
          await saveMotorcycleToFirestore(
            { ...localBike, userId: user.uid },
            user.uid,
            concurrencyOptions
          );
          setMotorcycles((prev) =>
            prev.map((b) => (b.id === localBike.id ? { ...localBike, userId: user.uid } : b))
          );
        } else if (conflict.entity === 'reminder') {
          const localRem = conflict.localRecord as MaintenanceReminder;
          await saveReminderToFirestore(
            { ...localRem, userId: user.uid },
            user.uid,
            concurrencyOptions
          );
          setReminders((prev) =>
            prev.map((r) => (r.id === localRem.id ? { ...localRem, userId: user.uid } : r))
          );
        } else if (conflict.entity === 'serviceRecord') {
          const localRec = conflict.localRecord as ServiceRecord;
          await saveServiceRecordToFirestore(
            { ...localRec, userId: user.uid },
            user.uid,
            undefined,
            concurrencyOptions
          );
          setServiceRecords((prev) =>
            prev.map((r) => (r.id === localRec.id ? { ...localRec, userId: user.uid } : r))
          );
        }
        setSyncStatus('synced');
      } catch {
        setSyncStatus('sync_error');
        return;
      }
    }

    setActiveConflicts((prev) => prev.filter((c) => c.id !== conflictId));
  };

  const handleRetrySync = async () => {
    if (!user?.uid) return;
    setSyncStatus('syncing');
    const res = await flushOfflineMutationQueue(user.uid);
    setSyncStatus(res.failedCount > 0 ? 'sync_error' : 'synced');
  };

  return {
    syncStatus,
    setSyncStatus,
    hydratedUid,
    migrationDryRun,
    isMigrationModalOpen,
    setIsMigrationModalOpen,
    isMigrating,
    activeConflicts,
    isConflictModalOpen,
    setIsConflictModalOpen,
    handleConfirmLegacyMigration,
    handleSkipLegacyMigration,
    handleResolveConflict,
    handleRetrySync,
  };
}

export default function App() {
  const {
    user,
    loading: authLoading,
    hasProAccess: contextHasProAccess,
    subscription,
    submitPaymentRef,
  } = useAuth();
  const isExactAdmin =
    Boolean(user) &&
    user?.email?.toLowerCase() === 'mustetm7@gmail.com' &&
    user?.emailVerified === true;
  const isActivePaidProSubscriber =
    subscription.tier === 'pro' &&
    subscription.status === 'active' &&
    !subscription.isExpired;
  const hasProAccess =
    contextHasProAccess ?? (isExactAdmin || isActivePaidProSubscriber);
  const isPro = hasProAccess;

  // --- Persistent State ---
  const [motorcycles, setMotorcycles] = React.useState<Motorcycle[]>(() =>
    user?.uid ? loadUserScopedMotorcycles(user.uid) : loadMotorcycles()
  );
  const [activeBikeId, setActiveBikeId] = React.useState<string>(() =>
    user?.uid ? loadUserScopedActiveBikeId(user.uid, motorcycles) : loadActiveBikeId(motorcycles)
  );
  const [reminders, setReminders] = React.useState<MaintenanceReminder[]>(() =>
    user?.uid ? loadUserScopedReminders(user.uid) : loadReminders()
  );
  const [serviceRecords, setServiceRecords] = React.useState<ServiceRecord[]>(() =>
    user?.uid ? loadUserScopedServiceRecords(user.uid) : loadServiceRecords()
  );
  const [quickPresets, setQuickPresets] = React.useState<number[]>(() => loadQuickKmPresets());

  // User Accounts State (persisted for Admin Review)
  const [userAccounts, setUserAccounts] = React.useState<UserAccount[]>(() => loadUserAccounts());

  const {
    syncStatus,
    setSyncStatus,
    hydratedUid,
    migrationDryRun,
    isMigrationModalOpen,
    isMigrating,
    activeConflicts,
    isConflictModalOpen,
    setIsConflictModalOpen,
    handleConfirmLegacyMigration,
    handleSkipLegacyMigration,
    handleResolveConflict,
    handleRetrySync,
  } = useHydrateUserData({
    user,
    hasProAccess,
    setMotorcycles,
    setReminders,
    setServiceRecords,
    setActiveBikeId,
  });

  const odoDebounceTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Separate Admin Page URL detection (/admin or #admin)
  const checkIsAdminPage = () => {
    if (typeof window === 'undefined') return false;
    const path = window.location.pathname.toLowerCase();
    const hash = window.location.hash.toLowerCase();
    const query = new URLSearchParams(window.location.search).get('admin');
    return (
      path === '/admin' ||
      path.startsWith('/admin/') ||
      hash === '#admin' ||
      hash.startsWith('#admin') ||
      query === 'true'
    );
  };

  const [isAdminPortal, setIsAdminPortal] = React.useState<boolean>(() => checkIsAdminPage());

  // Active Tab
  const [activeTab, setActiveTab] = React.useState<ActiveTab>('garage');

  // Modals state
  const [isQuickAddOdoOpen, setIsQuickAddOdoOpen] = React.useState(false);
  const [isGarageModalOpen, setIsGarageModalOpen] = React.useState(false);
  const [editingBike, setEditingBike] = React.useState<Motorcycle | null>(null);

  const [isReminderModalOpen, setIsReminderModalOpen] = React.useState(false);
  const [editingReminder, setEditingReminder] = React.useState<MaintenanceReminder | null>(null);

  const [isServiceModalOpen, setIsServiceModalOpen] = React.useState(false);
  const [serviceModalInitialTitle, setServiceModalInitialTitle] = React.useState<string>('');
  const [serviceModalInitialReminderId, setServiceModalInitialReminderId] = React.useState<string | undefined>();

  const [isPaywallOpen, setIsPaywallOpen] = React.useState(false);
  const [isGpsModalOpen, setIsGpsModalOpen] = React.useState(false);
  const [isOverdueBannerDismissed, setIsOverdueBannerDismissed] = React.useState(false);
  const alertedOverdueIds = React.useRef<Set<string>>(new Set());

  // Listen to path, hash and popstate changes (for direct /admin URL)
  React.useEffect(() => {
    const handleUrlChange = () => {
      setIsAdminPortal(checkIsAdminPage());
    };

    window.addEventListener('hashchange', handleUrlChange);
    window.addEventListener('popstate', handleUrlChange);
    return () => {
      window.removeEventListener('hashchange', handleUrlChange);
      window.removeEventListener('popstate', handleUrlChange);
    };
  }, []);

  // Sync to read-through UID-scoped LocalStorage cache when authenticated, or local guest storage when unauthenticated
  React.useEffect(() => {
    if (user?.uid) {
      if (hydratedUid === user.uid) {
        saveUserScopedMotorcycles(user.uid, motorcycles);
      }
    } else {
      saveMotorcycles(motorcycles);
    }
  }, [motorcycles, user?.uid, hydratedUid]);

  React.useEffect(() => {
    if (user?.uid) {
      if (hydratedUid === user.uid) {
        saveUserScopedReminders(user.uid, reminders);
      }
    } else {
      saveReminders(reminders);
    }
  }, [reminders, user?.uid, hydratedUid]);

  React.useEffect(() => {
    if (user?.uid) {
      if (hydratedUid === user.uid) {
        saveUserScopedServiceRecords(user.uid, serviceRecords);
      }
    } else {
      saveServiceRecords(serviceRecords);
    }
  }, [serviceRecords, user?.uid, hydratedUid]);

  React.useEffect(() => {
    saveQuickKmPresets(quickPresets);
  }, [quickPresets]);

  React.useEffect(() => {
    saveUserAccounts(userAccounts);
  }, [userAccounts]);

  React.useEffect(() => {
    if (activeBikeId) {
      if (user?.uid) {
        if (hydratedUid === user.uid) {
          saveUserScopedActiveBikeId(user.uid, activeBikeId);
        }
      } else {
        saveActiveBikeId(activeBikeId);
      }
    }
  }, [activeBikeId, user?.uid, hydratedUid]);

  // Active Bike lookup
  const activeBike: Motorcycle =
    motorcycles.find((b) => b.id === activeBikeId) || motorcycles[0] || ({} as Motorcycle);

  // Reminders & Overdue tracking for active bike
  const activeReminders = reminders.filter((r) => r.bikeId === activeBike?.id);
  const overdueReminders = activeReminders.filter(
    (r) => analyzeReminder(r, activeBike?.odometer || 0).status === 'overdue'
  );
  const overdueCount = overdueReminders.length;

  // --- Handlers ---
  const handleSelectBike = (bikeId: string) => {
    sounds.playClick();
    setActiveBikeId(bikeId);
    setIsOverdueBannerDismissed(false);
  };

  const resolveBaseVersionForEntity = (
    entity: 'motorcycle' | 'reminder' | 'serviceRecord',
    targetId: string,
    existingRecord?: {
      updatedAt?: string;
      createdAt?: string;
      timestampSource?: string;
      cloudVersion?: number;
    }
  ): {
    baseCloudUpdatedAt: string | null;
    baseCloudVersion: number | null;
    expectedCloudAbsent: boolean;
  } => {
    const res = resolveEntityBaseCloudVersion(user?.uid, entity, targetId, existingRecord);
    return {
      baseCloudUpdatedAt: res.baseCloudUpdatedAt ?? null,
      baseCloudVersion: res.baseCloudVersion ?? null,
      expectedCloudAbsent: Boolean(res.expectedCloudAbsent),
    };
  };

  const handleUpdateOdometer = (newOdo: number) => {
    const nowIso = new Date().toISOString();
    const targetBikeId = activeBike?.id;
    // Capture original base version BEFORE optimistic local state update
    const preEditBike = motorcycles.find((b) => b.id === targetBikeId);
    const baseVersion = targetBikeId
      ? resolveBaseVersionForEntity('motorcycle', targetBikeId, preEditBike)
      : { baseCloudUpdatedAt: null, baseCloudVersion: null, expectedCloudAbsent: false };

    const updated = motorcycles.map((b) =>
      b.id === targetBikeId
        ? { ...b, odometer: newOdo, updatedAt: nowIso, timestampSource: 'client_pending' as const }
        : b
    );
    setMotorcycles(updated);

    if (user?.uid && targetBikeId) {
      scheduleDirectOnlineOdometerUpdate({
        userId: user.uid,
        targetBikeId,
        newOdo,
        preEditBike: preEditBike
          ? {
              ...preEditBike,
              updatedAt: baseVersion.baseCloudUpdatedAt || preEditBike.updatedAt,
              cloudVersion: baseVersion.baseCloudVersion ?? preEditBike.cloudVersion,
            }
          : null,
        debounceTimerRef: odoDebounceTimerRef,
        delayMs: 600,
        onStatusChange: (status) => setSyncStatus(status),
      });
    }

    // Check if newly reached odometer pushes any maintenance task into OVERDUE
    const newlyOverdue = activeReminders.filter((r) => {
      const isOverdueNow = analyzeReminder(r, newOdo).status === 'overdue';
      const wasAlreadyAlerted = alertedOverdueIds.current.has(r.id);
      return isOverdueNow && !wasAlreadyAlerted;
    });

    if (newlyOverdue.length > 0) {
      // Trigger browser push notification, phone vibration, and urgent automotive sound
      newlyOverdue.forEach((rem) => {
        triggerOverdueAlert(rem, { ...activeBike, odometer: newOdo }, newOdo - rem.nextDueOdo);
        alertedOverdueIds.current.add(rem.id);
      });
      setIsOverdueBannerDismissed(false);
    }
  };

  const handleAddKm = (km: number) => {
    handleUpdateOdometer(activeBike.odometer + km);
  };

  const handleFinishGpsRide = (rideDistanceKm: number) => {
    if (!isPro) {
      setIsGpsModalOpen(false);
      setIsPaywallOpen(true);
      return;
    }
    const newOdo = Math.round(activeBike.odometer + rideDistanceKm);
    handleUpdateOdometer(newOdo);
    sounds.playSuccess();
  };

  const handleSaveBike = async (bike: Motorcycle, selectedPreset?: PhilippineModelPreset) => {
    const existingBike = motorcycles.find((b) => b.id === bike.id);
    const exists = Boolean(existingBike);
    if (!exists && !isPro && motorcycles.length >= 1) {
      setIsPaywallOpen(true);
      return;
    }

    // Capture original base version BEFORE optimistic local state update
    const preEditRecord = existingBike
      ? {
          ...existingBike,
          cloudVersion: bike.cloudVersion ?? existingBike.cloudVersion,
        }
      : null;

    if (odoDebounceTimerRef.current && activeBike?.id === bike.id) {
      clearTimeout(odoDebounceTimerRef.current);
      odoDebounceTimerRef.current = null;
    }

    const nowIso = new Date().toISOString();
    const stampedBike: Motorcycle = {
      ...bike,
      userId: user?.uid || bike.userId,
      createdAt: bike.createdAt || nowIso,
      updatedAt: nowIso,
      timestampSource: 'client_pending',
    };

    const oemReminders: MaintenanceReminder[] =
      !exists && selectedPreset
        ? generateOemSchedule(bike.id, selectedPreset, bike.odometer).map((r, idx) => ({
            ...r,
            id: `rem-${bike.id}-oem-${idx + 1}`,
            userId: user?.uid,
            createdAt: nowIso,
            updatedAt: nowIso,
            timestampSource: 'client_pending' as const,
          }))
        : [];

    if (user?.uid) {
      setSyncStatus('syncing');
      const res = await executeDirectOnlineWrite({
        userId: user.uid,
        entity: 'motorcycle',
        action: 'upsert',
        targetId: stampedBike.id,
        payload: stampedBike as unknown as Record<string, unknown>,
        preEditRecord,
        oemRemindersToCreate: oemReminders,
      });

      if (res.status === 'quota_or_permission_error') {
        setSyncStatus('synced');
        setIsPaywallOpen(true);
        return;
      }
      if (res.status === 'version_conflict') {
        setSyncStatus('sync_error');
        return;
      }
      setSyncStatus(res.status === 'synced' ? 'synced' : 'offline_cache');
    }

    if (exists) {
      setMotorcycles(motorcycles.map((b) => (b.id === bike.id ? stampedBike : b)));
    } else {
      setMotorcycles([...motorcycles, stampedBike]);
      setActiveBikeId(stampedBike.id);
      if (oemReminders.length > 0) {
        setReminders([...reminders, ...oemReminders]);
      }
    }
  };

  const handleDeleteBike = async (bikeId: string) => {
    sounds.playClick();
    // Capture original base version BEFORE optimistic local state update
    const preDeleteBike = motorcycles.find((b) => b.id === bikeId);

    if (odoDebounceTimerRef.current && activeBike?.id === bikeId) {
      clearTimeout(odoDebounceTimerRef.current);
      odoDebounceTimerRef.current = null;
    }

    // PHASE 3 DATA RETENTION: Preserve service records when a motorcycle is removed or retired!
    const remaining = motorcycles.filter((b) => b.id !== bikeId);
    setMotorcycles(remaining);
    setActiveBikeId(remaining.length > 0 ? remaining[0].id : '');
    setReminders(reminders.filter((r) => r.bikeId !== bikeId));

    if (user?.uid) {
      setSyncStatus('syncing');
      const res = await executeDirectOnlineWrite({
        userId: user.uid,
        entity: 'motorcycle',
        action: 'delete',
        targetId: bikeId,
        preEditRecord: preDeleteBike,
        deleteOptions: {
          deleteReminders: true,
          deleteServiceHistoryConfirmed: false,
        },
      });
      if (res.status === 'version_conflict') {
        setSyncStatus('sync_error');
      } else {
        setSyncStatus(res.status === 'synced' ? 'synced' : 'offline_cache');
      }
    }
  };

  const handleSaveReminder = async (reminder: MaintenanceReminder) => {
    const existingRem = reminders.find((r) => r.id === reminder.id);
    const exists = Boolean(existingRem);
    // Capture original base version BEFORE optimistic local state update
    const preEditRecord = existingRem
      ? {
          ...existingRem,
          cloudVersion: reminder.cloudVersion ?? existingRem.cloudVersion,
        }
      : null;

    const nowIso = new Date().toISOString();
    const stampedReminder: MaintenanceReminder = {
      ...reminder,
      userId: user?.uid || reminder.userId,
      createdAt: reminder.createdAt || nowIso,
      updatedAt: nowIso,
      timestampSource: 'client_pending',
    };

    if (exists) {
      setReminders(reminders.map((r) => (r.id === reminder.id ? stampedReminder : r)));
    } else {
      setReminders([...reminders, stampedReminder]);
    }

    if (user?.uid) {
      setSyncStatus('syncing');
      const res = await executeDirectOnlineWrite({
        userId: user.uid,
        entity: 'reminder',
        action: 'upsert',
        targetId: stampedReminder.id,
        payload: stampedReminder as unknown as Record<string, unknown>,
        preEditRecord,
      });
      if (res.status === 'version_conflict') {
        setSyncStatus('sync_error');
      } else {
        setSyncStatus(res.status === 'synced' ? 'synced' : 'offline_cache');
      }
    }
  };

  const handleDeleteReminder = async (reminderId: string) => {
    sounds.playClick();
    // Capture original base version BEFORE optimistic local state update
    const preDeleteRem = reminders.find((r) => r.id === reminderId);
    setReminders(reminders.filter((r) => r.id !== reminderId));

    if (user?.uid) {
      setSyncStatus('syncing');
      const res = await executeDirectOnlineWrite({
        userId: user.uid,
        entity: 'reminder',
        action: 'delete',
        targetId: reminderId,
        preEditRecord: preDeleteRem,
      });
      if (res.status === 'version_conflict') {
        setSyncStatus('sync_error');
      } else {
        setSyncStatus(res.status === 'synced' ? 'synced' : 'offline_cache');
      }
    }
  };

  const handleSaveServiceRecord = async (record: ServiceRecord, linkedReminderId?: string) => {
    // Capture original base versions BEFORE optimistic local state updates
    const existingRecord = serviceRecords.find((r) => r.id === record.id);
    const preEditRecord = existingRecord
      ? {
          ...existingRecord,
          cloudVersion: record.cloudVersion ?? existingRecord.cloudVersion,
        }
      : null;
    const existingLinkedRem = linkedReminderId
      ? reminders.find((r) => r.id === linkedReminderId)
      : undefined;

    const nowIso = new Date().toISOString();
    const stampedRecord: ServiceRecord = {
      ...record,
      userId: user?.uid || record.userId,
      bikeLabelSnapshot:
        record.bikeLabelSnapshot ||
        (activeBike?.id
          ? `${activeBike.year} ${activeBike.brand} ${activeBike.model} (${activeBike.licensePlate || activeBike.nickname || 'Bike'})`
          : undefined),
      createdAt: record.createdAt || nowIso,
      updatedAt: nowIso,
      timestampSource: 'client_pending',
    };

    setServiceRecords([stampedRecord, ...serviceRecords]);

    let updatedReminderForSync: MaintenanceReminder | undefined;

    // Reset linked reminder target if provided
    if (linkedReminderId) {
      alertedOverdueIds.current.delete(linkedReminderId);
      setReminders((prev) =>
        prev.map((r) => {
          if (r.id === linkedReminderId) {
            const resetRem: MaintenanceReminder = {
              ...r,
              lastCompletedDate: record.date,
              lastCompletedOdo: record.odometer,
              nextDueOdo: record.odometer + r.intervalKm,
              updatedAt: nowIso,
              timestampSource: 'client_pending',
            };
            updatedReminderForSync = resetRem;
            return resetRem;
          }
          return r;
        })
      );
    }

    if (user?.uid) {
      setSyncStatus('syncing');
      const res = await executeDirectOnlineWrite({
        userId: user.uid,
        entity: 'serviceRecord',
        action: 'upsert',
        targetId: stampedRecord.id,
        payload: stampedRecord as unknown as Record<string, unknown>,
        preEditRecord,
        linkedReminderUpdate: updatedReminderForSync
          ? {
              reminder: updatedReminderForSync,
              preEditReminder: existingLinkedRem,
            }
          : undefined,
      });
      if (res.status === 'version_conflict') {
        setSyncStatus('sync_error');
      } else {
        setSyncStatus(res.status === 'synced' ? 'synced' : 'offline_cache');
      }
    }
  };

  const handleDeleteServiceRecord = async (recordId: string) => {
    sounds.playClick();
    // Capture original base version BEFORE optimistic local state update
    const preDeleteRec = serviceRecords.find((r) => r.id === recordId);
    setServiceRecords(serviceRecords.filter((r) => r.id !== recordId));

    if (user?.uid) {
      setSyncStatus('syncing');
      const res = await executeDirectOnlineWrite({
        userId: user.uid,
        entity: 'serviceRecord',
        action: 'delete',
        targetId: recordId,
        preEditRecord: preDeleteRec,
      });
      if (res.status === 'version_conflict') {
        setSyncStatus('sync_error');
      } else {
        setSyncStatus(res.status === 'synced' ? 'synced' : 'offline_cache');
      }
    }
  };

  const handleOpenAdminPortal = () => {
    sounds.playClick();
    if (typeof window !== 'undefined') {
      window.location.hash = 'admin';
    }
    setIsAdminPortal(true);
  };

  const handleCloseAdminPortal = () => {
    sounds.playClick();
    if (typeof window !== 'undefined') {
      if (window.location.hash.includes('admin')) {
        window.location.hash = '';
      }
      if (window.location.pathname.includes('/admin')) {
        window.history.pushState(null, '', '/');
      }
    }
    setIsAdminPortal(false);
  };

  const handleApprovePro = (userId: string) => {
    setUserAccounts((prev) =>
      prev.map((u) =>
        u.id === userId
          ? {
              ...u,
              subscriptionTier: 'pro',
              paymentStatus: 'active_pro',
              approvedAt: new Date().toISOString(),
              approvedBy: 'Admin (Manual)',
            }
          : u
      )
    );
  };

  const handleRevokePro = (userId: string) => {
    setUserAccounts((prev) =>
      prev.map((u) =>
        u.id === userId
          ? {
              ...u,
              subscriptionTier: 'free',
              paymentStatus: 'unpaid_free',
            }
          : u
      )
    );
  };

  const handleAddUser = (user: Omit<UserAccount, 'id' | 'registeredAt'>) => {
    const newUser: UserAccount = {
      ...user,
      id: `user-${Date.now().toString(36)}`,
      registeredAt: new Date().toISOString().split('T')[0],
    };
    setUserAccounts((prev) => [newUser, ...prev]);
  };

  const handleResetUsersToDefault = () => {
    setUserAccounts(INITIAL_USER_ACCOUNTS);
  };

  const currentRider = user
    ? userAccounts.find((u) => u.id === user.uid || u.email === user.email)
    : undefined;
  const isAlreadyPending =
    subscription.status === 'trial' || currentRider?.paymentStatus === 'pending_approval';
  const existingPendingRef = subscription.referenceNumber || currentRider?.referenceNumber;

  const handleSubmitReference = async (
    paymentMethod: PaymentMethod,
    referenceNumber: string
  ) => {
    const refCode = referenceNumber.trim() || `GCASH-${Math.floor(100000 + Math.random() * 900000)}`;

    // 1. Submit to Firebase Firestore
    try {
      await submitPaymentRef(
        paymentMethod,
        refCode,
        activeBike?.model || 'Motorcycle',
        activeBike?.licensePlate || ''
      );
    } catch (err) {
      console.warn('Could not submit payment to Firestore:', err);
      throw err;
    }

    // 2. Update local state if present
    if (user) {
      setUserAccounts((prev) =>
        prev.map((u) =>
          u.id === user.uid || u.email === user.email
            ? {
                ...u,
                subscriptionTier: 'free', // stays free until owner approves in /admin
                paymentStatus: 'pending_approval',
                paymentMethod,
                referenceNumber: refCode,
                amountPhp: 49,
                lastPaymentDate: new Date().toISOString(),
                notes: 'Submitted via Payment Gateway. Awaiting Admin manual approval.',
              }
            : u
        )
      );
    }
  };

  const handleCancelSubscription = () => {
    // Authoritative subscription changes are managed via Firestore
    setIsPaywallOpen(false);
  };

  if (isAdminPortal) {
    // 1. Loading state while Firebase Auth initializes session
    if (authLoading) {
      return (
        <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center items-center px-4 font-sans selection:bg-[#FF6B00] selection:text-white">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-[#FF6B00] border-t-transparent rounded-full animate-spin" />
            <p className="text-xs text-slate-400 font-medium">Verifying administrator credentials...</p>
          </div>
        </div>
      );
    }

    // 2. Reject authenticated non-admin users
    if (user && !isExactAdmin) {
      return (
        <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center items-center px-4 py-12 font-sans selection:bg-[#FF6B00] selection:text-white">
          <div className="w-full max-w-md p-6 sm:p-8 bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl space-y-5 text-center">
            <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 flex items-center justify-center mx-auto text-xl font-bold">
              ✕
            </div>
            <div className="space-y-1">
              <h2 className="text-lg font-black text-white">Access Denied</h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                The MotoCare Admin Portal is strictly restricted to administrator <span className="font-mono text-amber-300">mustetm7@gmail.com</span>.
              </p>
              <p className="text-[11px] text-slate-500 pt-1">
                You are currently signed in as <span className="font-mono text-slate-300">{user.email}</span>.
              </p>
            </div>
            <button
              type="button"
              onClick={handleCloseAdminPortal}
              className="w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs transition-colors cursor-pointer"
            >
              ← Return to Garage
            </button>
          </div>
        </div>
      );
    }

    // 3. Render AdminUsersPortal for exact admin or unauthenticated owner gate
    return (
      <AdminUsersPortal
        users={userAccounts}
        onApprovePro={handleApprovePro}
        onRevokePro={handleRevokePro}
        onAddUser={handleAddUser}
        onResetUsersToDefault={handleResetUsersToDefault}
        onReturnToApp={handleCloseAdminPortal}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-slate-900 flex flex-col font-sans selection:bg-[#FF6B00] selection:text-white">
      {/* Top Navbar matching screenshots */}
      <Navbar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        motorcycles={motorcycles}
        activeBike={activeBike}
        subscription={subscription}
        hasProAccess={hasProAccess}
        syncStatus={syncStatus}
        onRetrySync={handleRetrySync}
        pendingConflictsCount={activeConflicts.length}
        onOpenConflictReview={() => setIsConflictModalOpen(true)}
        onSelectBike={handleSelectBike}
        onOpenAddBike={() => {
          if (!isPro && motorcycles.length >= 1) {
            setIsPaywallOpen(true);
            return;
          }
          setEditingBike(null);
          setIsGarageModalOpen(true);
        }}
        onOpenAddService={() => {
          setServiceModalInitialTitle('');
          setServiceModalInitialReminderId(undefined);
          setIsServiceModalOpen(true);
        }}
        onOpenPaywall={() => setIsPaywallOpen(true)}
        onGoToHome={() => {
          setActiveTab('garage');
        }}
        onOpenAdminPortal={isExactAdmin ? handleOpenAdminPortal : undefined}
        overdueCount={overdueCount}
        overdueReminders={overdueReminders}
        onOpenServiceForReminder={(rem) => {
          setServiceModalInitialTitle(rem.title);
          setServiceModalInitialReminderId(rem.id);
          setIsServiceModalOpen(true);
        }}
      />

      {/* Main App Container matching mobile app width on desktop */}
      <main className="flex-1 max-w-md w-full mx-auto px-4 py-5 space-y-5 relative pb-24">
        {motorcycles.length === 0 && !(activeTab === 'logbook' && serviceRecords.length > 0) ? (
          <OnboardingView
            onAddMotorcycle={() => {
              setEditingBike(null);
              setIsGarageModalOpen(true);
            }}
          />
        ) : (
          <>
            {/* Urgent In-App Push Notification Alert Banner with Vibration & Quick Action */}
            {overdueReminders.length > 0 && !isOverdueBannerDismissed && (
              <OverdueAlertBanner
                overdueReminders={overdueReminders}
                bike={activeBike}
                onOpenServiceModal={(rem) => {
                  setServiceModalInitialTitle(rem.title);
                  setServiceModalInitialReminderId(rem.id);
                  setIsServiceModalOpen(true);
                }}
                onDismiss={() => setIsOverdueBannerDismissed(true)}
              />
            )}

            {/* Garage & Schedule Tabs */}
            {(activeTab === 'garage' || activeTab === 'reminders') && (
              <div className="space-y-6 animate-in fade-in duration-150">
                {/* Active Bike Profile, Odometer & Quick Actions matching screenshot 2 */}
                <GarageHeader
                  bike={activeBike}
                  reminders={reminders}
                  activeTab={activeTab}
                  onTabChange={setActiveTab}
                  onAddKm={handleAddKm}
                  onOpenEditOdometer={() => setIsQuickAddOdoOpen(true)}
                  onOpenEditBike={() => {
                    setEditingBike(activeBike);
                    setIsGarageModalOpen(true);
                  }}
                  onOpenGpsRide={() => {
                    if (!isPro) {
                      setIsPaywallOpen(true);
                      return;
                    }
                    setIsGpsModalOpen(true);
                  }}
                  onOpenPaywall={() => setIsPaywallOpen(true)}
                  isPro={isPro}
                />

                {/* Maintenance Schedule Header matching screenshot 2 */}
                <div className="flex items-center justify-between pt-1">
                  <h2 className="text-xl font-bold text-slate-900 tracking-tight">
                    Maintenance Schedule
                  </h2>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingReminder(null);
                      setIsReminderModalOpen(true);
                    }}
                    className="text-xs font-bold text-[#FF6B00] hover:underline flex items-center gap-1"
                  >
                    <span>+ Add Task</span>
                  </button>
                </div>

                {/* Maintenance Cards List matching screenshots 2, 3, 4 */}
                <div className="space-y-3.5">
                  {activeReminders.map((reminder) => (
                    <MaintenanceCard
                      key={reminder.id}
                      reminder={reminder}
                      bike={activeBike}
                      onComplete={(rem) => {
                        setServiceModalInitialTitle(rem.title);
                        setServiceModalInitialReminderId(rem.id);
                        setIsServiceModalOpen(true);
                      }}
                      onEdit={(rem) => {
                        setEditingReminder(rem);
                        setIsReminderModalOpen(true);
                      }}
                      onDelete={handleDeleteReminder}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Service History Tab */}
            {activeTab === 'logbook' && (
              <div className="animate-in fade-in duration-150">
                <ServiceLogbookView
                  records={serviceRecords}
                  bike={activeBike}
                  subscription={subscription}
                  hasProAccess={hasProAccess}
                  onOpenAddService={() => {
                    setServiceModalInitialTitle('');
                    setServiceModalInitialReminderId(undefined);
                    setIsServiceModalOpen(true);
                  }}
                  onOpenCasaBooklet={() => {}}
                  onDeleteRecord={handleDeleteServiceRecord}
                  onOpenPaywall={() => setIsPaywallOpen(true)}
                  onBack={() => setActiveTab('garage')}
                />
              </div>
            )}

            {/* Garage / LTO Registration Tab */}
            {activeTab === 'lto' && (
              <div className="animate-in fade-in duration-150">
                <LtoView
                  bike={activeBike}
                  onUpdatePlate={async (newPlate) => {
                    const nowIso = new Date().toISOString();
                    const targetBikeId = activeBike?.id;
                    // Capture original base version BEFORE optimistic local state update
                    const preEditBike = motorcycles.find((b) => b.id === targetBikeId);
                    setMotorcycles(
                      motorcycles.map((b) =>
                        b.id === targetBikeId
                          ? {
                              ...b,
                              licensePlate: newPlate,
                              updatedAt: nowIso,
                              timestampSource: 'client_pending' as const,
                            }
                          : b
                      )
                    );
                    sounds.playSuccess();

                    if (user?.uid && targetBikeId) {
                      setSyncStatus('syncing');
                      const res = await executeDirectOnlineWrite({
                        userId: user.uid,
                        entity: 'motorcycle',
                        action: 'update_fields',
                        targetId: targetBikeId,
                        payload: { licensePlate: newPlate },
                        preEditRecord: preEditBike,
                      });
                      if (res.status === 'version_conflict') {
                        setSyncStatus('sync_error');
                      } else {
                        setSyncStatus(res.status === 'synced' ? 'synced' : 'offline_cache');
                      }
                    }
                  }}
                  onBack={() => setActiveTab('garage')}
                />
              </div>
            )}

            {/* Floating Action Button (+ New Task) matching screenshots 2, 3, 4 */}
            {(activeTab === 'garage' || activeTab === 'reminders') && (
              <div className="fixed bottom-6 right-4 sm:right-auto sm:left-1/2 sm:translate-x-28 z-30">
                <button
                  type="button"
                  onClick={() => {
                    sounds.playClick();
                    setEditingReminder(null);
                    setIsReminderModalOpen(true);
                  }}
                  className="px-5 py-3 rounded-2xl bg-[#FF6B00] hover:bg-[#EA580C] text-white font-bold text-xs shadow-xl shadow-[#FF6B00]/35 flex items-center gap-1.5 transition-all active:scale-95 hover:scale-105"
                >
                  <Plus className="w-4 h-4 stroke-[3]" />
                  <span>New Task</span>
                </button>
              </div>
            )}
          </>
        )}

        {/* Clean Footer with Admin Portal Access (Strictly restricted to verified mustetm7@gmail.com) */}
        <footer className="pt-8 pb-4 text-center text-[10px] text-slate-400 space-y-1.5">
          <p>MotoCare PH • Motorcycle Maintenance & Digital Garage</p>
          {isExactAdmin && (
            <div>
              <button
                type="button"
                onClick={handleOpenAdminPortal}
                className="text-slate-400 hover:text-[#FF6B00] transition-colors underline cursor-pointer"
              >
                Owner Admin Portal
              </button>
            </div>
          )}
        </footer>
      </main>

      {/* Lazy-Loaded Modals */}
      <React.Suspense fallback={null}>
        {isQuickAddOdoOpen && (
          <QuickAddOdometerModal
            isOpen={isQuickAddOdoOpen}
            onClose={() => setIsQuickAddOdoOpen(false)}
            bike={activeBike}
            presets={quickPresets}
            onSavePresets={setQuickPresets}
            onUpdateOdometer={handleUpdateOdometer}
          />
        )}

        {isGarageModalOpen && (
          <GarageModal
            isOpen={isGarageModalOpen}
            onClose={() => setIsGarageModalOpen(false)}
            bike={editingBike}
            subscription={subscription}
            hasProAccess={hasProAccess}
            existingCount={motorcycles.length}
            onSave={handleSaveBike}
            onDelete={handleDeleteBike}
            canDelete={true}
            onOpenPaywall={() => {
              setIsGarageModalOpen(false);
              setIsPaywallOpen(true);
            }}
          />
        )}

        {isReminderModalOpen && (
          <AddReminderModal
            isOpen={isReminderModalOpen}
            onClose={() => setIsReminderModalOpen(false)}
            bike={activeBike}
            editingReminder={editingReminder}
            onSave={handleSaveReminder}
            onDelete={handleDeleteReminder}
          />
        )}

        {isServiceModalOpen && (
          <AddServiceRecordModal
            isOpen={isServiceModalOpen}
            onClose={() => setIsServiceModalOpen(false)}
            bike={activeBike}
            reminders={reminders}
            initialTitle={serviceModalInitialTitle}
            initialReminderId={serviceModalInitialReminderId}
            onSave={handleSaveServiceRecord}
          />
        )}

        {isPaywallOpen && (
          <PaywallModal
            isOpen={isPaywallOpen}
            onClose={() => setIsPaywallOpen(false)}
            subscription={subscription}
            onSubmitReference={handleSubmitReference}
            onCancelSubscription={handleCancelSubscription}
            isAlreadyPending={isAlreadyPending}
            existingPendingRef={existingPendingRef}
          />
        )}

        {/* Safe Local Data Migration Preview & Conflict Resolution Modal */}
        {(isMigrationModalOpen || (isConflictModalOpen && activeConflicts.length > 0)) && (
          <LegacyMigrationModal
            isOpen={isMigrationModalOpen || (isConflictModalOpen && activeConflicts.length > 0)}
            dryRun={isMigrationModalOpen ? migrationDryRun : null}
            activeConflicts={activeConflicts}
            isSyncing={isMigrating || syncStatus === 'syncing'}
            onConfirmMigrate={handleConfirmLegacyMigration}
            onSkipMigration={handleSkipLegacyMigration}
            onResolveConflict={handleResolveConflict}
            onClose={() => setIsConflictModalOpen(false)}
          />
        )}

        {/* GPS Ride Tracker Modal */}
        {isGpsModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <GpsRideTrackerSheet
              bike={activeBike}
              subscription={subscription}
              hasProAccess={hasProAccess}
              onFinishRide={handleFinishGpsRide}
              onClose={() => setIsGpsModalOpen(false)}
              onOpenPaywall={() => {
                setIsGpsModalOpen(false);
                setIsPaywallOpen(true);
              }}
            />
          </div>
        )}
      </React.Suspense>

      {/* Offline Connectivity Toast for PWA */}
      <OfflineIndicator />
    </div>
  );
}
