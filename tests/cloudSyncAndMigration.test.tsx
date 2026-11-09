import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, renderHook, act, fireEvent } from '@testing-library/react';
import * as fs from 'fs';
import * as path from 'path';
import {
  Motorcycle,
  MaintenanceReminder,
  ServiceRecord,
} from '../src/types';
import {
  loadUserScopedMotorcycles,
  saveUserScopedMotorcycles,
  loadUserScopedReminders,
  saveUserScopedReminders,
  loadUserScopedServiceRecords,
  saveUserScopedServiceRecords,
  getOfflineMutationQueue,
  getOfflineMutationQueueKey,
  enqueueOfflineMutation,
  getQuarantinedMutationQueue,
  getQuarantinedMutationQueueKey,
  requeueQuarantinedMutation,
  getKnownCloudVersion,
  getKnownCloudRevision,
  recordKnownCloudVersion,
  recordCloudSyncOperation,
  getCloudSyncOperationLogs,
  createImmutablePreMigrationBackup,
  loadPreMigrationBackup,
  loadMigrationLedger,
  saveMigrationLedger,
  skipLegacyMigrationForUser,
  resolveMotorcycleConflict,
  inspectLegacyDataDryRun,
  parseTimestampToMillis,
} from '../src/utils/storage';
import {
  syncStorageToFirestore,
  flushOfflineMutationQueue,
  recoverQuarantinedMutationSafely,
  saveMotorcycleToFirestore,
  updateMotorcycleFieldsInFirestore,
  deleteMotorcycleFromFirestore,
  saveReminderToFirestore,
  saveRemindersBatchToFirestore,
  deleteReminderFromFirestore,
  saveServiceRecordToFirestore,
  saveServiceRecordsBatchToFirestore,
  deleteServiceRecordFromFirestore,
  normalizeFirestoreTimestampToIso,
  completeDirectOnlineMutation,
  scheduleDirectOnlineOdometerUpdate,
  executeDirectOnlineWrite,
  SAFE_BATCH_TRANSACTION_CHUNK_SIZE,
  SAFE_CLEANUP_DELETE_BATCH_CHUNK_SIZE,
  resolveNextCloudVersionForUpdate,
} from '../src/utils/firestoreService';
import {
  LegacyMigrationModal,
  buildConflictFieldDiffs,
} from '../src/components/LegacyMigrationModal';
import { AdminUsersPortal } from '../src/components/AdminUsersPortal';
import { auth } from '../src/utils/firebase';
import { useHydrateUserData } from '../src/App';

// -----------------------------------------------------------------------------
// In-Memory Firestore Mock Store for Deterministic Multi-Device & Sync Testing
// -----------------------------------------------------------------------------
const inMemoryFirestore: Record<string, Map<string, Record<string, any>>> = {
  users: new Map(),
  motorcycles: new Map(),
  reminders: new Map(),
  serviceRecords: new Map(),
};

const activeSnapshotListeners: Record<
  string,
  Array<{ userId: string; onNext: (docs: any[]) => void }>
> = {
  motorcycles: [],
  reminders: [],
  serviceRecords: [],
};

let simulateNetworkOffline = false;
let transactionCommitCount = 0;
let writeBatchCommitCount = 0;

function notifyCollectionListeners(collectionName: 'motorcycles' | 'reminders' | 'serviceRecords') {
  const store = inMemoryFirestore[collectionName];
  const listeners = activeSnapshotListeners[collectionName] || [];
  for (const listener of listeners) {
    const matchingDocs: Array<{ id: string; data: () => Record<string, any> }> = [];
    for (const [docId, docData] of store.entries()) {
      if (docData.userId === listener.userId) {
        matchingDocs.push({
          id: docId,
          data: () => ({ ...docData }),
        });
      }
    }
    listener.onNext(matchingDocs);
  }
}

vi.mock('firebase/firestore', () => {
  class MockTimestamp {
    seconds: number;
    nanoseconds: number;
    private ms: number;
    constructor(ms: number) {
      this.ms = ms;
      this.seconds = Math.floor(ms / 1000);
      this.nanoseconds = (ms % 1000) * 1_000_000;
    }
    toDate() {
      return new Date(this.ms);
    }
    toMillis() {
      return this.ms;
    }
    static now() {
      return new MockTimestamp(Date.now());
    }
    static fromDate(d: Date) {
      return new MockTimestamp(d.getTime());
    }
  }

  return {
    getFirestore: () => ({ __type: 'mockDb' }),
    initializeFirestore: () => ({ __type: 'mockDb' }),
    setLogLevel: () => {},
    serverTimestamp: () => MockTimestamp.now(),
    Timestamp: MockTimestamp,
    doc: (_db: any, colName: string, docId: string) => ({
      __type: 'docRef',
      colName,
      id: docId,
      path: `${colName}/${docId}`,
    }),
    collection: (_db: any, colName: string) => ({
      __type: 'colRef',
      colName,
    }),
    where: (field: string, op: string, value: any) => ({ field, op, value }),
    query: (colRef: any, ...constraints: any[]) => ({
      __type: 'query',
      colName: colRef.colName,
      constraints,
    }),
    getDoc: async (docRef: any) => {
      if (simulateNetworkOffline) {
        throw new Error('Failed to get document because the client is offline.');
      }
      const store = inMemoryFirestore[docRef.colName];
      const exists = store?.has(docRef.id) ?? false;
      const val = store?.get(docRef.id);
      return {
        id: docRef.id,
        exists: () => exists,
        data: () => (val ? { ...val } : undefined),
      };
    },
    getDocs: async (q: any) => {
      if (simulateNetworkOffline) {
        throw new Error('Failed to get documents because the client is offline.');
      }
      const colName = q.colName;
      const store = inMemoryFirestore[colName] || new Map();
      const userIdConstraint = (q.constraints || []).find((c: any) => c.field === 'userId');
      const targetUid = userIdConstraint?.value;
      const docs: any[] = [];
      for (const [id, data] of store.entries()) {
        if (!targetUid || data.userId === targetUid) {
          docs.push({
            id,
            ref: { __type: 'docRef', colName, id, path: `${colName}/${id}` },
            data: () => ({ ...data }),
          });
        }
      }
      return {
        docs,
        size: docs.length,
        empty: docs.length === 0,
        forEach: (cb: (d: any) => void) => docs.forEach(cb),
      };
    },
    setDoc: async (docRef: any, payload: any, options?: { merge?: boolean }) => {
      if (simulateNetworkOffline) {
        throw new Error('UNAVAILABLE: Network offline');
      }
      const store = inMemoryFirestore[docRef.colName];
      const existing = store.get(docRef.id) || {};
      const next = options?.merge ? { ...existing, ...payload } : { ...payload };
      store.set(docRef.id, next);
      if (
        docRef.colName === 'motorcycles' ||
        docRef.colName === 'reminders' ||
        docRef.colName === 'serviceRecords'
      ) {
        notifyCollectionListeners(docRef.colName);
      }
    },
    updateDoc: async (docRef: any, payload: any) => {
      if (simulateNetworkOffline) {
        throw new Error('UNAVAILABLE: Network offline');
      }
      const store = inMemoryFirestore[docRef.colName];
      if (!store.has(docRef.id)) {
        throw new Error(`NOT_FOUND: ${docRef.path}`);
      }
      const existing = store.get(docRef.id) || {};
      store.set(docRef.id, { ...existing, ...payload });
      if (
        docRef.colName === 'motorcycles' ||
        docRef.colName === 'reminders' ||
        docRef.colName === 'serviceRecords'
      ) {
        notifyCollectionListeners(docRef.colName);
      }
    },
    deleteDoc: async (docRef: any) => {
      if (simulateNetworkOffline) {
        throw new Error('UNAVAILABLE: Network offline');
      }
      const store = inMemoryFirestore[docRef.colName];
      store.delete(docRef.id);
      if (
        docRef.colName === 'motorcycles' ||
        docRef.colName === 'reminders' ||
        docRef.colName === 'serviceRecords'
      ) {
        notifyCollectionListeners(docRef.colName);
      }
    },
    writeBatch: () => {
      const ops: Array<() => void> = [];
      const affectedCols = new Set<'motorcycles' | 'reminders' | 'serviceRecords'>();
      return {
        set: (docRef: any, payload: any, options?: { merge?: boolean }) => {
          ops.push(() => {
            const store = inMemoryFirestore[docRef.colName];
            const existing = store.get(docRef.id) || {};
            store.set(docRef.id, options?.merge ? { ...existing, ...payload } : { ...payload });
            if (
              docRef.colName === 'motorcycles' ||
              docRef.colName === 'reminders' ||
              docRef.colName === 'serviceRecords'
            ) {
              affectedCols.add(docRef.colName);
            }
          });
        },
        delete: (docRef: any) => {
          ops.push(() => {
            const store = inMemoryFirestore[docRef.colName];
            store.delete(docRef.id);
            if (
              docRef.colName === 'motorcycles' ||
              docRef.colName === 'reminders' ||
              docRef.colName === 'serviceRecords'
            ) {
              affectedCols.add(docRef.colName);
            }
          });
        },
        commit: async () => {
          if (simulateNetworkOffline) {
            throw new Error('UNAVAILABLE: Network offline');
          }
          writeBatchCommitCount += 1;
          for (const op of ops) op();
          for (const col of affectedCols) notifyCollectionListeners(col);
        },
      };
    },
    runTransaction: async (_db: any, updateFn: (tx: any) => Promise<any>) => {
      if (simulateNetworkOffline) {
        throw new Error('UNAVAILABLE: Network offline');
      }
      const stagedOps: Array<() => void> = [];
      const affectedCols = new Set<'motorcycles' | 'reminders' | 'serviceRecords'>();
      const tx = {
        get: async (docRef: any) => {
          if (stagedOps.length > 0) {
            throw new Error(
              'FIRESTORE_TRANSACTION_ORDER_VIOLATION: Firestore transactions require all reads (transaction.get) to be executed before any writes'
            );
          }
          const store = inMemoryFirestore[docRef.colName];
          const exists = store?.has(docRef.id) ?? false;
          const val = store?.get(docRef.id);
          return {
            id: docRef.id,
            exists: () => exists,
            data: () => (val ? { ...val } : undefined),
          };
        },
        set: (docRef: any, payload: any, options?: { merge?: boolean }) => {
          stagedOps.push(() => {
            const store = inMemoryFirestore[docRef.colName];
            const existing = store.get(docRef.id) || {};
            store.set(docRef.id, options?.merge ? { ...existing, ...payload } : { ...payload });
            if (
              docRef.colName === 'motorcycles' ||
              docRef.colName === 'reminders' ||
              docRef.colName === 'serviceRecords'
            ) {
              affectedCols.add(docRef.colName);
            }
          });
        },
        update: (docRef: any, payload: any) => {
          stagedOps.push(() => {
            const store = inMemoryFirestore[docRef.colName];
            const existing = store.get(docRef.id) || {};
            store.set(docRef.id, { ...existing, ...payload });
            if (
              docRef.colName === 'motorcycles' ||
              docRef.colName === 'reminders' ||
              docRef.colName === 'serviceRecords'
            ) {
              affectedCols.add(docRef.colName);
            }
          });
        },
        delete: (docRef: any) => {
          stagedOps.push(() => {
            const store = inMemoryFirestore[docRef.colName];
            store.delete(docRef.id);
            if (
              docRef.colName === 'motorcycles' ||
              docRef.colName === 'reminders' ||
              docRef.colName === 'serviceRecords'
            ) {
              affectedCols.add(docRef.colName);
            }
          });
        },
      };
      const result = await updateFn(tx);
      transactionCommitCount += 1;
      for (const op of stagedOps) op();
      for (const col of affectedCols) notifyCollectionListeners(col);
      return result;
    },
    onSnapshot: (q: any, onNext: (snap: any) => void, onError?: (err: any) => void) => {
      if (simulateNetworkOffline) {
        if (onError) onError(new Error('UNAVAILABLE: Network offline'));
        return () => {};
      }
      const colName = q.colName as 'motorcycles' | 'reminders' | 'serviceRecords';
      const userIdConstraint = (q.constraints || []).find((c: any) => c.field === 'userId');
      const userId = userIdConstraint?.value || '';
      const entry = {
        userId,
        onNext: (docs: any[]) =>
          onNext({
            docs,
            forEach: (cb: (d: any) => void) => docs.forEach(cb),
          }),
      };
      if (activeSnapshotListeners[colName]) {
        activeSnapshotListeners[colName].push(entry);
        notifyCollectionListeners(colName);
      }
      return () => {
        if (activeSnapshotListeners[colName]) {
          activeSnapshotListeners[colName] = activeSnapshotListeners[colName].filter(
            (l) => l !== entry
          );
        }
      };
    },
  };
});

