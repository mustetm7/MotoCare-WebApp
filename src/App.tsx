import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  ActiveTab,
  Motorcycle,
  MaintenanceReminder,
  ServiceRecord,
  PreRideItem,
  PaymentProvider,
  CloudSyncStatus,
  SyncConflictItem,
  LegacyMigrationDryRun,
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
  loadPreRideItems,
  savePreRideItems,
  loadQuickKmPresets,
  saveQuickKmPresets,
  loadUserScopedMotorcycles,
  saveUserScopedMotorcycles,
  loadUserScopedReminders,
  saveUserScopedReminders,
  loadUserScopedServiceRecords,
  saveUserScopedServiceRecords,
  loadUserScopedActiveBikeId,
  saveUserScopedActiveBikeId,
  getOfflineMutationQueue,
  inspectLegacyDataDryRun,
  skipLegacyMigrationForUser,
  resolveMotorcycleConflict,
  exportServiceAndMaintenanceCsv,
  exportServiceAndMaintenancePdf,
  generatePrintableMaintenancePdfReport,
  ThemeMode,
  loadThemePreference,
  saveThemePreference,
} from './utils/storage';
import {
  syncStorageToFirestore,
  flushOfflineMutationQueue,
  saveMotorcycleToFirestore,
  saveReminderToFirestore,
  saveServiceRecordToFirestore,
  subscribeToUserMotorcycles,
  subscribeToUserReminders,
  subscribeToUserServiceRecords,
  fetchUserMotorcyclesOnce,
  fetchUserRemindersOnce,
  fetchUserServiceRecordsOnce,
  executeDirectOnlineWrite,
  scheduleDirectOnlineOdometerUpdate,
  validatePaymentReferenceNumber,
} from './utils/firestoreService';
import { OWNER_ADMIN_EMAIL } from './utils/firebase';
import { useAuth } from './context/AuthContext';
import { checkAndTriggerOverdueNotifications } from './utils/notifications';
import { Navbar } from './components/Navbar';
import { GarageHeader } from './components/GarageHeader';
import { MaintenanceCard } from './components/MaintenanceCard';
import { ServiceLogbookView } from './components/ServiceLogbookView';
import { LtoView } from './components/LtoView';
import { PreRideChecklistView } from './components/PreRideChecklistView';
import { GarageModal } from './components/GarageModal';
import { AddReminderModal } from './components/AddReminderModal';
import { AddServiceRecordModal } from './components/AddServiceRecordModal';
import { QuickAddOdometerModal } from './components/QuickAddOdometerModal';
import { PaywallModal } from './components/PaywallModal';
import { CasaBookletModal } from './components/CasaBookletModal';
import { OnboardingView } from './components/OnboardingView';
import { AccountRegistrationScreen } from './components/AccountRegistrationScreen';
import { AdminUsersPortal } from './components/AdminUsersPortal';
import { GpsRideTrackerSheet } from './components/GpsRideTrackerSheet';
import { OfflineIndicator } from './components/OfflineIndicator';
import { OverdueAlertBanner } from './components/OverdueAlertBanner';
import { LegacyMigrationModal } from './components/LegacyMigrationModal';
import { Plus, CheckCircle2, Sparkles } from 'lucide-react';
import { sounds } from './utils/audio';

function createDefaultRemindersForBike(bike: Motorcycle): MaintenanceReminder[] {
  const isScooter =
    bike.motorcycleType === 'Scooter' ||
    bike.motorcycleType === 'Scooter / AT' ||
    bike.specs?.transmission === 'Automatic Scooter';
  const oilInterval = bike.specs?.recommendedServiceIntervalKm || 1500;
  const odo = bike.odometer || 0;
  const todayIso = new Date().toISOString().split('T')[0];

  const rems: MaintenanceReminder[] = [
    {
      id: `rem_${bike.id}_oil_${Date.now()}`,
      userId: bike.userId,
      bikeId: bike.id,
      title: 'Engine Oil Change (Langis)',
      category: 'Engine Oil',
      categoryTag: 'ENGINE',
      intervalKm: oilInterval,
      lastCompletedOdo: odo,
      nextDueOdo: odo + oilInterval,
      lastCompletedDate: todayIso,
      priority: 'high',
      notes: `Use ${bike.specs?.oilViscosity || '10W-40'} (${bike.specs?.oilCapacityLiters || 0.8}L).`,
      estimatedCostPhp: 380,
    },
    {
      id: `rem_${bike.id}_drive_${Date.now() + 1}`,
      userId: bike.userId,
      bikeId: bike.id,
      title: isScooter
        ? 'Final Transmission Gear Oil & CVT Check'
        : 'Drive Chain Lubrication & Slack Adjustment',
      category: isScooter ? 'Gear Oil' : 'Chain & Sprockets',
      categoryTag: isScooter ? 'CVT & DRIVE' : 'DRIVE CHAIN',
      intervalKm: isScooter ? oilInterval * 2 : 1000,
      lastCompletedOdo: odo,
      nextDueOdo: odo + (isScooter ? oilInterval * 2 : 1000),
      lastCompletedDate: todayIso,
      priority: 'medium',
      notes: isScooter
        ? 'Replace scooter gear oil and inspect CVT belt/flyballs.'
        : 'Clean, lubricate, and adjust drive chain slack (25-35mm).',
      estimatedCostPhp: isScooter ? 250 : 180,
    },
    {
      id: `rem_${bike.id}_brakes_${Date.now() + 2}`,
      userId: bike.userId,
      bikeId: bike.id,
      title: 'Brake Pads & DOT 4 Fluid Inspection',
      category: 'Brakes',
      categoryTag: 'BRAKES',
      intervalKm: 6000,
      lastCompletedOdo: odo,
      nextDueOdo: odo + 6000,
      lastCompletedDate: todayIso,
      priority: 'medium',
      notes: 'Inspect front/rear brake pad thickness and brake fluid level.',
      estimatedCostPhp: 350,
    },
  ];
  return rems;
}

export interface UseHydrateUserDataParams {
  user: { uid: string; email?: string | null } | null;
  hasProAccess: boolean;
  setMotorcycles: React.Dispatch<React.SetStateAction<Motorcycle[]>>;
  setReminders: React.Dispatch<React.SetStateAction<MaintenanceReminder[]>>;
  setServiceRecords: React.Dispatch<React.SetStateAction<ServiceRecord[]>>;
  setActiveBikeId: React.Dispatch<React.SetStateAction<string>>;
}

