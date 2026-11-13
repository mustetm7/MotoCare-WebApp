import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import {
  Motorcycle,
  MaintenanceReminder,
  ServiceRecord,
} from '../types';
import {
  loadMotorcycles,
  loadReminders,
  loadServiceRecords,
  loadUserScopedMotorcycles,
  saveUserScopedMotorcycles,
  loadUserScopedReminders,
  saveUserScopedReminders,
  loadUserScopedServiceRecords,
  saveUserScopedServiceRecords,
  inspectLegacyDataDryRun,
} from '../utils/storage';
import {
  syncUserProfile,
  saveMotorcycleToFirestore,
  saveReminderToFirestore,
  saveServiceRecordToFirestore,
  permanentlyDeleteUserAccount,
  fetchUserMotorcyclesOnce,
  fetchUserRemindersOnce,
  fetchUserServiceRecordsOnce,
  canCreateMotorcycleInGarage,
  approveProAccessInFirestore,
  revokeProAccessInFirestore,
  submitPaymentReferenceToFirestore,
} from '../utils/firestoreService';
import {
  signUpWithEmail,
  auth,
  OWNER_ADMIN_EMAIL,
} from '../utils/firebase';
import {
  computeAuthoritativeSubscription,
  useAuth,
} from '../context/AuthContext';
import { Navbar } from '../components/Navbar';
import { INITIAL_SUBSCRIPTION } from '../data/initialData';

// -----------------------------------------------------------------------------
// In-Memory Firebase Auth & Firestore Mock Stores for Account Deletion Lifecycle
// -----------------------------------------------------------------------------
const inMemoryAuthUsersByEmail = new Map<
  string,
  {
    uid: string;
    email: string;
    displayName: string;
    emailVerified: boolean;
    providerData: Array<{ providerId: string }>;
    delete: () => Promise<void>;
  }
>();

let uidCounter = 1000;
const deleteUserSpy = vi.fn();
const reauthenticateWithCredentialSpy = vi.fn();
const reauthenticateWithPopupSpy = vi.fn();

vi.mock('firebase/app-check', () => ({
  initializeAppCheck: vi.fn(),
  ReCaptchaV3Provider: class {},
}));

vi.mock('firebase/auth', () => {
  return {
    getAuth: () => ({ currentUser: null }),
    GoogleAuthProvider: class {},
    EmailAuthProvider: {
      credential: (email: string, password: string) => ({
        providerId: 'password',
        email,
        password,
      }),
    },
    signInWithPopup: vi.fn(),
    signOut: vi.fn(async () => {}),
    onAuthStateChanged: vi.fn(() => () => {}),
    signInWithEmailAndPassword: vi.fn(),
    sendPasswordResetEmail: vi.fn(),
    sendEmailVerification: vi.fn(async () => {}),
    reauthenticateWithCredential: vi.fn(async (user: any, credential: any) => {
      reauthenticateWithCredentialSpy(user, credential);
      if (credential?.password === 'WRONG_PASSWORD') {
        throw new Error('Firebase: Error (auth/wrong-password).');
      }
    }),
    reauthenticateWithPopup: vi.fn(async (user: any, provider: any) => {
      reauthenticateWithPopupSpy(user, provider);
    }),
    updateProfile: vi.fn(async (user: any, profile: { displayName?: string }) => {
      if (profile.displayName) {
        user.displayName = profile.displayName;
      }
    }),
    createUserWithEmailAndPassword: vi.fn(async (_authObj: any, email: string, _pass: string) => {
      const normalized = email.trim().toLowerCase();
      if (inMemoryAuthUsersByEmail.has(normalized)) {
        throw new Error('Firebase: Error (auth/email-already-in-use).');
      }
      uidCounter += 1;
      const freshUid = `uid_lifecycle_${uidCounter}`;
      const userRecord = {
        uid: freshUid,
        email: normalized,
        displayName: 'MotoCare Rider',
        emailVerified: true,
        providerData: [{ providerId: 'password' }],
        delete: async () => {
          inMemoryAuthUsersByEmail.delete(normalized);
        },
      };
      inMemoryAuthUsersByEmail.set(normalized, userRecord);
      return { user: userRecord };
    }),
    deleteUser: vi.fn(async (user: any) => {
      deleteUserSpy(user);
      if (user?.email) {
        inMemoryAuthUsersByEmail.delete(user.email.trim().toLowerCase());
      }
    }),
  };
});