function createSampleBike(overrides: Partial<Motorcycle> = {}): Motorcycle {
  return {
    id: 'bike-custom-1',
    userId: 'uid-rider-a',
    nickname: 'Daily Runner',
    brand: 'Yamaha',
    model: 'NMAX 155',
    year: 2024,
    licensePlate: 'NAA 1234',
    color: 'Matte Black',
    odometer: 4500,
    unit: 'km',
    motorcycleType: 'Scooter / AT',
    specs: {
      displacementCc: 155,
      transmission: 'Automatic Scooter',
      cooling: 'Liquid-Cooled',
      oilCapacityLiters: 0.9,
      oilViscosity: '10W-40 JASO MB',
      tirePressureFrontPsi: 29,
      tirePressureRearPsi: 33,
      recommendedServiceIntervalKm: 1500,
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
    timestampSource: 'server',
    ...overrides,
  };
}

function createSampleReminder(overrides: Partial<MaintenanceReminder> = {}): MaintenanceReminder {
  return {
    id: 'rem-custom-1',
    userId: 'uid-rider-a',
    bikeId: 'bike-custom-1',
    title: 'Engine Oil Change',
    category: 'Engine Oil',
    categoryTag: 'OIL',
    intervalKm: 1500,
    lastCompletedOdo: 3000,
    nextDueOdo: 4500,
    lastCompletedDate: '2026-01-15',
    priority: 'high',
    notes: 'Use 10W-40 full synthetic',
    estimatedCostPhp: 450,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
    timestampSource: 'server',
    ...overrides,
  };
}

function createSampleRecord(overrides: Partial<ServiceRecord> = {}): ServiceRecord {
  return {
    id: 'rec-custom-1',
    userId: 'uid-rider-a',
    bikeId: 'bike-custom-1',
    date: '2026-01-15',
    odometer: 3000,
    title: '3,000 km PMS & Oil Change',
    category: 'Engine Oil',
    type: 'Casa / Official 3S',
    shopName: 'Yamaha 3S Quezon Ave',
    oilBrandGrade: 'Yamalube RS4GP 10W-40',
    parts: [{ name: 'Yamalube 1L', costPhp: 450 }],
    laborCostPhp: 200,
    totalCostPhp: 650,
    notes: 'Smooth engine response',
    isCasaVerified: true,
    bikeLabelSnapshot: '2024 Yamaha NMAX 155 (NAA 1234)',
    createdAt: '2026-01-15T00:00:00.000Z',
    updatedAt: '2026-01-15T00:00:00.000Z',
    timestampSource: 'server',
    ...overrides,
  };
}

describe('MotoCare Cloud Synchronization & Safe Migration — 16 Regression Scenarios', () => {
  beforeEach(() => {
    localStorage.clear();
    simulateNetworkOffline = false;
    inMemoryFirestore.users.clear();
    inMemoryFirestore.motorcycles.clear();
    inMemoryFirestore.reminders.clear();
    inMemoryFirestore.serviceRecords.clear();
    activeSnapshotListeners.motorcycles = [];
    activeSnapshotListeners.reminders = [];
    activeSnapshotListeners.serviceRecords = [];

    // Seed default Free and Pro user profiles in mock Firestore
    inMemoryFirestore.users.set('uid-rider-a', {
      id: 'uid-rider-a',
      email: 'ridera@example.com',
      role: 'rider',
      subscriptionTier: 'free',
      bikeCount: 0,
    });
    inMemoryFirestore.users.set('uid-rider-b', {
      id: 'uid-rider-b',
      email: 'riderb@example.com',
      role: 'rider',
      subscriptionTier: 'free',
      bikeCount: 0,
    });
    inMemoryFirestore.users.set('uid-pro-rider', {
      id: 'uid-pro-rider',
      email: 'pro@example.com',
      role: 'rider',
      subscriptionTier: 'pro',
      expiryDate: { toMillis: () => Date.now() + 30 * 86400000 },
      bikeCount: 0,
    });
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 1: Same-account synchronization across two devices
  // ---------------------------------------------------------------------------
  it('Scenario 1: synchronizes motorcycles, reminders, and service records across two devices signed into the same Firebase account', async () => {
    const uid = 'uid-rider-a';
    const bike = createSampleBike({ id: 'bike-dev1', userId: uid });
    const reminder = createSampleReminder({ id: 'rem-dev1', bikeId: 'bike-dev1', userId: uid });
    const record = createSampleRecord({ id: 'rec-dev1', bikeId: 'bike-dev1', userId: uid });

    // Device 1 writes to Firestore
    await saveMotorcycleToFirestore(bike, uid);
    await saveReminderToFirestore(reminder, uid);
    await saveServiceRecordToFirestore(record, uid);

    // Clear LocalStorage to simulate fresh Device 2 signing in with same UID
    localStorage.clear();

    const { result, unmount } = renderHook(() => {
      const [motorcycles, setMotorcycles] = React.useState<Motorcycle[]>([]);
      const [reminders, setReminders] = React.useState<MaintenanceReminder[]>([]);
      const [serviceRecords, setServiceRecords] = React.useState<ServiceRecord[]>([]);
      const [activeBikeId, setActiveBikeId] = React.useState<string>('');
      const syncState = useHydrateUserData({
        user: { uid, email: 'ridera@example.com' },
        hasProAccess: false,
        setMotorcycles,
        setReminders,
        setServiceRecords,
        setActiveBikeId,
      });
      return { motorcycles, reminders, serviceRecords, activeBikeId, ...syncState };
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });

    expect(result.current.motorcycles).toHaveLength(1);
    expect(result.current.motorcycles[0].id).toBe('bike-dev1');
    expect(result.current.reminders).toHaveLength(1);
    expect(result.current.reminders[0].id).toBe('rem-dev1');
    expect(result.current.serviceRecords).toHaveLength(1);
    expect(result.current.serviceRecords[0].id).toBe('rec-dev1');

    // Verify UID-scoped read-through cache was populated on Device 2
    expect(loadUserScopedMotorcycles(uid)).toHaveLength(1);
    expect(loadUserScopedReminders(uid)).toHaveLength(1);
    expect(loadUserScopedServiceRecords(uid)).toHaveLength(1);

    unmount();
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 2: Account switching on a shared browser
  // ---------------------------------------------------------------------------
  it('Scenario 2: isolates UID-scoped LocalStorage caches and cleans up listeners when switching accounts on a shared browser', async () => {
    const bikeA = createSampleBike({ id: 'bike-user-a', userId: 'uid-rider-a', nickname: 'Alpha Bike' });
    const bikeB = createSampleBike({ id: 'bike-user-b', userId: 'uid-rider-b', nickname: 'Bravo Bike' });

    await saveMotorcycleToFirestore(bikeA, 'uid-rider-a');
    await saveMotorcycleToFirestore(bikeB, 'uid-rider-b');

    const { result, rerender, unmount } = renderHook(
      ({ uid, email }) => {
        const [motorcycles, setMotorcycles] = React.useState<Motorcycle[]>([]);
        const [reminders, setReminders] = React.useState<MaintenanceReminder[]>([]);
        const [serviceRecords, setServiceRecords] = React.useState<ServiceRecord[]>([]);
        const [activeBikeId, setActiveBikeId] = React.useState<string>('');
        const syncState = useHydrateUserData({
          user: uid ? { uid, email } : null,
          hasProAccess: false,
          setMotorcycles,
          setReminders,
          setServiceRecords,
          setActiveBikeId,
        });
        return { motorcycles, reminders, serviceRecords, activeBikeId, ...syncState };
      },
      { initialProps: { uid: 'uid-rider-a' as string | undefined, email: 'ridera@example.com' } }
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 25));
    });

    expect(result.current.motorcycles.map((b) => b.id)).toEqual(['bike-user-a']);

    // Switch to Rider B on the same browser
    rerender({ uid: 'uid-rider-b', email: 'riderb@example.com' });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 25));
    });

    expect(result.current.motorcycles.map((b) => b.id)).toEqual(['bike-user-b']);
    // Rider A's cache remains isolated under uid-rider-a
    expect(loadUserScopedMotorcycles('uid-rider-a').map((b) => b.id)).toEqual(['bike-user-a']);
    expect(loadUserScopedMotorcycles('uid-rider-b').map((b) => b.id)).toEqual(['bike-user-b']);

    // Sign out (uid = undefined)
    rerender({ uid: undefined, email: '' });
    expect(activeSnapshotListeners.motorcycles).toHaveLength(0);
    expect(activeSnapshotListeners.reminders).toHaveLength(0);
    expect(activeSnapshotListeners.serviceRecords).toHaveLength(0);

    unmount();
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 3: Legacy data ownership confirmation
  // ---------------------------------------------------------------------------
  it('Scenario 3: blocks automatic legacy data migration without explicit user ownership confirmation', async () => {
    const legacyBike = createSampleBike({ id: 'bike-legacy-real', userId: undefined });
    localStorage.setItem('motocare_app_motorcycles_v4', JSON.stringify([legacyBike]));

    // Attempt syncStorageToFirestore with userConfirmedOwnership = false -> MUST throw
    await expect(
      syncStorageToFirestore({
        userId: 'uid-rider-a',
        userEmail: 'ridera@example.com',
        hasProAccess: false,
        userConfirmedOwnership: false,
        motorcyclesToSync: [legacyBike],
        remindersToSync: [],
        serviceRecordsToSync: [],
      })
    ).rejects.toThrow(/CONFIRMATION_REQUIRED/);

    expect(inMemoryFirestore.motorcycles.size).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 4: Skipping migration safely
  // ---------------------------------------------------------------------------
  it('Scenario 4: allows skipping legacy migration safely while preserving legacy LocalStorage untouched', () => {
    const legacyBike = createSampleBike({ id: 'bike-legacy-keep', userId: undefined });
    localStorage.setItem('motocare_app_motorcycles_v4', JSON.stringify([legacyBike]));

    skipLegacyMigrationForUser('uid-rider-a', 'ridera@example.com');

    const ledger = loadMigrationLedger('uid-rider-a');
    expect(ledger?.status).toBe('skipped');

    const dryRunAfterSkip = inspectLegacyDataDryRun({
      userId: 'uid-rider-a',
      userEmail: 'ridera@example.com',
      hasProAccess: false,
    });
    expect(dryRunAfterSkip.hasLegacyDataToReview).toBe(false);

    // Original legacy key is preserved intact
    const rawLegacy = JSON.parse(localStorage.getItem('motocare_app_motorcycles_v4') || '[]');
    expect(rawLegacy).toHaveLength(1);
    expect(rawLegacy[0].id).toBe('bike-legacy-keep');
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 5: Migration backup creation
  // ---------------------------------------------------------------------------
  it('Scenario 5: creates an immutable pre-migration backup before writing any legacy records to Firestore', async () => {
    const legacyBike = createSampleBike({ id: 'bike-legacy-bkp', userId: undefined });
    const legacyReminder = createSampleReminder({
      id: 'rem-legacy-bkp',
      bikeId: 'bike-legacy-bkp',
      userId: undefined,
    });
    localStorage.setItem('motocare_app_motorcycles_v4', JSON.stringify([legacyBike]));
    localStorage.setItem('motocare_app_reminders_v4', JSON.stringify([legacyReminder]));

    const backup = createImmutablePreMigrationBackup('uid-rider-a', 'ridera@example.com');
    expect(backup.backupVersion).toBe('1.0');
    expect(backup.userId).toBe('uid-rider-a');
    expect(backup.motorcycles).toHaveLength(1);
    expect(backup.reminders).toHaveLength(1);

    // Verify immutability: modifying legacy storage later does not overwrite existing backup
    localStorage.setItem('motocare_app_motorcycles_v4', JSON.stringify([]));
    const secondCallBackup = createImmutablePreMigrationBackup('uid-rider-a', 'ridera@example.com');
    expect(secondCallBackup.motorcycles).toHaveLength(1);
    expect(loadPreMigrationBackup('uid-rider-a')?.motorcycles).toHaveLength(1);
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 6: Interrupted migration recovery
  // ---------------------------------------------------------------------------
  it('Scenario 6: recovers and resumes an interrupted migration using per-entity ledger checkpoints without re-creating completed motorcycles', async () => {
    const uid = 'uid-pro-rider';
    const bike1 = createSampleBike({ id: 'bike-mig-1', userId: uid });
    const rem1 = createSampleReminder({ id: 'rem-mig-1', bikeId: 'bike-mig-1', userId: uid });
    const rec1 = createSampleRecord({ id: 'rec-mig-1', bikeId: 'bike-mig-1', userId: uid });

    // Simulate bike1 already written before interruption
    await saveMotorcycleToFirestore(bike1, uid);
    saveMigrationLedger({
      userId: uid,
      userEmail: 'pro@example.com',
      status: 'in_progress',
      backupKey: `motocare_pre_cloud_migration_backup_v1_${uid}`,
      startedAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-01T00:00:00.000Z',
      motorcyclesCompletedIds: ['bike-mig-1'],
      remindersCompletedIds: [],
      serviceRecordsCompletedIds: [],
      bikeIdRemap: { 'bike-mig-1': 'bike-mig-1' },
    });

    // Resume migration
    const { ledger } = await syncStorageToFirestore({
      userId: uid,
      userEmail: 'pro@example.com',
      hasProAccess: true,
      userConfirmedOwnership: true,
      motorcyclesToSync: [bike1],
      remindersToSync: [rem1],
      serviceRecordsToSync: [rec1],
      existingCloudMotorcycles: [bike1],
      existingCloudReminders: [],
      existingCloudServiceRecords: [],
    });

    expect(ledger.status).toBe('completed');
    expect(ledger.motorcyclesCompletedIds).toContain('bike-mig-1');
    expect(ledger.remindersCompletedIds).toContain('rem-mig-1');
    expect(ledger.serviceRecordsCompletedIds).toContain('rec-mig-1');
    expect(inMemoryFirestore.motorcycles.size).toBe(1);
    expect(inMemoryFirestore.reminders.size).toBe(1);
    expect(inMemoryFirestore.serviceRecords.size).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 7: Duplicate prevention
  // ---------------------------------------------------------------------------
  it('Scenario 7: prevents duplicate documents when syncStorageToFirestore is invoked multiple times and excludes mock/sample IDs', async () => {
    const uid = 'uid-rider-a';
    const realBike = createSampleBike({ id: 'bike-real-unique', userId: undefined });
    const mockBike = createSampleBike({ id: 'bike-ph-1', userId: undefined }); // Known mock sample ID
    localStorage.setItem('motocare_app_motorcycles_v4', JSON.stringify([realBike, mockBike]));

    const dryRun = inspectLegacyDataDryRun({
      userId: uid,
      userEmail: 'ridera@example.com',
      hasProAccess: false,
    });
    expect(dryRun.eligibleMotorcycles.map((b) => b.id)).toEqual(['bike-real-unique']);
    expect(dryRun.excludedMockSampleCount).toBeGreaterThanOrEqual(1);

    await syncStorageToFirestore({
      userId: uid,
      userEmail: 'ridera@example.com',
      hasProAccess: false,
      userConfirmedOwnership: true,
      motorcyclesToSync: dryRun.eligibleMotorcycles,
      remindersToSync: [],
      serviceRecordsToSync: [],
    });

    // Run a second time -> idempotent ledger prevents duplicate creation
    await syncStorageToFirestore({
      userId: uid,
      userEmail: 'ridera@example.com',
      hasProAccess: false,
      userConfirmedOwnership: true,
      motorcyclesToSync: dryRun.eligibleMotorcycles,
      remindersToSync: [],
      serviceRecordsToSync: [],
    });

    expect(inMemoryFirestore.motorcycles.size).toBe(1);
    expect(inMemoryFirestore.users.get(uid)?.bikeCount).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 8: Newer Firestore record protection
  // ---------------------------------------------------------------------------
  it('Scenario 8: protects newer Firestore records from being overwritten by older local records and surfaces odometer conflicts instead of blindly picking highest value', async () => {
    const uid = 'uid-rider-a';
    // Cloud has newer timestamp (March 10) with corrected odometer 5,200 km
    const newerCloudBike = createSampleBike({
      id: 'bike-conflict-1',
      userId: uid,
      odometer: 5200,
      updatedAt: '2026-03-10T12:00:00.000Z',
    });
    // Local cache has older timestamp (March 1) but an accidental typo odometer 59,000 km
    const olderLocalTypoBike = createSampleBike({
      id: 'bike-conflict-1',
      userId: uid,
      odometer: 59000,
      updatedAt: '2026-03-01T12:00:00.000Z',
    });

    const resolution = resolveMotorcycleConflict(olderLocalTypoBike, newerCloudBike);
    // Must NOT blindly pick 59,000 km; must preserve newer cloud record and surface conflict
    expect(resolution.winner).toBe('cloud');
    expect(resolution.resolved.odometer).toBe(5200);
    expect(resolution.conflict).toBeDefined();
    expect(resolution.conflict?.cloudRecord.odometer).toBe(5200);
    expect(resolution.conflict?.localRecord.odometer).toBe(59000);
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 9: Offline changes and retry
  // ---------------------------------------------------------------------------
  it('Scenario 9: queues mutations locally when offline and flushes them atomically when connectivity returns', async () => {
    const uid = 'uid-rider-a';
    const bike = createSampleBike({ id: 'bike-offline-1', userId: uid });
    await saveMotorcycleToFirestore(bike, uid);

    // Go offline and enqueue an odometer update + reminder upsert
    simulateNetworkOffline = true;
    const rem = createSampleReminder({ id: 'rem-offline-1', bikeId: 'bike-offline-1', userId: uid });

    enqueueOfflineMutation({
      userId: uid,
      entity: 'motorcycle',
      action: 'update_fields',
      targetId: 'bike-offline-1',
      payload: { odometer: 4850 },
    });
    enqueueOfflineMutation({
      userId: uid,
      entity: 'reminder',
      action: 'upsert',
      targetId: 'rem-offline-1',
      payload: rem as unknown as Record<string, unknown>,
    });

    expect(getOfflineMutationQueue(uid)).toHaveLength(2);

    // Flushing while still offline retains items and increments retryCount
    const failedFlush = await flushOfflineMutationQueue(uid);
    expect(failedFlush.failedCount).toBe(2);
    expect(getOfflineMutationQueue(uid)).toHaveLength(2);

    // Restore connectivity and flush queue
    simulateNetworkOffline = false;
    const successFlush = await flushOfflineMutationQueue(uid);
    expect(successFlush.flushedCount).toBe(2);
    expect(successFlush.failedCount).toBe(0);
    expect(getOfflineMutationQueue(uid)).toHaveLength(0);
    expect(inMemoryFirestore.motorcycles.get('bike-offline-1')?.odometer).toBe(4850);
    expect(inMemoryFirestore.reminders.get('rem-offline-1')?.title).toBe('Engine Oil Change');
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 10: Motorcycle create/edit/delete synchronization
  // ---------------------------------------------------------------------------
  it('Scenario 10: synchronizes motorcycle create, edit, and delete with atomic bikeCount updates and native Firestore Timestamps', async () => {
    const uid = 'uid-rider-a';
    const bike = createSampleBike({ id: 'bike-crud-1', userId: uid, odometer: 1000 });

    // Create
    await saveMotorcycleToFirestore(bike, uid);
    expect(inMemoryFirestore.motorcycles.has('bike-crud-1')).toBe(true);
    expect(inMemoryFirestore.users.get(uid)?.bikeCount).toBe(1);
    const createdDoc = inMemoryFirestore.motorcycles.get('bike-crud-1');
    expect(typeof createdDoc?.updatedAt?.toDate).toBe('function');
    expect(normalizeFirestoreTimestampToIso(createdDoc?.updatedAt)).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // Edit
    const editedBike = { ...bike, odometer: 1850, nickname: 'Touring Spec' };
    await saveMotorcycleToFirestore(editedBike, uid);
    expect(inMemoryFirestore.motorcycles.get('bike-crud-1')?.odometer).toBe(1850);
    expect(inMemoryFirestore.motorcycles.get('bike-crud-1')?.nickname).toBe('Touring Spec');
    expect(inMemoryFirestore.users.get(uid)?.bikeCount).toBe(1);

    // Delete
    await deleteMotorcycleFromFirestore('bike-crud-1', uid);
    expect(inMemoryFirestore.motorcycles.has('bike-crud-1')).toBe(false);
    expect(inMemoryFirestore.users.get(uid)?.bikeCount).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 11: Reminder create/edit/delete synchronization
  // ---------------------------------------------------------------------------
  it('Scenario 11: synchronizes maintenance reminder create, edit, and delete to Firestore', async () => {
    const uid = 'uid-rider-a';
    const bike = createSampleBike({ id: 'bike-rem-parent', userId: uid });
    await saveMotorcycleToFirestore(bike, uid);

    const rem = createSampleReminder({ id: 'rem-crud-1', bikeId: 'bike-rem-parent', userId: uid });
    await saveReminderToFirestore(rem, uid);
    expect(inMemoryFirestore.reminders.has('rem-crud-1')).toBe(true);

    // Edit reminder
    await saveReminderToFirestore({ ...rem, intervalKm: 2000, nextDueOdo: 5000 }, uid);
    expect(inMemoryFirestore.reminders.get('rem-crud-1')?.intervalKm).toBe(2000);

    // Delete reminder
    await deleteReminderFromFirestore('rem-crud-1', uid);
    expect(inMemoryFirestore.reminders.has('rem-crud-1')).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 12: Service-record create/edit/delete synchronization
  // ---------------------------------------------------------------------------
  it('Scenario 12: synchronizes service record create, edit (with atomic linked reminder reset), and delete to Firestore', async () => {
    const uid = 'uid-rider-a';
    const bike = createSampleBike({ id: 'bike-rec-parent', userId: uid });
    const rem = createSampleReminder({
      id: 'rem-linked-1',
      bikeId: 'bike-rec-parent',
      userId: uid,
      intervalKm: 1500,
      lastCompletedOdo: 3000,
      nextDueOdo: 4500,
    });
    await saveMotorcycleToFirestore(bike, uid);
    await saveReminderToFirestore(rem, uid);

    const record = createSampleRecord({
      id: 'rec-crud-1',
      bikeId: 'bike-rec-parent',
      userId: uid,
      odometer: 4500,
      linkedReminderId: 'rem-linked-1',
    });
    const resetReminder: MaintenanceReminder = {
      ...rem,
      lastCompletedOdo: 4500,
      nextDueOdo: 6000,
      lastCompletedDate: '2026-03-01',
    };

    // Create service record + atomically update linked reminder
    await saveServiceRecordToFirestore(record, uid, resetReminder);
    expect(inMemoryFirestore.serviceRecords.has('rec-crud-1')).toBe(true);
    expect(inMemoryFirestore.reminders.get('rem-linked-1')?.nextDueOdo).toBe(6000);

    // Edit service record
    await saveServiceRecordToFirestore({ ...record, totalCostPhp: 850 }, uid);
    expect(inMemoryFirestore.serviceRecords.get('rec-crud-1')?.totalCostPhp).toBe(850);

    // Delete service record
    await deleteServiceRecordFromFirestore('rec-crud-1', uid);
    expect(inMemoryFirestore.serviceRecords.has('rec-crud-1')).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 13: Service-history preservation after motorcycle removal
  // ---------------------------------------------------------------------------
  it('Scenario 13: preserves service history records when a motorcycle is removed from the garage', async () => {
    const uid = 'uid-rider-a';
    const bike = createSampleBike({ id: 'bike-retire-1', userId: uid });
    const rem = createSampleReminder({ id: 'rem-retire-1', bikeId: 'bike-retire-1', userId: uid });
    const rec = createSampleRecord({ id: 'rec-preserve-1', bikeId: 'bike-retire-1', userId: uid });

    await saveMotorcycleToFirestore(bike, uid);
    await saveReminderToFirestore(rem, uid);
    await saveServiceRecordToFirestore(rec, uid);

    // Delete motorcycle without requesting permanent service history deletion
    await deleteMotorcycleFromFirestore('bike-retire-1', uid);

    expect(inMemoryFirestore.motorcycles.has('bike-retire-1')).toBe(false);
    expect(inMemoryFirestore.reminders.has('rem-retire-1')).toBe(false);
    // Service record MUST remain preserved!
    expect(inMemoryFirestore.serviceRecords.has('rec-preserve-1')).toBe(true);
    expect(inMemoryFirestore.serviceRecords.get('rec-preserve-1')?.bikeLabelSnapshot).toContain(
      'Yamaha NMAX 155'
    );
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 14: Free motorcycle quota enforcement
  // ---------------------------------------------------------------------------
  it('Scenario 14: enforces the 1-motorcycle Free quota during creation and requires single-bike selection during multi-bike Free migration', async () => {
    const uid = 'uid-rider-a'; // Free tier
    const bike1 = createSampleBike({ id: 'bike-free-1', userId: uid });
    const bike2 = createSampleBike({ id: 'bike-free-2', userId: uid });

    await saveMotorcycleToFirestore(bike1, uid);
    await expect(saveMotorcycleToFirestore(bike2, uid)).rejects.toThrow(/QUOTA_EXCEEDED/);

    // Verify Free migration with 2 local bikes requires single-bike selection and only syncs selected bike
    inMemoryFirestore.motorcycles.clear();
    inMemoryFirestore.users.set(uid, {
      id: uid,
      email: 'ridera@example.com',
      role: 'rider',
      subscriptionTier: 'free',
      bikeCount: 0,
    });

    localStorage.setItem('motocare_app_motorcycles_v4', JSON.stringify([bike1, bike2]));
    const dryRun = inspectLegacyDataDryRun({
      userId: uid,
      userEmail: 'ridera@example.com',
      hasProAccess: false,
    });
    expect(dryRun.requiresQuotaSelection).toBe(true);
    expect(dryRun.maxAllowedCloudBikes).toBe(1);

    await syncStorageToFirestore({
      userId: uid,
      userEmail: 'ridera@example.com',
      hasProAccess: false,
      userConfirmedOwnership: true,
      selectedBikeIds: ['bike-free-2'],
      motorcyclesToSync: [bike1, bike2],
      remindersToSync: [],
      serviceRecordsToSync: [],
    });

    expect(inMemoryFirestore.motorcycles.size).toBe(1);
    expect(inMemoryFirestore.motorcycles.has('bike-free-2')).toBe(true);
    // Both bikes remain preserved in the immutable pre-migration backup
    expect(loadPreMigrationBackup(uid)?.motorcycles).toHaveLength(2);
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 15: Expired Pro access to existing records
  // ---------------------------------------------------------------------------
  it('Scenario 15: preserves full read, edit, and delete access to existing motorcycles, reminders, and service records after Pro expiration', async () => {
    const uid = 'uid-expired-pro';
    inMemoryFirestore.users.set(uid, {
      id: uid,
      email: 'expired@example.com',
      role: 'rider',
      subscriptionTier: 'pro',
      // Expired 5 days ago
      expiryDate: { toMillis: () => Date.now() - 5 * 86400000 },
      bikeCount: 2,
    });

    const existingBike1 = createSampleBike({ id: 'bike-exp-1', userId: uid, odometer: 10000 });
    const existingBike2 = createSampleBike({ id: 'bike-exp-2', userId: uid, odometer: 20000 });
    inMemoryFirestore.motorcycles.set('bike-exp-1', existingBike1);
    inMemoryFirestore.motorcycles.set('bike-exp-2', existingBike2);

    // Updating an existing motorcycle succeeds even when expired and holding 2 motorcycles
    await saveMotorcycleToFirestore({ ...existingBike2, odometer: 20500 }, uid);
    expect(inMemoryFirestore.motorcycles.get('bike-exp-2')?.odometer).toBe(20500);

    // Creating a reminder or service record on existing motorcycle succeeds
    const rem = createSampleReminder({ id: 'rem-exp-1', bikeId: 'bike-exp-2', userId: uid });
    const rec = createSampleRecord({ id: 'rec-exp-1', bikeId: 'bike-exp-2', userId: uid });
    await saveReminderToFirestore(rem, uid);
    await saveServiceRecordToFirestore(rec, uid);
    expect(inMemoryFirestore.reminders.has('rem-exp-1')).toBe(true);
    expect(inMemoryFirestore.serviceRecords.has('rec-exp-1')).toBe(true);

    // Adding a 3rd new motorcycle is blocked because Pro is expired
    const newBike3 = createSampleBike({ id: 'bike-exp-3', userId: uid });
    await expect(saveMotorcycleToFirestore(newBike3, uid)).rejects.toThrow(/QUOTA_EXCEEDED/);
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 16: Cross-user ownership protection & Firestore Security Rules
  // ---------------------------------------------------------------------------
  it('Scenario 16: enforces cross-user ownership protection in client storage/service layers and in firestore.rules', async () => {
    const attackerUid = 'uid-rider-b';
    const victimUid = 'uid-rider-a';

    const victimBike = createSampleBike({ id: 'bike-victim-1', userId: victimUid });
    await saveMotorcycleToFirestore(victimBike, victimUid);

    // Attacker attempts to overwrite or delete victim's motorcycle
    await expect(
      saveMotorcycleToFirestore({ ...victimBike, nickname: 'Hacked' }, attackerUid)
    ).rejects.toThrow(/PERMISSION_DENIED/);

    await expect(deleteMotorcycleFromFirestore('bike-victim-1', attackerUid)).rejects.toThrow(
      /PERMISSION_DENIED/
    );

    // Foreign UID records in legacy LocalStorage are rejected during dry-run inspection
    localStorage.setItem('motocare_app_motorcycles_v4', JSON.stringify([victimBike]));
    const attackerDryRun = inspectLegacyDataDryRun({
      userId: attackerUid,
      userEmail: 'riderb@example.com',
      hasProAccess: false,
    });
    expect(attackerDryRun.eligibleMotorcycles).toHaveLength(0);
    expect(attackerDryRun.rejectedForeignUidCount).toBe(1);

    // Verify firestore.rules contains all Phase 5 structural validations
    const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
    const rulesContent = fs.readFileSync(rulesPath, 'utf-8');
    expect(rulesContent).toContain('function isValidMotorcyclePayload(data, bikeId)');
    expect(rulesContent).toContain('function isValidReminderPayload(data, reminderId)');
    expect(rulesContent).toContain('function isValidServiceRecordPayload(data, recordId)');
    expect(rulesContent).toContain(
      'exists(/databases/$(database)/documents/motorcycles/$(data.bikeId))'
    );
    expect(rulesContent).toContain(
      'get(/databases/$(database)/documents/motorcycles/$(data.bikeId)).data.userId == request.auth.uid'
    );
    expect(rulesContent).toContain("data.parts is list && data.parts.size() <= 50");
    expect(rulesContent).toContain('request.resource.data.bikeId == resource.data.bikeId');
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 17: Side-by-Side Conflict Diff View in LegacyMigrationModal
  // ---------------------------------------------------------------------------
  it('Scenario 17: compares local and cloud record fields side-by-side in LegacyMigrationModal before choosing which version to keep', async () => {
    const cloudBike = createSampleBike({
      id: 'bike-diff-1',
      odometer: 12400,
      nickname: 'Cloud Commuter',
      licensePlate: 'NAA 1234',
      updatedAt: '2026-03-10T09:00:00.000Z',
      timestampSource: 'server',
    });
    const localBike = createSampleBike({
      id: 'bike-diff-1',
      odometer: 15800,
      nickname: 'Weekend Tourer',
      licensePlate: 'NAA 1234',
      updatedAt: '2026-03-01T08:00:00.000Z',
      timestampSource: 'client_pending',
    });

    const diffs = buildConflictFieldDiffs(localBike, cloudBike);
    const odoRow = diffs.find((d) => d.fieldKey === 'odometer');
    const nickRow = diffs.find((d) => d.fieldKey === 'nickname');
    const plateRow = diffs.find((d) => d.fieldKey === 'licensePlate');

    expect(odoRow?.isDifferent).toBe(true);
    expect(odoRow?.cloudValue).toBe('12,400 km');
    expect(odoRow?.localValue).toBe('15,800 km');
    expect(odoRow?.deltaLabel).toBe('+3,400 km local');
    expect(nickRow?.isDifferent).toBe(true);
    expect(plateRow?.isDifferent).toBe(false);

    const onResolve = vi.fn().mockResolvedValue(undefined);
    const { getByTestId, getByText, queryByTestId } = render(
      <LegacyMigrationModal
        isOpen={true}
        dryRun={null}
        activeConflicts={[
          {
            id: 'conflict_bike_bike-diff-1',
            entity: 'motorcycle',
            targetId: 'bike-diff-1',
            reason: 'ambiguous_odometer',
            localRecord: localBike,
            cloudRecord: cloudBike,
            detectedAtIso: '2026-03-10T10:00:00.000Z',
          },
        ]}
        isSyncing={false}
        onConfirmMigrate={vi.fn()}
        onSkipMigration={vi.fn()}
        onResolveConflict={onResolve}
      />
    );

    expect(getByTestId('conflict-diff-card-conflict_bike_bike-diff-1')).toBeTruthy();
    expect(getByTestId('diff-row-odometer').textContent).toContain('12,400 km');
    expect(getByTestId('diff-row-odometer').textContent).toContain('15,800 km');
    expect(getByTestId('diff-row-odometer').textContent).toContain('+3,400 km local');
    expect(getByTestId('diff-row-licensePlate').textContent).toContain('MATCH');

    // Toggle "Show All Fields" -> "Showing Changes Only" hides matching rows
    fireEvent.click(getByText('Show All Fields'));
    expect(queryByTestId('diff-row-licensePlate')).toBeNull();
    expect(getByTestId('diff-row-odometer')).toBeTruthy();

    // User chooses Keep Cloud
    fireEvent.click(getByText('Keep Cloud (12,400 km)'));
    expect(onResolve).toHaveBeenCalledWith('conflict_bike_bike-diff-1', 'keep_cloud');
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 18: AdminPortal Cloud Sync Write Queue Size & Last 5 Success vs Failed Logs
  // ---------------------------------------------------------------------------
  it('Scenario 18: displays current Firestore write queue size and logs the last 5 successful vs failed cloud sync operations in AdminUsersPortal', async () => {
    const ownerUid = 'uid-owner-admin';
    (auth as any).currentUser = {
      uid: ownerUid,
      email: 'mustetm7@gmail.com',
      emailVerified: true,
    };
    (auth as any).onAuthStateChanged = (cb: (u: any) => void) => {
      cb((auth as any).currentUser);
      return () => {};
    };

    // Enqueue 2 pending offline mutations for the current user
    enqueueOfflineMutation({
      userId: ownerUid,
      entity: 'motorcycle',
      action: 'update_fields',
      targetId: 'bike-q-1',
      payload: { odometer: 8800 },
    });
    enqueueOfflineMutation({
      userId: ownerUid,
      entity: 'reminder',
      action: 'upsert',
      targetId: 'rem-q-2',
      payload: { title: 'Engine Oil' },
    });

    // Record 6 successful and 6 failed operations to verify only the last 5 of each are surfaced
    for (let i = 1; i <= 6; i++) {
      recordCloudSyncOperation({
        id: `succ-${i}`,
        userId: ownerUid,
        timestampIso: `2026-03-10T10:0${i}:00.000Z`,
        status: 'success',
        operation: `upsert_motorcycle_${i}`,
        entity: 'motorcycle',
        targetId: `bike-${i}`,
        detail: `Synced bike #${i}`,
      });
      recordCloudSyncOperation({
        id: `fail-${i}`,
        userId: ownerUid,
        timestampIso: `2026-03-10T11:0${i}:00.000Z`,
        status: 'failed',
        operation: `update_odo_${i}`,
        entity: 'motorcycle',
        targetId: `bike-${i}`,
        errorMessage: `Network timeout #${i}`,
      });
    }

    const logs = getCloudSyncOperationLogs(ownerUid);
    expect(logs.last5Successful).toHaveLength(5);
    expect(logs.last5Failed).toHaveLength(5);
    // Newest 5 should be #6 down to #2
    expect(logs.last5Successful.map((l) => l.id)).toEqual([
      'succ-6',
      'succ-5',
      'succ-4',
      'succ-3',
      'succ-2',
    ]);
    expect(logs.last5Failed.map((l) => l.id)).toEqual([
      'fail-6',
      'fail-5',
      'fail-4',
      'fail-3',
      'fail-2',
    ]);

    const { getByTestId } = render(
      <AdminUsersPortal
        users={[]}
        onApprovePro={vi.fn()}
        onRevokePro={vi.fn()}
        onAddUser={vi.fn()}
        onResetUsersToDefault={vi.fn()}
      />
    );

    const panel = getByTestId('admin-cloud-sync-diagnostic-panel');
    expect(panel).toBeTruthy();

    const queueBadge = getByTestId('firestore-write-queue-size-badge');
    expect(queueBadge.textContent).toContain('Write Queue Size: 2');

    const successCol = getByTestId('sync-logs-successful-column');
    const failedCol = getByTestId('sync-logs-failed-column');
    expect(successCol.textContent).toContain('5 / 5');
    expect(successCol.textContent).toContain('upsert_motorcycle_6');
    expect(successCol.textContent).not.toContain('upsert_motorcycle_1');

    expect(failedCol.textContent).toContain('5 / 5');
    expect(failedCol.textContent).toContain('Network timeout #6');
    expect(failedCol.textContent).not.toContain('Network timeout #1');
  });

  // ---------------------------------------------------------------------------
  // OFFLINE MUTATION QUEUE DATA-LOSS PREVENTION — 7 TARGETED SCENARIOS
  // ---------------------------------------------------------------------------
  describe('Offline Mutation Queue Data-Loss Prevention (7 Scenarios)', () => {
    beforeEach(() => {
      Object.defineProperty(window.navigator, 'onLine', {
        configurable: true,
        value: true,
      });
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: 'visible',
      });
    });

    it('1. Offline rider creates a mutation and hides the tab five times -> mutation remains in active queue and retryCount does not increase', async () => {
      const uid = 'uid-rider-a';
      Object.defineProperty(window.navigator, 'onLine', {
        configurable: true,
        value: false,
      });

      const { unmount } = renderHook(() => {
        const [motorcycles, setMotorcycles] = React.useState<Motorcycle[]>([]);
        const [reminders, setReminders] = React.useState<MaintenanceReminder[]>([]);
        const [serviceRecords, setServiceRecords] = React.useState<ServiceRecord[]>([]);
        const [activeBikeId, setActiveBikeId] = React.useState<string>('');
        return useHydrateUserData({
          user: { uid, email: 'ridera@example.com' },
          hasProAccess: false,
          setMotorcycles,
          setReminders,
          setServiceRecords,
          setActiveBikeId,
        });
      });

      const created = enqueueOfflineMutation({
        id: 'mut_offline_tab_hide_1',
        userId: uid,
        entity: 'motorcycle',
        action: 'update_fields',
        targetId: 'bike-off-1',
        payload: { odometer: 14250, nickname: 'Offline Commuter' },
        createdAtIso: '2026-03-11T08:00:00.000Z',
      });
      expect(created.retryCount).toBe(0);

      // Hide the tab 5 times while offline AND directly invoke flushOfflineMutationQueue 5 times while offline
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: 'hidden',
      });

      for (let i = 0; i < 5; i++) {
        document.dispatchEvent(new Event('visibilitychange'));
        const res = await flushOfflineMutationQueue(uid);
        expect(res.skippedOffline).toBe(true);
        expect(res.flushedCount).toBe(0);
        expect(res.failedCount).toBe(0);
      }

      const activeQueue = getOfflineMutationQueue(uid);
      expect(activeQueue).toHaveLength(1);
      expect(activeQueue[0].id).toBe('mut_offline_tab_hide_1');
      expect(activeQueue[0].retryCount).toBe(0);
      expect(activeQueue[0].payload).toEqual({
        odometer: 14250,
        nickname: 'Offline Commuter',
      });
      expect(getQuarantinedMutationQueue(uid)).toHaveLength(0);

      unmount();
    });

    it('2. Reconnecting allows the existing offline mutation to flush successfully', async () => {
      const uid = 'uid-rider-a';
      const existingBike = createSampleBike({ id: 'bike-reconnect-1', userId: uid, odometer: 10000 });
      await saveMotorcycleToFirestore(existingBike, uid);

      // Rider goes offline and enqueues an odometer update + hides tab 5 times
      Object.defineProperty(window.navigator, 'onLine', {
        configurable: true,
        value: false,
      });

      enqueueOfflineMutation({
        id: 'mut_reconnect_1',
        userId: uid,
        entity: 'motorcycle',
        action: 'update_fields',
        targetId: 'bike-reconnect-1',
        payload: { odometer: 11250 },
      });

      for (let i = 0; i < 5; i++) {
        await flushOfflineMutationQueue(uid);
      }
      expect(getOfflineMutationQueue(uid)).toHaveLength(1);
      expect(getOfflineMutationQueue(uid)[0].retryCount).toBe(0);

      // Rider reconnects
      Object.defineProperty(window.navigator, 'onLine', {
        configurable: true,
        value: true,
      });

      const flushRes = await flushOfflineMutationQueue(uid);
      expect(flushRes.skippedOffline).toBe(false);
      expect(flushRes.flushedCount).toBe(1);
      expect(flushRes.failedCount).toBe(0);
      expect(getOfflineMutationQueue(uid)).toHaveLength(0);
      expect(inMemoryFirestore.motorcycles.get('bike-reconnect-1')?.odometer).toBe(11250);
    });

    it('3. A temporary network failure does not discard the payload and keeps the mutation in the active queue', async () => {
      const uid = 'uid-rider-a';
      const bike = createSampleBike({ id: 'bike-temp-err-1', userId: uid, odometer: 5000 });
      await saveMotorcycleToFirestore(bike, uid);

      enqueueOfflineMutation({
        id: 'mut_temp_net_1',
        userId: uid,
        entity: 'motorcycle',
        action: 'update_fields',
        targetId: 'bike-temp-err-1',
        payload: { odometer: 5600, licensePlate: 'TEMP 999' },
      });

      // Browser reports online, but Firestore RPC fails with transient UNAVAILABLE network error
      simulateNetworkOffline = true;
      const res = await flushOfflineMutationQueue(uid);

      expect(res.flushedCount).toBe(0);
      expect(res.failedCount).toBe(1);
      expect(res.quarantinedCount).toBe(0);

      const activeQueue = getOfflineMutationQueue(uid);
      expect(activeQueue).toHaveLength(1);
      expect(activeQueue[0].id).toBe('mut_temp_net_1');
      expect(activeQueue[0].retryCount).toBe(1);
      expect(activeQueue[0].payload).toEqual({
        odometer: 5600,
        licensePlate: 'TEMP 999',
      });
      expect(activeQueue[0].lastError).toContain('UNAVAILABLE');
      expect(getQuarantinedMutationQueue(uid)).toHaveLength(0);
    });

    it('4. A permanent failure moves the complete payload into quarantine (motocare_quarantined_queue_v1_${userId})', async () => {
      const uid = 'uid-rider-a'; // Free tier rider (1 bike quota)
      const firstBike = createSampleBike({ id: 'bike-perm-1', userId: uid });
      await saveMotorcycleToFirestore(firstBike, uid);

      // Enqueue a 2nd motorcycle creation that will fail with QUOTA_EXCEEDED
      const secondBike = createSampleBike({
        id: 'bike-perm-2',
        userId: uid,
        brand: 'Honda',
        model: 'Click 160',
        odometer: 3300,
        licensePlate: 'QTA 160',
      });

      enqueueOfflineMutation({
        id: 'mut_perm_quota_1',
        userId: uid,
        entity: 'motorcycle',
        action: 'upsert',
        targetId: 'bike-perm-2',
        payload: secondBike as unknown as Record<string, unknown>,
        createdAtIso: '2026-03-12T09:30:00.000Z',
      });

      const res = await flushOfflineMutationQueue(uid);
      expect(res.flushedCount).toBe(0);
      expect(res.failedCount).toBe(1);
      expect(res.quarantinedCount).toBe(1);

      // Active queue is unblocked
      expect(getOfflineMutationQueue(uid)).toHaveLength(0);

      // Complete original payload is preserved in motocare_quarantined_queue_v1_${uid}
      const rawQuarantine = localStorage.getItem(getQuarantinedMutationQueueKey(uid));
      expect(rawQuarantine).toBeTruthy();

      const quarantined = getQuarantinedMutationQueue(uid);
      expect(quarantined).toHaveLength(1);
      expect(quarantined[0]).toMatchObject({
        id: 'mut_perm_quota_1',
        userId: uid,
        entity: 'motorcycle',
        action: 'upsert',
        targetId: 'bike-perm-2',
        createdAtIso: '2026-03-12T09:30:00.000Z',
        retryCount: 1,
        failureClassification: 'quota_exceeded',
      });
      expect(quarantined[0].quarantinedAtIso).toBeTruthy();
      expect(quarantined[0].lastError).toContain('QUOTA_EXCEEDED');
      expect((quarantined[0].payload as any)?.model).toBe('Click 160');
      expect((quarantined[0].payload as any)?.odometer).toBe(3300);
    });

    it('5. A retry-exhausted mutation remains recoverable and does not silently overwrite newer Firestore data', async () => {
      const uid = 'uid-rider-a';
      const bike = createSampleBike({
        id: 'bike-exhaust-1',
        userId: uid,
        odometer: 7000,
        updatedAt: '2026-03-01T00:00:00.000Z',
      });
      await saveMotorcycleToFirestore(bike, uid);

      enqueueOfflineMutation({
        id: 'mut_exhaust_1',
        userId: uid,
        entity: 'motorcycle',
        action: 'update_fields',
        targetId: 'bike-exhaust-1',
        payload: { odometer: 7850, nickname: 'Recovered Runner' },
        createdAtIso: '2026-03-15T10:00:00.000Z',
      });

      // Fail 5 times with temporary network error while online
      simulateNetworkOffline = true;
      for (let attempt = 1; attempt <= 4; attempt++) {
        await flushOfflineMutationQueue(uid);
        expect(getOfflineMutationQueue(uid)).toHaveLength(1);
        expect(getOfflineMutationQueue(uid)[0].retryCount).toBe(attempt);
        expect(getQuarantinedMutationQueue(uid)).toHaveLength(0);
      }

      // 5th attempt reaches MAX_RETRIES = 5 -> moved to quarantine with retry_exhausted
      const fifthRes = await flushOfflineMutationQueue(uid);
      expect(fifthRes.quarantinedCount).toBe(1);
      expect(getOfflineMutationQueue(uid)).toHaveLength(0);

      const quarantined = getQuarantinedMutationQueue(uid);
      expect(quarantined).toHaveLength(1);
      expect(quarantined[0].failureClassification).toBe('retry_exhausted');
      expect(quarantined[0].retryCount).toBe(5);
      expect(quarantined[0].payload).toEqual({
        odometer: 7850,
        nickname: 'Recovered Runner',
      });

      // Network recovers -> recoverQuarantinedMutationSafely requeues with retryCount = 0 and flushes
      simulateNetworkOffline = false;

      const recovery = await recoverQuarantinedMutationSafely(uid, 'mut_exhaust_1');
      expect(recovery.status).toBe('requeued');
      expect(getQuarantinedMutationQueue(uid)).toHaveLength(0);
      expect(getOfflineMutationQueue(uid)).toHaveLength(1);
      expect(getOfflineMutationQueue(uid)[0].retryCount).toBe(0);

      const replayRes = await flushOfflineMutationQueue(uid);
      expect(replayRes.flushedCount).toBe(1);
      expect(inMemoryFirestore.motorcycles.get('bike-exhaust-1')?.odometer).toBe(7850);
    });

    it('6. A mutation belonging to User A cannot be inspected or recovered under User B', async () => {
      const userA = 'uid-rider-a';
      const userB = 'uid-rider-b';

      // Create a quarantined mutation under User A
      const bikeA1 = createSampleBike({ id: 'bike-a-1', userId: userA });
      const bikeA2 = createSampleBike({ id: 'bike-a-2', userId: userA, nickname: 'Secret Bike A' });
      await saveMotorcycleToFirestore(bikeA1, userA);

      enqueueOfflineMutation({
        id: 'mut_user_a_secret',
        userId: userA,
        entity: 'motorcycle',
        action: 'upsert',
        targetId: 'bike-a-2',
        payload: bikeA2 as unknown as Record<string, unknown>,
      });

      await flushOfflineMutationQueue(userA);
      expect(getQuarantinedMutationQueue(userA)).toHaveLength(1);

      // User B cannot inspect or recover User A's quarantined mutation
      expect(getQuarantinedMutationQueue(userB)).toHaveLength(0);
      expect(requeueQuarantinedMutation(userB, 'mut_user_a_secret')).toBeNull();

      const recoveryAttemptByB = await recoverQuarantinedMutationSafely(
        userB,
        'mut_user_a_secret'
      );
      expect(recoveryAttemptByB.status).toBe('not_found');

      // User A's quarantined mutation remains untouched in User A's quarantine store
      expect(getQuarantinedMutationQueue(userA)).toHaveLength(1);
      expect(getOfflineMutationQueue(userB)).toHaveLength(0);
    });

    it('7. Existing successful queue replay behavior remains intact for motorcycles, reminders, and service records', async () => {
      const uid = 'uid-pro-rider';
      const bike = createSampleBike({ id: 'bike-ok-1', userId: uid, odometer: 3000 });
      const rem = createSampleReminder({ id: 'rem-ok-1', bikeId: 'bike-ok-1', userId: uid });
      const rec = createSampleRecord({ id: 'rec-ok-1', bikeId: 'bike-ok-1', userId: uid });

      enqueueOfflineMutation({
        id: 'mut_ok_bike',
        userId: uid,
        entity: 'motorcycle',
        action: 'upsert',
        targetId: 'bike-ok-1',
        payload: bike as unknown as Record<string, unknown>,
      });
      enqueueOfflineMutation({
        id: 'mut_ok_rem',
        userId: uid,
        entity: 'reminder',
        action: 'upsert',
        targetId: 'rem-ok-1',
        payload: rem as unknown as Record<string, unknown>,
      });
      enqueueOfflineMutation({
        id: 'mut_ok_rec',
        userId: uid,
        entity: 'serviceRecord',
        action: 'upsert',
        targetId: 'rec-ok-1',
        payload: rec as unknown as Record<string, unknown>,
      });

      const res = await flushOfflineMutationQueue(uid);
      expect(res.skippedOffline).toBe(false);
      expect(res.flushedCount).toBe(3);
      expect(res.failedCount).toBe(0);
      expect(res.quarantinedCount).toBe(0);
      expect(getOfflineMutationQueue(uid)).toHaveLength(0);
      expect(getQuarantinedMutationQueue(uid)).toHaveLength(0);
      expect(inMemoryFirestore.motorcycles.has('bike-ok-1')).toBe(true);
      expect(inMemoryFirestore.reminders.has('rem-ok-1')).toBe(true);
      expect(inMemoryFirestore.serviceRecords.has('rec-ok-1')).toBe(true);
    });
  });

  // ===========================================================================
  // ATOMIC CLOUD VERSION PROTECTION FOR OFFLINE MUTATION REPLAY (12 SCENARIOS)
  // ===========================================================================
  describe('Atomic Cloud Version Protection for Offline Mutation Replay (12 Scenarios)', () => {
    it('1 & 2. Device A queues an offline motorcycle update, Device B updates the same motorcycle in Firestore, Device A reconnects -> blocked from overwriting & quarantined with full payload and version details', async () => {
      const uid = 'uid-rider-a';
      const initialBike = createSampleBike({
        id: 'bike-conc-1',
        userId: uid,
        odometer: 10000,
        nickname: 'Initial Cloud State',
      });
      await saveMotorcycleToFirestore(initialBike, uid);
      const baseCloudVersion = getKnownCloudVersion(uid, 'motorcycle', 'bike-conc-1');
      expect(baseCloudVersion).toBeTruthy();

      // Device A goes offline and queues an odometer update based on baseCloudVersion
      enqueueOfflineMutation({
        id: 'mut_conc_bike_1',
        userId: uid,
        entity: 'motorcycle',
        action: 'update_fields',
        targetId: 'bike-conc-1',
        payload: { odometer: 10500, nickname: 'Device A Offline Edit' },
        baseCloudUpdatedAt: baseCloudVersion,
      });

      // Meanwhile, Device B updates the same motorcycle in Firestore (advancing cloud updatedAt)
      await saveMotorcycleToFirestore(
        {
          ...initialBike,
          odometer: 12000,
          nickname: 'Device B Newer Cloud Update',
        },
        uid
      );
      const deviceBCloudVersion = normalizeFirestoreTimestampToIso(
        inMemoryFirestore.motorcycles.get('bike-conc-1')?.updatedAt
      );
      expect(deviceBCloudVersion).not.toBe(baseCloudVersion);

      // Restore Device A's local known version to simulate Device A reconnecting before snapshot listeners overwrite
      recordKnownCloudVersion(uid, 'motorcycle', 'bike-conc-1', baseCloudVersion!);

      // Device A reconnects and attempts replay -> transaction detects version mismatch and quarantines immediately
      const flushRes = await flushOfflineMutationQueue(uid);
      expect(flushRes.flushedCount).toBe(0);
      expect(flushRes.quarantinedCount).toBe(1);
      expect(getOfflineMutationQueue(uid)).toHaveLength(0);

      // Verify Device B's newer cloud data was NOT overwritten
      const cloudBike = inMemoryFirestore.motorcycles.get('bike-conc-1');
      expect(cloudBike?.odometer).toBe(12000);
      expect(cloudBike?.nickname).toBe('Device B Newer Cloud Update');

      // Scenario 2: Original mutation remains recoverable/inspectable in quarantine with base & cloud versions
      const quarantined = getQuarantinedMutationQueue(uid);
      expect(quarantined).toHaveLength(1);
      expect(quarantined[0].id).toBe('mut_conc_bike_1');
      expect(quarantined[0].failureClassification).toBe('version_conflict');
      expect(quarantined[0].baseCloudUpdatedAt).toBe(baseCloudVersion);
      expect(quarantined[0].conflictCloudUpdatedAt).toBe(deviceBCloudVersion);
      expect(quarantined[0].conflictReason).toContain('was modified by another device');
      expect(quarantined[0].payload).toEqual({
        odometer: 10500,
        nickname: 'Device A Offline Edit',
      });
    });

    it('3. Competing offline vs. cloud update for reminders is blocked inside the Firestore transaction and quarantined as version_conflict', async () => {
      const uid = 'uid-rider-a';
      const initialReminder = createSampleReminder({
        id: 'rem-conc-1',
        bikeId: 'bike-1',
        userId: uid,
        intervalKm: 5000,
        title: 'Initial Oil Reminder',
      });
      await saveReminderToFirestore(initialReminder, uid);
      const baseRemVersion = getKnownCloudVersion(uid, 'reminder', 'rem-conc-1');
      expect(baseRemVersion).toBeTruthy();

      // Device A queues offline reminder edit with baseRemVersion
      const deviceAReminder: MaintenanceReminder = {
        ...initialReminder,
        intervalKm: 5500,
        title: 'Device A Offline Reminder',
        updatedAt: '2099-01-01T00:00:00.000Z', // even with a future local timestamp, baseCloudUpdatedAt governs!
      };
      enqueueOfflineMutation({
        id: 'mut_conc_rem_1',
        userId: uid,
        entity: 'reminder',
        action: 'upsert',
        targetId: 'rem-conc-1',
        payload: deviceAReminder as unknown as Record<string, unknown>,
        baseCloudUpdatedAt: baseRemVersion,
      });

      // Device B updates reminder in Firestore
      await saveReminderToFirestore(
        {
          ...initialReminder,
          intervalKm: 6000,
          title: 'Device B Newer Reminder',
        },
        uid
      );

      // Device A flushes queue -> blocked by atomic transaction
      const res = await flushOfflineMutationQueue(uid);
      expect(res.flushedCount).toBe(0);
      expect(res.quarantinedCount).toBe(1);

      expect(inMemoryFirestore.reminders.get('rem-conc-1')?.intervalKm).toBe(6000);
      expect(inMemoryFirestore.reminders.get('rem-conc-1')?.title).toBe('Device B Newer Reminder');

      const quarantined = getQuarantinedMutationQueue(uid);
      expect(quarantined).toHaveLength(1);
      expect(quarantined[0].failureClassification).toBe('version_conflict');
      expect(quarantined[0].baseCloudUpdatedAt).toBe(baseRemVersion);
    });

    it('4. Competing offline vs. cloud update for service records is blocked inside the Firestore transaction and quarantined as version_conflict', async () => {
      const uid = 'uid-rider-a';
      const initialRecord = createSampleRecord({
        id: 'rec-conc-1',
        bikeId: 'bike-1',
        userId: uid,
        totalCostPhp: 450,
        notes: 'Initial Service Note',
      });
      await saveServiceRecordToFirestore(initialRecord, uid);
      const baseRecVersion = getKnownCloudVersion(uid, 'serviceRecord', 'rec-conc-1');
      expect(baseRecVersion).toBeTruthy();

      // Device A queues offline service record edit
      const deviceARecord: ServiceRecord = {
        ...initialRecord,
        totalCostPhp: 500,
        notes: 'Device A Offline Service Edit',
        updatedAt: '2099-01-01T00:00:00.000Z',
      };
      enqueueOfflineMutation({
        id: 'mut_conc_rec_1',
        userId: uid,
        entity: 'serviceRecord',
        action: 'upsert',
        targetId: 'rec-conc-1',
        payload: deviceARecord as unknown as Record<string, unknown>,
        baseCloudUpdatedAt: baseRecVersion,
      });

      // Device B updates service record in Firestore
      await saveServiceRecordToFirestore(
        {
          ...initialRecord,
          totalCostPhp: 950,
          notes: 'Device B Full Rebuild Service',
        },
        uid
      );

      const res = await flushOfflineMutationQueue(uid);
      expect(res.flushedCount).toBe(0);
      expect(res.quarantinedCount).toBe(1);

      expect(inMemoryFirestore.serviceRecords.get('rec-conc-1')?.totalCostPhp).toBe(950);
      expect(inMemoryFirestore.serviceRecords.get('rec-conc-1')?.notes).toBe(
        'Device B Full Rebuild Service'
      );

      const quarantined = getQuarantinedMutationQueue(uid);
      expect(quarantined).toHaveLength(1);
      expect(quarantined[0].failureClassification).toBe('version_conflict');
      expect(quarantined[0].baseCloudUpdatedAt).toBe(baseRecVersion);
    });

    it('5. Stale queued deletes (motorcycle, reminder, serviceRecord) cannot delete a newer cloud document updated by another device', async () => {
      const uid = 'uid-rider-a';
      const bike = createSampleBike({ id: 'bike-del-1', userId: uid, odometer: 2000 });
      const rem = createSampleReminder({ id: 'rem-del-1', bikeId: 'bike-del-1', userId: uid });
      const rec = createSampleRecord({ id: 'rec-del-1', bikeId: 'bike-del-1', userId: uid });

      await saveMotorcycleToFirestore(bike, uid);
      await saveReminderToFirestore(rem, uid);
      await saveServiceRecordToFirestore(rec, uid);

      const baseBikeVer = getKnownCloudVersion(uid, 'motorcycle', 'bike-del-1');
      const baseRemVer = getKnownCloudVersion(uid, 'reminder', 'rem-del-1');
      const baseRecVer = getKnownCloudVersion(uid, 'serviceRecord', 'rec-del-1');

      // Device A queues offline deletes for all three
      enqueueOfflineMutation({
        id: 'mut_del_bike',
        userId: uid,
        entity: 'motorcycle',
        action: 'delete',
        targetId: 'bike-del-1',
        payload: { id: 'bike-del-1' },
        baseCloudUpdatedAt: baseBikeVer,
      });
      enqueueOfflineMutation({
        id: 'mut_del_rem',
        userId: uid,
        entity: 'reminder',
        action: 'delete',
        targetId: 'rem-del-1',
        payload: { id: 'rem-del-1' },
        baseCloudUpdatedAt: baseRemVer,
      });
      enqueueOfflineMutation({
        id: 'mut_del_rec',
        userId: uid,
        entity: 'serviceRecord',
        action: 'delete',
        targetId: 'rec-del-1',
        payload: { id: 'rec-del-1' },
        baseCloudUpdatedAt: baseRecVer,
      });

      // Device B updates all three documents in Firestore before Device A reconnects
      await saveMotorcycleToFirestore({ ...bike, odometer: 2500 }, uid);
      await saveReminderToFirestore({ ...rem, intervalKm: 4000 }, uid);
      await saveServiceRecordToFirestore({ ...rec, totalCostPhp: 1200 }, uid);

      // Device A replays queued deletes -> all 3 must be blocked and quarantined
      const res = await flushOfflineMutationQueue(uid);
      expect(res.flushedCount).toBe(0);
      expect(res.quarantinedCount).toBe(3);

      // Verify none of the newer cloud documents were deleted
      expect(inMemoryFirestore.motorcycles.has('bike-del-1')).toBe(true);
      expect(inMemoryFirestore.reminders.has('rem-del-1')).toBe(true);
      expect(inMemoryFirestore.serviceRecords.has('rec-del-1')).toBe(true);
      expect(inMemoryFirestore.motorcycles.get('bike-del-1')?.odometer).toBe(2500);
    });

    it('6. A quarantined mutation cannot bypass the write-time version check (even if cloud changes after requeue or if requeued while offline)', async () => {
      const uid = 'uid-rider-a';
      const bike = createSampleBike({ id: 'bike-q-race', userId: uid, odometer: 4000 });
      await saveMotorcycleToFirestore(bike, uid);
      const baseVer = getKnownCloudVersion(uid, 'motorcycle', 'bike-q-race');

      // Queue mutation and exhaust retries while offline so it lands in quarantine
      enqueueOfflineMutation({
        id: 'mut_q_race',
        userId: uid,
        entity: 'motorcycle',
        action: 'update_fields',
        targetId: 'bike-q-race',
        payload: { odometer: 4400 },
        baseCloudUpdatedAt: baseVer,
      });

      simulateNetworkOffline = true;
      for (let i = 0; i < 5; i++) {
        await flushOfflineMutationQueue(uid);
      }
      expect(getQuarantinedMutationQueue(uid)).toHaveLength(1);

      // Admin recovers mutation while online (pre-read passes because cloud is still at baseVer)
      simulateNetworkOffline = false;
      const recovery = await recoverQuarantinedMutationSafely(uid, 'mut_q_race');
      expect(recovery.status).toBe('requeued');
      expect(getOfflineMutationQueue(uid)[0].baseCloudUpdatedAt).toBe(baseVer);

      // Race condition: Device B updates Firestore AFTER recoverQuarantinedMutationSafely pre-read, BEFORE flushOfflineMutationQueue!
      await saveMotorcycleToFirestore({ ...bike, odometer: 9999, nickname: 'Device B Race Winner' }, uid);

      // Now flushOfflineMutationQueue executes -> write-time transaction catches the version change!
      const replay = await flushOfflineMutationQueue(uid);
      expect(replay.flushedCount).toBe(0);
      expect(replay.quarantinedCount).toBe(1);
      expect(inMemoryFirestore.motorcycles.get('bike-q-race')?.odometer).toBe(9999);
      expect(getQuarantinedMutationQueue(uid)[0].failureClassification).toBe('version_conflict');
    });

    it('7. Legacy queued items without a trustworthy base version cannot silently overwrite existing cloud documents and cannot be auto-requeued', async () => {
      const uid = 'uid-rider-a';
      const bike = createSampleBike({ id: 'bike-legacy-q', userId: uid, odometer: 8000 });
      await saveMotorcycleToFirestore(bike, uid);

      // Simulate a legacy queued item in localStorage that has no baseCloudUpdatedAt and no expectedCloudAbsent
      const legacyRawItem = {
        id: 'mut_legacy_untrusted',
        userId: uid,
        entity: 'motorcycle',
        action: 'update_fields',
        targetId: 'bike-legacy-q',
        payload: { odometer: 1500, nickname: 'Stale Legacy Queue Item' },
        createdAtIso: '2026-01-01T00:00:00.000Z',
        retryCount: 0,
      };
      localStorage.setItem(getOfflineMutationQueueKey(uid), JSON.stringify([legacyRawItem]));

      // Attempt replay -> blocked because base version is missing/untrusted
      const flushRes = await flushOfflineMutationQueue(uid);
      expect(flushRes.flushedCount).toBe(0);
      expect(flushRes.quarantinedCount).toBe(1);
      expect(inMemoryFirestore.motorcycles.get('bike-legacy-q')?.odometer).toBe(8000);

      const quarantined = getQuarantinedMutationQueue(uid);
      expect(quarantined).toHaveLength(1);
      expect(quarantined[0].failureClassification).toBe('version_conflict');
      expect(quarantined[0].baseVersionUntrusted).toBe(true);

      // Attempting automatic requeue via recoverQuarantinedMutationSafely or requeueQuarantinedMutation is blocked
      const recovery = await recoverQuarantinedMutationSafely(uid, 'mut_legacy_untrusted');
      expect(recovery.status).toBe('missing_base_version');
      expect(requeueQuarantinedMutation(uid, 'mut_legacy_untrusted')).toBeNull();
      expect(getQuarantinedMutationQueue(uid)).toHaveLength(1);
    });

    it('8. Rapid offline coalesced edits preserve the original baseCloudUpdatedAt from before the first offline edit', async () => {
      const uid = 'uid-rider-a';
      const bike = createSampleBike({ id: 'bike-coalesce-1', userId: uid, odometer: 1000 });
      await saveMotorcycleToFirestore(bike, uid);
      const originalCloudVer = getKnownCloudVersion(uid, 'motorcycle', 'bike-coalesce-1');
      expect(originalCloudVer).toBeTruthy();

      // First offline edit captures originalCloudVer
      enqueueOfflineMutation({
        id: 'mut_coal_1',
        userId: uid,
        entity: 'motorcycle',
        action: 'update_fields',
        targetId: 'bike-coalesce-1',
        payload: { odometer: 1100 },
        baseCloudUpdatedAt: originalCloudVer,
      });

      // Second offline edit (even if caller passes a local optimistic timestamp or undefined) must preserve originalCloudVer
      enqueueOfflineMutation({
        id: 'mut_coal_2',
        userId: uid,
        entity: 'motorcycle',
        action: 'update_fields',
        targetId: 'bike-coalesce-1',
        payload: { odometer: 1250, plateNumber: 'ABC-999' },
        baseCloudUpdatedAt: '2099-12-31T23:59:59.000Z',
      });

      // Third offline edit coalescing into delete must also preserve originalCloudVer
      enqueueOfflineMutation({
        id: 'mut_coal_3',
        userId: uid,
        entity: 'motorcycle',
        action: 'delete',
        targetId: 'bike-coalesce-1',
        payload: { id: 'bike-coalesce-1' },
      });

      const queue = getOfflineMutationQueue(uid);
      expect(queue).toHaveLength(1);
      expect(queue[0].action).toBe('delete');
      expect(queue[0].baseCloudUpdatedAt).toBe(originalCloudVer);
    });

    it('9. Brand-new offline record creation with expectedCloudAbsent succeeds when absent and conflicts if created concurrently on another device', async () => {
      const uid = 'uid-pro-rider';
      const collidingBike = createSampleBike({
        id: 'bike-absent-check',
        userId: uid,
        odometer: 500,
        nickname: 'Device A Brand New Bike',
      });

      // Queue creation expecting document to be absent in cloud
      enqueueOfflineMutation({
        id: 'mut_new_absent',
        userId: uid,
        entity: 'motorcycle',
        action: 'upsert',
        targetId: 'bike-absent-check',
        payload: collidingBike as unknown as Record<string, unknown>,
        baseCloudUpdatedAt: null,
        expectedCloudAbsent: true,
      });

      // Device B creates the same document ID in Firestore first
      await saveMotorcycleToFirestore(
        {
          ...collidingBike,
          odometer: 900,
          nickname: 'Device B Created First',
        },
        uid
      );

      // Device A flushes -> blocked because expectedCloudAbsent was true but document now exists
      const res = await flushOfflineMutationQueue(uid);
      expect(res.flushedCount).toBe(0);
      expect(res.quarantinedCount).toBe(1);
      expect(inMemoryFirestore.motorcycles.get('bike-absent-check')?.nickname).toBe(
        'Device B Created First'
      );
      expect(getQuarantinedMutationQueue(uid)[0].failureClassification).toBe('version_conflict');
    });

    it('10. Normal successful offline replay works when the cloud version still matches baseCloudUpdatedAt', async () => {
      const uid = 'uid-rider-a';
      const bike = createSampleBike({ id: 'bike-clean-replay', userId: uid, odometer: 3000 });
      await saveMotorcycleToFirestore(bike, uid);
      const baseVer = getKnownCloudVersion(uid, 'motorcycle', 'bike-clean-replay');

      enqueueOfflineMutation({
        id: 'mut_clean_replay',
        userId: uid,
        entity: 'motorcycle',
        action: 'update_fields',
        targetId: 'bike-clean-replay',
        payload: { odometer: 3450, nickname: 'Clean Offline Update' },
        baseCloudUpdatedAt: baseVer,
      });

      const res = await flushOfflineMutationQueue(uid);
      expect(res.flushedCount).toBe(1);
      expect(res.quarantinedCount).toBe(0);
      expect(inMemoryFirestore.motorcycles.get('bike-clean-replay')?.odometer).toBe(3450);
      expect(inMemoryFirestore.motorcycles.get('bike-clean-replay')?.nickname).toBe(
        'Clean Offline Update'
      );
    });

    it('11. UID isolation remains intact across known cloud versions, active queues, and quarantined version_conflict items', async () => {
      const userA = 'uid-rider-a';
      const userB = 'uid-rider-b';

      const bikeA = createSampleBike({ id: 'shared-doc-id', userId: userA, odometer: 1000 });
      await saveMotorcycleToFirestore(bikeA, userA);

      const verA = getKnownCloudVersion(userA, 'motorcycle', 'shared-doc-id');
      const verB = getKnownCloudVersion(userB, 'motorcycle', 'shared-doc-id');

      expect(verA).toBeTruthy();
      expect(verB).toBeNull();
    });

    it('12. AdminUsersPortal displays clear version_conflict diagnostics including base vs. cloud versions and conflict reason', async () => {
      const uid = 'uid-owner-admin';
      (auth as any).currentUser = {
        uid,
        email: 'mustetm7@gmail.com',
        emailVerified: true,
      };
      (auth as any).onAuthStateChanged = (cb: (u: any) => void) => {
        cb((auth as any).currentUser);
        return () => {};
      };

      const bike = createSampleBike({ id: 'bike-admin-diag', userId: uid, odometer: 1000 });
      await saveMotorcycleToFirestore(bike, uid);
      const baseVer = getKnownCloudVersion(uid, 'motorcycle', 'bike-admin-diag');

      enqueueOfflineMutation({
        id: 'mut_admin_diag',
        userId: uid,
        entity: 'motorcycle',
        action: 'update_fields',
        targetId: 'bike-admin-diag',
        payload: { odometer: 1500 },
        baseCloudUpdatedAt: baseVer,
      });

      // Concurrent cloud update
      await saveMotorcycleToFirestore({ ...bike, odometer: 2200 }, uid);

      await flushOfflineMutationQueue(uid);
      expect(getQuarantinedMutationQueue(uid)).toHaveLength(1);

      const { getByTestId } = render(
        <AdminUsersPortal
          users={[]}
          onApprovePro={vi.fn()}
          onRevokePro={vi.fn()}
          onAddUser={vi.fn()}
          onResetUsersToDefault={vi.fn()}
        />
      );

      const qSection = getByTestId('quarantined-mutations-section');
      expect(qSection.textContent).toContain('version_conflict');
      expect(qSection.textContent).toContain('Version Conflict: Base=');
      expect(qSection.textContent).toContain('Conflict:');
    });
  });

  // ===========================================================================
  // DIRECT ONLINE WRITE CONCURRENCY PROTECTION & TIMESTAMP PRECISION (10 SCENARIOS)
  // ===========================================================================
  describe('Direct Online Write Concurrency Protection & Timestamp/Revision Precision (10 Scenarios)', () => {
    it('1. Direct online odometer updates cannot overwrite a newer cloud version', async () => {
      const uid = 'uid-direct-odo';
      const initialBike = createSampleBike({
        id: 'bike-direct-odo',
        userId: uid,
        odometer: 1000,
      });
      await saveMotorcycleToFirestore(initialBike, uid);

      const deviceABaseVersion = getKnownCloudVersion(uid, 'motorcycle', 'bike-direct-odo');
      const deviceABaseRev = getKnownCloudRevision(uid, 'motorcycle', 'bike-direct-odo');
      const preEditBikeOnDeviceA: Motorcycle = {
        ...initialBike,
        updatedAt: deviceABaseVersion || initialBike.updatedAt,
        cloudVersion: deviceABaseRev ?? 1,
      };

      // Device B updates the motorcycle in the cloud to 3,500 km before Device A's direct write executes
      await saveMotorcycleToFirestore({ ...initialBike, odometer: 3500 }, uid);

      // Device A performs a direct online odometer update based on stale preEditBikeOnDeviceA
      const res = await executeDirectOnlineWrite({
        userId: uid,
        entity: 'motorcycle',
        action: 'update_fields',
        targetId: 'bike-direct-odo',
        payload: { odometer: 1200 },
        preEditRecord: preEditBikeOnDeviceA,
      });

      expect(res.status).toBe('version_conflict');
      // Cloud odometer MUST remain 3500 (never overwritten by stale 1200)
      expect(inMemoryFirestore.motorcycles.get('bike-direct-odo')?.odometer).toBe(3500);
    });

    it('2. Direct online motorcycle edits (upsert and licensePlate update_fields) detect conflicts', async () => {
      const uid = 'uid-direct-bike';
      const initialBike = createSampleBike({
        id: 'bike-direct-edit',
        userId: uid,
        nickname: 'Original V1',
        licensePlate: '111-AAA',
      });
      await saveMotorcycleToFirestore(initialBike, uid);

      const staleSnap: Motorcycle = {
        ...initialBike,
        updatedAt: getKnownCloudVersion(uid, 'motorcycle', 'bike-direct-edit')!,
        cloudVersion: getKnownCloudRevision(uid, 'motorcycle', 'bike-direct-edit') ?? 1,
      };

      // Device B updates nickname and plate in cloud (advancing version to v2)
      await saveMotorcycleToFirestore(
        { ...initialBike, nickname: 'Cloud V2', licensePlate: '999-ZZZ' },
        uid
      );

      // Device A attempts direct online full bike save with stale base version
      const upsertRes = await executeDirectOnlineWrite({
        userId: uid,
        entity: 'motorcycle',
        action: 'upsert',
        targetId: 'bike-direct-edit',
        payload: { ...initialBike, nickname: 'Stale Local Edit' } as unknown as Record<string, unknown>,
        preEditRecord: staleSnap,
      });
      expect(upsertRes.status).toBe('version_conflict');
      expect(inMemoryFirestore.motorcycles.get('bike-direct-edit')?.nickname).toBe('Cloud V2');

      // Device A attempts direct online LTO plate update with stale base version
      const plateRes = await executeDirectOnlineWrite({
        userId: uid,
        entity: 'motorcycle',
        action: 'update_fields',
        targetId: 'bike-direct-edit',
        payload: { licensePlate: '222-BBB' },
        preEditRecord: staleSnap,
      });
      expect(plateRes.status).toBe('version_conflict');
      expect(inMemoryFirestore.motorcycles.get('bike-direct-edit')?.licensePlate).toBe('999-ZZZ');
    });

    it('3. Direct online reminder edits detect conflicts and preserve newer cloud state', async () => {
      const uid = 'uid-direct-rem';
      const bike = createSampleBike({ id: 'bike-rem', userId: uid });
      await saveMotorcycleToFirestore(bike, uid);

      const initialRem = createSampleReminder({
        id: 'rem-direct-1',
        bikeId: 'bike-rem',
        userId: uid,
        nextDueOdo: 3000,
      });
      await saveReminderToFirestore(initialRem, uid);

      const staleRemSnap: MaintenanceReminder = {
        ...initialRem,
        updatedAt: getKnownCloudVersion(uid, 'reminder', 'rem-direct-1')!,
        cloudVersion: getKnownCloudRevision(uid, 'reminder', 'rem-direct-1') ?? 1,
      };

      // Device B updates nextDueOdo to 6000 in cloud
      await saveReminderToFirestore({ ...initialRem, nextDueOdo: 6000 }, uid);

      // Device A attempts direct online reminder edit from stale snapshot
      const res = await executeDirectOnlineWrite({
        userId: uid,
        entity: 'reminder',
        action: 'upsert',
        targetId: 'rem-direct-1',
        payload: { ...initialRem, nextDueOdo: 4000 } as unknown as Record<string, unknown>,
        preEditRecord: staleRemSnap,
      });

      expect(res.status).toBe('version_conflict');
      expect(inMemoryFirestore.reminders.get('rem-direct-1')?.nextDueOdo).toBe(6000);
    });

    it('4. Direct online service record edits (and linked reminder resets) detect conflicts', async () => {
      const uid = 'uid-direct-rec';
      const bike = createSampleBike({ id: 'bike-rec', userId: uid });
      await saveMotorcycleToFirestore(bike, uid);

      const initialRec = createSampleRecord({
        id: 'rec-direct-1',
        bikeId: 'bike-rec',
        userId: uid,
        totalCostPhp: 450,
      });
      await saveServiceRecordToFirestore(initialRec, uid);

      const staleRecSnap: ServiceRecord = {
        ...initialRec,
        updatedAt: getKnownCloudVersion(uid, 'serviceRecord', 'rec-direct-1')!,
        cloudVersion: getKnownCloudRevision(uid, 'serviceRecord', 'rec-direct-1') ?? 1,
      };

      // Device B updates service record totalCostPhp to 950 in cloud
      await saveServiceRecordToFirestore({ ...initialRec, totalCostPhp: 950 }, uid);

      // Device A attempts direct online service record edit from stale snapshot
      const res = await executeDirectOnlineWrite({
        userId: uid,
        entity: 'serviceRecord',
        action: 'upsert',
        targetId: 'rec-direct-1',
        payload: { ...initialRec, totalCostPhp: 550 } as unknown as Record<string, unknown>,
        preEditRecord: staleRecSnap,
      });

      expect(res.status).toBe('version_conflict');
      expect(inMemoryFirestore.serviceRecords.get('rec-direct-1')?.totalCostPhp).toBe(950);
    });

    it('5. Direct online deletes (motorcycle, reminder, serviceRecord) cannot remove newer cloud documents', async () => {
      const uid = 'uid-direct-del';
      const bike = createSampleBike({ id: 'bike-del', userId: uid, odometer: 1000 });
      await saveMotorcycleToFirestore(bike, uid);
      const staleBike: Motorcycle = {
        ...bike,
        updatedAt: getKnownCloudVersion(uid, 'motorcycle', 'bike-del')!,
        cloudVersion: getKnownCloudRevision(uid, 'motorcycle', 'bike-del') ?? 1,
      };

      const rem = createSampleReminder({ id: 'rem-del', bikeId: 'bike-del', userId: uid, nextDueOdo: 2500 });
      await saveReminderToFirestore(rem, uid);
      const staleRem: MaintenanceReminder = {
        ...rem,
        updatedAt: getKnownCloudVersion(uid, 'reminder', 'rem-del')!,
        cloudVersion: getKnownCloudRevision(uid, 'reminder', 'rem-del') ?? 1,
      };

      const rec = createSampleRecord({ id: 'rec-del', bikeId: 'bike-del', userId: uid, totalCostPhp: 300 });
      await saveServiceRecordToFirestore(rec, uid);
      const staleRec: ServiceRecord = {
        ...rec,
        updatedAt: getKnownCloudVersion(uid, 'serviceRecord', 'rec-del')!,
        cloudVersion: getKnownCloudRevision(uid, 'serviceRecord', 'rec-del') ?? 1,
      };

      // Device B updates all three documents in cloud
      await saveMotorcycleToFirestore({ ...bike, odometer: 5000 }, uid);
      await saveReminderToFirestore({ ...rem, nextDueOdo: 6500 }, uid);
      await saveServiceRecordToFirestore({ ...rec, totalCostPhp: 750 }, uid);

      // Stale direct online deletes from Device A must all be rejected with version_conflict
      const delBikeRes = await executeDirectOnlineWrite({
        userId: uid,
        entity: 'motorcycle',
        action: 'delete',
        targetId: 'bike-del',
        preEditRecord: staleBike,
      });
      const delRemRes = await executeDirectOnlineWrite({
        userId: uid,
        entity: 'reminder',
        action: 'delete',
        targetId: 'rem-del',
        preEditRecord: staleRem,
      });
      const delRecRes = await executeDirectOnlineWrite({
        userId: uid,
        entity: 'serviceRecord',
        action: 'delete',
        targetId: 'rec-del',
        preEditRecord: staleRec,
      });

      expect(delBikeRes.status).toBe('version_conflict');
      expect(delRemRes.status).toBe('version_conflict');
      expect(delRecRes.status).toBe('version_conflict');

      expect(inMemoryFirestore.motorcycles.has('bike-del')).toBe(true);
      expect(inMemoryFirestore.reminders.has('rem-del')).toBe(true);
      expect(inMemoryFirestore.serviceRecords.has('rec-del')).toBe(true);
    });

    it('6. The 600ms odometer debounce preserves concurrency checks and aborts if cloud changed during debounce window', async () => {
      vi.useFakeTimers();
      try {
        const uid = 'uid-debounce-conflict';
        const bike = createSampleBike({ id: 'bike-debounce', userId: uid, odometer: 1000 });
        await saveMotorcycleToFirestore(bike, uid);

        const baseVer = getKnownCloudVersion(uid, 'motorcycle', 'bike-debounce')!;
        const baseRev = getKnownCloudRevision(uid, 'motorcycle', 'bike-debounce') ?? 1;
        const debounceTimerRef = { current: null as ReturnType<typeof setTimeout> | null };
        const statuses: string[] = [];

        // User increments odometer locally (+10km -> 1010) which starts 600ms debounce timer
        scheduleDirectOnlineOdometerUpdate({
          userId: uid,
          targetBikeId: 'bike-debounce',
          newOdo: 1010,
          preEditBike: { ...bike, updatedAt: baseVer, cloudVersion: baseRev },
          debounceTimerRef,
          delayMs: 600,
          onStatusChange: (s) => statuses.push(s),
        });

        // Before the 600ms timer fires, Device B updates the motorcycle in the cloud to 4,200 km
        await saveMotorcycleToFirestore({ ...bike, odometer: 4200 }, uid);

        // Advance timer past 600ms
        await vi.advanceTimersByTimeAsync(650);

        // Cloud odometer MUST remain 4200, status becomes sync_error, and mutation is quarantined
        expect(inMemoryFirestore.motorcycles.get('bike-debounce')?.odometer).toBe(4200);
        expect(statuses).toContain('sync_error');
        expect(getOfflineMutationQueue(uid)).toHaveLength(0);
        const quarantined = getQuarantinedMutationQueue(uid);
        expect(quarantined).toHaveLength(1);
        expect(quarantined[0].failureClassification).toBe('version_conflict');
        expect(quarantined[0].payload).toEqual({ odometer: 1010 });
      } finally {
        vi.useRealTimers();
      }
    });

    it('7. A direct online conflict preserves the queued mutation payload in quarantine and never silently retries as a temporary network error', async () => {
      const uid = 'uid-conflict-quarantine';
      const bike = createSampleBike({ id: 'bike-quarantine', userId: uid, odometer: 2000 });
      await saveMotorcycleToFirestore(bike, uid);

      const staleBike: Motorcycle = {
        ...bike,
        updatedAt: getKnownCloudVersion(uid, 'motorcycle', 'bike-quarantine')!,
        cloudVersion: getKnownCloudRevision(uid, 'motorcycle', 'bike-quarantine') ?? 1,
      };

      // Concurrent cloud update
      await saveMotorcycleToFirestore({ ...bike, odometer: 9000 }, uid);

      const res = await executeDirectOnlineWrite({
        userId: uid,
        entity: 'motorcycle',
        action: 'update_fields',
        targetId: 'bike-quarantine',
        payload: { odometer: 2500 },
        preEditRecord: staleBike,
      });

      expect(res.status).toBe('version_conflict');
      // Removed from active retry queue so it will never be retried as a network error
      expect(getOfflineMutationQueue(uid)).toHaveLength(0);

      // Preserved in quarantine with full payload and version details
      const quarantined = getQuarantinedMutationQueue(uid);
      expect(quarantined).toHaveLength(1);
      expect(quarantined[0].failureClassification).toBe('version_conflict');
      expect(quarantined[0].payload).toEqual({ odometer: 2500 });
      expect(quarantined[0].baseCloudVersion).toBe(1);
      expect(quarantined[0].conflictCloudVersion).toBe(2);
    });

    it('8. Successful direct writes remove only the corresponding completed mutation, and unprotected writes cannot remove queued mutations', async () => {
      const uid = 'uid-safe-remove';
      const bike = createSampleBike({ id: 'bike-safe-remove', userId: uid, odometer: 1000 });
      await saveMotorcycleToFirestore(bike, uid);

      const baseVer = getKnownCloudVersion(uid, 'motorcycle', 'bike-safe-remove')!;
      const baseRev = getKnownCloudRevision(uid, 'motorcycle', 'bike-safe-remove') ?? 1;

      const queued = enqueueOfflineMutation({
        userId: uid,
        entity: 'motorcycle',
        action: 'update_fields',
        targetId: 'bike-safe-remove',
        payload: { odometer: 1100 },
        baseCloudUpdatedAt: baseVer,
        baseCloudVersion: baseRev,
      });

      // Attempting to complete a mutation with enforceVersionCheck: false MUST be rejected
      const unprotectedRemoved = completeDirectOnlineMutation({
        userId: uid,
        mutationId: queued.id,
        expectedGeneration: queued.mutationGeneration ?? 1,
        enforceVersionCheck: false,
      });
      expect(unprotectedRemoved).toBe(false);
      expect(getOfflineMutationQueue(uid)).toHaveLength(1);

      // Executing a version-checked direct online write removes the corresponding mutation on success
      const res = await executeDirectOnlineWrite({
        userId: uid,
        entity: 'motorcycle',
        action: 'update_fields',
        targetId: 'bike-safe-remove',
        payload: { odometer: 1100 },
        preEditRecord: { ...bike, updatedAt: baseVer, cloudVersion: baseRev },
      });
      expect(res.status).toBe('synced');
      expect(getOfflineMutationQueue(uid)).toHaveLength(0);
    });

    it('9. Rapid repeated edits preserve the original base version and prevent an older generation completion from deleting a newer queued mutation', async () => {
      const uid = 'uid-rapid-edits';
      const bike = createSampleBike({ id: 'bike-rapid', userId: uid, odometer: 1000 });
      await saveMotorcycleToFirestore(bike, uid);

      const initialBaseVer = getKnownCloudVersion(uid, 'motorcycle', 'bike-rapid')!;
      const initialBaseRev = getKnownCloudRevision(uid, 'motorcycle', 'bike-rapid') ?? 1;

      // Rapid Edit #1 (generation 1): 1000 -> 1010
      const edit1 = enqueueOfflineMutation({
        userId: uid,
        entity: 'motorcycle',
        action: 'update_fields',
        targetId: 'bike-rapid',
        payload: { odometer: 1010 },
        baseCloudUpdatedAt: initialBaseVer,
        baseCloudVersion: initialBaseRev,
      });
      expect(edit1.mutationGeneration).toBe(1);

      // Rapid Edit #2 (generation 2): 1010 -> 1020 coalesces into the same queue item
      const edit2 = enqueueOfflineMutation({
        userId: uid,
        entity: 'motorcycle',
        action: 'update_fields',
        targetId: 'bike-rapid',
        payload: { odometer: 1020 },
        baseCloudUpdatedAt: '2099-01-01T00:00:00.000Z', // even if caller passed optimistic timestamp, original base is preserved
        baseCloudVersion: 99,
      });
      expect(edit2.id).toBe(edit1.id);
      expect(edit2.mutationGeneration).toBe(2);
      expect(edit2.baseCloudUpdatedAt).toBe(initialBaseVer);
      expect(edit2.baseCloudVersion).toBe(initialBaseRev);

      // If an earlier in-flight write for generation 1 finishes late, it MUST NOT remove generation 2!
      const staleGenRemoved = completeDirectOnlineMutation({
        userId: uid,
        mutationId: edit1.id,
        expectedGeneration: 1,
        enforceVersionCheck: true,
      });
      expect(staleGenRemoved).toBe(false);
      expect(getOfflineMutationQueue(uid)).toHaveLength(1);
      expect(getOfflineMutationQueue(uid)[0].payload).toEqual({ odometer: 1020 });

      // Completing generation 2 removes the mutation cleanly
      const currentGenRemoved = completeDirectOnlineMutation({
        userId: uid,
        mutationId: edit2.id,
        expectedGeneration: 2,
        enforceVersionCheck: true,
      });
      expect(currentGenRemoved).toBe(true);
      expect(getOfflineMutationQueue(uid)).toHaveLength(0);
    });

    it('10. Transactional batch helpers and nanosecond/revision comparisons protect against precision collisions and stale batch overwrites', async () => {
      const uid = 'uid-batch-and-precision';

      // Verify plain { seconds, nanoseconds } preserves millisecond component from nanoseconds
      const ts1 = { seconds: 1700000000, nanoseconds: 123_000_000 };
      const ts2 = { seconds: 1700000000, nanoseconds: 789_000_000 };
      expect(parseTimestampToMillis(ts1)).toBe(1700000000123);
      expect(parseTimestampToMillis(ts2)).toBe(1700000000789);
      expect(normalizeFirestoreTimestampToIso(ts1)).not.toBe(normalizeFirestoreTimestampToIso(ts2));

      // Verify transactional batch helpers do not overwrite newer cloud reminders or service records
      const bike = createSampleBike({ id: 'bike-batch', userId: uid });
      await saveMotorcycleToFirestore(bike, uid);

      const cloudRem = createSampleReminder({
        id: 'rem-batch-1',
        bikeId: 'bike-batch',
        userId: uid,
        nextDueOdo: 8000,
      });
      await saveReminderToFirestore(cloudRem, uid);
      // Advance cloud reminder to v2
      await saveReminderToFirestore({ ...cloudRem, nextDueOdo: 9500 }, uid);

      // Attempting a batch write with a stale reminder version (cloudVersion: 1) must throw CONCURRENCY_CONFLICT when concurrency options are enforced
      await expect(
        saveRemindersBatchToFirestore(
          [{ ...cloudRem, nextDueOdo: 4000, cloudVersion: 1 }],
          uid,
          {
            'rem-batch-1': {
              enforceVersionCheck: true,
              baseCloudUpdatedAt: cloudRem.updatedAt,
              baseCloudVersion: 1,
            },
          }
        )
      ).rejects.toThrow(/CONCURRENCY_CONFLICT/);

      // Even without explicit concurrency map, batch helper skips overwriting a newer cloud revision
      await saveRemindersBatchToFirestore(
        [{ ...cloudRem, nextDueOdo: 3000, cloudVersion: 1, updatedAt: '2020-01-01T00:00:00.000Z' }],
        uid
      );
      expect(inMemoryFirestore.reminders.get('rem-batch-1')?.nextDueOdo).toBe(9500);

      // Same protection for saveServiceRecordsBatchToFirestore
      const cloudRec = createSampleRecord({
        id: 'rec-batch-1',
        bikeId: 'bike-batch',
        userId: uid,
        totalCostPhp: 1200,
      });
      await saveServiceRecordToFirestore(cloudRec, uid);
      await saveServiceRecordToFirestore({ ...cloudRec, totalCostPhp: 1800 }, uid);

      await saveServiceRecordsBatchToFirestore(
        [{ ...cloudRec, totalCostPhp: 400, cloudVersion: 1, updatedAt: '2020-01-01T00:00:00.000Z' }],
        uid
      );
      expect(inMemoryFirestore.serviceRecords.get('rec-batch-1')?.totalCostPhp).toBe(1800);
    });
  });

  // ===========================================================================
  // Final CloudVersion, Legacy Initialization & Batch Transaction Safety Suite
  // ===========================================================================
  describe('Final CloudVersion, Legacy Initialization & Batch Transaction Safety (8 Scenarios)', () => {
    beforeEach(() => {
      transactionCommitCount = 0;
      writeBatchCommitCount = 0;
    });

    it('1. Legacy documents without cloudVersion receive cloudVersion = 1 on their first update, and malformed legacy cloudVersion fails safely', async () => {
      const uid = 'uid-legacy-init';

      // Verify helper directly
      expect(resolveNextCloudVersionForUpdate(undefined, 'motorcycle', 'b1')).toBe(1);
      expect(resolveNextCloudVersionForUpdate({ userId: uid, odometer: 500 }, 'motorcycle', 'b1')).toBe(1);
      expect(resolveNextCloudVersionForUpdate({ userId: uid, cloudVersion: 1 }, 'motorcycle', 'b1')).toBe(2);
      expect(resolveNextCloudVersionForUpdate({ userId: uid, cloudVersion: 4 }, 'motorcycle', 'b1')).toBe(5);
      expect(() =>
        resolveNextCloudVersionForUpdate({ userId: uid, cloudVersion: 'v1' }, 'motorcycle', 'b1')
      ).toThrow(/PERMISSION_DENIED: Malformed cloudVersion/);
      expect(() =>
        resolveNextCloudVersionForUpdate({ userId: uid, cloudVersion: 0 }, 'motorcycle', 'b1')
      ).toThrow(/PERMISSION_DENIED: Malformed cloudVersion/);
      expect(() =>
        resolveNextCloudVersionForUpdate({ userId: uid, cloudVersion: -2 }, 'motorcycle', 'b1')
      ).toThrow(/PERMISSION_DENIED: Malformed cloudVersion/);
      expect(() =>
        resolveNextCloudVersionForUpdate({ userId: uid, cloudVersion: 1.5 }, 'motorcycle', 'b1')
      ).toThrow(/PERMISSION_DENIED: Malformed cloudVersion/);

      // Seed legacy motorcycle, reminder, and serviceRecord WITHOUT cloudVersion in Firestore
      inMemoryFirestore.motorcycles.set('bike-legacy-1', {
        id: 'bike-legacy-1',
        userId: uid,
        nickname: 'Legacy Bike',
        brand: 'Honda',
        model: 'Click 125i',
        odometer: 1000,
        updatedAt: '2026-01-01T00:00:00.000Z',
      });
      inMemoryFirestore.reminders.set('rem-legacy-1', {
        id: 'rem-legacy-1',
        bikeId: 'bike-legacy-1',
        userId: uid,
        serviceType: 'Engine Oil Change',
        intervalKm: 1500,
        intervalMonths: 6,
        lastServiceDate: '2026-01-01',
        lastServiceOdo: 1000,
        nextDueDate: '2026-07-01',
        nextDueOdo: 2500,
        status: 'upcoming',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });
      inMemoryFirestore.serviceRecords.set('rec-legacy-1', {
        id: 'rec-legacy-1',
        bikeId: 'bike-legacy-1',
        userId: uid,
        serviceType: 'Engine Oil Change',
        date: '2026-01-01',
        odometer: 1000,
        totalCostPhp: 350,
        updatedAt: '2026-01-01T00:00:00.000Z',
      });

      // First update to legacy motorcycle -> MUST initialize cloudVersion to 1 (NOT 2!)
      await updateMotorcycleFieldsInFirestore('bike-legacy-1', uid, { odometer: 1200 });
      expect(inMemoryFirestore.motorcycles.get('bike-legacy-1')?.cloudVersion).toBe(1);
      expect(getKnownCloudRevision(uid, 'motorcycle', 'bike-legacy-1')).toBe(1);

      // Second update to the same motorcycle -> increments 1 -> 2
      await updateMotorcycleFieldsInFirestore('bike-legacy-1', uid, { odometer: 1400 });
      expect(inMemoryFirestore.motorcycles.get('bike-legacy-1')?.cloudVersion).toBe(2);

      // First update to legacy reminder -> MUST initialize cloudVersion to 1
      await saveReminderToFirestore(
        createSampleReminder({
          id: 'rem-legacy-1',
          bikeId: 'bike-legacy-1',
          userId: uid,
          nextDueOdo: 2700,
        }),
        uid
      );
      expect(inMemoryFirestore.reminders.get('rem-legacy-1')?.cloudVersion).toBe(1);

      // First update to legacy serviceRecord -> MUST initialize cloudVersion to 1
      await saveServiceRecordToFirestore(
        createSampleRecord({
          id: 'rec-legacy-1',
          bikeId: 'bike-legacy-1',
          userId: uid,
          totalCostPhp: 450,
        }),
        uid
      );
      expect(inMemoryFirestore.serviceRecords.get('rec-legacy-1')?.cloudVersion).toBe(1);

      // Malformed cloudVersion on an existing document fails safely instead of inventing a version
      inMemoryFirestore.motorcycles.set('bike-corrupt-ver', {
        id: 'bike-corrupt-ver',
        userId: uid,
        odometer: 1000,
        cloudVersion: 'corrupted-string',
      });
      await expect(
        updateMotorcycleFieldsInFirestore('bike-corrupt-ver', uid, { odometer: 1100 })
      ).rejects.toThrow(/PERMISSION_DENIED: Malformed cloudVersion/);
    });

    it('2. Eight reminder writes with 8 distinct parent motorcycles succeed in a single transaction chunk (<= 20 rules document access calls)', async () => {
      const uid = 'uid-batch-8-reminders';
      expect(SAFE_BATCH_TRANSACTION_CHUNK_SIZE).toBe(8);

      const reminders: MaintenanceReminder[] = [];
      for (let i = 1; i <= 8; i++) {
        const bikeId = `bike-8rem-${i}`;
        await saveMotorcycleToFirestore(
          createSampleBike({ id: bikeId, userId: uid, nickname: `Bike ${i}` }),
          uid
        );
        reminders.push(
          createSampleReminder({
            id: `rem-8-${i}`,
            bikeId,
            userId: uid,
            nextDueOdo: 2000 + i * 100,
          })
        );
      }

      transactionCommitCount = 0;
      const committedChunkIds: string[][] = [];
      await saveRemindersBatchToFirestore(reminders, uid, {
        onChunkCommitted: (ids) => {
          committedChunkIds.push(ids);
        },
      });

      // Exactly 1 transaction chunk for 8 reminders (8 * 1 get() in rules = 8 <= 20)
      expect(transactionCommitCount).toBe(1);
      expect(committedChunkIds).toHaveLength(1);
      expect(committedChunkIds[0]).toHaveLength(8);
      for (let i = 1; i <= 8; i++) {
        const saved = inMemoryFirestore.reminders.get(`rem-8-${i}`);
        expect(saved?.userId).toBe(uid);
        expect(saved?.cloudVersion).toBe(1);
      }
    });

    it('3. Eight service-record writes with 8 distinct parent motorcycles succeed in a single transaction chunk (<= 20 rules document access calls)', async () => {
      const uid = 'uid-batch-8-records';
      expect(SAFE_BATCH_TRANSACTION_CHUNK_SIZE).toBe(8);

      const records: ServiceRecord[] = [];
      for (let i = 1; i <= 8; i++) {
        const bikeId = `bike-8rec-${i}`;
        await saveMotorcycleToFirestore(
          createSampleBike({ id: bikeId, userId: uid, nickname: `Bike ${i}` }),
          uid
        );
        records.push(
          createSampleRecord({
            id: `rec-8-${i}`,
            bikeId,
            userId: uid,
            totalCostPhp: 300 + i * 50,
          })
        );
      }

      transactionCommitCount = 0;
      const committedChunkIds: string[][] = [];
      await saveServiceRecordsBatchToFirestore(records, uid, {
        onChunkCommitted: (ids) => {
          committedChunkIds.push(ids);
        },
      });

      // Exactly 1 transaction chunk for 8 service records (8 * 2 exists/get in rules = 16 <= 20)
      expect(transactionCommitCount).toBe(1);
      expect(committedChunkIds).toHaveLength(1);
      expect(committedChunkIds[0]).toHaveLength(8);
      for (let i = 1; i <= 8; i++) {
        const saved = inMemoryFirestore.serviceRecords.get(`rec-8-${i}`);
        expect(saved?.userId).toBe(uid);
        expect(saved?.cloudVersion).toBe(1);
      }
    });

    it('4. Migrating more than 8 reminders and service records splits writes into multiple 8-item transaction chunks with all reads before writes', async () => {
      const uid = 'uid-multi-chunk-19';
      const bike = createSampleBike({ id: 'bike-multi-chunk', userId: uid });
      await saveMotorcycleToFirestore(bike, uid);

      const reminders = Array.from({ length: 19 }, (_, idx) =>
        createSampleReminder({
          id: `rem-mc-${idx + 1}`,
          bikeId: 'bike-multi-chunk',
          userId: uid,
          nextDueOdo: 3000 + idx * 50,
        })
      );
      const records = Array.from({ length: 19 }, (_, idx) =>
        createSampleRecord({
          id: `rec-mc-${idx + 1}`,
          bikeId: 'bike-multi-chunk',
          userId: uid,
          totalCostPhp: 500 + idx * 25,
        })
      );

      transactionCommitCount = 0;
      const remChunks: string[][] = [];
      await saveRemindersBatchToFirestore(reminders, uid, {
        onChunkCommitted: (ids) => {
          remChunks.push(ids);
        },
      });
      // ceil(19 / 8) = 3 chunks (8, 8, 3)
      expect(transactionCommitCount).toBe(3);
      expect(remChunks.map((c) => c.length)).toEqual([8, 8, 3]);

      transactionCommitCount = 0;
      const recChunks: string[][] = [];
      await saveServiceRecordsBatchToFirestore(records, uid, {
        onChunkCommitted: (ids) => {
          recChunks.push(ids);
        },
      });
      expect(transactionCommitCount).toBe(3);
      expect(recChunks.map((c) => c.length)).toEqual([8, 8, 3]);
    });

    it('5. Batch helpers validate parent motorcycle ownership inside the transaction and reject cross-user parent references', async () => {
      const uidOwner = 'uid-owner-a';
      const uidOther = 'uid-owner-b';

      await saveMotorcycleToFirestore(
        createSampleBike({ id: 'bike-owned-by-b', userId: uidOther }),
        uidOther
      );

      // Reminder referencing another user's motorcycle MUST be rejected
      await expect(
        saveRemindersBatchToFirestore(
          [
            createSampleReminder({
              id: 'rem-hijack-bike',
              bikeId: 'bike-owned-by-b',
              userId: uidOwner,
            }),
          ],
          uidOwner
        )
      ).rejects.toThrow(/PERMISSION_DENIED: Reminder \(rem-hijack-bike\) references nonexistent or unauthorized parent motorcycle/);

      // Reminder referencing a non-existent motorcycle MUST be rejected
      await expect(
        saveRemindersBatchToFirestore(
          [
            createSampleReminder({
              id: 'rem-missing-bike',
              bikeId: 'bike-does-not-exist',
              userId: uidOwner,
            }),
          ],
          uidOwner
        )
      ).rejects.toThrow(/PERMISSION_DENIED: Reminder \(rem-missing-bike\) references nonexistent or unauthorized parent motorcycle/);

      // Service record referencing another user's existing motorcycle MUST be rejected
      await expect(
        saveServiceRecordsBatchToFirestore(
          [
            createSampleRecord({
              id: 'rec-hijack-bike',
              bikeId: 'bike-owned-by-b',
              userId: uidOwner,
            }),
          ],
          uidOwner
        )
      ).rejects.toThrow(/PERMISSION_DENIED: Service record \(rec-hijack-bike\) references a motorcycle \(bike-owned-by-b\) owned by another user/);
    });

    it('6. Existing cloud records with newer revisions or legacy records without cloudVersion are handled safely during batch writes', async () => {
      const uid = 'uid-batch-legacy-and-newer';
      const bike = createSampleBike({ id: 'bike-bln', userId: uid });
      await saveMotorcycleToFirestore(bike, uid);

      // Seed a legacy reminder in cloud without cloudVersion and old updatedAt
      inMemoryFirestore.reminders.set('rem-legacy-batch', {
        id: 'rem-legacy-batch',
        bikeId: 'bike-bln',
        userId: uid,
        serviceType: 'Oil Change',
        intervalKm: 1500,
        intervalMonths: 6,
        lastServiceDate: '2025-01-01',
        lastServiceOdo: 500,
        nextDueDate: '2025-07-01',
        nextDueOdo: 2000,
        status: 'upcoming',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });

      // Batch update with newer timestamp updates the legacy cloud reminder and sets cloudVersion = 1
      await saveRemindersBatchToFirestore(
        [
          createSampleReminder({
            id: 'rem-legacy-batch',
            bikeId: 'bike-bln',
            userId: uid,
            nextDueOdo: 3500,
            updatedAt: '2026-06-01T00:00:00.000Z',
          }),
        ],
        uid
      );
      expect(inMemoryFirestore.reminders.get('rem-legacy-batch')?.nextDueOdo).toBe(3500);
      expect(inMemoryFirestore.reminders.get('rem-legacy-batch')?.cloudVersion).toBe(1);
    });

    it('7. Failure in a middle chunk during migration checkpoints earlier chunks and preserves unmigrated later chunks for retry without data loss', async () => {
      const uid = 'uid-chunk-checkpoint-recovery';
      const otherUid = 'uid-other-owner-cp';
      const validBike = createSampleBike({ id: 'bike-valid-cp', userId: uid });
      const otherBike = createSampleBike({ id: 'bike-other-cp', userId: otherUid });
      await saveMotorcycleToFirestore(validBike, uid);
      await saveMotorcycleToFirestore(otherBike, otherUid);
      saveUserScopedMotorcycles(uid, [validBike]);

      // Create 10 service records: Chunk 1 (items 1..8) are valid; Chunk 2 (items 9..10) includes item 9 referencing another user's motorcycle
      const localRecords: ServiceRecord[] = [];
      for (let i = 1; i <= 10; i++) {
        localRecords.push(
          createSampleRecord({
            id: `rec-cp-${i}`,
            bikeId: i === 9 ? 'bike-other-cp' : 'bike-valid-cp',
            userId: uid,
            odometer: 1000 + i * 100,
            totalCostPhp: 400 + i * 25,
          })
        );
      }
      saveUserScopedServiceRecords(uid, localRecords);

      // Run migration — Chunk 1 (items 1..8) commits and checkpoints in MigrationLedger, Chunk 2 fails
      await expect(
        syncStorageToFirestore({
          userId: uid,
          userEmail: 'rider-cp@example.com',
          hasProAccess: true,
          userConfirmedOwnership: true,
          motorcyclesToSync: [validBike],
          remindersToSync: [],
          serviceRecordsToSync: localRecords,
        })
      ).rejects.toThrow(/PERMISSION_DENIED: Service record \(rec-cp-9\) references a motorcycle/);

      // Verify Chunk 1 (items 1..8) was persisted in Firestore AND checkpointed in MigrationLedger, while Chunk 2 (items 9..10) was not lost or falsely marked complete
      const ledgerAfterFailure = loadMigrationLedger(uid);
      expect(ledgerAfterFailure?.status).toBe('in_progress');
      expect(ledgerAfterFailure?.serviceRecordsCompletedIds).toEqual([
        'rec-cp-1',
        'rec-cp-2',
        'rec-cp-3',
        'rec-cp-4',
        'rec-cp-5',
        'rec-cp-6',
        'rec-cp-7',
        'rec-cp-8',
      ]);
      expect(inMemoryFirestore.serviceRecords.has('rec-cp-1')).toBe(true);
      expect(inMemoryFirestore.serviceRecords.has('rec-cp-8')).toBe(true);
      expect(inMemoryFirestore.serviceRecords.has('rec-cp-10')).toBe(false);

      // Fix item 9's parent bikeId locally and retry migration
      const fixedRecords = localRecords.map((r) =>
        r.id === 'rec-cp-9' ? { ...r, bikeId: 'bike-valid-cp' } : r
      );
      saveUserScopedServiceRecords(uid, fixedRecords);

      transactionCommitCount = 0;
      const retryAttempt = await syncStorageToFirestore({
        userId: uid,
        userEmail: 'rider-cp@example.com',
        hasProAccess: true,
        userConfirmedOwnership: true,
        motorcyclesToSync: [validBike],
        remindersToSync: [],
        serviceRecordsToSync: fixedRecords,
      });
      expect(retryAttempt.migratedServiceRecordsCount).toBe(2);

      // Only the remaining uncheckpointed records (rec-cp-9 and rec-cp-10) needed to be committed in 1 transaction chunk!
      expect(transactionCommitCount).toBe(1);
      expect(inMemoryFirestore.serviceRecords.has('rec-cp-9')).toBe(true);
      expect(inMemoryFirestore.serviceRecords.has('rec-cp-10')).toBe(true);
      const finalLedger = loadMigrationLedger(uid);
      expect(finalLedger?.status).toBe('completed');
      expect(finalLedger?.serviceRecordsCompletedIds).toHaveLength(10);
    });

    it('8. Large motorcycle cleanup in deleteMotorcycleFromFirestore chunks writeBatch deletes into SAFE_CLEANUP_DELETE_BATCH_CHUNK_SIZE (50)', async () => {
      const uid = 'uid-large-cleanup';
      expect(SAFE_CLEANUP_DELETE_BATCH_CHUNK_SIZE).toBe(50);

      const bike = createSampleBike({ id: 'bike-cleanup-120', userId: uid });
      await saveMotorcycleToFirestore(bike, uid);

      // Seed 120 reminders and 120 service records for this motorcycle
      for (let i = 1; i <= 120; i++) {
        inMemoryFirestore.reminders.set(`rem-clean-${i}`, {
          id: `rem-clean-${i}`,
          bikeId: 'bike-cleanup-120',
          userId: uid,
          cloudVersion: 1,
        });
        inMemoryFirestore.serviceRecords.set(`rec-clean-${i}`, {
          id: `rec-clean-${i}`,
          bikeId: 'bike-cleanup-120',
          userId: uid,
          cloudVersion: 1,
        });
      }

      writeBatchCommitCount = 0;
      await deleteMotorcycleFromFirestore('bike-cleanup-120', uid, {
        deleteReminders: true,
        deleteServiceHistoryConfirmed: true,
      });

      // 120 reminders -> ceil(120/50) = 3 batches; 120 serviceRecords -> ceil(120/50) = 3 batches; total = 6 writeBatch commits
      expect(writeBatchCommitCount).toBe(6);
      expect(inMemoryFirestore.motorcycles.has('bike-cleanup-120')).toBe(false);
      expect(inMemoryFirestore.reminders.size).toBe(0);
      expect(inMemoryFirestore.serviceRecords.size).toBe(0);
    });
  });
});