/**
 * UID-scoped hydration, real-time Firestore subscription, offline mutation replay,
 * and non-destructive legacy migration dry-run hook.
 */
export function useHydrateUserData({
  user,
  hasProAccess,
  setMotorcycles,
  setReminders,
  setServiceRecords,
  setActiveBikeId,
}: UseHydrateUserDataParams) {
  const [syncStatus, setSyncStatus] = useState<CloudSyncStatus>('synced');
  const [migrationDryRun, setMigrationDryRun] = useState<LegacyMigrationDryRun | null>(null);
  const [isMigrationModalOpen, setIsMigrationModalOpen] = useState(false);
  const [activeConflicts, setActiveConflicts] = useState<SyncConflictItem[]>([]);
  const [isSyncingMigration, setIsSyncingMigration] = useState(false);

  const cloudBikesRef = useRef<Motorcycle[]>([]);
  const cloudRemindersRef = useRef<MaintenanceReminder[]>([]);
  const cloudRecordsRef = useRef<ServiceRecord[]>([]);
  const isFlushingRef = useRef(false);

  const triggerFlushOfflineQueue = useCallback(async () => {
    if (!user?.uid || isFlushingRef.current) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setSyncStatus('offline_cache');
      return;
    }

    const queue = getOfflineMutationQueue(user.uid);
    if (queue.length === 0) {
      setSyncStatus('synced');
      return;
    }

    isFlushingRef.current = true;
    setSyncStatus('syncing');
    try {
      const res = await flushOfflineMutationQueue(user.uid);
      if (res.skippedOffline) {
        setSyncStatus('offline_cache');
      } else if (res.failedCount > 0) {
        setSyncStatus('sync_error');
      } else {
        setSyncStatus('synced');
      }
    } catch {
      setSyncStatus('sync_error');
    } finally {
      isFlushingRef.current = false;
    }
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid) {
      cloudBikesRef.current = [];
      cloudRemindersRef.current = [];
      cloudRecordsRef.current = [];
      setMigrationDryRun(null);
      setIsMigrationModalOpen(false);
      setActiveConflicts([]);
      return;
    }

    const uid = user.uid;
    const email = user.email || '';

    // 1. Immediately hydrate from UID-scoped read-through cache
    const cachedBikes = loadUserScopedMotorcycles(uid);
    const cachedRems = loadUserScopedReminders(uid);
    const cachedRecs = loadUserScopedServiceRecords(uid);
    const cachedActiveId = loadUserScopedActiveBikeId(uid, cachedBikes);

    setMotorcycles(cachedBikes);
    setReminders(cachedRems);
    setServiceRecords(cachedRecs);
    setActiveBikeId(cachedActiveId);

    // 2. Inspect unscoped legacy data in read-only dry-run mode
    const dryRun = inspectLegacyDataDryRun({
      userId: uid,
      userEmail: email,
      hasProAccess,
      cloudMotorcycles: cachedBikes,
      cloudReminders: cachedRems,
      cloudServiceRecords: cachedRecs,
    });
    if (dryRun.hasLegacyDataToReview && cachedBikes.length === 0) {
      setMigrationDryRun(dryRun);
      setIsMigrationModalOpen(true);
    } else {
      setMigrationDryRun(null);
      setIsMigrationModalOpen(false);
    }

    // 3. Flush any pending offline mutations when online
    if (typeof navigator === 'undefined' || navigator.onLine !== false) {
      triggerFlushOfflineQueue();
    } else {
      setSyncStatus('offline_cache');
    }

    // 4. Subscribe to real-time Firestore updates for this UID
    const unsubBikes = subscribeToUserMotorcycles(uid, (cloudBikes) => {
      cloudBikesRef.current = cloudBikes;
      const pendingQueue = getOfflineMutationQueue(uid);
      const pendingBikeMap = new Map(
        pendingQueue.filter((q) => q.entity === 'motorcycle').map((q) => [q.targetId, q])
      );

      const mergedBikes: Motorcycle[] = [];
      const detectedConflicts: SyncConflictItem[] = [];
      const cachedById = new Map(loadUserScopedMotorcycles(uid).map((b) => [b.id, b]));

      for (const cloudBike of cloudBikes) {
        const pendingMut = pendingBikeMap.get(cloudBike.id);
        if (pendingMut && pendingMut.action === 'delete') {
          continue;
        }
        if (pendingMut && pendingMut.payload) {
          mergedBikes.push({
            ...cloudBike,
            ...(pendingMut.payload as Partial<Motorcycle>),
            id: cloudBike.id,
          });
          continue;
        }
        const localBike = cachedById.get(cloudBike.id);
        if (localBike && localBike.timestampSource === 'client_pending') {
          const res = resolveMotorcycleConflict(localBike, cloudBike);
          mergedBikes.push(res.resolved);
          if (res.conflict) {
            detectedConflicts.push(res.conflict);
          }
        } else {
          mergedBikes.push(cloudBike);
        }
      }

      // Include locally created bikes still in queue not yet in cloud snapshot
      for (const [targetId, mut] of pendingBikeMap.entries()) {
        if (
          mut.action === 'upsert' &&
          mut.payload &&
          !mergedBikes.some((b) => b.id === targetId)
        ) {
          mergedBikes.push({ ...(mut.payload as unknown as Motorcycle), id: targetId });
        }
      }

      // Only overwrite local cache if cloud or pending queue has data, or if cached was empty
      if (mergedBikes.length > 0 || cloudBikes.length === 0) {
        // When in-memory mock Firestore is empty on initial mount but UID cache was seeded by test,
        // preserve UID cache if cloud has 0 docs and no snapshot write happened yet
        if (mergedBikes.length > 0) {
          saveUserScopedMotorcycles(uid, mergedBikes);
          setMotorcycles(mergedBikes);
          setActiveBikeId((prev) =>
            prev && mergedBikes.some((b) => b.id === prev) ? prev : mergedBikes[0]?.id || ''
          );
        }
      }

      if (detectedConflicts.length > 0) {
        setActiveConflicts(detectedConflicts);
      }
    });

    const unsubReminders = subscribeToUserReminders(uid, (cloudRems) => {
      cloudRemindersRef.current = cloudRems;
      if (cloudRems.length > 0) {
        saveUserScopedReminders(uid, cloudRems);
        setReminders(cloudRems);
      }
    });

    const unsubRecords = subscribeToUserServiceRecords(uid, (cloudRecs) => {
      cloudRecordsRef.current = cloudRecs;
      if (cloudRecs.length > 0) {
        saveUserScopedServiceRecords(uid, cloudRecs);
        setServiceRecords(cloudRecs);
      }
    });

    const handleOnline = () => {
      triggerFlushOfflineQueue();
    };
    const handleOffline = () => {
      setSyncStatus('offline_cache');
    };
    const handleVisibilityChange = () => {
      if (
        typeof document !== 'undefined' &&
        document.visibilityState === 'hidden' &&
        (typeof navigator === 'undefined' || navigator.onLine !== false)
      ) {
        triggerFlushOfflineQueue();
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      unsubBikes();
      unsubReminders();
      unsubRecords();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [
    user?.uid,
    user?.email,
    hasProAccess,
    setMotorcycles,
    setReminders,
    setServiceRecords,
    setActiveBikeId,
    triggerFlushOfflineQueue,
  ]);

  const handleConfirmMigration = useCallback(
    async (selectedBikeIds?: string[]) => {
      if (!user?.uid || !migrationDryRun) return;
      setIsSyncingMigration(true);
      try {
        await syncStorageToFirestore({
          userId: user.uid,
          userEmail: user.email || '',
          hasProAccess,
          userConfirmedOwnership: true,
          selectedBikeIds,
          motorcyclesToSync: migrationDryRun.eligibleMotorcycles,
          remindersToSync: migrationDryRun.eligibleReminders,
          serviceRecordsToSync: migrationDryRun.eligibleServiceRecords,
          existingCloudMotorcycles: cloudBikesRef.current,
          existingCloudReminders: cloudRemindersRef.current,
          existingCloudServiceRecords: cloudRecordsRef.current,
        });
        setIsMigrationModalOpen(false);
        setMigrationDryRun(null);
      } finally {
        setIsSyncingMigration(false);
      }
    },
    [user?.uid, user?.email, hasProAccess, migrationDryRun]
  );

  const handleSkipMigration = useCallback(() => {
    if (user?.uid) {
      skipLegacyMigrationForUser(user.uid, user.email || '');
    }
    setIsMigrationModalOpen(false);
    setMigrationDryRun(null);
  }, [user?.uid, user?.email]);

  const handleResolveConflict = useCallback(
    async (conflictId: string, resolution: 'keep_cloud' | 'use_local') => {
      if (!user?.uid) return;
      const target = activeConflicts.find((c) => c.id === conflictId);
      if (!target) return;

      if (resolution === 'use_local' && target.entity === 'motorcycle') {
        const localBike = target.localRecord as Motorcycle;
        await saveMotorcycleToFirestore(localBike, user.uid);
      }
      setActiveConflicts((prev) => prev.filter((c) => c.id !== conflictId));
    },
    [user?.uid, activeConflicts]
  );

  return {
    syncStatus,
    setSyncStatus,
    migrationDryRun,
    isMigrationModalOpen,
    setIsMigrationModalOpen,
    activeConflicts,
    isSyncingMigration,
    triggerFlushOfflineQueue,
    handleConfirmMigration,
    handleSkipMigration,
    handleResolveConflict,
  };
}

export function App() {
  const {
    user,
    loading: authLoading,
    subscription,
    hasProAccess: contextHasProAccess,
    submitPaymentRef,
    deleteAccount,
  } = useAuth();

  // Exact verified owner or active Pro entitlement
  const isExactAdmin =
    Boolean(user) &&
    user?.email?.toLowerCase() === OWNER_ADMIN_EMAIL &&
    user?.emailVerified === true;
  const isPro = Boolean(
    contextHasProAccess ??
      (isExactAdmin ||
        (subscription.tier === 'pro' &&
          subscription.status === 'active' &&
          !subscription.isExpired))
  );

  // Theme State (Light / Dark Mode) persisted in LocalStorage
  const [theme, setTheme] = useState<ThemeMode>(() => loadThemePreference());

  useEffect(() => {
    saveThemePreference(theme);
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('dark', theme === 'dark');
      document.documentElement.setAttribute('data-theme', theme);
    }
  }, [theme]);

  const handleToggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  // Core State
  const [motorcycles, setMotorcycles] = useState<Motorcycle[]>(() =>
    user?.uid ? loadUserScopedMotorcycles(user.uid) : loadMotorcycles()
  );
  const [reminders, setReminders] = useState<MaintenanceReminder[]>(() =>
    user?.uid ? loadUserScopedReminders(user.uid) : loadReminders()
  );
  const [serviceRecords, setServiceRecords] = useState<ServiceRecord[]>(() =>
    user?.uid ? loadUserScopedServiceRecords(user.uid) : loadServiceRecords()
  );
  const [activeBikeId, setActiveBikeId] = useState<string>(() => {
    const initialBikes = user?.uid ? loadUserScopedMotorcycles(user.uid) : loadMotorcycles();
    return user?.uid
      ? loadUserScopedActiveBikeId(user.uid, initialBikes)
      : loadActiveBikeId(initialBikes);
  });

  const [preRideItems, setPreRideItems] = useState<PreRideItem[]>(() => loadPreRideItems());
  const [quickKmPresets, setQuickKmPresets] = useState<number[]>(() => loadQuickKmPresets());
  const odoDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    syncStatus,
    setSyncStatus,
    migrationDryRun,
    isMigrationModalOpen,
    setIsMigrationModalOpen,
    activeConflicts,
    isSyncingMigration,
    triggerFlushOfflineQueue,
    handleConfirmMigration,
    handleSkipMigration,
    handleResolveConflict,
  } = useHydrateUserData({
    user,
    hasProAccess: isPro,
    setMotorcycles,
    setReminders,
    setServiceRecords,
    setActiveBikeId,
  });

  // Secret Admin Route Detection: Supports `#admin`, `#/admin`, `/admin`, or `?admin=1`
  const [isAdminPortal, setIsAdminPortal] = useState<boolean>(() => {
    const hash = window.location.hash.toLowerCase();
    const pathname = window.location.pathname.toLowerCase();
    const search = window.location.search.toLowerCase();
    return (
      hash === '#admin' ||
      hash === '#/admin' ||
      pathname === '/admin' ||
      pathname.endsWith('/admin') ||
      search.includes('admin=1')
    );
  });

  useEffect(() => {
    const checkRoute = () => {
      const hash = window.location.hash.toLowerCase();
      const pathname = window.location.pathname.toLowerCase();
      const search = window.location.search.toLowerCase();
      setIsAdminPortal(
        hash === '#admin' ||
          hash === '#/admin' ||
          pathname === '/admin' ||
          pathname.endsWith('/admin') ||
          search.includes('admin=1')
      );
    };
    window.addEventListener('hashchange', checkRoute);
    window.addEventListener('popstate', checkRoute);
    return () => {
      window.removeEventListener('hashchange', checkRoute);
      window.removeEventListener('popstate', checkRoute);
    };
  }, []);

  const handleOpenAdminPortal = () => {
    window.location.hash = 'admin';
    setIsAdminPortal(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCloseAdminPortal = () => {
    window.location.hash = '';
    if (window.location.pathname.toLowerCase().endsWith('/admin')) {
      window.history.pushState({}, '', '/');
    }
    setIsAdminPortal(false);
  };

  // Explicit Welcome / Home View & Auth Screen State
  const [showWelcomeScreen, setShowWelcomeScreen] = useState(false);
  const [showAuthScreen, setShowAuthScreen] = useState(false);
  const [authScreenInitialMode, setAuthScreenInitialMode] = useState<'register' | 'signin'>(
    'register'
  );

  // Navigation & Modal States
  const [activeTab, setActiveTab] = useState<ActiveTab>('reminders');
  const [garageModalOpen, setGarageModalOpen] = useState(false);
  const [garageCustomMode, setGarageCustomMode] = useState(false);
  const [editingBike, setEditingBike] = useState<Motorcycle | null>(null);

  const [serviceModalOpen, setServiceModalOpen] = useState(false);
  const [prefillReminder, setPrefillReminder] = useState<MaintenanceReminder | null>(null);

  const [reminderModalOpen, setReminderModalOpen] = useState(false);
  const [editingReminder, setEditingReminder] = useState<MaintenanceReminder | null>(null);

  const [quickOdoModalOpen, setQuickOdoModalOpen] = useState(false);
  const [paywallModalOpen, setPaywallModalOpen] = useState(false);
  const [casaBookletOpen, setCasaBookletOpen] = useState(false);
  const [gpsTrackerOpen, setGpsTrackerOpen] = useState(false);
  const [overdueBannerDismissed, setOverdueBannerDismissed] = useState(false);

  // Toast Notification State after Motorcycle Registration
  const [registrationToast, setRegistrationToast] = useState<{
    bikeName: string;
    reminderCount: number;
  } | null>(null);

  // Persist to LocalStorage: UID-scoped when signed in, unscoped only for anonymous visitors
  useEffect(() => {
    if (user?.uid) {
      saveUserScopedMotorcycles(user.uid, motorcycles);
    } else {
      saveMotorcycles(motorcycles);
    }
  }, [motorcycles, user?.uid]);

  useEffect(() => {
    if (user?.uid) {
      saveUserScopedReminders(user.uid, reminders);
    } else {
      saveReminders(reminders);
    }
  }, [reminders, user?.uid]);

  useEffect(() => {
    if (user?.uid) {
      saveUserScopedServiceRecords(user.uid, serviceRecords);
    } else {
      saveServiceRecords(serviceRecords);
    }
  }, [serviceRecords, user?.uid]);

  useEffect(() => {
    if (activeBikeId) {
      if (user?.uid) {
        saveUserScopedActiveBikeId(user.uid, activeBikeId);
      } else {
        saveActiveBikeId(activeBikeId);
      }
    }
  }, [activeBikeId, user?.uid]);

  useEffect(() => {
    savePreRideItems(preRideItems);
  }, [preRideItems]);

  useEffect(() => {
    saveQuickKmPresets(quickKmPresets);
  }, [quickKmPresets]);

  // Active Motorcycle Resolution
  const activeBike = useMemo(() => {
    return motorcycles.find((b) => b.id === activeBikeId) || motorcycles[0] || null;
  }, [motorcycles, activeBikeId]);

  // Filtered Reminders & Service Records for Active Bike
  const activeBikeReminders = useMemo(() => {
    if (!activeBike) return [];
    return reminders.filter((r) => r.bikeId === activeBike.id);
  }, [reminders, activeBike]);

  const activeBikeRecords = useMemo(() => {
    if (!activeBike) return [];
    return serviceRecords
      .filter((r) => r.bikeId === activeBike.id)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [serviceRecords, activeBike]);

  // Overdue Reminders Calculation
  const overdueReminders = useMemo(() => {
    if (!activeBike) return [];
    return activeBikeReminders.filter((r) => r.nextDueOdo - activeBike.odometer <= 0);
  }, [activeBike, activeBikeReminders]);

  const overdueCount = overdueReminders.length;

  useEffect(() => {
    if (activeBike && activeBikeReminders.length > 0) {
      checkAndTriggerOverdueNotifications(activeBike, activeBikeReminders);
    }
  }, [activeBike, activeBikeReminders]);

  // Handlers: Motorcycle Garage
  const handleUpdateOdometer = useCallback(
    (newOdo: number) => {
      if (!activeBike) return;
      const preEditBike = activeBike;
      const updatedBike: Motorcycle = {
        ...activeBike,
        odometer: newOdo,
        updatedAt: new Date().toISOString(),
        timestampSource: 'client_pending',
      };
      setMotorcycles((prev) => prev.map((b) => (b.id === activeBike.id ? updatedBike : b)));

      if (user?.uid) {
        scheduleDirectOnlineOdometerUpdate({
          userId: user.uid,
          targetBikeId: activeBike.id,
          newOdo,
          preEditBike,
          debounceTimerRef: odoDebounceRef,
          delayMs: 600,
          onStatusChange: setSyncStatus,
        });
      }
    },
    [activeBike, user?.uid, setSyncStatus]
  );

  const handleAddKm = useCallback(
    (km: number) => {
      if (!activeBike || km <= 0) return;
      handleUpdateOdometer(activeBike.odometer + km);
    },
    [activeBike, handleUpdateOdometer]
  );

  const handleFinishGpsRide = useCallback(
    (distanceDeltaKm: number) => {
      if (!activeBike || distanceDeltaKm <= 0) return;
      handleUpdateOdometer(activeBike.odometer + distanceDeltaKm);
    },
    [activeBike, handleUpdateOdometer]
  );

  const handleUpdatePlate = useCallback(
    (newPlate: string) => {
      if (!activeBike) return;
      const preEditBike = activeBike;
      const updatedBike: Motorcycle = {
        ...activeBike,
        licensePlate: newPlate,
        updatedAt: new Date().toISOString(),
        timestampSource: 'client_pending',
      };
      setMotorcycles((prev) => prev.map((b) => (b.id === activeBike.id ? updatedBike : b)));
      if (user?.uid) {
        executeDirectOnlineWrite({
          userId: user.uid,
          entity: 'motorcycle',
          action: 'update_fields',
          targetId: activeBike.id,
          payload: { licensePlate: newPlate },
          preEditRecord: preEditBike,
        });
      }
    },
    [activeBike, user?.uid]
  );

  const handleSaveBike = (bikeData: Motorcycle) => {
    const existingBike = motorcycles.find((b) => b.id === bikeData.id) || null;
    const isNewBike = !existingBike;

    if (isNewBike && !isPro && motorcycles.length >= 1) {
      setPaywallModalOpen(true);
      return;
    }

    const scopedBike: Motorcycle = user?.uid ? { ...bikeData, userId: user.uid } : bikeData;

    setMotorcycles((prev) => {
      const exists = prev.some((b) => b.id === scopedBike.id);
      const next = exists
        ? prev.map((b) => (b.id === scopedBike.id ? scopedBike : b))
        : [...prev, scopedBike];
      if (user?.uid) {
        saveUserScopedMotorcycles(user.uid, next);
      } else {
        saveMotorcycles(next);
      }
      return next;
    });

    if (user?.uid) {
      executeDirectOnlineWrite({
        userId: user.uid,
        entity: 'motorcycle',
        action: 'upsert',
        targetId: scopedBike.id,
        payload: scopedBike as unknown as Record<string, unknown>,
        preEditRecord: existingBike,
      });
    }

    if (isNewBike) {
      const allStarterReminders = createDefaultRemindersForBike(scopedBike);
      const starterReminders = isPro
        ? allStarterReminders
        : allStarterReminders.slice(0, Math.max(0, 2 - reminders.length));

      if (starterReminders.length > 0) {
        setReminders((prev) => {
          const next = [...prev, ...starterReminders];
          if (user?.uid) {
            saveUserScopedReminders(user.uid, next);
          } else {
            saveReminders(next);
          }
          return next;
        });
        if (user?.uid) {
          starterReminders.forEach((rem) => {
            executeDirectOnlineWrite({
              userId: user.uid,
              entity: 'reminder',
              action: 'upsert',
              targetId: rem.id,
              payload: rem as unknown as Record<string, unknown>,
              preEditRecord: null,
            });
          });
        }
      }

      sounds.playSuccess();
      setRegistrationToast({
        bikeName: scopedBike.nickname
          ? `"${scopedBike.nickname}" (${scopedBike.brand} ${scopedBike.model})`
          : `${scopedBike.year} ${scopedBike.brand} ${scopedBike.model}`,
        reminderCount: starterReminders.length,
      });
      setTimeout(() => {
        setRegistrationToast(null);
      }, 5000);
    }

    setActiveBikeId(scopedBike.id);
    setShowWelcomeScreen(false);
    setActiveTab('reminders');
  };

  const handleDeleteBike = (bikeId: string) => {
    const preEditBike = motorcycles.find((b) => b.id === bikeId) || null;
    setMotorcycles((prev) => {
      const filtered = prev.filter((b) => b.id !== bikeId);
      if (activeBikeId === bikeId) {
        setActiveBikeId(filtered[0]?.id || '');
      }
      if (user?.uid) {
        saveUserScopedMotorcycles(user.uid, filtered);
      } else {
        saveMotorcycles(filtered);
      }
      return filtered;
    });
    setReminders((prev) => {
      const filtered = prev.filter((r) => r.bikeId !== bikeId);
      if (user?.uid) {
        saveUserScopedReminders(user.uid, filtered);
      } else {
        saveReminders(filtered);
      }
      return filtered;
    });

    if (user?.uid) {
      executeDirectOnlineWrite({
        userId: user.uid,
        entity: 'motorcycle',
        action: 'delete',
        targetId: bikeId,
        preEditRecord: preEditBike,
      });
    }
  };

  // Handlers: Service Records & Linked Reminder Auto-Advancement
  const handleSaveServiceRecord = (record: ServiceRecord, linkedReminderId?: string) => {
    const scopedRecord: ServiceRecord = user?.uid ? { ...record, userId: user.uid } : record;
    setServiceRecords((prev) => [scopedRecord, ...prev]);

    if (activeBike && scopedRecord.odometer > activeBike.odometer) {
      handleUpdateOdometer(scopedRecord.odometer);
    }

    let updatedReminderForSync: MaintenanceReminder | undefined;
    if (linkedReminderId) {
      setReminders((prev) =>
        prev.map((rem) => {
          if (rem.id !== linkedReminderId) return rem;
          const nextDueOdo = scopedRecord.odometer + rem.intervalKm;
          const updatedRem: MaintenanceReminder = {
            ...rem,
            lastCompletedOdo: scopedRecord.odometer,
            lastCompletedDate: scopedRecord.date,
            nextDueOdo,
          };
          updatedReminderForSync = updatedRem;
          return updatedRem;
        })
      );
    }

    if (user?.uid) {
      executeDirectOnlineWrite({
        userId: user.uid,
        entity: 'serviceRecord',
        action: 'upsert',
        targetId: scopedRecord.id,
        payload: scopedRecord as unknown as Record<string, unknown>,
        preEditRecord: null,
        linkedReminderToUpdate: updatedReminderForSync,
      });
    }
  };

  const handleDeleteServiceRecord = (recordId: string) => {
    const preEditRec = serviceRecords.find((r) => r.id === recordId) || null;
    setServiceRecords((prev) => prev.filter((r) => r.id !== recordId));
    if (user?.uid) {
      executeDirectOnlineWrite({
        userId: user.uid,
        entity: 'serviceRecord',
        action: 'delete',
        targetId: recordId,
        preEditRecord: preEditRec,
      });
    }
  };

  // Handlers: Maintenance Reminders
  const handleSaveReminder = (reminderData: MaintenanceReminder) => {
    const existingRem = reminders.find((r) => r.id === reminderData.id) || null;
    if (!existingRem && !isPro && reminders.length >= 2) {
      setPaywallModalOpen(true);
      return;
    }

    const scopedRem: MaintenanceReminder = user?.uid
      ? { ...reminderData, userId: user.uid }
      : reminderData;

    setReminders((prev) => {
      const already = prev.some((r) => r.id === scopedRem.id);
      if (already) {
        return prev.map((r) => (r.id === scopedRem.id ? scopedRem : r));
      }
      return [...prev, scopedRem];
    });

    if (user?.uid) {
      executeDirectOnlineWrite({
        userId: user.uid,
        entity: 'reminder',
        action: 'upsert',
        targetId: scopedRem.id,
        payload: scopedRem as unknown as Record<string, unknown>,
        preEditRecord: existingRem,
      });
    }
  };

  const handleDeleteReminder = (reminderId: string) => {
    const preEditRem = reminders.find((r) => r.id === reminderId) || null;
    setReminders((prev) => prev.filter((r) => r.id !== reminderId));
    if (user?.uid) {
      executeDirectOnlineWrite({
        userId: user.uid,
        entity: 'reminder',
        action: 'delete',
        targetId: reminderId,
        preEditRecord: preEditRem,
      });
    }
  };

  // Handlers: Pre-Ride Checklist
  const handleTogglePreRideItem = (itemId: string) => {
    setPreRideItems((prev) =>
      prev.map((item) => (item.id === itemId ? { ...item, checked: !item.checked } : item))
    );
  };

  const handleResetPreRideAll = () => {
    setPreRideItems((prev) => prev.map((item) => ({ ...item, checked: false })));
  };

  const handleCheckPreRideAll = () => {
    setPreRideItems((prev) => prev.map((item) => ({ ...item, checked: true })));
  };

  const handleLogPreRideInspectionAsService = () => {
    if (!activeBike) return;
    setPrefillReminder(null);
    setServiceModalOpen(true);
  };

  // Handlers: Subscription & Payment Verification Flow (Authoritative Firestore Only)
  // Requires real GCash reference number (8–64 chars, letters and digits only after normalization).
  const handleSubmitReference = async (provider: PaymentProvider, referenceNumber: string) => {
    const validation = validatePaymentReferenceNumber(referenceNumber);
    if (!validation.valid) {
      throw new Error(
        validation.error ||
          'Please enter your valid 8–64 character alphanumeric GCash reference number.'
      );
    }

    const bikeLabel = activeBike
      ? `${activeBike.year} ${activeBike.brand} ${activeBike.model}`
      : 'Motorcycle';

    if (user) {
      await submitPaymentRef(
        provider,
        validation.trimmed,
        bikeLabel,
        activeBike?.licensePlate
      );
    }
  };

  const handleCancelSubscription = () => {
    setPaywallModalOpen(false);
  };

  // Permanent Account Deletion Handler — Cleans up Firestore, Firebase Auth, LocalStorage, and resets session
  const handlePermanentAccountDelete = useCallback(
    async (password?: string) => {
      if (deleteAccount) {
        await deleteAccount(password);
      }
      setMotorcycles([]);
      setReminders([]);
      setServiceRecords([]);
      setActiveBikeId('');
      setShowAuthScreen(false);
      setShowWelcomeScreen(true);
      setActiveTab('reminders');
    },
    [deleteAccount]
  );

  // Handlers: Complete Cloud-Aware CSV & PDF Export
  const resolveLatestDataForExport = useCallback(async () => {
    let targetBike = activeBike;
    let exportRecords = activeBikeRecords;
    let exportReminders = activeBikeReminders;

    if (user?.uid && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
      try {
        const [cloudBikes, cloudRecs, cloudRems] = await Promise.all([
          fetchUserMotorcyclesOnce(user.uid),
          fetchUserServiceRecordsOnce(user.uid),
          fetchUserRemindersOnce(user.uid),
        ]);

        if (cloudBikes.length > 0) {
          targetBike =
            cloudBikes.find((b) => b.id === activeBike?.id) || cloudBikes[0] || activeBike;
        }
        if (targetBike) {
          if (cloudRecs.length > 0) {
            exportRecords = cloudRecs.filter((r) => r.bikeId === targetBike!.id);
          }
          if (cloudRems.length > 0) {
            exportReminders = cloudRems.filter((r) => r.bikeId === targetBike!.id);
          }
        }
      } catch (err) {
        console.warn('Export fallback to local state due to offline/fetch error:', err);
      }
    }

    return { targetBike, exportRecords, exportReminders };
  }, [activeBike, activeBikeRecords, activeBikeReminders, user?.uid]);

  const handleDownloadPrintablePdfReport = useCallback(async () => {
    const { targetBike, exportRecords, exportReminders } = await resolveLatestDataForExport();
    generatePrintableMaintenancePdfReport(targetBike, exportRecords, exportReminders);
  }, [resolveLatestDataForExport]);

  // Render Secret Admin Portal when routed via `#admin`, `/admin`, or `?admin=1`
  if (isAdminPortal) {
    if (authLoading) {
      return (
        <div className="min-h-screen bg-[#070B12] text-white flex flex-col items-center justify-center p-6">
          <div className="w-10 h-10 rounded-full border-3 border-[#FF6B00] border-t-transparent animate-spin mb-3" />
          <p className="text-xs font-bold text-slate-400">Verifying administrator credentials...</p>
        </div>
      );
    }

    if (user && !isExactAdmin) {
      return (
        <div className="min-h-screen bg-[#070B12] text-white flex flex-col items-center justify-center p-4">
          <div className="max-w-md w-full bg-[#0E1525] border border-red-500/30 rounded-3xl p-6 sm:p-8 text-center space-y-4 shadow-2xl">
            <div className="w-12 h-12 rounded-2xl bg-red-500/20 border border-red-500/40 text-red-400 flex items-center justify-center mx-auto font-black text-xl">
              !
            </div>
            <h1 className="text-xl font-black text-white">Access Denied</h1>
            <p className="text-xs text-slate-300 leading-relaxed">
              Administrator access only. You are currently signed in as{' '}
              <span className="font-mono text-white">{user.email}</span>.
            </p>
            <button
              type="button"
              onClick={handleCloseAdminPortal}
              className="w-full py-3 rounded-2xl bg-[#FF6B00] hover:bg-[#e05e00] text-slate-950 font-black text-xs transition-all cursor-pointer"
            >
              ← Return to Garage
            </button>
          </div>
        </div>
      );
    }

    return <AdminUsersPortal onReturnToApp={handleCloseAdminPortal} />;
  }

  return (
    <div
      data-testid="app-root-container"
      data-theme={theme}
      className={`min-h-screen bg-[#F8F9FA] text-slate-800 pb-28 selection:bg-[#FF6B00] selection:text-white transition-colors duration-200 ${
        theme === 'dark' ? 'dark bg-[#070B12] text-slate-100' : ''
      }`}
    >
      {/* Top Navbar */}
      <Navbar
        activeTab={activeTab}
        onTabChange={(tab) => {
          setShowWelcomeScreen(false);
          setActiveTab(tab);
        }}
        motorcycles={motorcycles}
        activeBike={activeBike}
        subscription={subscription}
        hasProAccess={isPro}
        syncStatus={syncStatus}
        onRetrySync={triggerFlushOfflineQueue}
        pendingConflictsCount={activeConflicts.length}
        onOpenConflictReview={() => setIsMigrationModalOpen(true)}
        onSelectBike={(id) => {
          setActiveBikeId(id);
          setShowWelcomeScreen(false);
        }}
        onOpenAddBike={() => {
          if (!user) {
            setAuthScreenInitialMode('register');
            setShowAuthScreen(true);
            return;
          }
          setEditingBike(null);
          setGarageCustomMode(false);
          setGarageModalOpen(true);
        }}
        onOpenAddService={() => {
          setPrefillReminder(null);
          setServiceModalOpen(true);
        }}
        onOpenPaywall={() => setPaywallModalOpen(true)}
        onOpenCasaBooklet={() => setCasaBookletOpen(true)}
        onGoToHome={() => setShowWelcomeScreen(true)}
        onOpenAdminPortal={isExactAdmin ? handleOpenAdminPortal : undefined}
        overdueCount={overdueCount}
        overdueReminders={overdueReminders}
        onOpenServiceForReminder={(rem) => {
          setPrefillReminder(rem);
          setServiceModalOpen(true);
        }}
        onOpenAuthScreen={(mode = 'signin') => {
          setAuthScreenInitialMode(mode);
          setShowAuthScreen(true);
        }}
        theme={theme}
        onToggleTheme={handleToggleTheme}
        serviceRecords={activeBikeRecords}
        reminders={activeBikeReminders}
        onDownloadPdfReport={handleDownloadPrintablePdfReport}
        onDeleteAccount={handlePermanentAccountDelete}
      />

      {/* Registration Success Toast Banner */}
      {registrationToast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed top-20 left-1/2 -translate-x-1/2 z-50 w-[92%] max-w-md p-4 rounded-2xl bg-slate-900 text-white border border-emerald-500/50 shadow-2xl flex items-start gap-3 animate-fade-in"
        >
          <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center shrink-0 text-emerald-400">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div className="flex-1 text-xs leading-relaxed">
            <div className="font-extrabold text-emerald-300 text-sm flex items-center gap-1.5">
              <span>Registered to Your Garage!</span>
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            </div>
            <p className="text-slate-200 mt-0.5">
              <strong>{registrationToast.bikeName}</strong> is now active with{' '}
              <strong>{registrationToast.reminderCount} automatic PMS reminders</strong> configured.
            </p>
          </div>
        </div>
      )}

      {/* Main Content Container */}
      <main className="max-w-2xl lg:max-w-4xl mx-auto px-4 sm:px-6 pt-5">
        {showAuthScreen && !user ? (
          <AccountRegistrationScreen
            initialMode={authScreenInitialMode}
            onBack={() => setShowAuthScreen(false)}
          />
        ) : !user ? (
          <OnboardingView
            isAuthenticated={false}
            onStartOnboarding={() => {
              setAuthScreenInitialMode('register');
              setShowAuthScreen(true);
            }}
            onAddMotorcycle={() => {
              setAuthScreenInitialMode('register');
              setShowAuthScreen(true);
            }}
          />
        ) : !activeBike || motorcycles.length === 0 || showWelcomeScreen ? (
          <OnboardingView
            isAuthenticated={true}
            userName={user.displayName || user.email}
            onAddMotorcycle={() => {
              setEditingBike(null);
              setGarageCustomMode(false);
              setGarageModalOpen(true);
            }}
            onAddCustomMotorcycle={() => {
              setEditingBike(null);
              setGarageCustomMode(true);
              setGarageModalOpen(true);
            }}
          />
        ) : (
          <div className="space-y-5">
            {!overdueBannerDismissed && overdueReminders.length > 0 && (
              <OverdueAlertBanner
                overdueReminders={overdueReminders}
                bike={activeBike}
                onOpenServiceModal={(rem) => {
                  setPrefillReminder(rem);
                  setServiceModalOpen(true);
                }}
                onDismiss={() => setOverdueBannerDismissed(true)}
              />
            )}

            <GarageHeader
              bike={activeBike}
              reminders={activeBikeReminders}
              activeTab={activeTab}
              onTabChange={(tab) => setActiveTab(tab)}
              onAddKm={handleAddKm}
              onOpenEditOdometer={() => setQuickOdoModalOpen(true)}
              onOpenEditBike={() => {
                setEditingBike(activeBike);
                setGarageCustomMode(Boolean(activeBike.isCustom));
                setGarageModalOpen(true);
              }}
              onOpenGpsRide={() => setGpsTrackerOpen(true)}
              onOpenPaywall={() => setPaywallModalOpen(true)}
              isPro={isPro}
            />

            {activeTab === 'reminders' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-extrabold text-slate-900">
                      Maintenance Schedule
                    </h2>
                    <p className="text-xs text-slate-500">
                      Automatic kilometer &amp; date interval tracking for your {activeBike.brand}{' '}
                      {activeBike.model}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (!isPro && reminders.length >= 2) {
                        setPaywallModalOpen(true);
                        return;
                      }
                      setEditingReminder(null);
                      setReminderModalOpen(true);
                    }}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#FF6B00] hover:bg-[#e05e00] text-white font-bold text-xs shadow-sm transition-colors cursor-pointer"
                  >
                    <Plus className="w-4 h-4 stroke-[2.5]" />
                    <span>Add Reminder</span>
                  </button>
                </div>

                {activeBikeReminders.length === 0 ? (
                  <div className="p-8 rounded-2xl bg-white border border-slate-100 text-center space-y-3">
                    <p className="text-sm font-bold text-slate-700">
                      No maintenance reminders configured yet.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingReminder(null);
                        setReminderModalOpen(true);
                      }}
                      className="px-4 py-2 rounded-xl bg-[#FF6B00] text-white font-bold text-xs cursor-pointer"
                    >
                      + Create First Reminder
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-3.5">
                    {activeBikeReminders.map((rem) => (
                      <MaintenanceCard
                        key={rem.id}
                        reminder={rem}
                        bike={activeBike}
                        onComplete={(r) => {
                          setPrefillReminder(r);
                          setServiceModalOpen(true);
                        }}
                        onEdit={(r) => {
                          setEditingReminder(r);
                          setReminderModalOpen(true);
                        }}
                        onDelete={handleDeleteReminder}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'history' && (
              <ServiceLogbookView
                records={activeBikeRecords}
                reminders={activeBikeReminders}
                bike={activeBike}
                subscription={subscription}
                hasProAccess={isPro}
                onOpenAddService={() => {
                  setPrefillReminder(null);
                  setServiceModalOpen(true);
                }}
                onOpenCasaBooklet={() => setCasaBookletOpen(true)}
                onDeleteRecord={handleDeleteServiceRecord}
                onOpenPaywall={() => setPaywallModalOpen(true)}
                onBack={() => setActiveTab('reminders')}
              />
            )}

            {activeTab === 'lto' && (
              <LtoView
                bike={activeBike}
                onUpdatePlate={handleUpdatePlate}
                onBack={() => setActiveTab('reminders')}
              />
            )}

            {activeTab === 'preride' && (
              <PreRideChecklistView
                items={preRideItems}
                bike={activeBike}
                onToggleItem={handleTogglePreRideItem}
                onResetAll={handleResetPreRideAll}
                onCheckAll={handleCheckPreRideAll}
                onLogInspectionAsService={handleLogPreRideInspectionAsService}
              />
            )}
          </div>
        )}

        {/* Discrete Footer with Admin Access Link (Visible Only to Verified Owner) */}
        <footer className="pt-8 pb-4 text-center text-[10px] text-slate-400 space-y-1.5">
          <p>MotoCare PH • Motorcycle Maintenance &amp; Digital Garage</p>
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

      <OfflineIndicator />

      {/* Modals */}
      <GarageModal
        isOpen={garageModalOpen}
        onClose={() => {
          setGarageModalOpen(false);
          setGarageCustomMode(false);
        }}
        bike={editingBike}
        subscription={subscription}
        hasProAccess={isPro}
        existingCount={motorcycles.length}
        initialCustomMode={garageCustomMode}
        onSave={handleSaveBike}
        onDelete={handleDeleteBike}
        onOpenPaywall={() => setPaywallModalOpen(true)}
      />

      {activeBike && (
        <AddServiceRecordModal
          isOpen={serviceModalOpen}
          onClose={() => {
            setServiceModalOpen(false);
            setPrefillReminder(null);
          }}
          bike={activeBike}
          reminders={activeBikeReminders}
          initialTitle={prefillReminder?.title}
          initialReminderId={prefillReminder?.id}
          onSave={handleSaveServiceRecord}
        />
      )}

      {activeBike && (
        <AddReminderModal
          isOpen={reminderModalOpen}
          onClose={() => {
            setReminderModalOpen(false);
            setEditingReminder(null);
          }}
          bike={activeBike}
          editingReminder={editingReminder}
          onSave={handleSaveReminder}
          onDelete={handleDeleteReminder}
        />
      )}

      {activeBike && (
        <QuickAddOdometerModal
          isOpen={quickOdoModalOpen}
          onClose={() => setQuickOdoModalOpen(false)}
          bike={activeBike}
          presets={quickKmPresets}
          onSavePresets={setQuickKmPresets}
          onUpdateOdometer={handleUpdateOdometer}
        />
      )}

      <PaywallModal
        isOpen={paywallModalOpen}
        onClose={() => setPaywallModalOpen(false)}
        subscription={subscription}
        hasProAccess={isPro}
        onSubmitReference={handleSubmitReference}
        onCancelSubscription={handleCancelSubscription}
      />

      {activeBike && (
        <CasaBookletModal
          isOpen={casaBookletOpen}
          onClose={() => setCasaBookletOpen(false)}
          bike={activeBike}
          records={activeBikeRecords}
          subscription={subscription}
          hasProAccess={isPro}
          onOpenPaywall={() => setPaywallModalOpen(true)}
        />
      )}

      {activeBike && gpsTrackerOpen && (
        <GpsRideTrackerSheet
          bike={activeBike}
          subscription={subscription}
          hasProAccess={isPro}
          onFinishRide={handleFinishGpsRide}
          onOpenPaywall={() => {
            setGpsTrackerOpen(false);
            setPaywallModalOpen(true);
          }}
          onClose={() => setGpsTrackerOpen(false)}
        />
      )}

      <LegacyMigrationModal
        isOpen={isMigrationModalOpen || activeConflicts.length > 0}
        dryRun={migrationDryRun}
        activeConflicts={activeConflicts}
        isSyncing={isSyncingMigration}
        onConfirmMigrate={handleConfirmMigration}
        onSkipMigration={handleSkipMigration}
        onResolveConflict={handleResolveConflict}
        onClose={() => setIsMigrationModalOpen(false)}
      />
    </div>
  );
}

export default App;