const inMemoryFirestore: Record<string, Map<string, Record<string, any>>> = {
  users: new Map(),
  motorcycles: new Map(),
  reminders: new Map(),
  serviceRecords: new Map(),
  paymentSubmissions: new Map(),
  paymentReferences: new Map(),
};

let userDocDeletedWhenBikeCountWasZero = false;

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
    limit: (n: number) => ({ __type: 'limit', n }),
    startAfter: (cursor: any) => ({ __type: 'startAfter', cursor }),
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
      const store = inMemoryFirestore[docRef.colName];
      const existing = store?.get(docRef.id) || {};
      const next = options?.merge ? { ...existing, ...payload } : { ...payload };
      store?.set(docRef.id, next);
    },
    updateDoc: async (docRef: any, payload: any) => {
      const store = inMemoryFirestore[docRef.colName];
      const existing = store?.get(docRef.id) || {};
      store?.set(docRef.id, { ...existing, ...payload });
    },
    deleteDoc: async (docRef: any) => {
      const store = inMemoryFirestore[docRef.colName];
      if (docRef.colName === 'users') {
        const currentUserDoc = store?.get(docRef.id);
        const currentBikeCount = currentUserDoc?.bikeCount ?? 0;
        if (currentBikeCount > 0) {
          throw new Error('PERMISSION_DENIED: Cannot delete user document while bikeCount > 0');
        }
        userDocDeletedWhenBikeCountWasZero = true;
      }
      store?.delete(docRef.id);
    },
    writeBatch: () => {
      const ops: Array<() => void> = [];
      return {
        set: (docRef: any, payload: any, options?: { merge?: boolean }) => {
          ops.push(() => {
            const store = inMemoryFirestore[docRef.colName];
            const existing = store?.get(docRef.id) || {};
            store?.set(docRef.id, options?.merge ? { ...existing, ...payload } : { ...payload });
          });
        },
        update: (docRef: any, payload: any) => {
          ops.push(() => {
            const store = inMemoryFirestore[docRef.colName];
            const existing = store?.get(docRef.id) || {};
            store?.set(docRef.id, { ...existing, ...payload });
          });
        },
        delete: (docRef: any) => {
          ops.push(() => {
            const store = inMemoryFirestore[docRef.colName];
            store?.delete(docRef.id);
          });
        },
        commit: async () => {
          for (const op of ops) op();
        },
      };
    },
    runTransaction: async (_db: any, updateFn: (tx: any) => Promise<any>) => {
      const stagedOps: Array<() => void> = [];
      const tx = {
        get: async (docRef: any) => {
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
            const existing = store?.get(docRef.id) || {};
            store?.set(docRef.id, options?.merge ? { ...existing, ...payload } : { ...payload });
          });
        },
        update: (docRef: any, payload: any) => {
          stagedOps.push(() => {
            const store = inMemoryFirestore[docRef.colName];
            const existing = store?.get(docRef.id) || {};
            // Enforce firestore.rules terminal-state lock on paymentSubmissions:
            // allow update: if isAdmin() && resource.data.status == 'pending_approval'
            if (
              docRef.colName === 'paymentSubmissions' &&
              existing.status &&
              existing.status !== 'pending_approval'
            ) {
              throw new Error(
                'Missing or insufficient permissions: cannot update paymentSubmission whose status is not pending_approval.'
              );
            }
            store?.set(docRef.id, { ...existing, ...payload });
          });
        },
        delete: (docRef: any) => {
          stagedOps.push(() => {
            const store = inMemoryFirestore[docRef.colName];
            store?.delete(docRef.id);
          });
        },
      };
      const res = await updateFn(tx);
      for (const op of stagedOps) op();
      return res;
    },
    onSnapshot: vi.fn(() => () => {}),
  };
});

vi.mock('../context/AuthContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../context/AuthContext')>();
  return {
    ...actual,
    useAuth: vi.fn(),
  };
});

describe('MotoCare Account Deletion & Same-Email Re-Registration Lifecycle Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    inMemoryAuthUsersByEmail.clear();
    inMemoryFirestore.users.clear();
    inMemoryFirestore.motorcycles.clear();
    inMemoryFirestore.reminders.clear();
    inMemoryFirestore.serviceRecords.clear();
    inMemoryFirestore.paymentSubmissions.clear();
    uidCounter = 1000;
    userDocDeletedWhenBikeCountWasZero = false;
  });

  it('Completes the full 5-step account deletion lifecycle with re-authentication, atomic motorcycle deletion (bikeCount -> 0 before user doc delete), and same-email re-registration', async () => {
    const testEmail = 'lifecycle.rider@motocare.ph';
    const testPass = 'MotoCare#2026';

    // -------------------------------------------------------------------------
    // STEP 1: Register a new test user
    // -------------------------------------------------------------------------
    const firstUser = await signUpWithEmail(testEmail, testPass, 'Marco Reyes');
    expect(firstUser).not.toBeNull();
    const firstUid = firstUser!.uid;
    (auth as any).currentUser = firstUser;
    await syncUserProfile(firstUser!);

    // -------------------------------------------------------------------------
    // STEP 2: Verify it is a valid user and populate motorcycles, reminders, and service records
    // -------------------------------------------------------------------------
    expect(inMemoryAuthUsersByEmail.has(testEmail)).toBe(true);
    const firstUserProfile = inMemoryFirestore.users.get(firstUid);
    expect(firstUserProfile).toBeDefined();
    expect(firstUserProfile?.uid).toBe(firstUid);
    expect(firstUserProfile?.email).toBe(testEmail);

    // Upgrade the first user to Pro in Firestore and add motorcycles, reminders, and service history
    inMemoryFirestore.users.set(firstUid, {
      ...firstUserProfile,
      subscriptionTier: 'pro',
      subscriptionStatus: 'active',
      paymentStatus: 'active_pro',
      expiryDate: new Date(Date.now() + 30 * 86400_000).toISOString(),
    });

    const bike1: Motorcycle = {
      id: 'bike-lifecycle-1',
      userId: firstUid,
      nickname: 'Manila Commuter',
      brand: 'Yamaha',
      model: 'NMAX 155',
      year: 2024,
      licensePlate: 'NAA 4567',
      odometer: 9400,
      unit: 'km',
      color: 'Matte Black',
      specs: {
        transmission: 'Automatic Scooter',
        cooling: 'Liquid-Cooled',
        displacementCc: 155,
        oilViscosity: '10W-40',
        oilCapacityLiters: 0.9,
        tirePressureFrontPsi: 29,
        tirePressureRearPsi: 33,
        recommendedServiceIntervalKm: 1500,
      },
    };
    const rem1: MaintenanceReminder = {
      id: 'rem-lifecycle-1',
      userId: firstUid,
      bikeId: bike1.id,
      title: 'Engine Oil Change',
      category: 'Engine Oil',
      categoryTag: 'OIL',
      intervalKm: 1500,
      lastCompletedOdo: 8000,
      nextDueOdo: 9500,
      lastCompletedDate: '2026-02-01',
      priority: 'high',
      notes: 'Full synthetic 10W-40',
      estimatedCostPhp: 480,
    };
    const rec1: ServiceRecord = {
      id: 'rec-lifecycle-1',
      userId: firstUid,
      bikeId: bike1.id,
      date: '2026-02-01',
      odometer: 8000,
      title: '8,000 km PMS & Oil Service',
      category: 'Engine Oil',
      type: 'Casa / Official 3S',
      parts: [{ name: 'Yamalube 10W-40', costPhp: 480 }],
      laborCostPhp: 200,
      totalCostPhp: 680,
      notes: 'Completed on schedule',
    };

    await saveMotorcycleToFirestore(bike1, firstUid);
    await saveReminderToFirestore(rem1, firstUid);
    await saveServiceRecordToFirestore(rec1, firstUid);

    saveUserScopedMotorcycles(firstUid, [bike1]);
    saveUserScopedReminders(firstUid, [rem1]);
    saveUserScopedServiceRecords(firstUid, [rec1]);
    localStorage.setItem('motocare_app_motorcycles_v4', JSON.stringify([bike1]));
    localStorage.setItem('motocare_app_reminders_v4', JSON.stringify([rem1]));
    localStorage.setItem('motocare_app_records_v4', JSON.stringify([rec1]));

    expect(inMemoryFirestore.users.get(firstUid)?.bikeCount).toBe(1);
    expect(await fetchUserMotorcyclesOnce(firstUid)).toHaveLength(1);
    expect(await fetchUserRemindersOnce(firstUid)).toHaveLength(1);
    expect(await fetchUserServiceRecordsOnce(firstUid)).toHaveLength(1);

    // -------------------------------------------------------------------------
    // STEP 3: Trigger the account deletion process (with re-authentication)
    // -------------------------------------------------------------------------
    const deletionSummary = await permanentlyDeleteUserAccount(firstUser, testPass);
    expect(reauthenticateWithCredentialSpy).toHaveBeenCalledTimes(1);
    expect(userDocDeletedWhenBikeCountWasZero).toBe(true);
    expect(deletionSummary.deletedUid).toBe(firstUid);
    expect(deletionSummary.releasedEmail).toBe(testEmail);
    expect(deletionSummary.deletedMotorcyclesCount).toBe(1);
    expect(deletionSummary.deletedRemindersCount).toBe(1);
    expect(deletionSummary.deletedServiceRecordsCount).toBe(1);

    // Verify Firebase Auth deleteUser was called last and the email was released
    expect(deleteUserSpy).toHaveBeenCalledTimes(1);
    expect(inMemoryAuthUsersByEmail.has(testEmail)).toBe(false);

    // Verify all Firestore data for the old user was removed
    expect(inMemoryFirestore.users.has(firstUid)).toBe(false);
    expect(inMemoryFirestore.motorcycles.size).toBe(0);
    expect(inMemoryFirestore.reminders.size).toBe(0);
    expect(inMemoryFirestore.serviceRecords.size).toBe(0);

    // Verify UID-scoped and unscoped local storage caches were cleaned up
    expect(loadUserScopedMotorcycles(firstUid)).toHaveLength(0);
    expect(loadUserScopedReminders(firstUid)).toHaveLength(0);
    expect(loadUserScopedServiceRecords(firstUid)).toHaveLength(0);
    expect(loadMotorcycles()).toHaveLength(0);
    expect(loadReminders()).toHaveLength(0);
    expect(loadServiceRecords()).toHaveLength(0);

    // -------------------------------------------------------------------------
    // STEP 4: Immediately register with the SAME email address again
    // -------------------------------------------------------------------------
    const secondUser = await signUpWithEmail(testEmail, 'NewPassword#2026', 'Marco Reyes');
    expect(secondUser).not.toBeNull();
    const secondUid = secondUser!.uid;
    (auth as any).currentUser = secondUser;
    await syncUserProfile(secondUser!);

    // -------------------------------------------------------------------------
    // STEP 5: Ensure a new UID is created, Free-tier status is assigned, and no old data is restored
    // -------------------------------------------------------------------------
    expect(secondUid).toBeTruthy();
    expect(secondUid).not.toBe(firstUid);

    const newUserProfile = inMemoryFirestore.users.get(secondUid);
    expect(newUserProfile).toBeDefined();
    expect(newUserProfile?.uid).toBe(secondUid);
    expect(newUserProfile?.email).toBe(testEmail);
    expect(newUserProfile?.subscriptionTier).toBe('free');
    expect(newUserProfile?.subscriptionStatus).toBe('free');
    expect(newUserProfile?.paymentStatus).toBe('unpaid_free');
    expect(newUserProfile?.bikeCount).toBe(0);

    const effectiveSubscription = computeAuthoritativeSubscription(newUserProfile || null, null);
    expect(effectiveSubscription.tier).toBe('free');
    expect(effectiveSubscription.status).toBe('free');

    // Verify Free-tier limits apply (1 motorcycle max)
    expect(
      canCreateMotorcycleInGarage({
        authUser: secondUser,
        targetUserId: secondUid,
        userDocData: newUserProfile,
        currentCount: 0,
      })
    ).toBe(true);
    expect(
      canCreateMotorcycleInGarage({
        authUser: secondUser,
        targetUserId: secondUid,
        userDocData: { ...newUserProfile, bikeCount: 1 },
        currentCount: 1,
      })
    ).toBe(false);

    // Verify zero old motorcycles, reminders, or service records exist in Firestore or LocalStorage
    expect(await fetchUserMotorcyclesOnce(secondUid)).toHaveLength(0);
    expect(await fetchUserRemindersOnce(secondUid)).toHaveLength(0);
    expect(await fetchUserServiceRecordsOnce(secondUid)).toHaveLength(0);
    expect(loadUserScopedMotorcycles(secondUid)).toHaveLength(0);
    expect(loadUserScopedReminders(secondUid)).toHaveLength(0);
    expect(loadUserScopedServiceRecords(secondUid)).toHaveLength(0);

    const dryRun = inspectLegacyDataDryRun({
      userId: secondUid,
      userEmail: testEmail,
      hasProAccess: false,
    });
    expect(dryRun.hasLegacyDataToReview).toBe(false);
    expect(dryRun.eligibleMotorcycles).toHaveLength(0);
    expect(dryRun.eligibleReminders).toHaveLength(0);
    expect(dryRun.eligibleServiceRecords).toHaveLength(0);
  });

  it('Does not swallow errors if re-authentication fails: halts immediately without deleting Firestore data or calling deleteUser', async () => {
    const email = 'fail.reauth@motocare.ph';
    const user = await signUpWithEmail(email, 'CorrectPass123!', 'Reauth Test Rider');
    expect(user).not.toBeNull();
    const uid = user!.uid;
    (auth as any).currentUser = user;
    await syncUserProfile(user!);

    await expect(permanentlyDeleteUserAccount(user, 'WRONG_PASSWORD')).rejects.toThrow(
      /auth\/wrong-password/i
    );

    // Verify user document and Auth user were NOT deleted
    expect(deleteUserSpy).not.toHaveBeenCalled();
    expect(inMemoryFirestore.users.has(uid)).toBe(true);
    expect(inMemoryAuthUsersByEmail.has(email)).toBe(true);
  });

  it('Displays a double-confirmation dialog with password prompt in Navbar / User Settings and triggers Firebase Auth deleteUser + Firestore cleanup', async () => {
    const settingsUserEmail = 'settings.delete@motocare.ph';
    const registeredUser = await signUpWithEmail(settingsUserEmail, 'Pass1234!', 'Settings Rider');
    expect(registeredUser).not.toBeNull();
    const uid = registeredUser!.uid;
    (auth as any).currentUser = registeredUser;
    await syncUserProfile(registeredUser!);

    const sampleBike: Motorcycle = {
      id: 'bike-settings-del-1',
      userId: uid,
      nickname: 'City Scooter',
      brand: 'Honda',
      model: 'Click 125i',
      year: 2025,
      licensePlate: 'NBC 1122',
      odometer: 2300,
      unit: 'km',
      color: 'White',
      specs: {
        transmission: 'Automatic Scooter',
        cooling: 'Liquid-Cooled',
        displacementCc: 125,
        oilViscosity: '10W-30',
        oilCapacityLiters: 0.8,
        tirePressureFrontPsi: 29,
        tirePressureRearPsi: 33,
        recommendedServiceIntervalKm: 1500,
      },
    };
    const sampleReminder: MaintenanceReminder = {
      id: 'rem-settings-del-1',
      userId: uid,
      bikeId: sampleBike.id,
      title: 'Periodic Oil Change',
      category: 'Engine Oil',
      categoryTag: 'OIL',
      intervalKm: 1500,
      lastCompletedOdo: 1500,
      nextDueOdo: 3000,
      lastCompletedDate: '2026-01-15',
      priority: 'medium',
      notes: '10W-30 Scooter Oil',
      estimatedCostPhp: 380,
    };
    const sampleRecord: ServiceRecord = {
      id: 'rec-settings-del-1',
      userId: uid,
      bikeId: sampleBike.id,
      date: '2026-01-15',
      odometer: 1500,
      title: '1,500 km First PMS',
      category: 'Engine Oil',
      type: 'Casa / Official 3S',
      parts: [{ name: 'Honda Pro Oil', costPhp: 380 }],
      laborCostPhp: 150,
      totalCostPhp: 530,
      notes: 'Initial break-in oil change',
    };

    await saveMotorcycleToFirestore(sampleBike, uid);
    await saveReminderToFirestore(sampleReminder, uid);
    await saveServiceRecordToFirestore(sampleRecord, uid);

    vi.mocked(useAuth).mockReturnValue({
      user: registeredUser as any,
      loading: false,
      isAdmin: false,
      hasProAccess: false,
      subscription: { ...INITIAL_SUBSCRIPTION },
      signIn: vi.fn(),
      signInWithEmail: vi.fn(),
      signUpWithEmail: vi.fn(),
      resetPassword: vi.fn(),
      signOut: vi.fn(),
      deleteAccount: async (password?: string) => {
        await permanentlyDeleteUserAccount(registeredUser, password);
      },
      submitPaymentRef: vi.fn(),
    });

    render(
      React.createElement(Navbar, {
        activeTab: 'garage',
        onTabChange: vi.fn(),
        motorcycles: [sampleBike],
        activeBike: sampleBike,
        subscription: { ...INITIAL_SUBSCRIPTION },
        onSelectBike: vi.fn(),
        onOpenAddBike: vi.fn(),
        onOpenAddService: vi.fn(),
        onOpenPaywall: vi.fn(),
        overdueCount: 0,
      })
    );

    // 1. Open Application User Settings in Navbar and click "Delete Account"
    const settingsBtn = screen.getByTestId('user-settings-button');
    fireEvent.click(settingsBtn);

    const settingsDeleteBtn = screen.getByTestId('settings-delete-account-btn');
    expect(settingsDeleteBtn).toBeDefined();
    fireEvent.click(settingsDeleteBtn);

    // 2. Verify Double-Confirmation Modal opens with clear permanent data removal warning
    const modal = screen.getByTestId('delete-account-modal');
    expect(modal).toBeDefined();
    expect(modal.getAttribute('role')).toBe('dialog');
    expect(
      screen.getByText(/All data \(motorcycles, service records, reminders\) will be permanently removed/i)
    ).toBeDefined();
    expect(
      screen.getByText(
        /While you can register again later using the same email address, your previous data cannot be restored/i
      )
    ).toBeDefined();

    // 3. Enter password and complete mandatory double-confirmation checkbox
    const passwordInput = screen.getByTestId('delete-account-password-input') as HTMLInputElement;
    fireEvent.change(passwordInput, { target: { value: 'Pass1234!' } });

    const doubleConfirmCheckbox = screen.getByTestId(
      'delete-account-double-confirm-checkbox'
    ) as HTMLInputElement;
    const confirmDeleteBtn = screen.getByTestId(
      'confirm-permanent-delete-account-btn'
    ) as HTMLButtonElement;

    expect(doubleConfirmCheckbox.checked).toBe(false);
    expect(confirmDeleteBtn.disabled).toBe(true);

    fireEvent.click(doubleConfirmCheckbox);
    expect(doubleConfirmCheckbox.checked).toBe(true);
    expect(confirmDeleteBtn.disabled).toBe(false);

    await act(async () => {
      fireEvent.click(confirmDeleteBtn);
    });

    expect(reauthenticateWithCredentialSpy).toHaveBeenCalledTimes(1);
    expect(deleteUserSpy).toHaveBeenCalledTimes(1);

    // 4. Verify clean sweep of all associated Firestore documents and Firebase Auth record
    expect(inMemoryFirestore.users.has(uid)).toBe(false);
    expect(inMemoryFirestore.motorcycles.has('bike-settings-del-1')).toBe(false);
    expect(inMemoryFirestore.reminders.has('rem-settings-del-1')).toBe(false);
    expect(inMemoryFirestore.serviceRecords.has('rec-settings-del-1')).toBe(false);
    expect(inMemoryFirestore.paymentSubmissions.size).toBe(0);
    expect(inMemoryAuthUsersByEmail.has(settingsUserEmail)).toBe(false);

    // 5. Confirm future re-registration with the same email succeeds with a fresh UID
    const reRegisteredUser = await signUpWithEmail(settingsUserEmail, 'NewPass999!', 'Settings Rider');
    expect(reRegisteredUser).not.toBeNull();
    expect(reRegisteredUser!.uid).not.toBe(uid);
  });

  it('Verifies Revoke Pro Access regression requirements (A–I): revokes approved Pro without mutating approved paymentSubmissions or paymentReferences, preserves garage data, rejects pending submissions, and protects newer/other subscriptions', async () => {
    const rider1 = await signUpWithEmail('pro.rider1@motocare.ph', 'Pass1111!', 'Pro Rider One');
    const rider2 = await signUpWithEmail('pro.rider2@motocare.ph', 'Pass2222!', 'Pro Rider Two');
    expect(rider1).not.toBeNull();
    expect(rider2).not.toBeNull();

    const uid1 = rider1!.uid;
    const uid2 = rider2!.uid;

    (auth as any).currentUser = rider1;
    await syncUserProfile(rider1!);

    (auth as any).currentUser = rider2;
    await syncUserProfile(rider2!);

    // Seed Rider 1's motorcycle, reminder, and service record (Requirement H)
    const rider1Bike: Motorcycle = {
      id: 'bike-revoke-reg-1',
      userId: uid1,
      nickname: 'Adv Tourer',
      brand: 'Honda',
      model: 'ADV 160',
      year: 2025,
      licensePlate: 'NAA 7788',
      odometer: 4200,
      unit: 'km',
      color: 'Matte Red',
      specs: {
        transmission: 'Automatic Scooter',
        cooling: 'Liquid-Cooled',
        displacementCc: 160,
        oilViscosity: '10W-30',
        oilCapacityLiters: 0.8,
        tirePressureFrontPsi: 29,
        tirePressureRearPsi: 33,
        recommendedServiceIntervalKm: 1500,
      },
    };
    const rider1Rem: MaintenanceReminder = {
      id: 'rem-revoke-reg-1',
      userId: uid1,
      bikeId: rider1Bike.id,
      title: 'Engine Oil Change',
      category: 'Engine Oil',
      intervalKm: 1500,
      lastCompletedOdo: 3000,
      nextDueOdo: 4500,
      lastCompletedDate: '2026-02-10',
      priority: 'high',
      notes: 'Honda Pro Scooter Oil',
      estimatedCostPhp: 420,
    };
    const rider1Rec: ServiceRecord = {
      id: 'rec-revoke-reg-1',
      userId: uid1,
      bikeId: rider1Bike.id,
      date: '2026-02-10',
      odometer: 3000,
      title: '3,000 km PMS',
      category: 'Engine Oil',
      type: 'Casa / Official 3S',
      parts: [{ name: 'Engine Oil', costPhp: 420 }],
      laborCostPhp: 150,
      totalCostPhp: 570,
      notes: 'Routine service',
    };

    (auth as any).currentUser = rider1;
    await saveMotorcycleToFirestore(rider1Bike, uid1);
    await saveReminderToFirestore(rider1Rem, uid1);
    await saveServiceRecordToFirestore(rider1Rec, uid1);

    // Rider 1 submits a payment reference and Admin approves it
    const subId1 = await submitPaymentReferenceToFirestore({
      userId: uid1,
      userEmail: rider1!.email || 'pro.rider1@motocare.ph',
      userName: rider1!.displayName || 'Pro Rider One',
      bikeModel: 'Honda ADV 160',
      bikePlate: 'NAA 7788',
      paymentMethod: 'gcash',
      referenceNumber: '9001234567890',
    });

    await approveProAccessInFirestore(subId1, uid1, OWNER_ADMIN_EMAIL);

    // Rider 2 also submits and gets approved (Requirement I: another active subscription)
    (auth as any).currentUser = rider2;
    const subId2 = await submitPaymentReferenceToFirestore({
      userId: uid2,
      userEmail: rider2!.email || 'pro.rider2@motocare.ph',
      userName: rider2!.displayName || 'Pro Rider Two',
      bikeModel: 'Yamaha NMAX 155',
      paymentMethod: 'gcash',
      referenceNumber: '8009876543210',
    });
    await approveProAccessInFirestore(subId2, uid2, OWNER_ADMIN_EMAIL);

    const approvedSubSnapshotBefore = { ...inMemoryFirestore.paymentSubmissions.get(subId1)! };
    const refHash1 = approvedSubSnapshotBefore.referenceHash;
    const approvedRefSnapshotBefore = { ...inMemoryFirestore.paymentReferences.get(refHash1)! };

    expect(approvedSubSnapshotBefore.status).toBe('active_pro');
    expect(approvedRefSnapshotBefore.status).toBe('approved');
    expect(inMemoryFirestore.users.get(uid1)?.subscriptionTier).toBe('pro');

    // A & B: Admin revokes Rider 1's approved Pro subscription
    await revokeProAccessInFirestore(subId1, uid1, OWNER_ADMIN_EMAIL);

    const revokedUser1 = inMemoryFirestore.users.get(uid1)!;
    expect(revokedUser1.subscriptionTier).toBe('free');
    expect(revokedUser1.subscriptionStatus).toBe('revoked');
    expect(revokedUser1.paymentStatus).toBe('rejected');
    expect(revokedUser1.pendingSubmissionId).toBeNull();
    expect(revokedUser1.revokedBy).toBe(OWNER_ADMIN_EMAIL);
    expect(typeof revokedUser1.revokedAt).toBe('string');
    expect(revokedUser1.expiryDate.toMillis()).toBe(0);

    // C & D: Approved paymentSubmissions and paymentReferences records remain completely unchanged
    expect(inMemoryFirestore.paymentSubmissions.get(subId1)).toEqual(approvedSubSnapshotBefore);
    expect(inMemoryFirestore.paymentReferences.get(refHash1)).toEqual(approvedRefSnapshotBefore);

    // H: Revoking Pro access does NOT delete Rider 1's account, motorcycles, reminders, or service records,
    // and Rider 1 can continue using MotoCare's Free tier
    expect(inMemoryAuthUsersByEmail.has('pro.rider1@motocare.ph')).toBe(true);
    expect(revokedUser1.displayName).toBe('Pro Rider One');
    expect(revokedUser1.bikeCount).toBe(1);
    expect(await fetchUserMotorcyclesOnce(uid1)).toHaveLength(1);
    expect(await fetchUserRemindersOnce(uid1)).toHaveLength(1);
    expect(await fetchUserServiceRecordsOnce(uid1)).toHaveLength(1);

    const effectiveSubAfterRevoke = computeAuthoritativeSubscription(revokedUser1, null);
    expect(effectiveSubAfterRevoke.tier).toBe('free');
    expect(effectiveSubAfterRevoke.status).toBe('revoked');

    // I (Part 1): Rider 2's active Pro subscription is completely untouched
    const activeUser2 = inMemoryFirestore.users.get(uid2)!;
    expect(activeUser2.subscriptionTier).toBe('pro');
    expect(activeUser2.subscriptionStatus).toBe('active');

    // I (Part 2): If Rider 2 renews with a newer approved payment (subId2New), revoking the older
    // superseded subId2 does NOT overwrite Rider 2's newer active subscription state
    (auth as any).currentUser = rider2;
    const subId2New = await submitPaymentReferenceToFirestore({
      userId: uid2,
      userEmail: rider2!.email || 'pro.rider2@motocare.ph',
      userName: rider2!.displayName || 'Pro Rider Two',
      bikeModel: 'Yamaha NMAX 155',
      paymentMethod: 'gcash',
      referenceNumber: '7001122334455',
    });
    await approveProAccessInFirestore(subId2New, uid2, OWNER_ADMIN_EMAIL);
    expect(inMemoryFirestore.users.get(uid2)?.lastPaymentId).toBe(subId2New);

    await revokeProAccessInFirestore(subId2, uid2, OWNER_ADMIN_EMAIL);
    expect(inMemoryFirestore.users.get(uid2)?.subscriptionTier).toBe('pro');
    expect(inMemoryFirestore.users.get(uid2)?.subscriptionStatus).toBe('active');
    expect(inMemoryFirestore.users.get(uid2)?.lastPaymentId).toBe(subId2New);

    // G: Admin can still reject a pending payment submission using the existing rejection workflow
    (auth as any).currentUser = rider1;
    const pendingSubId = await submitPaymentReferenceToFirestore({
      userId: uid1,
      userEmail: rider1!.email || 'pro.rider1@motocare.ph',
      userName: rider1!.displayName || 'Pro Rider One',
      bikeModel: 'Honda ADV 160',
      paymentMethod: 'gcash',
      referenceNumber: '6005544332211',
    });
    expect(inMemoryFirestore.paymentSubmissions.get(pendingSubId)?.status).toBe('pending_approval');
    expect(inMemoryFirestore.users.get(uid1)?.pendingSubmissionId).toBe(pendingSubId);

    await revokeProAccessInFirestore(pendingSubId, uid1, OWNER_ADMIN_EMAIL);
    expect(inMemoryFirestore.paymentSubmissions.get(pendingSubId)?.status).toBe('rejected');
    expect(inMemoryFirestore.users.get(uid1)?.pendingSubmissionId).toBeNull();
    expect(inMemoryFirestore.users.get(uid1)?.subscriptionTier).toBe('free');
  });
});
