import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  onSnapshot,
  runTransaction,
  writeBatch,
  Timestamp,
  serverTimestamp,
} from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from './firebase';
import { User } from 'firebase/auth';
import {
  Motorcycle,
  MaintenanceReminder,
  ServiceRecord,
  UserSubscription,
  PaymentMethod,
  MigrationLedger,
  SyncConflictItem,
  OfflineMutationItem,
  OfflineMutationEntity,
  OfflineMutationAction,
  QuarantinedMutationItem,
  MutationFailureClassification,
} from '../types';
import {
  CONFIRMED_SAMPLE_MOTORCYCLE_IDS,
  CONFIRMED_SAMPLE_REMINDER_IDS,
  CONFIRMED_SAMPLE_SERVICE_RECORD_IDS,
  createImmutablePreMigrationBackup,
  getPreMigrationBackupKey,
  loadMigrationLedger,
  saveMigrationLedger,
  resolveMotorcycleConflict,
  parseTimestampToMillis,
  getOfflineMutationQueue,
  saveOfflineMutationQueue,
  enqueueOfflineMutation,
  removeOfflineMutation,
  classifyMutationFailure,
  quarantineOfflineMutation,
  getQuarantinedMutationQueue,
  requeueQuarantinedMutation,
  recordCloudSyncOperation,
  saveUserScopedMotorcycles,
  saveUserScopedReminders,
  saveUserScopedServiceRecords,
  getKnownCloudVersion,
  getKnownCloudRevision,
  recordKnownCloudVersion,
  removeKnownCloudVersion,
} from './storage';

export interface PaymentSubmission {
  id: string;
  userId: string;
  userEmail: string;
  userName: string;
  bikeModel: string;
  bikePlate?: string;
  paymentMethod: PaymentMethod;
  referenceNumber: string;
  referenceHash: string;
  amountPhp: number;
  status: 'pending_approval' | 'active_pro' | 'rejected';
  submittedAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
  approvedAt?: string;
  approvedBy?: string;
  subscriptionStartDate?: string;
  subscriptionEndDate?: string;
  notes?: string;
}

export function normalizePaymentRef(rawRef: string): string {
  return rawRef.trim().toUpperCase().replace(/[\s-]/g, '');
}

export function normalizePaymentProvider(provider: string): 'gcash' | 'gotyme' {
  const p = provider.trim().toLowerCase();
  if (p === 'gotyme' || p === 'gotyme bank') return 'gotyme';
  return 'gcash';
}

// Compute deterministic SHA-256 hash of provider + normalized reference
export async function computePaymentRefHash(provider: string, normalizedRef: string): Promise<string> {
  const message = `${provider.toLowerCase()}_${normalizedRef.toUpperCase()}`;
  const msgUint8 = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// 1. User Profile & Subscription Sync
export async function syncUserProfile(user: User): Promise<void> {
  const path = `users/${user.uid}`;
  try {
    const userDocRef = doc(db, 'users', user.uid);
    const existing = await getDoc(userDocRef);

    const isVerifiedOwner =
      user.email?.toLowerCase() === 'mustetm7@gmail.com' && user.emailVerified === true;

    if (!existing.exists()) {
      await setDoc(userDocRef, {
        id: user.uid,
        uid: user.uid,
        email: user.email || '',
        displayName: user.displayName || 'MotoCare Rider',
        photoURL: user.photoURL || '',
        role: isVerifiedOwner ? 'admin' : 'rider',
        subscriptionTier: 'free',
        subscriptionStatus: 'free',
        paymentStatus: 'unpaid_free',
        bikeCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // If verified owner, bootstrap admin document
      if (isVerifiedOwner) {
        await setDoc(doc(db, 'admins', user.uid), {
          email: user.email,
          role: 'owner',
          createdAt: new Date().toISOString(),
        });
      }
    } else {
      await updateDoc(userDocRef, {
        displayName: user.displayName || existing.data().displayName || 'MotoCare Rider',
        photoURL: user.photoURL || existing.data().photoURL || '',
        updatedAt: new Date().toISOString(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

// 2. Listen to active User Document (for live subscription status updates)
export function subscribeToUserDoc(
  userId: string,
  onUpdate: (userData: Record<string, unknown> | null) => void
): () => void {
  const path = `users/${userId}`;
  return onSnapshot(
    doc(db, 'users', userId),
    (docSnap) => {
      if (docSnap.exists()) {
        onUpdate(docSnap.data() as Record<string, unknown>);
      } else {
        onUpdate(null);
      }
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, path);
      } catch {
        // Prevent uncaught listener throw in offline mode
      }
    }
  );
}

// 3. Listen to Rider's Own Latest Payment Submission
export function subscribeToUserPaymentSubmission(
  userId: string,
  callback: (submission: PaymentSubmission | null) => void
): () => void {
  const path = 'paymentSubmissions';
  const q = query(collection(db, 'paymentSubmissions'), where('userId', '==', userId));
  return onSnapshot(
    q,
    (snapshot) => {
      const items: PaymentSubmission[] = [];
      snapshot.forEach((docSnap) => {
        items.push(docSnap.data() as PaymentSubmission);
      });
      items.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
      callback(items.length > 0 ? items[0] : null);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch {
        // Prevent uncaught listener throw in offline mode
      }
    }
  );
}

// 4. Submit Payment Reference to Firestore
// Uses deterministic SHA-256 hash reservation (ZERO personal data in reservation doc).
// Does NOT touch user profile document to preserve strict field-level protection.
export async function submitPaymentReferenceToFirestore(data: {
  userId: string;
  userEmail: string;
  userName: string;
  bikeModel: string;
  bikePlate?: string;
  paymentMethod: PaymentMethod;
  referenceNumber: string;
  amountPhp?: number;
}): Promise<string> {
  const cleanMethod = normalizePaymentProvider(data.paymentMethod);
  const cleanRef = normalizePaymentRef(data.referenceNumber);

  if (!cleanRef) {
    throw new Error('Valid payment reference number is required.');
  }

  // Generate deterministic SHA-256 hash
  const refHash = await computePaymentRefHash(cleanMethod, cleanRef);
  const reservationRef = doc(db, 'paymentReferences', refHash);

  const submissionId = `pay_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const submissionRef = doc(db, 'paymentSubmissions', submissionId);

  try {
    await runTransaction(db, async (transaction) => {
      // Step A: Check if this reference reservation exists
      const existingRefSnap = await transaction.get(reservationRef);
      if (existingRefSnap.exists()) {
        throw new Error('This transaction reference number has already been submitted or reserved.');
      }

      const timestamp = new Date().toISOString();

      // Step B: Atomically create minimal non-personal reference reservation
      // Contains ONLY hash id, status: 'reserved', and timestamp (NO PII, NO actual ref, NO uid)
      transaction.set(reservationRef, {
        id: refHash,
        status: 'reserved',
        createdAt: timestamp,
      });

      // Step C: Atomically create payment submission record
      const submission: PaymentSubmission = {
        id: submissionId,
        userId: data.userId,
        userEmail: data.userEmail,
        userName: data.userName,
        bikeModel: data.bikeModel || 'Motorcycle',
        bikePlate: data.bikePlate || '',
        paymentMethod: cleanMethod,
        referenceNumber: data.referenceNumber.trim(),
        referenceHash: refHash,
        amountPhp: 49,
        status: 'pending_approval',
        submittedAt: timestamp,
        notes: `Submitted via ${cleanMethod.toUpperCase()} QRPH. Awaiting owner admin approval.`,
      };

      transaction.set(submissionRef, submission);
    });

    return submissionId;
  } catch (error) {
    if (error instanceof Error && (
      error.message.includes('already been submitted') ||
      error.message.includes('already been registered') ||
      error.message.includes('required')
    )) {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, `paymentSubmissions/${submissionId}`);
  }
}

// 5. Admin: Subscribe to All Payment Submissions Live
export function subscribeToAllPaymentSubmissions(
  callback: (submissions: PaymentSubmission[]) => void
): () => void {
  const path = 'paymentSubmissions';
  return onSnapshot(
    collection(db, 'paymentSubmissions'),
    (snapshot) => {
      const items: PaymentSubmission[] = [];
      snapshot.forEach((docSnap) => {
        items.push(docSnap.data() as PaymentSubmission);
      });
      items.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
      callback(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

// --- Asia/Manila Calendar Month & Expiration Utilities ---

/**
 * Returns the calendar day of the month (1-31) in Asia/Manila (UTC+8).
 */
// --- Asia/Manila Calendar Month & Expiration Utilities ---

/**
 * Safely parses Firestore Timestamp, ISO string, or epoch milliseconds into a Date object.
 */
export function parseExpiryToDate(val: unknown): Date | null {
  if (!val) return null;
  if (typeof (val as any)?.toDate === 'function') {
    return (val as any).toDate();
  }
  if (typeof val === 'string') {
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof val === 'number') {
    return new Date(val);
  }
  return null;
}

/**
 * Returns the calendar day of the month (1-31) in Asia/Manila (UTC+8).
 */
export function getManilaDay(date: Date): number {
  const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
  const manilaDate = new Date(date.getTime() + MANILA_OFFSET_MS);
  return manilaDate.getUTCDate();
}

/**
 * Calculates the next calendar month expiration in Asia/Manila (UTC+8),
 * strictly preserving the original billingAnchorDay across months of varying lengths.
 *
 * Examples:
 * January 31 -> February 28 (or 29) -> March 31
 * January 15 -> February 15 -> March 15
 */
export function calculateNextMonthlyExpiry(baseDate: Date, anchorDay: number): {
  expiryIso: string;
  expiryTimestamp: Timestamp;
  targetUtcDate: Date;
  anchorDay: number;
} {
  const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
  const manilaDate = new Date(baseDate.getTime() + MANILA_OFFSET_MS);

  let year = manilaDate.getUTCFullYear();
  let month = manilaDate.getUTCMonth(); // 0-indexed: 0 = Jan, 11 = Dec
  const hours = manilaDate.getUTCHours();
  const minutes = manilaDate.getUTCMinutes();
  const seconds = manilaDate.getUTCSeconds();
  const ms = manilaDate.getUTCMilliseconds();

  // Advance by 1 calendar month
  month += 1;
  if (month > 11) {
    month = 0;
    year += 1;
  }

  // Determine max days in target month (e.g. 28, 29, 30, or 31)
  const maxDaysInTargetMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  // Clamp target day to max days while preserving persistent anchorDay
  const targetDay = Math.min(anchorDay, maxDaysInTargetMonth);

  // Convert back to UTC
  const targetManilaTimeMs = Date.UTC(year, month, targetDay, hours, minutes, seconds, ms);
  const targetUtcDate = new Date(targetManilaTimeMs - MANILA_OFFSET_MS);

  return {
    expiryIso: targetUtcDate.toISOString(),
    expiryTimestamp: Timestamp.fromDate(targetUtcDate),
    targetUtcDate,
    anchorDay,
  };
}

/**
 * Calculates remaining days until expiration from a Timestamp, Date, or ISO string.
 */
export function calculateDaysRemaining(expiry?: unknown): number {
  const dateObj = parseExpiryToDate(expiry);
  if (!dateObj) return 0;
  const diffMs = dateObj.getTime() - Date.now();
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

// 6. Admin: Approve Pro Access Atomically via runTransaction
// Performs all reads before writes and commits submission + user tier with native Timestamp atomically.
export async function approveProAccessInFirestore(
  submissionId: string,
  riderUserId: string,
  adminIdentifier: string = 'Owner Admin'
): Promise<{
  subscriptionStartDate: string;
  expiryDate: string;
  expiryTimestamp: Timestamp;
  billingAnchorDay: number;
}> {
  const subDocRef = doc(db, 'paymentSubmissions', submissionId);
  const userDocRef = doc(db, 'users', riderUserId);

  try {
    const result = await runTransaction(db, async (transaction) => {
      // Step 1: Read the selected payment submission
      const subSnap = await transaction.get(subDocRef);
      if (!subSnap.exists()) {
        throw new Error('Payment submission not found.');
      }
      const currentSub = subSnap.data() as PaymentSubmission;

      // Step 2: Confirm its status is pending_approval (prevents double approval)
      if (currentSub.status !== 'pending_approval') {
        throw new Error('This payment submission has already been reviewed.');
      }

      // Step 3: Read the corresponding rider's user profile
      const userSnap = await transaction.get(userDocRef);
      const userData = userSnap.exists() ? userSnap.data() : null;

      // Step 4: Calculate the correct calendar-month subscription expiration
      const approvalDate = new Date();
      const approvalIso = approvalDate.toISOString();

      const existingExpiry = parseExpiryToDate(userData?.expiryDate);
      const isCurrentlyPro = userData?.subscriptionTier === 'pro';

      // Early renewal check: currently Pro AND existing expiryDate is strictly in the future
      const isEarlyRenewal =
        isCurrentlyPro && existingExpiry !== null && existingExpiry.getTime() > approvalDate.getTime();

      let subscriptionStartDate: string;
      let expiryIso: string;
      let expiryTimestamp: Timestamp;
      let billingAnchorDay: number;

      if (isEarlyRenewal && existingExpiry) {
        // Early Renewal: preserve original start date and anchor day, extend from existing expiry
        subscriptionStartDate = (userData.subscriptionStartDate as string) || approvalIso;
        billingAnchorDay =
          typeof userData.billingAnchorDay === 'number'
            ? userData.billingAnchorDay
            : getManilaDay(existingExpiry);

        const calc = calculateNextMonthlyExpiry(existingExpiry, billingAnchorDay);
        expiryIso = calc.expiryIso;
        expiryTimestamp = calc.expiryTimestamp;
      } else {
        // First-Time Activation or Late Renewal (expired):
        // Start fresh from approval time, set new billingAnchorDay
        subscriptionStartDate = approvalIso;
        billingAnchorDay = getManilaDay(approvalDate);

        const calc = calculateNextMonthlyExpiry(approvalDate, billingAnchorDay);
        expiryIso = calc.expiryIso;
        expiryTimestamp = calc.expiryTimestamp;
      }

      // Step 5: Update the payment submission (All writes after all reads)
      transaction.update(subDocRef, {
        status: 'active_pro',
        reviewedAt: approvalIso,
        approvedAt: approvalIso,
        reviewedBy: adminIdentifier,
        approvedBy: adminIdentifier,
        subscriptionStartDate,
        subscriptionEndDate: expiryIso,
        notes: `Approved by ${adminIdentifier}. PRO unlocked until ${expiryIso}.`,
      });

      // Step 6: Update the user profile atomically linking this exact payment submission
      // Stores native Firestore Timestamp in expiryDate for server-enforced rules
      if (userSnap.exists()) {
        transaction.update(userDocRef, {
          subscriptionTier: 'pro',
          subscriptionStatus: 'active',
          paymentStatus: 'active_pro',
          subscriptionStartDate,
          expiryDate: expiryTimestamp,
          billingAnchorDay,
          lastPaymentId: submissionId,
          approvedAt: approvalIso,
          approvedBy: adminIdentifier,
          updatedAt: approvalIso,
        });
      } else {
        transaction.set(userDocRef, {
          id: riderUserId,
          uid: riderUserId,
          email: currentSub.userEmail,
          role: 'rider',
          subscriptionTier: 'pro',
          subscriptionStatus: 'active',
          paymentStatus: 'active_pro',
          subscriptionStartDate,
          expiryDate: expiryTimestamp,
          billingAnchorDay,
          bikeCount: 0,
          lastPaymentId: submissionId,
          approvedAt: approvalIso,
          approvedBy: adminIdentifier,
          createdAt: approvalIso,
          updatedAt: approvalIso,
        });
      }

      return {
        subscriptionStartDate,
        expiryDate: expiryIso,
        expiryTimestamp,
        billingAnchorDay,
      };
    });

    return result;
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('already been reviewed') || error.message.includes('not found'))
    ) {
      throw error;
    }
    handleFirestoreError(error, OperationType.UPDATE, `paymentSubmissions/${submissionId}`);
    throw error;
  }
}

// 7. Admin: Revoke Pro Access Atomically via runTransaction
export async function revokeProAccessInFirestore(
  submissionId: string | null,
  riderUserId: string,
  adminIdentifier: string = 'Owner Admin'
): Promise<void> {
  const userDocRef = doc(db, 'users', riderUserId);
  const subDocRef = submissionId ? doc(db, 'paymentSubmissions', submissionId) : null;
  const nowIso = new Date().toISOString();

  try {
    await runTransaction(db, async (transaction) => {
      const userSnap = await transaction.get(userDocRef);
      let subSnap = null;
      if (subDocRef) {
        subSnap = await transaction.get(subDocRef);
      }

      // If a pending submission is associated, mark it rejected
      if (subDocRef && subSnap && subSnap.exists()) {
        const subData = subSnap.data() as PaymentSubmission;
        if (subData.status === 'pending_approval') {
          transaction.update(subDocRef, {
            status: 'rejected',
            reviewedAt: nowIso,
            reviewedBy: adminIdentifier,
            notes: `Rejected / revoked by ${adminIdentifier}.`,
          });
        }
      }

      // Revert user to Free, revoke status, set expiryDate to current timestamp
      if (userSnap.exists()) {
        transaction.update(userDocRef, {
          subscriptionTier: 'free',
          subscriptionStatus: 'revoked',
          paymentStatus: 'unpaid_free',
          expiryDate: Timestamp.now(),
          updatedAt: nowIso,
        });
      }
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${riderUserId}`);
    throw error;
  }
}

// 8. Safe Migration Helper for Existing Records with String ExpiryDates
export async function migrateUserExpiryToTimestamp(userId: string): Promise<boolean> {
  const userDocRef = doc(db, 'users', userId);
  try {
    const snap = await getDoc(userDocRef);
    if (!snap.exists()) return false;
    const data = snap.data();
    if (data.expiryDate && typeof data.expiryDate === 'string') {
      const dateObj = new Date(data.expiryDate);
      if (!isNaN(dateObj.getTime())) {
        await updateDoc(userDocRef, {
          expiryDate: Timestamp.fromDate(dateObj),
          updatedAt: new Date().toISOString(),
        });
        return true;
      }
    }
    return false;
  } catch (error) {
    console.error(`Failed to migrate user ${userId} expiryDate:`, error);
    return false;
  }
}

export interface CounterReconciliationItem {
  userId: string;
  userEmail: string;
  userName: string;
  storedBikeCount: number;
  actualMotorcycleCount: number;
  needsCorrection: boolean;
}

export interface CounterReconciliationReport {
  totalUsersInspected: number;
  totalMotorcyclesFound: number;
  usersRequiringCorrection: number;
  usersAlreadyMatching: number;
  items: CounterReconciliationItem[];
  executedAt: string;
  isDryRun: boolean;
}

export interface TimestampMigrationItem {
  userId: string;
  userEmail: string;
  userName: string;
  subscriptionTier: string;
  subscriptionStatus: string;
  currentType: 'Timestamp' | 'ISO_String' | 'Epoch_Millis' | 'Missing';
  rawExpiryValue: string;
  parsedDateIso: string | null;
  needsMigration: boolean;
}

export interface TimestampMigrationReport {
  totalUsersInspected: number;
  timestampCount: number;
  isoStringCount: number;
  epochMillisCount: number;
  missingCount: number;
  usersRequiringMigration: number;
  items: TimestampMigrationItem[];
  executedAt: string;
  isDryRun: boolean;
}

/**
 * 9. Admin Counter Reconciliation Utilities:
 * Generates a non-destructive DRY RUN report inspecting every registered user
 * and comparing their stored `bikeCount` with their actual `/motorcycles` documents.
 */
export async function generateCounterReconciliationDryRun(): Promise<CounterReconciliationReport> {
  const usersSnap = await getDocs(collection(db, 'users'));
  const motorcyclesSnap = await getDocs(collection(db, 'motorcycles'));

  const bikesByUser = new Map<string, number>();
  motorcyclesSnap.forEach((docSnap) => {
    const data = docSnap.data();
    const ownerId = data.userId;
    if (ownerId) {
      bikesByUser.set(ownerId, (bikesByUser.get(ownerId) || 0) + 1);
    }
  });

  const items: CounterReconciliationItem[] = [];
  let usersRequiringCorrection = 0;
  let usersAlreadyMatching = 0;

  usersSnap.forEach((docSnap) => {
    const data = docSnap.data();
    const userId = docSnap.id;
    const storedCount = typeof data.bikeCount === 'number' ? data.bikeCount : 0;
    const actualCount = bikesByUser.get(userId) || 0;
    const needsCorrection = storedCount !== actualCount;

    if (needsCorrection) {
      usersRequiringCorrection++;
    } else {
      usersAlreadyMatching++;
    }

    items.push({
      userId,
      userEmail: data.email || 'No email',
      userName: data.displayName || data.name || 'Rider',
      storedBikeCount: storedCount,
      actualMotorcycleCount: actualCount,
      needsCorrection,
    });
  });

  return {
    totalUsersInspected: usersSnap.size,
    totalMotorcyclesFound: motorcyclesSnap.size,
    usersRequiringCorrection,
    usersAlreadyMatching,
    items,
    executedAt: new Date().toISOString(),
    isDryRun: true,
  };
}

/**
 * Executes counter reconciliation safely in chunks of 50.
 * Requires explicit administrator confirmation.
 * Catches individual write failures to prevent orphaned updates.
 */
export async function executeCounterReconciliation(
  itemsToFix: CounterReconciliationItem[]
): Promise<{
  successCount: number;
  failedCount: number;
  errors: string[];
}> {
  let successCount = 0;
  let failedCount = 0;
  const errors: string[] = [];

  const targets = itemsToFix.filter((item) => item.needsCorrection);
  const CHUNK_SIZE = 50;

  for (let i = 0; i < targets.length; i += CHUNK_SIZE) {
    const chunk = targets.slice(i, i + CHUNK_SIZE);
    await Promise.all(
      chunk.map(async (item) => {
        try {
          const userDocRef = doc(db, 'users', item.userId);
          await updateDoc(userDocRef, {
            bikeCount: item.actualMotorcycleCount,
            updatedAt: new Date().toISOString(),
          });
          successCount++;
        } catch (err: any) {
          failedCount++;
          errors.push(`User ${item.userId}: ${err?.message || 'Update failed'}`);
        }
      })
    );
  }

  return { successCount, failedCount, errors };
}

/**
 * 10. Admin Timestamp Migration Utilities:
 * Generates an inspection report categorizing the exact storage format of expiryDate across all users.
 */
export async function generateTimestampMigrationDryRun(): Promise<TimestampMigrationReport> {
  const usersSnap = await getDocs(collection(db, 'users'));
  const items: TimestampMigrationItem[] = [];

  let timestampCount = 0;
  let isoStringCount = 0;
  let epochMillisCount = 0;
  let missingCount = 0;
  let usersRequiringMigration = 0;

  usersSnap.forEach((docSnap) => {
    const data = docSnap.data();
    const rawVal = data.expiryDate;
    let currentType: 'Timestamp' | 'ISO_String' | 'Epoch_Millis' | 'Missing' = 'Missing';
    let rawString = 'None';
    let parsedIso: string | null = null;

    if (!rawVal) {
      currentType = 'Missing';
      missingCount++;
    } else if (typeof (rawVal as any)?.toDate === 'function' || ('seconds' in rawVal && 'nanoseconds' in rawVal)) {
      currentType = 'Timestamp';
      timestampCount++;
      rawString = `Timestamp(s=${rawVal.seconds})`;
      parsedIso = (rawVal as any).toDate().toISOString();
    } else if (typeof rawVal === 'string') {
      currentType = 'ISO_String';
      isoStringCount++;
      rawString = rawVal;
      const d = new Date(rawVal);
      parsedIso = !isNaN(d.getTime()) ? d.toISOString() : null;
    } else if (typeof rawVal === 'number') {
      currentType = 'Epoch_Millis';
      epochMillisCount++;
      rawString = String(rawVal);
      const d = new Date(rawVal);
      parsedIso = !isNaN(d.getTime()) ? d.toISOString() : null;
    }

    const needsMigration = (currentType === 'ISO_String' || currentType === 'Epoch_Millis') && parsedIso !== null;
    if (needsMigration) {
      usersRequiringMigration++;
    }

    items.push({
      userId: docSnap.id,
      userEmail: data.email || 'No email',
      userName: data.displayName || data.name || 'Rider',
      subscriptionTier: data.subscriptionTier || 'free',
      subscriptionStatus: data.subscriptionStatus || 'free',
      currentType,
      rawExpiryValue: rawString,
      parsedDateIso: parsedIso,
      needsMigration,
    });
  });

  return {
    totalUsersInspected: usersSnap.size,
    timestampCount,
    isoStringCount,
    epochMillisCount,
    missingCount,
    usersRequiringMigration,
    items,
    executedAt: new Date().toISOString(),
    isDryRun: true,
  };
}

/**
 * Executes timestamp migration for identified legacy records.
 * Converts ISO strings / epoch millis to native Firestore Timestamp without changing dates or tiers.
 */
export async function executeTimestampMigration(
  itemsToMigrate: TimestampMigrationItem[]
): Promise<{
  successCount: number;
  failedCount: number;
  errors: string[];
}> {
  let successCount = 0;
  let failedCount = 0;
  const errors: string[] = [];

  const targets = itemsToMigrate.filter((item) => item.needsMigration && item.parsedDateIso);
  const CHUNK_SIZE = 50;

  for (let i = 0; i < targets.length; i += CHUNK_SIZE) {
    const chunk = targets.slice(i, i + CHUNK_SIZE);
    await Promise.all(
      chunk.map(async (item) => {
        try {
          const userDocRef = doc(db, 'users', item.userId);
          const dateObj = new Date(item.parsedDateIso!);
          await updateDoc(userDocRef, {
            expiryDate: Timestamp.fromDate(dateObj),
            updatedAt: new Date().toISOString(),
          });
          successCount++;
        } catch (err: any) {
          failedCount++;
          errors.push(`User ${item.userId}: ${err?.message || 'Migration failed'}`);
        }
      })
    );
  }

  return { successCount, failedCount, errors };
}

/**
 * Single User Admin Counter Reconciliation Helper
 */
export async function reconcileUserBikeCount(userId: string): Promise<number> {
  const userDocRef = doc(db, 'users', userId);
  const motorcyclesQuery = query(collection(db, 'motorcycles'), where('userId', '==', userId));

  const motorcyclesSnap = await getDocs(motorcyclesQuery);
  const actualCount = motorcyclesSnap.size;

  await updateDoc(userDocRef, {
    bikeCount: actualCount,
    updatedAt: new Date().toISOString(),
  });

  return actualCount;
}

export async function reconcileAllUsersBikeCounts(): Promise<{ userId: string; actualCount: number }[]> {
  const report = await generateCounterReconciliationDryRun();
  const toFix = report.items.filter((item) => item.needsCorrection);
  await executeCounterReconciliation(toFix);
  return report.items.map((it) => ({ userId: it.userId, actualCount: it.actualMotorcycleCount }));
}

// 10. Server-Enforced Motorcycle Garage Persistence (Atomic Quota Enforcement)
export function canCreateMotorcycleInGarage(params: {
  authUser: { uid?: string; email?: string | null; emailVerified?: boolean } | null | undefined;
  targetUserId: string;
  userDocData: Record<string, unknown> | null | undefined;
  currentCount: number;
  nowMs?: number;
}): boolean {
  const { authUser, targetUserId, userDocData, currentCount, nowMs = Date.now() } = params;

  const isVerifiedOwner =
    Boolean(authUser) &&
    authUser?.uid === targetUserId &&
    authUser?.email?.toLowerCase() === 'mustetm7@gmail.com' &&
    authUser?.emailVerified === true;

  const isActivePaidPro =
    Boolean(userDocData) &&
    userDocData?.subscriptionTier === 'pro' &&
    userDocData?.subscriptionStatus !== 'revoked' &&
    userDocData?.subscriptionStatus !== 'expired' &&
    userDocData?.subscriptionStatus !== 'free' &&
    (() => {
      const exp = parseExpiryToDate(userDocData?.expiryDate);
      return exp !== null && exp.getTime() > nowMs;
    })();

  const hasProAccess = isVerifiedOwner || isActivePaidPro;
  return hasProAccess || currentCount < 1;
}

export function normalizeFirestoreTimestampToIso(val: unknown): string | undefined {
  if (!val) return undefined;
  if (typeof (val as any)?.toDate === 'function') {
    return (val as any).toDate().toISOString();
  }
  if (typeof val === 'object' && val !== null && 'seconds' in val && typeof (val as any).seconds === 'number') {
    const nanos = typeof (val as any).nanoseconds === 'number' ? (val as any).nanoseconds : 0;
    return new Date((val as any).seconds * 1000 + Math.floor(nanos / 1_000_000)).toISOString();
  }
  if (typeof val === 'string') {
    const d = new Date(val);
    return isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  if (typeof val === 'number') {
    return new Date(val).toISOString();
  }
  return undefined;
}

export function sanitizeFirestorePayload<T extends Record<string, any>>(obj: T): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    if (key === 'timestampSource') continue;
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Timestamp) && typeof (value as any)?.toDate !== 'function') {
      result[key] = sanitizeFirestorePayload(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

let lastIssuedFirestoreTimestampMs = 0;

/**
 * Generates a strictly monotonic Firestore Timestamp so rapid consecutive writes
 * (including multi-device unit tests within the same millisecond) always produce
 * distinct, comparable `updatedAt` versions.
 */
export function nextMonotonicTimestamp(): Timestamp {
  const nowMs = Date.now();
  const nextMs = nowMs > lastIssuedFirestoreTimestampMs ? nowMs : lastIssuedFirestoreTimestampMs + 1;
  lastIssuedFirestoreTimestampMs = nextMs;
  if (typeof (Timestamp as any)?.fromDate === 'function') {
    return Timestamp.fromDate(new Date(nextMs));
  }
  return Timestamp.now();
}

export interface WriteConcurrencyOptions {
  /**
   * When true, enforces strict optimistic concurrency control inside the Firestore transaction.
   */
  enforceVersionCheck?: boolean;
  /**
   * The authoritative cloud `updatedAt` ISO timestamp that the mutation was based upon.
   */
  baseCloudUpdatedAt?: string | null;
  /**
   * The authoritative integer revision (`cloudVersion`) that the mutation was based upon.
   */
  baseCloudVersion?: number | null;
  /**
   * True when the mutation was created for a new document expected not to exist in Firestore.
   */
  expectedCloudAbsent?: boolean;
  /**
   * True when a legacy queued item lacks a trustworthy base cloud version.
   */
  baseVersionUntrusted?: boolean;
}

export interface ConcurrencyConflictDetails {
  entity: OfflineMutationEntity;
  targetId: string;
  action: OfflineMutationAction;
  baseCloudUpdatedAt: string | null;
  currentCloudUpdatedAt: string | null;
  baseCloudVersion?: number | null;
  currentCloudVersion?: number | null;
  reason: string;
}

export const SAFE_BATCH_TRANSACTION_CHUNK_SIZE = 8;
export const SAFE_CLEANUP_DELETE_BATCH_CHUNK_SIZE = 50;

/**
 * Computes the next integer `cloudVersion` for an existing Firestore document:
 * - If `existingData` has no `cloudVersion` field (`!('cloudVersion' in existingData)` or `existingData.cloudVersion === undefined`):
 *   returns `1` (legacy document without `cloudVersion` safely receives version `1` on its first update).
 * - If `existingData.cloudVersion` is a valid positive integer (`Number.isInteger(v) && v >= 1`):
 *   returns `existingData.cloudVersion + 1`.
 * - If `existingData.cloudVersion` is present but malformed (`null`, string, float, `NaN`, `<= 0`):
 *   throws a `PERMISSION_DENIED` error to fail safely rather than silently inventing a revision.
 */
export function resolveNextCloudVersionForUpdate(
  existingData: Record<string, any> | undefined | null,
  entity: OfflineMutationEntity,
  targetId: string
): number {
  if (!existingData || !('cloudVersion' in existingData) || existingData.cloudVersion === undefined) {
    return 1;
  }
  const raw = existingData.cloudVersion;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1) {
    throw new Error(
      `PERMISSION_DENIED: Malformed cloudVersion (${String(raw)}) on existing ${entity} (${targetId}). Refusing to invent revision.`
    );
  }
  return raw + 1;
}

export function createConcurrencyConflictError(details: ConcurrencyConflictDetails): Error {
  const err = new Error(
    `CONCURRENCY_CONFLICT: ${details.reason} [base=${details.baseCloudUpdatedAt ?? 'none'}(v=${details.baseCloudVersion ?? 'none'}), cloud=${details.currentCloudUpdatedAt ?? 'none'}(v=${details.currentCloudVersion ?? 'none'})]`
  );
  (err as any).conflictDetails = details;
  return err;
}

/**
 * Validates inside an active Firestore transaction that the cloud document's current
 * `updatedAt` (strict ISO `&&` epoch-millisecond equality) and transactional integer
 * `cloudVersion` match the mutation's base version.
 * Throws a `CONCURRENCY_CONFLICT` Error to abort the transaction if the cloud document
 * was modified by another device or if the item lacks a trustworthy base version.
 */
export function assertTransactionVersionMatches(params: {
  entity: OfflineMutationEntity;
  targetId: string;
  action: OfflineMutationAction;
  existingData: Record<string, any>;
  concurrency: WriteConcurrencyOptions;
}): void {
  const { entity, targetId, action, existingData, concurrency } = params;
  const cloudUpdatedIso =
    normalizeFirestoreTimestampToIso(existingData?.updatedAt) ||
    normalizeFirestoreTimestampToIso(existingData?.createdAt) ||
    null;
  const cloudUpdatedMs =
    parseTimestampToMillis(existingData?.updatedAt) ??
    parseTimestampToMillis(existingData?.createdAt);
  if (
    existingData &&
    'cloudVersion' in existingData &&
    existingData.cloudVersion !== undefined &&
    (typeof existingData.cloudVersion !== 'number' ||
      !Number.isInteger(existingData.cloudVersion) ||
      existingData.cloudVersion < 1)
  ) {
    throw new Error(
      `PERMISSION_DENIED: Malformed cloudVersion (${String(existingData.cloudVersion)}) on existing ${entity} (${targetId}).`
    );
  }
  const cloudVersion =
    typeof existingData?.cloudVersion === 'number' &&
    Number.isInteger(existingData.cloudVersion) &&
    existingData.cloudVersion >= 1
      ? existingData.cloudVersion
      : null;

  // 1. Mutation expected document NOT to exist in Firestore, yet it already exists
  if (
    concurrency.expectedCloudAbsent === true &&
    !concurrency.baseCloudUpdatedAt &&
    concurrency.baseCloudVersion == null
  ) {
    throw createConcurrencyConflictError({
      entity,
      targetId,
      action,
      baseCloudUpdatedAt: null,
      currentCloudUpdatedAt: cloudUpdatedIso,
      baseCloudVersion: null,
      currentCloudVersion: cloudVersion,
      reason: `Target ${entity} (${targetId}) was expected to be a newly created document, but already exists in Firestore (version ${cloudUpdatedIso || 'unknown'}).`,
    });
  }

  // 2. Legacy or untrusted queue item lacking a trustworthy base version
  if (
    concurrency.baseVersionUntrusted ||
    (!concurrency.baseCloudUpdatedAt && typeof concurrency.baseCloudVersion !== 'number')
  ) {
    throw createConcurrencyConflictError({
      entity,
      targetId,
      action,
      baseCloudUpdatedAt: null,
      currentCloudUpdatedAt: cloudUpdatedIso,
      baseCloudVersion: concurrency.baseCloudVersion ?? null,
      currentCloudVersion: cloudVersion,
      reason: `Queued ${action} on ${entity} (${targetId}) lacks a trustworthy baseCloudUpdatedAt while the cloud document exists (version ${cloudUpdatedIso || 'unknown'}). Conflict review required.`,
    });
  }

  // 3. Compare transactional integer cloudVersion revision when present (clock-skew independent)
  if (typeof concurrency.baseCloudVersion === 'number' && cloudVersion !== null) {
    if (cloudVersion !== concurrency.baseCloudVersion) {
      throw createConcurrencyConflictError({
        entity,
        targetId,
        action,
        baseCloudUpdatedAt: concurrency.baseCloudUpdatedAt ?? null,
        currentCloudUpdatedAt: cloudUpdatedIso,
        baseCloudVersion: concurrency.baseCloudVersion,
        currentCloudVersion: cloudVersion,
        reason: `Cloud ${entity} (${targetId}) was modified by another device (cloud revision v${cloudVersion} !== mutation base revision v${concurrency.baseCloudVersion}, cloud timestamp: ${cloudUpdatedIso || 'unknown'}).`,
      });
    }
  }

  // 4. Compare current cloud timestamp against baseCloudUpdatedAt using strict && equality
  if (concurrency.baseCloudUpdatedAt) {
    const baseIso = concurrency.baseCloudUpdatedAt;
    const baseMs = parseTimestampToMillis(baseIso);

    const exactIsoMatch = cloudUpdatedIso !== null && cloudUpdatedIso === baseIso;
    const exactMillisMatch =
      cloudUpdatedMs !== null && baseMs !== null && cloudUpdatedMs === baseMs;

    if (!exactIsoMatch || !exactMillisMatch) {
      throw createConcurrencyConflictError({
        entity,
        targetId,
        action,
        baseCloudUpdatedAt: baseIso,
        currentCloudUpdatedAt: cloudUpdatedIso,
        baseCloudVersion: concurrency.baseCloudVersion ?? null,
        currentCloudVersion: cloudVersion,
        reason: `Cloud ${entity} (${targetId}) was modified by another device (cloud version: ${cloudUpdatedIso || 'unknown'}, mutation base version: ${baseIso}).`,
      });
    }
  }
}

export function normalizeMotorcycleFromFirestore(
  raw: Record<string, any>,
  hasPendingWrites: boolean = false
): Motorcycle {
  const createdIso = normalizeFirestoreTimestampToIso(raw.createdAt);
  const updatedIso = normalizeFirestoreTimestampToIso(raw.updatedAt);
  const cloudVersion =
    typeof raw.cloudVersion === 'number' &&
    Number.isInteger(raw.cloudVersion) &&
    raw.cloudVersion >= 1
      ? raw.cloudVersion
      : undefined;
  if (!hasPendingWrites && raw.userId && raw.id && (updatedIso || createdIso)) {
    recordKnownCloudVersion(raw.userId, 'motorcycle', raw.id, updatedIso || createdIso, cloudVersion);
  }
  return {
    ...(raw as Motorcycle),
    createdAt: createdIso,
    updatedAt: updatedIso,
    ...(cloudVersion !== undefined ? { cloudVersion } : {}),
    timestampSource: hasPendingWrites ? 'client_pending' : 'server',
  };
}

export function normalizeReminderFromFirestore(
  raw: Record<string, any>,
  hasPendingWrites: boolean = false
): MaintenanceReminder {
  const createdIso = normalizeFirestoreTimestampToIso(raw.createdAt);
  const updatedIso = normalizeFirestoreTimestampToIso(raw.updatedAt);
  const cloudVersion =
    typeof raw.cloudVersion === 'number' &&
    Number.isInteger(raw.cloudVersion) &&
    raw.cloudVersion >= 1
      ? raw.cloudVersion
      : undefined;
  if (!hasPendingWrites && raw.userId && raw.id && (updatedIso || createdIso)) {
    recordKnownCloudVersion(raw.userId, 'reminder', raw.id, updatedIso || createdIso, cloudVersion);
  }
  return {
    ...(raw as MaintenanceReminder),
    createdAt: createdIso,
    updatedAt: updatedIso,
    ...(cloudVersion !== undefined ? { cloudVersion } : {}),
    timestampSource: hasPendingWrites ? 'client_pending' : 'server',
  };
}

export function normalizeServiceRecordFromFirestore(
  raw: Record<string, any>,
  hasPendingWrites: boolean = false
): ServiceRecord {
  const createdIso = normalizeFirestoreTimestampToIso(raw.createdAt);
  const updatedIso = normalizeFirestoreTimestampToIso(raw.updatedAt);
  const cloudVersion =
    typeof raw.cloudVersion === 'number' &&
    Number.isInteger(raw.cloudVersion) &&
    raw.cloudVersion >= 1
      ? raw.cloudVersion
      : undefined;
  if (!hasPendingWrites && raw.userId && raw.id && (updatedIso || createdIso)) {
    recordKnownCloudVersion(raw.userId, 'serviceRecord', raw.id, updatedIso || createdIso, cloudVersion);
  }
  return {
    ...(raw as ServiceRecord),
    createdAt: createdIso,
    updatedAt: updatedIso,
    ...(cloudVersion !== undefined ? { cloudVersion } : {}),
    timestampSource: hasPendingWrites ? 'client_pending' : 'server',
  };
}

export async function saveMotorcycleToFirestore(
  bike: Motorcycle,
  userId: string,
  concurrency?: WriteConcurrencyOptions
): Promise<void> {
  if (!userId) {
    throw new Error('AUTH_REQUIRED: You must be signed in to save a motorcycle to cloud storage.');
  }
  if (CONFIRMED_SAMPLE_MOTORCYCLE_IDS.has(bike.id)) {
    return;
  }

  const bikeDocRef = doc(db, 'motorcycles', bike.id);
  const userDocRef = doc(db, 'users', userId);
  const cleanPayload = sanitizeFirestorePayload(bike);
  let committedIso: string | null = null;
  let committedVersion = 1;

  try {
    await runTransaction(db, async (transaction) => {
      const bikeSnap = await transaction.get(bikeDocRef);
      const userSnap = await transaction.get(userDocRef);
      const nowTs = nextMonotonicTimestamp();
      const nowIso = nowTs.toDate().toISOString();
      committedIso = nowIso;

      if (bikeSnap.exists()) {
        const existingData = bikeSnap.data() || {};
        if (existingData.userId && existingData.userId !== userId) {
          throw new Error('PERMISSION_DENIED: Cannot modify a motorcycle owned by another user.');
        }
        if (concurrency?.enforceVersionCheck) {
          assertTransactionVersionMatches({
            entity: 'motorcycle',
            targetId: bike.id,
            action: 'upsert',
            existingData,
            concurrency,
          });
        }
        committedVersion = resolveNextCloudVersionForUpdate(existingData, 'motorcycle', bike.id);
        // Updating existing motorcycle does NOT consume additional quota
        transaction.update(bikeDocRef, {
          ...cleanPayload,
          id: bike.id,
          userId,
          updatedAt: nowTs,
          cloudVersion: committedVersion,
        });
      } else {
        if (concurrency?.enforceVersionCheck && concurrency.baseVersionUntrusted) {
          throw createConcurrencyConflictError({
            entity: 'motorcycle',
            targetId: bike.id,
            action: 'upsert',
            baseCloudUpdatedAt: null,
            currentCloudUpdatedAt: null,
            baseCloudVersion: null,
            currentCloudVersion: null,
            reason: `Legacy queued motorcycle mutation (${bike.id}) is missing a trustworthy base version. Conflict review required.`,
          });
        }
        // Creating NEW motorcycle: Verify quota before writing
        const userDocData = userSnap.exists() ? (userSnap.data() as Record<string, unknown>) : null;
        const currentCount =
          userSnap.exists() && typeof userSnap.data()?.bikeCount === 'number'
            ? userSnap.data().bikeCount
            : 0;

        const allowed = canCreateMotorcycleInGarage({
          authUser: auth.currentUser || { uid: userId },
          targetUserId: userId,
          userDocData,
          currentCount,
        });

        if (!allowed) {
          throw new Error('QUOTA_EXCEEDED: Free plan is limited to 1 motorcycle. Upgrade to Pro for unlimited garage bikes.');
        }

        committedVersion = 1;
        transaction.set(bikeDocRef, {
          ...cleanPayload,
          id: bike.id,
          userId,
          createdAt: nowTs,
          updatedAt: nowTs,
          cloudVersion: committedVersion,
        });

        if (userSnap.exists()) {
          transaction.update(userDocRef, {
            bikeCount: currentCount + 1,
            lastBikeId: bike.id,
            lastBikeAction: 'create',
            updatedAt: nowIso,
          });
        }
      }
    });
    if (committedIso) {
      recordKnownCloudVersion(userId, 'motorcycle', bike.id, committedIso, committedVersion);
    }
    recordCloudSyncOperation({
      userId,
      status: 'success',
      operation: 'upsert_motorcycle',
      entity: 'motorcycle',
      targetId: bike.id,
      detail: `${bike.brand} ${bike.model} (${bike.odometer.toLocaleString()} km)`,
    });
  } catch (error) {
    recordCloudSyncOperation({
      userId,
      status: 'failed',
      operation: 'upsert_motorcycle',
      entity: 'motorcycle',
      targetId: bike.id,
      detail: `${bike.brand} ${bike.model}`,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    if (
      error instanceof Error &&
      (error.message.includes('QUOTA_EXCEEDED') ||
        error.message.includes('PERMISSION_DENIED') ||
        error.message.includes('CONCURRENCY_CONFLICT'))
    ) {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, `motorcycles/${bike.id}`);
  }
}

/**
 * Targeted incremental update for odometer, license plate, or GPS ride completion.
 * Executes inside a Firestore transaction to verify ownership, baseCloudUpdatedAt, and cloudVersion.
 */
export async function updateMotorcycleFieldsInFirestore(
  bikeId: string,
  userId: string,
  fields: Partial<Pick<Motorcycle, 'odometer' | 'licensePlate' | 'nickname' | 'notes' | 'customColorBadge'>>,
  concurrency?: WriteConcurrencyOptions
): Promise<void> {
  if (!userId || !bikeId || CONFIRMED_SAMPLE_MOTORCYCLE_IDS.has(bikeId)) return;
  const bikeDocRef = doc(db, 'motorcycles', bikeId);
  const cleanFields = sanitizeFirestorePayload(fields);
  let committedIso: string | null = null;
  let committedVersion = 1;

  try {
    await runTransaction(db, async (transaction) => {
      const bikeSnap = await transaction.get(bikeDocRef);
      if (!bikeSnap.exists()) {
        if (concurrency?.enforceVersionCheck) {
          throw createConcurrencyConflictError({
            entity: 'motorcycle',
            targetId: bikeId,
            action: 'update_fields',
            baseCloudUpdatedAt: concurrency.baseCloudUpdatedAt ?? null,
            currentCloudUpdatedAt: null,
            baseCloudVersion: concurrency.baseCloudVersion ?? null,
            currentCloudVersion: null,
            reason: `Target motorcycle (${bikeId}) no longer exists in Firestore (deleted on another device).`,
          });
        }
        throw new Error(`NOT_FOUND: motorcycles/${bikeId}`);
      }

      const existingData = bikeSnap.data() || {};
      if (existingData.userId && existingData.userId !== userId) {
        throw new Error('PERMISSION_DENIED: Cannot modify a motorcycle owned by another user.');
      }

      if (concurrency?.enforceVersionCheck) {
        assertTransactionVersionMatches({
          entity: 'motorcycle',
          targetId: bikeId,
          action: 'update_fields',
          existingData,
          concurrency,
        });
      }

      committedVersion = resolveNextCloudVersionForUpdate(existingData, 'motorcycle', bikeId);

      const nowTs = nextMonotonicTimestamp();
      committedIso = nowTs.toDate().toISOString();
      transaction.update(bikeDocRef, {
        ...cleanFields,
        updatedAt: nowTs,
        cloudVersion: committedVersion,
      });
    });

    if (committedIso) {
      recordKnownCloudVersion(userId, 'motorcycle', bikeId, committedIso, committedVersion);
    }
    recordCloudSyncOperation({
      userId,
      status: 'success',
      operation: 'update_motorcycle_fields',
      entity: 'motorcycle',
      targetId: bikeId,
      detail: Object.keys(cleanFields).join(', '),
    });
  } catch (error) {
    recordCloudSyncOperation({
      userId,
      status: 'failed',
      operation: 'update_motorcycle_fields',
      entity: 'motorcycle',
      targetId: bikeId,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    if (
      error instanceof Error &&
      (error.message.includes('PERMISSION_DENIED') ||
        error.message.includes('CONCURRENCY_CONFLICT'))
    ) {
      throw error;
    }
    handleFirestoreError(error, OperationType.UPDATE, `motorcycles/${bikeId}`);
  }
}

/**
 * Deletes a motorcycle from the active garage and decrements the user's bikeCount.
 * PHASE 3 DATA RETENTION INVARIANT:
 * - Service records (/serviceRecords) are PRESERVED by default even when a motorcycle is sold or removed.
 * - Maintenance reminders (/reminders) for the removed bike are cleaned up by default unless deleteReminders === false.
 * - Permanent service-history deletion requires explicit deleteServiceHistoryConfirmed === true.
 */
export async function deleteMotorcycleFromFirestore(
  bikeId: string,
  userId?: string,
  options?: {
    deleteReminders?: boolean;
    deleteServiceHistoryConfirmed?: boolean;
    concurrency?: WriteConcurrencyOptions;
  }
): Promise<void> {
  const currentUserId = userId || auth.currentUser?.uid;
  if (!currentUserId) {
    throw new Error('AUTH_REQUIRED: You must be logged in to delete a motorcycle.');
  }

  const deleteReminders = options?.deleteReminders ?? true;
  const deleteServiceHistoryConfirmed = options?.deleteServiceHistoryConfirmed ?? false;
  const concurrency = options?.concurrency;

  const bikeDocRef = doc(db, 'motorcycles', bikeId);
  const userDocRef = doc(db, 'users', currentUserId);

  try {
    await runTransaction(db, async (transaction) => {
      const bikeSnap = await transaction.get(bikeDocRef);
      const userSnap = await transaction.get(userDocRef);

      if (bikeSnap.exists()) {
        const existingData = bikeSnap.data() || {};
        const existingOwner = existingData.userId;
        if (existingOwner && existingOwner !== currentUserId) {
          throw new Error('PERMISSION_DENIED: Cannot delete a motorcycle owned by another user.');
        }

        if (concurrency?.enforceVersionCheck) {
          assertTransactionVersionMatches({
            entity: 'motorcycle',
            targetId: bikeId,
            action: 'delete',
            existingData,
            concurrency,
          });
        }

        const currentCount =
          userSnap.exists() && typeof userSnap.data()?.bikeCount === 'number'
            ? userSnap.data().bikeCount
            : 1;

        const newCount = Math.max(0, currentCount - 1);
        const nowIso = nextMonotonicTimestamp().toDate().toISOString();

        transaction.delete(bikeDocRef);
        if (userSnap.exists()) {
          transaction.update(userDocRef, {
            bikeCount: newCount,
            lastBikeId: bikeId,
            lastBikeAction: 'delete',
            updatedAt: nowIso,
          });
        }
      }
    });

    removeKnownCloudVersion(currentUserId, 'motorcycle', bikeId);

    // Clean up active reminders for this removed bike in safe chunks
    if (deleteReminders) {
      const remQuery = query(
        collection(db, 'reminders'),
        where('userId', '==', currentUserId)
      );
      const remSnap = await getDocs(remQuery);
      const matchingDocs = remSnap.docs.filter((d) => d.data()?.bikeId === bikeId);
      for (let i = 0; i < matchingDocs.length; i += SAFE_CLEANUP_DELETE_BATCH_CHUNK_SIZE) {
        const chunk = matchingDocs.slice(i, i + SAFE_CLEANUP_DELETE_BATCH_CHUNK_SIZE);
        const batch = writeBatch(db);
        chunk.forEach((d) => {
          batch.delete(d.ref);
          removeKnownCloudVersion(currentUserId, 'reminder', d.id);
        });
        await batch.commit();
      }
    }

    // ONLY delete service records if the user explicitly confirmed permanent history deletion (chunked safely)
    if (deleteServiceHistoryConfirmed) {
      const recQuery = query(
        collection(db, 'serviceRecords'),
        where('userId', '==', currentUserId)
      );
      const recSnap = await getDocs(recQuery);
      const matchingRecs = recSnap.docs.filter((d) => d.data()?.bikeId === bikeId);
      for (let i = 0; i < matchingRecs.length; i += SAFE_CLEANUP_DELETE_BATCH_CHUNK_SIZE) {
        const chunk = matchingRecs.slice(i, i + SAFE_CLEANUP_DELETE_BATCH_CHUNK_SIZE);
        const batch = writeBatch(db);
        chunk.forEach((d) => {
          batch.delete(d.ref);
          removeKnownCloudVersion(currentUserId, 'serviceRecord', d.id);
        });
        await batch.commit();
      }
    }
    recordCloudSyncOperation({
      userId: currentUserId,
      status: 'success',
      operation: 'delete_motorcycle',
      entity: 'motorcycle',
      targetId: bikeId,
      detail: deleteServiceHistoryConfirmed ? 'Deleted with history' : 'Removed bike (history preserved)',
    });
  } catch (error) {
    recordCloudSyncOperation({
      userId: currentUserId,
      status: 'failed',
      operation: 'delete_motorcycle',
      entity: 'motorcycle',
      targetId: bikeId,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    if (
      error instanceof Error &&
      (error.message.includes('PERMISSION_DENIED') ||
        error.message.includes('CONCURRENCY_CONFLICT'))
    ) {
      throw error;
    }
    handleFirestoreError(error, OperationType.DELETE, `motorcycles/${bikeId}`);
  }
}

export async function fetchUserMotorcyclesOnce(userId: string): Promise<Motorcycle[]> {
  if (!userId) return [];
  const path = 'motorcycles';
  try {
    const q = query(collection(db, 'motorcycles'), where('userId', '==', userId));
    const snap = await getDocs(q);
    const items: Motorcycle[] = [];
    snap.forEach((docSnap) => {
      items.push(normalizeMotorcycleFromFirestore({ id: docSnap.id, ...docSnap.data() }));
    });
    return items;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export function subscribeToUserMotorcycles(
  userId: string,
  callback: (bikes: Motorcycle[]) => void,
  onError?: (err: unknown) => void
): () => void {
  const path = 'motorcycles';
  const q = query(collection(db, 'motorcycles'), where('userId', '==', userId));
  return onSnapshot(
    q,
    (snapshot) => {
      const fromCache = Boolean((snapshot as any)?.metadata?.fromCache);
      const bikes: Motorcycle[] = [];
      snapshot.forEach((docSnap) => {
        const hasPending =
          Boolean((docSnap as any)?.metadata?.hasPendingWrites) || fromCache;
        bikes.push(
          normalizeMotorcycleFromFirestore(
            { id: docSnap.id, ...docSnap.data() },
            hasPending
          )
        );
      });
      callback(bikes);
    },
    (error) => {
      onError?.(error);
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch {
        // Prevent uncaught listener throw after reporting
      }
    }
  );
}

// ============================================================================
// 11. Maintenance Reminders Firestore CRUD & Real-Time Subscription
// ============================================================================

export async function saveReminderToFirestore(
  reminder: MaintenanceReminder,
  userId: string,
  concurrency?: WriteConcurrencyOptions
): Promise<void> {
  if (!userId || !reminder?.id || CONFIRMED_SAMPLE_REMINDER_IDS.has(reminder.id)) return;
  const remDocRef = doc(db, 'reminders', reminder.id);
  const cleanPayload = sanitizeFirestorePayload(reminder);
  let committedIso: string | null = null;
  let committedVersion = 1;

  try {
    await runTransaction(db, async (transaction) => {
      const existing = await transaction.get(remDocRef);
      const nowTs = nextMonotonicTimestamp();
      committedIso = nowTs.toDate().toISOString();

      if (existing.exists()) {
        const existingData = existing.data() || {};
        if (existingData.userId && existingData.userId !== userId) {
          throw new Error('PERMISSION_DENIED: Cannot modify a reminder owned by another user.');
        }
        if (concurrency?.enforceVersionCheck) {
          assertTransactionVersionMatches({
            entity: 'reminder',
            targetId: reminder.id,
            action: 'upsert',
            existingData,
            concurrency,
          });
        }
        committedVersion = resolveNextCloudVersionForUpdate(existingData, 'reminder', reminder.id);
        transaction.update(remDocRef, {
          ...cleanPayload,
          id: reminder.id,
          userId,
          updatedAt: nowTs,
          cloudVersion: committedVersion,
        });
      } else {
        if (concurrency?.enforceVersionCheck && concurrency.baseVersionUntrusted) {
          throw createConcurrencyConflictError({
            entity: 'reminder',
            targetId: reminder.id,
            action: 'upsert',
            baseCloudUpdatedAt: null,
            currentCloudUpdatedAt: null,
            baseCloudVersion: null,
            currentCloudVersion: null,
            reason: `Legacy queued reminder mutation (${reminder.id}) is missing a trustworthy base version. Conflict review required.`,
          });
        }
        committedVersion = 1;
        transaction.set(remDocRef, {
          ...cleanPayload,
          id: reminder.id,
          userId,
          createdAt: nowTs,
          updatedAt: nowTs,
          cloudVersion: committedVersion,
        });
      }
    });

    if (committedIso) {
      recordKnownCloudVersion(userId, 'reminder', reminder.id, committedIso, committedVersion);
    }
    recordCloudSyncOperation({
      userId,
      status: 'success',
      operation: 'upsert_reminder',
      entity: 'reminder',
      targetId: reminder.id,
      detail: reminder.title,
    });
  } catch (error) {
    recordCloudSyncOperation({
      userId,
      status: 'failed',
      operation: 'upsert_reminder',
      entity: 'reminder',
      targetId: reminder.id,
      detail: reminder.title,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    if (
      error instanceof Error &&
      (error.message.includes('PERMISSION_DENIED') ||
        error.message.includes('CONCURRENCY_CONFLICT'))
    ) {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, `reminders/${reminder.id}`);
  }
}

export async function saveRemindersBatchToFirestore(
  reminders: MaintenanceReminder[],
  userId: string,
  options?:
    | {
        concurrencyById?: Record<string, WriteConcurrencyOptions>;
        defaultConcurrency?: WriteConcurrencyOptions;
        onChunkCommitted?: (committedIds: string[]) => void;
      }
    | Record<string, WriteConcurrencyOptions>
): Promise<void> {
  if (!userId || reminders.length === 0) return;
  const validReminders = reminders.filter(
    (r) => r && r.id && !CONFIRMED_SAMPLE_REMINDER_IDS.has(r.id)
  );
  if (validReminders.length === 0) return;

  // Conservative chunk size of 8 guarantees <= 16 Security Rules document-access calls per transaction (limit: 20)
  const CHUNK_SIZE = SAFE_BATCH_TRANSACTION_CHUNK_SIZE;
  const nowTs = nextMonotonicTimestamp();
  const nowIso = nowTs.toDate().toISOString();

  const isStructuredOptions =
    Boolean(options) &&
    ('concurrencyById' in (options as object) ||
      'defaultConcurrency' in (options as object) ||
      'onChunkCommitted' in (options as object));

  const resolveItemConcurrency = (remId: string): WriteConcurrencyOptions | undefined => {
    if (!options) return undefined;
    if (isStructuredOptions) {
      const structured = options as {
        concurrencyById?: Record<string, WriteConcurrencyOptions>;
        defaultConcurrency?: WriteConcurrencyOptions;
      };
      return structured.concurrencyById?.[remId] ?? structured.defaultConcurrency;
    }
    return (options as Record<string, WriteConcurrencyOptions>)[remId];
  };

  const onChunkCommitted = isStructuredOptions
    ? (options as { onChunkCommitted?: (committedIds: string[]) => void }).onChunkCommitted
    : undefined;

  try {
    for (let i = 0; i < validReminders.length; i += CHUNK_SIZE) {
      const chunk = validReminders.slice(i, i + CHUNK_SIZE);
      const committedVersions = new Map<string, number>();

      await runTransaction(db, async (transaction) => {
        const refs = chunk.map((rem) => doc(db, 'reminders', rem.id));
        const distinctBikeIds = Array.from(
          new Set(chunk.map((rem) => rem.bikeId).filter((id): id is string => Boolean(id)))
        );
        const bikeRefs = distinctBikeIds.map((bId) => doc(db, 'motorcycles', bId));

        // Read all reminder docs and parent motorcycle docs BEFORE performing any writes
        const [snaps, bikeSnaps] = await Promise.all([
          Promise.all(refs.map((ref) => transaction.get(ref))),
          Promise.all(bikeRefs.map((bRef) => transaction.get(bRef))),
        ]);

        const bikeOwnerById = new Map<string, string | null>();
        for (let bIdx = 0; bIdx < distinctBikeIds.length; bIdx++) {
          const bSnap = bikeSnaps[bIdx];
          bikeOwnerById.set(
            distinctBikeIds[bIdx],
            bSnap.exists() ? (bSnap.data()?.userId ?? null) : null
          );
        }

        for (let idx = 0; idx < chunk.length; idx++) {
          const rem = chunk[idx];
          const ref = refs[idx];
          const existing = snaps[idx];
          const cleanPayload = sanitizeFirestorePayload(rem);
          const itemConcurrency = resolveItemConcurrency(rem.id);

          // Verify parent motorcycle exists and is owned by userId (mirrors firestore.rules)
          const parentOwner = bikeOwnerById.get(rem.bikeId);
          if (!parentOwner || parentOwner !== userId) {
            throw new Error(
              `PERMISSION_DENIED: Reminder (${rem.id}) references nonexistent or unauthorized parent motorcycle (${rem.bikeId}).`
            );
          }

          if (existing.exists()) {
            const existingData = existing.data() || {};
            if (existingData.userId && existingData.userId !== userId) {
              throw new Error('PERMISSION_DENIED: Cannot modify a reminder owned by another user.');
            }
            if (itemConcurrency?.enforceVersionCheck) {
              assertTransactionVersionMatches({
                entity: 'reminder',
                targetId: rem.id,
                action: 'upsert',
                existingData,
                concurrency: itemConcurrency,
              });
            } else {
              // Default batch conflict protection: never overwrite a cloud reminder with a higher revision, odometer, or newer timestamp
              const cloudRev =
                typeof existingData.cloudVersion === 'number' ? existingData.cloudVersion : null;
              const localRev =
                typeof rem.cloudVersion === 'number' ? rem.cloudVersion : null;
              const cloudOdo =
                typeof existingData.lastCompletedOdo === 'number'
                  ? existingData.lastCompletedOdo
                  : 0;
              const localOdo =
                typeof rem.lastCompletedOdo === 'number' ? rem.lastCompletedOdo : 0;
              const cloudMs =
                parseTimestampToMillis(existingData.updatedAt) ??
                parseTimestampToMillis(existingData.createdAt);
              const localMs =
                parseTimestampToMillis(rem.updatedAt) ??
                parseTimestampToMillis(rem.createdAt);
              if (
                (cloudRev !== null && localRev !== null && cloudRev > localRev) ||
                cloudOdo > localOdo ||
                (cloudMs !== null && localMs !== null && cloudMs > localMs)
              ) {
                continue;
              }
            }
            const nextVersion = resolveNextCloudVersionForUpdate(
              existingData,
              'reminder',
              rem.id
            );
            committedVersions.set(rem.id, nextVersion);
            transaction.update(ref, {
              ...cleanPayload,
              id: rem.id,
              userId,
              updatedAt: nowTs,
              cloudVersion: nextVersion,
            });
          } else {
            if (itemConcurrency?.enforceVersionCheck && itemConcurrency.baseVersionUntrusted) {
              throw createConcurrencyConflictError({
                entity: 'reminder',
                targetId: rem.id,
                action: 'upsert',
                baseCloudUpdatedAt: null,
                currentCloudUpdatedAt: null,
                baseCloudVersion: null,
                currentCloudVersion: null,
                reason: `Legacy batch reminder mutation (${rem.id}) is missing a trustworthy base version.`,
              });
            }
            committedVersions.set(rem.id, 1);
            transaction.set(ref, {
              ...cleanPayload,
              id: rem.id,
              userId,
              createdAt: nowTs,
              updatedAt: nowTs,
              cloudVersion: 1,
            });
          }
        }
      });

      for (const [remId, ver] of committedVersions.entries()) {
        recordKnownCloudVersion(userId, 'reminder', remId, nowIso, ver);
      }
      onChunkCommitted?.(chunk.map((r) => r.id));
    }
    recordCloudSyncOperation({
      userId,
      status: 'success',
      operation: 'batch_upsert_reminders',
      entity: 'reminder',
      detail: `${validReminders.length} reminder(s) synced`,
    });
  } catch (error) {
    recordCloudSyncOperation({
      userId,
      status: 'failed',
      operation: 'batch_upsert_reminders',
      entity: 'reminder',
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    if (
      error instanceof Error &&
      (error.message.includes('PERMISSION_DENIED') ||
        error.message.includes('CONCURRENCY_CONFLICT'))
    ) {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, 'reminders/batch');
  }
}

export async function deleteReminderFromFirestore(
  reminderId: string,
  userId?: string,
  concurrency?: WriteConcurrencyOptions
): Promise<void> {
  const currentUserId = userId || auth.currentUser?.uid;
  if (!currentUserId || !reminderId) return;
  const remDocRef = doc(db, 'reminders', reminderId);
  try {
    await runTransaction(db, async (transaction) => {
      const existing = await transaction.get(remDocRef);
      if (existing.exists()) {
        const existingData = existing.data() || {};
        if (existingData.userId && existingData.userId !== currentUserId) {
          throw new Error('PERMISSION_DENIED: Cannot delete a reminder owned by another user.');
        }
        if (concurrency?.enforceVersionCheck) {
          assertTransactionVersionMatches({
            entity: 'reminder',
            targetId: reminderId,
            action: 'delete',
            existingData,
            concurrency,
          });
        }
        transaction.delete(remDocRef);
      }
    });
    removeKnownCloudVersion(currentUserId, 'reminder', reminderId);
    recordCloudSyncOperation({
      userId: currentUserId,
      status: 'success',
      operation: 'delete_reminder',
      entity: 'reminder',
      targetId: reminderId,
    });
  } catch (error) {
    recordCloudSyncOperation({
      userId: currentUserId,
      status: 'failed',
      operation: 'delete_reminder',
      entity: 'reminder',
      targetId: reminderId,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    if (
      error instanceof Error &&
      (error.message.includes('PERMISSION_DENIED') ||
        error.message.includes('CONCURRENCY_CONFLICT'))
    ) {
      throw error;
    }
    handleFirestoreError(error, OperationType.DELETE, `reminders/${reminderId}`);
  }
}

export async function fetchUserRemindersOnce(userId: string): Promise<MaintenanceReminder[]> {
  if (!userId) return [];
  const path = 'reminders';
  try {
    const q = query(collection(db, 'reminders'), where('userId', '==', userId));
    const snap = await getDocs(q);
    const items: MaintenanceReminder[] = [];
    snap.forEach((docSnap) => {
      items.push(normalizeReminderFromFirestore({ id: docSnap.id, ...docSnap.data() }));
    });
    return items;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export function subscribeToUserReminders(
  userId: string,
  callback: (reminders: MaintenanceReminder[]) => void,
  onError?: (err: unknown) => void
): () => void {
  const path = 'reminders';
  const q = query(collection(db, 'reminders'), where('userId', '==', userId));
  return onSnapshot(
    q,
    (snapshot) => {
      const fromCache = Boolean((snapshot as any)?.metadata?.fromCache);
      const items: MaintenanceReminder[] = [];
      snapshot.forEach((docSnap) => {
        const hasPending =
          Boolean((docSnap as any)?.metadata?.hasPendingWrites) || fromCache;
        items.push(
          normalizeReminderFromFirestore(
            { id: docSnap.id, ...docSnap.data() },
            hasPending
          )
        );
      });
      callback(items);
    },
    (error) => {
      onError?.(error);
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch {
        // Prevent uncaught listener throw
      }
    }
  );
}

// ============================================================================
// 12. Service Records Firestore CRUD & Real-Time Subscription
// ============================================================================

/**
 * Saves a service record to Firestore inside an atomic transaction and, if a linked
 * reminder was reset by this service, updates that reminder in the same transaction
 * with full ownership and concurrency verification on both documents.
 */
export async function saveServiceRecordToFirestore(
  record: ServiceRecord,
  userId: string,
  updatedLinkedReminder?: MaintenanceReminder,
  concurrency?: WriteConcurrencyOptions,
  linkedReminderConcurrency?: WriteConcurrencyOptions
): Promise<void> {
  if (!userId || !record?.id || CONFIRMED_SAMPLE_SERVICE_RECORD_IDS.has(record.id)) return;
  const recDocRef = doc(db, 'serviceRecords', record.id);
  const cleanRecord = sanitizeFirestorePayload(record);
  let committedIso: string | null = null;
  let committedRecordVersion = 1;
  let committedReminderVersion = 1;

  try {
    await runTransaction(db, async (transaction) => {
      const existing = await transaction.get(recDocRef);
      const remDocRef =
        updatedLinkedReminder && updatedLinkedReminder.id
          ? doc(db, 'reminders', updatedLinkedReminder.id)
          : null;
      const existingRem = remDocRef ? await transaction.get(remDocRef) : null;

      const nowTs = nextMonotonicTimestamp();
      committedIso = nowTs.toDate().toISOString();

      if (existing.exists()) {
        const existingData = existing.data() || {};
        if (existingData.userId && existingData.userId !== userId) {
          throw new Error('PERMISSION_DENIED: Cannot modify a service record owned by another user.');
        }
        if (concurrency?.enforceVersionCheck) {
          assertTransactionVersionMatches({
            entity: 'serviceRecord',
            targetId: record.id,
            action: 'upsert',
            existingData,
            concurrency,
          });
        }
        committedRecordVersion = resolveNextCloudVersionForUpdate(
          existingData,
          'serviceRecord',
          record.id
        );
        transaction.update(recDocRef, {
          ...cleanRecord,
          id: record.id,
          userId,
          updatedAt: nowTs,
          cloudVersion: committedRecordVersion,
        });
      } else {
        if (concurrency?.enforceVersionCheck && concurrency.baseVersionUntrusted) {
          throw createConcurrencyConflictError({
            entity: 'serviceRecord',
            targetId: record.id,
            action: 'upsert',
            baseCloudUpdatedAt: null,
            currentCloudUpdatedAt: null,
            baseCloudVersion: null,
            currentCloudVersion: null,
            reason: `Legacy queued service record mutation (${record.id}) is missing a trustworthy base version. Conflict review required.`,
          });
        }
        committedRecordVersion = 1;
        transaction.set(recDocRef, {
          ...cleanRecord,
          id: record.id,
          userId,
          createdAt: nowTs,
          updatedAt: nowTs,
          cloudVersion: committedRecordVersion,
        });
      }

      if (remDocRef && updatedLinkedReminder) {
        const cleanRem = sanitizeFirestorePayload(updatedLinkedReminder);
        if (existingRem?.exists()) {
          const remData = existingRem.data() || {};
          if (remData.userId && remData.userId !== userId) {
            throw new Error('PERMISSION_DENIED: Cannot modify a reminder owned by another user.');
          }
          if (linkedReminderConcurrency?.enforceVersionCheck) {
            assertTransactionVersionMatches({
              entity: 'reminder',
              targetId: updatedLinkedReminder.id,
              action: 'upsert',
              existingData: remData,
              concurrency: linkedReminderConcurrency,
            });
          }
          committedReminderVersion = resolveNextCloudVersionForUpdate(
            remData,
            'reminder',
            updatedLinkedReminder.id
          );
          transaction.update(remDocRef, {
            ...cleanRem,
            id: updatedLinkedReminder.id,
            userId,
            updatedAt: nowTs,
            cloudVersion: committedReminderVersion,
          });
        } else {
          if (
            linkedReminderConcurrency?.enforceVersionCheck &&
            linkedReminderConcurrency.baseVersionUntrusted
          ) {
            throw createConcurrencyConflictError({
              entity: 'reminder',
              targetId: updatedLinkedReminder.id,
              action: 'upsert',
              baseCloudUpdatedAt: null,
              currentCloudUpdatedAt: null,
              baseCloudVersion: null,
              currentCloudVersion: null,
              reason: `Linked reminder mutation (${updatedLinkedReminder.id}) is missing a trustworthy base version.`,
            });
          }
          committedReminderVersion = 1;
          transaction.set(remDocRef, {
            ...cleanRem,
            id: updatedLinkedReminder.id,
            userId,
            createdAt: nowTs,
            updatedAt: nowTs,
            cloudVersion: committedReminderVersion,
          });
        }
      }
    });

    if (committedIso) {
      recordKnownCloudVersion(userId, 'serviceRecord', record.id, committedIso, committedRecordVersion);
      if (updatedLinkedReminder?.id) {
        recordKnownCloudVersion(
          userId,
          'reminder',
          updatedLinkedReminder.id,
          committedIso,
          committedReminderVersion
        );
      }
    }
    recordCloudSyncOperation({
      userId,
      status: 'success',
      operation: 'upsert_service_record',
      entity: 'serviceRecord',
      targetId: record.id,
      detail: `${record.title} (₱${record.totalCostPhp.toLocaleString()})`,
    });
  } catch (error) {
    recordCloudSyncOperation({
      userId,
      status: 'failed',
      operation: 'upsert_service_record',
      entity: 'serviceRecord',
      targetId: record.id,
      detail: record.title,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    if (
      error instanceof Error &&
      (error.message.includes('PERMISSION_DENIED') ||
        error.message.includes('CONCURRENCY_CONFLICT'))
    ) {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, `serviceRecords/${record.id}`);
  }
}

export async function saveServiceRecordsBatchToFirestore(
  records: ServiceRecord[],
  userId: string,
  options?:
    | {
        concurrencyById?: Record<string, WriteConcurrencyOptions>;
        defaultConcurrency?: WriteConcurrencyOptions;
        onChunkCommitted?: (committedIds: string[]) => void;
      }
    | Record<string, WriteConcurrencyOptions>
): Promise<void> {
  if (!userId || records.length === 0) return;
  const validRecords = records.filter(
    (r) => r && r.id && !CONFIRMED_SAMPLE_SERVICE_RECORD_IDS.has(r.id)
  );
  if (validRecords.length === 0) return;

  // Conservative chunk size of 8 guarantees <= 16 Security Rules document-access calls per transaction (limit: 20)
  const CHUNK_SIZE = SAFE_BATCH_TRANSACTION_CHUNK_SIZE;
  const nowTs = nextMonotonicTimestamp();
  const nowIso = nowTs.toDate().toISOString();

  const isStructuredOptions =
    Boolean(options) &&
    ('concurrencyById' in (options as object) ||
      'defaultConcurrency' in (options as object) ||
      'onChunkCommitted' in (options as object));

  const resolveItemConcurrency = (recId: string): WriteConcurrencyOptions | undefined => {
    if (!options) return undefined;
    if (isStructuredOptions) {
      const structured = options as {
        concurrencyById?: Record<string, WriteConcurrencyOptions>;
        defaultConcurrency?: WriteConcurrencyOptions;
      };
      return structured.concurrencyById?.[recId] ?? structured.defaultConcurrency;
    }
    return (options as Record<string, WriteConcurrencyOptions>)[recId];
  };

  const onChunkCommitted = isStructuredOptions
    ? (options as { onChunkCommitted?: (committedIds: string[]) => void }).onChunkCommitted
    : undefined;

  try {
    for (let i = 0; i < validRecords.length; i += CHUNK_SIZE) {
      const chunk = validRecords.slice(i, i + CHUNK_SIZE);
      const committedVersions = new Map<string, number>();

      await runTransaction(db, async (transaction) => {
        const refs = chunk.map((rec) => doc(db, 'serviceRecords', rec.id));
        const distinctBikeIds = Array.from(
          new Set(chunk.map((rec) => rec.bikeId).filter((id): id is string => Boolean(id)))
        );
        const bikeRefs = distinctBikeIds.map((bId) => doc(db, 'motorcycles', bId));

        // Read all serviceRecord docs and parent motorcycle docs BEFORE performing any writes
        const [snaps, bikeSnaps] = await Promise.all([
          Promise.all(refs.map((ref) => transaction.get(ref))),
          Promise.all(bikeRefs.map((bRef) => transaction.get(bRef))),
        ]);

        const bikeStatusById = new Map<string, { exists: boolean; ownerId: string | null }>();
        for (let bIdx = 0; bIdx < distinctBikeIds.length; bIdx++) {
          const bSnap = bikeSnaps[bIdx];
          bikeStatusById.set(distinctBikeIds[bIdx], {
            exists: bSnap.exists(),
            ownerId: bSnap.exists() ? (bSnap.data()?.userId ?? null) : null,
          });
        }

        for (let idx = 0; idx < chunk.length; idx++) {
          const rec = chunk[idx];
          const ref = refs[idx];
          const existing = snaps[idx];
          const cleanPayload = sanitizeFirestorePayload(rec);
          const itemConcurrency = resolveItemConcurrency(rec.id);

          // Verify parent motorcycle ownership if the motorcycle exists (retired/deleted motorcycles remain allowed for the owner)
          const bikeStatus = bikeStatusById.get(rec.bikeId);
          if (bikeStatus?.exists && bikeStatus.ownerId !== userId) {
            throw new Error(
              `PERMISSION_DENIED: Service record (${rec.id}) references a motorcycle (${rec.bikeId}) owned by another user.`
            );
          }

          if (existing.exists()) {
            const existingData = existing.data() || {};
            if (existingData.userId && existingData.userId !== userId) {
              throw new Error('PERMISSION_DENIED: Cannot modify a service record owned by another user.');
            }
            if (itemConcurrency?.enforceVersionCheck) {
              assertTransactionVersionMatches({
                entity: 'serviceRecord',
                targetId: rec.id,
                action: 'upsert',
                existingData,
                concurrency: itemConcurrency,
              });
            } else {
              // Service records in batch migration are append-mostly; never overwrite an existing cloud record with a higher revision or newer/equal timestamp
              const cloudRev =
                typeof existingData.cloudVersion === 'number' ? existingData.cloudVersion : null;
              const localRev =
                typeof rec.cloudVersion === 'number' ? rec.cloudVersion : null;
              const cloudMs =
                parseTimestampToMillis(existingData.updatedAt) ??
                parseTimestampToMillis(existingData.createdAt);
              const localMs =
                parseTimestampToMillis(rec.updatedAt) ??
                parseTimestampToMillis(rec.createdAt);
              if (
                (cloudRev !== null && localRev !== null && cloudRev > localRev) ||
                (cloudMs !== null && (localMs === null || cloudMs >= localMs))
              ) {
                continue;
              }
            }
            const nextVersion = resolveNextCloudVersionForUpdate(
              existingData,
              'serviceRecord',
              rec.id
            );
            committedVersions.set(rec.id, nextVersion);
            transaction.update(ref, {
              ...cleanPayload,
              id: rec.id,
              userId,
              updatedAt: nowTs,
              cloudVersion: nextVersion,
            });
          } else {
            if (itemConcurrency?.enforceVersionCheck && itemConcurrency.baseVersionUntrusted) {
              throw createConcurrencyConflictError({
                entity: 'serviceRecord',
                targetId: rec.id,
                action: 'upsert',
                baseCloudUpdatedAt: null,
                currentCloudUpdatedAt: null,
                baseCloudVersion: null,
                currentCloudVersion: null,
                reason: `Legacy batch service record mutation (${rec.id}) is missing a trustworthy base version.`,
              });
            }
            committedVersions.set(rec.id, 1);
            transaction.set(ref, {
              ...cleanPayload,
              id: rec.id,
              userId,
              createdAt: nowTs,
              updatedAt: nowTs,
              cloudVersion: 1,
            });
          }
        }
      });

      for (const [recId, ver] of committedVersions.entries()) {
        recordKnownCloudVersion(userId, 'serviceRecord', recId, nowIso, ver);
      }
      onChunkCommitted?.(chunk.map((r) => r.id));
    }
    recordCloudSyncOperation({
      userId,
      status: 'success',
      operation: 'batch_upsert_service_records',
      entity: 'serviceRecord',
      detail: `${validRecords.length} service record(s) synced`,
    });
  } catch (error) {
    recordCloudSyncOperation({
      userId,
      status: 'failed',
      operation: 'batch_upsert_service_records',
      entity: 'serviceRecord',
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    if (
      error instanceof Error &&
      (error.message.includes('PERMISSION_DENIED') ||
        error.message.includes('CONCURRENCY_CONFLICT'))
    ) {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, 'serviceRecords/batch');
  }
}

export async function deleteServiceRecordFromFirestore(
  recordId: string,
  userId?: string,
  concurrency?: WriteConcurrencyOptions
): Promise<void> {
  const currentUserId = userId || auth.currentUser?.uid;
  if (!currentUserId || !recordId) return;
  const recDocRef = doc(db, 'serviceRecords', recordId);
  try {
    await runTransaction(db, async (transaction) => {
      const existing = await transaction.get(recDocRef);
      if (existing.exists()) {
        const existingData = existing.data() || {};
        if (existingData.userId && existingData.userId !== currentUserId) {
          throw new Error('PERMISSION_DENIED: Cannot delete a service record owned by another user.');
        }
        if (concurrency?.enforceVersionCheck) {
          assertTransactionVersionMatches({
            entity: 'serviceRecord',
            targetId: recordId,
            action: 'delete',
            existingData,
            concurrency,
          });
        }
        transaction.delete(recDocRef);
      }
    });
    removeKnownCloudVersion(currentUserId, 'serviceRecord', recordId);
    recordCloudSyncOperation({
      userId: currentUserId,
      status: 'success',
      operation: 'delete_service_record',
      entity: 'serviceRecord',
      targetId: recordId,
    });
  } catch (error) {
    recordCloudSyncOperation({
      userId: currentUserId,
      status: 'failed',
      operation: 'delete_service_record',
      entity: 'serviceRecord',
      targetId: recordId,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    if (
      error instanceof Error &&
      (error.message.includes('PERMISSION_DENIED') ||
        error.message.includes('CONCURRENCY_CONFLICT'))
    ) {
      throw error;
    }
    handleFirestoreError(error, OperationType.DELETE, `serviceRecords/${recordId}`);
  }
}

export async function fetchUserServiceRecordsOnce(userId: string): Promise<ServiceRecord[]> {
  if (!userId) return [];
  const path = 'serviceRecords';
  try {
    const q = query(collection(db, 'serviceRecords'), where('userId', '==', userId));
    const snap = await getDocs(q);
    const items: ServiceRecord[] = [];
    snap.forEach((docSnap) => {
      items.push(normalizeServiceRecordFromFirestore({ id: docSnap.id, ...docSnap.data() }));
    });
    return items;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export function subscribeToUserServiceRecords(
  userId: string,
  callback: (records: ServiceRecord[]) => void,
  onError?: (err: unknown) => void
): () => void {
  const path = 'serviceRecords';
  const q = query(collection(db, 'serviceRecords'), where('userId', '==', userId));
  return onSnapshot(
    q,
    (snapshot) => {
      const fromCache = Boolean((snapshot as any)?.metadata?.fromCache);
      const items: ServiceRecord[] = [];
      snapshot.forEach((docSnap) => {
        const hasPending =
          Boolean((docSnap as any)?.metadata?.hasPendingWrites) || fromCache;
        items.push(
          normalizeServiceRecordFromFirestore(
            { id: docSnap.id, ...docSnap.data() },
            hasPending
          )
        );
      });
      callback(items);
    },
    (error) => {
      onError?.(error);
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch {
        // Prevent uncaught listener throw
      }
    }
  );
}

// ============================================================================
// 13. Direct Online Concurrency Protection & Offline Queue Replay
// ============================================================================

/**
 * Resolves the authoritative cloud base version (`baseCloudUpdatedAt` and `baseCloudVersion`)
 * for an entity BEFORE local optimistic React state updates occur.
 */
export function resolveEntityBaseCloudVersion(
  userId: string | undefined,
  entity: OfflineMutationEntity,
  targetId: string,
  existingRecord?: {
    updatedAt?: string;
    createdAt?: string;
    cloudVersion?: number;
    timestampSource?: string;
  } | null
): WriteConcurrencyOptions {
  if (userId && targetId) {
    // 1. If a pending mutation already exists in the active queue for (entity, targetId),
    // preserve its original pre-edit baseCloudUpdatedAt and baseCloudVersion.
    const pendingQueue = getOfflineMutationQueue(userId);
    const existingPending = pendingQueue.find(
      (q) => q.entity === entity && q.targetId === targetId
    );
    if (existingPending) {
      const hasValidTs =
        typeof existingPending.baseCloudUpdatedAt === 'string' &&
        existingPending.baseCloudUpdatedAt.length > 0;
      const hasValidRev = typeof existingPending.baseCloudVersion === 'number';
      const isExpectedAbsent =
        existingPending.expectedCloudAbsent === true && !hasValidTs && !hasValidRev;
      return {
        enforceVersionCheck: true,
        baseCloudUpdatedAt: hasValidTs ? existingPending.baseCloudUpdatedAt! : null,
        baseCloudVersion: hasValidRev ? existingPending.baseCloudVersion! : null,
        expectedCloudAbsent: isExpectedAbsent,
        baseVersionUntrusted:
          Boolean(existingPending.baseVersionUntrusted) ||
          (!hasValidTs && !hasValidRev && !isExpectedAbsent),
      };
    }

    // 2. If `existingRecord` carries a server-confirmed `cloudVersion` and `timestampSource !== 'client_pending'`,
    // use the record's own version (captures the exact state the user was viewing/editing in the UI).
    if (
      existingRecord &&
      existingRecord.timestampSource !== 'client_pending' &&
      typeof existingRecord.cloudVersion === 'number' &&
      (existingRecord.updatedAt || existingRecord.createdAt)
    ) {
      return {
        enforceVersionCheck: true,
        baseCloudUpdatedAt: existingRecord.updatedAt || existingRecord.createdAt || null,
        baseCloudVersion: existingRecord.cloudVersion,
        expectedCloudAbsent: false,
      };
    }

    // 3. Check UID-scoped cloud version registry
    const knownIso = getKnownCloudVersion(userId, entity, targetId);
    const knownRev = getKnownCloudRevision(userId, entity, targetId);
    if (knownIso || knownRev !== null) {
      return {
        enforceVersionCheck: true,
        baseCloudUpdatedAt: knownIso,
        baseCloudVersion: knownRev,
        expectedCloudAbsent: false,
      };
    }
  }

  // 4. Fallback to existingRecord if it existed locally before this edit
  if (existingRecord) {
    const candidateTs =
      existingRecord.timestampSource !== 'client_pending'
        ? existingRecord.updatedAt || existingRecord.createdAt || null
        : null;
    const candidateRev =
      existingRecord.timestampSource !== 'client_pending' &&
      typeof existingRecord.cloudVersion === 'number'
        ? existingRecord.cloudVersion
        : null;
    return {
      enforceVersionCheck: true,
      baseCloudUpdatedAt: candidateTs,
      baseCloudVersion: candidateRev,
      expectedCloudAbsent: false,
      baseVersionUntrusted: candidateTs === null && candidateRev === null,
    };
  }

  // 5. Brand-new entity not yet present in local state or cloud
  return {
    enforceVersionCheck: true,
    baseCloudUpdatedAt: null,
    baseCloudVersion: null,
    expectedCloudAbsent: true,
  };
}

/**
 * Removes a queued mutation ONLY after its version-checked direct online write succeeds,
 * and ONLY if no newer edit was coalesced into the queue item while the write was in flight.
 * Refuses to remove any queued mutation if `concurrency.enforceVersionCheck` was not true.
 */
export function completeDirectOnlineMutation(params: {
  userId: string;
  mutationId: string;
  expectedGeneration: number;
  entity?: OfflineMutationEntity;
  targetId?: string;
  concurrency?: WriteConcurrencyOptions;
  enforceVersionCheck?: boolean;
}): boolean {
  const {
    userId,
    mutationId,
    expectedGeneration,
    entity,
    targetId,
    concurrency,
    enforceVersionCheck,
  } = params;
  if (!userId || !mutationId) return false;

  const isVersionChecked =
    enforceVersionCheck !== undefined
      ? enforceVersionCheck === true
      : Boolean(concurrency && concurrency.enforceVersionCheck === true);

  // Never remove a queued mutation merely because an unprotected write succeeded
  if (!isVersionChecked) {
    return false;
  }

  const queue = getOfflineMutationQueue(userId);
  const idx = queue.findIndex((q) => q.id === mutationId);
  if (idx < 0) return false;

  const currentItem = queue[idx];
  const currentGeneration = currentItem.mutationGeneration ?? 1;

  if (currentGeneration !== expectedGeneration) {
    // A newer edit coalesced into this queue item while the earlier write was in flight!
    // Do NOT remove the newer queued mutation. Advance its base version to the version
    // just committed by this device if it was still referencing the pre-write base version.
    const resolvedEntity = entity || currentItem.entity;
    const resolvedTargetId = targetId || currentItem.targetId;
    const latestIso = getKnownCloudVersion(userId, resolvedEntity, resolvedTargetId);
    const latestRev = getKnownCloudRevision(userId, resolvedEntity, resolvedTargetId);
    if (
      latestIso &&
      concurrency &&
      (currentItem.baseCloudUpdatedAt === concurrency.baseCloudUpdatedAt ||
        (concurrency.expectedCloudAbsent && currentItem.expectedCloudAbsent))
    ) {
      queue[idx] = {
        ...currentItem,
        baseCloudUpdatedAt: latestIso,
        ...(latestRev !== null ? { baseCloudVersion: latestRev } : {}),
        expectedCloudAbsent: false,
      };
      saveOfflineMutationQueue(userId, queue);
    }
    return false;
  }

  queue.splice(idx, 1);
  saveOfflineMutationQueue(userId, queue);
  return true;
}

/**
 * Handles errors from a direct online write:
 * - On `CONCURRENCY_CONFLICT`: preserves the complete mutation payload and base/conflict
 *   version details in `motocare_quarantined_queue_v1_${userId}` (`version_conflict`) and
 *   removes the conflicted generation from the active retry queue so it is surfaced for
 *   review rather than silently retried as a temporary network error.
 * - On temporary network / offline error: keeps the queued mutation intact in the active queue.
 */
export function handleDirectOnlineMutationError(
  err: unknown,
  params: {
    userId: string;
    mutationId: string;
    expectedGeneration: number;
    fallbackItem: OfflineMutationItem;
  }
): {
  classification: MutationFailureClassification;
  quarantinedItem: QuarantinedMutationItem | null;
  conflictDetails?: ConcurrencyConflictDetails;
} {
  const { userId, mutationId, expectedGeneration, fallbackItem } = params;
  const errMsg = err instanceof Error ? err.message : String(err);
  const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
  const classification = classifyMutationFailure(errMsg, 1, 5, isOffline);
  const conflictDetails: ConcurrencyConflictDetails | undefined = (err as any)?.conflictDetails;

  if (
    classification === 'version_conflict' ||
    classification === 'permission_or_validation_error' ||
    classification === 'quota_exceeded'
  ) {
    const queue = getOfflineMutationQueue(userId);
    const idx = queue.findIndex((q) => q.id === mutationId);
    const targetItem = idx >= 0 ? queue[idx] : fallbackItem;

    const quarantinedItem = quarantineOfflineMutation({
      item: targetItem,
      lastError: errMsg,
      retryCount: (targetItem.retryCount || 0) + 1,
      failureClassification: classification,
      conflictCloudUpdatedAt: conflictDetails?.currentCloudUpdatedAt ?? undefined,
      conflictCloudVersion: conflictDetails?.currentCloudVersion ?? undefined,
      conflictReason: conflictDetails?.reason ?? undefined,
    });

    if (idx >= 0 && (queue[idx].mutationGeneration ?? 1) === expectedGeneration) {
      queue.splice(idx, 1);
      saveOfflineMutationQueue(userId, queue);
    }

    return { classification, quarantinedItem, conflictDetails };
  }

  return { classification, quarantinedItem: null };
}

/**
 * Schedules a 600ms debounced direct online odometer update while immediately persisting
 * the mutation and its pre-edit base cloud version in `motocare_offline_queue_v1_${userId}`.
 * Enforces the version check inside the Firestore transaction when the debounce timer fires,
 * and prevents debounce cancellation or rapid repeated edits from removing a newer mutation.
 */
export function scheduleDirectOnlineOdometerUpdate(params: {
  userId: string;
  bikeId?: string;
  targetBikeId?: string;
  newOdometer?: number;
  newOdo?: number;
  preEditBike?: Motorcycle | null;
  timerRef?: { current: ReturnType<typeof setTimeout> | null };
  debounceTimerRef?: { current: ReturnType<typeof setTimeout> | null };
  delayMs?: number;
  createdAtIso?: string;
  onStatusChange?: (status: 'syncing' | 'synced' | 'offline_cache' | 'sync_error') => void;
  onVersionConflict?: (details: {
    quarantinedItem: QuarantinedMutationItem | null;
    conflictDetails?: ConcurrencyConflictDetails;
  }) => void;
}): {
  queuedItem: OfflineMutationItem;
  concurrency: WriteConcurrencyOptions;
} {
  const {
    userId,
    preEditBike,
    delayMs = 600,
    createdAtIso = new Date().toISOString(),
    onStatusChange,
    onVersionConflict,
  } = params;
  const resolvedBikeId = (params.bikeId || params.targetBikeId || '').trim();
  const resolvedOdo =
    typeof params.newOdometer === 'number' ? params.newOdometer : (params.newOdo ?? 0);
  const resolvedTimerRef = params.timerRef || params.debounceTimerRef || { current: null };

  const baseVersion = resolveEntityBaseCloudVersion(
    userId,
    'motorcycle',
    resolvedBikeId,
    preEditBike
  );

  const queuedItem = enqueueOfflineMutation({
    userId,
    entity: 'motorcycle',
    action: 'update_fields',
    targetId: resolvedBikeId,
    payload: { odometer: resolvedOdo },
    createdAtIso,
    baseCloudUpdatedAt: baseVersion.baseCloudUpdatedAt,
    baseCloudVersion: baseVersion.baseCloudVersion,
    expectedCloudAbsent: baseVersion.expectedCloudAbsent,
    baseVersionUntrusted: baseVersion.baseVersionUntrusted,
  });

  const scheduledMutationId = queuedItem.id;
  const scheduledGeneration = queuedItem.mutationGeneration ?? 1;
  const scheduledConcurrency: WriteConcurrencyOptions = {
    enforceVersionCheck: true,
    baseCloudUpdatedAt: queuedItem.baseCloudUpdatedAt ?? null,
    baseCloudVersion: queuedItem.baseCloudVersion ?? null,
    expectedCloudAbsent: Boolean(queuedItem.expectedCloudAbsent),
    baseVersionUntrusted: Boolean(queuedItem.baseVersionUntrusted),
  };

  onStatusChange?.('syncing');

  if (resolvedTimerRef.current) {
    clearTimeout(resolvedTimerRef.current);
    resolvedTimerRef.current = null;
  }

  resolvedTimerRef.current = setTimeout(async () => {
    resolvedTimerRef.current = null;
    try {
      await updateMotorcycleFieldsInFirestore(
        resolvedBikeId,
        userId,
        { odometer: resolvedOdo },
        scheduledConcurrency
      );
      completeDirectOnlineMutation({
        userId,
        mutationId: scheduledMutationId,
        expectedGeneration: scheduledGeneration,
        entity: 'motorcycle',
        targetId: resolvedBikeId,
        concurrency: scheduledConcurrency,
      });
      onStatusChange?.('synced');
    } catch (err) {
      const handled = handleDirectOnlineMutationError(err, {
        userId,
        mutationId: scheduledMutationId,
        expectedGeneration: scheduledGeneration,
        fallbackItem: queuedItem,
      });
      if (handled.classification === 'version_conflict') {
        onStatusChange?.('sync_error');
        onVersionConflict?.({
          quarantinedItem: handled.quarantinedItem,
          conflictDetails: handled.conflictDetails,
        });
      } else {
        onStatusChange?.('offline_cache');
      }
    }
  }, delayMs);

  return { queuedItem, concurrency: scheduledConcurrency };
}

/**
 * Executes an immediate version-checked direct online write (upsert, update_fields, or delete)
 * for motorcycles, reminders, or service records.
 * - Captures the original cloud base version before writing.
 * - Persists the mutation in `motocare_offline_queue_v1_${userId}` prior to the network call.
 * - Enforces `assertTransactionVersionMatches` inside the Firestore transaction.
 * - Removes only the corresponding mutation generation on version-checked completion.
 * - Quarantines and surfaces version conflicts without retrying them as temporary network errors.
 */
export async function executeDirectOnlineWrite(params: {
  userId: string;
  entity: OfflineMutationEntity;
  action: OfflineMutationAction;
  targetId: string;
  payload?: Record<string, unknown>;
  preEditRecord?: {
    updatedAt?: string;
    createdAt?: string;
    cloudVersion?: number;
    timestampSource?: string;
  } | null;
  createdAtIso?: string;
  linkedReminderUpdate?: {
    reminder: MaintenanceReminder;
    preEditReminder?: MaintenanceReminder | null;
  };
  oemRemindersToCreate?: MaintenanceReminder[];
  deleteOptions?: {
    deleteReminders?: boolean;
    deleteServiceHistoryConfirmed?: boolean;
  };
}): Promise<{
  status: 'synced' | 'version_conflict' | 'quota_or_permission_error' | 'offline_queued';
  queuedItem: OfflineMutationItem;
  concurrency: WriteConcurrencyOptions;
  quarantinedItem?: QuarantinedMutationItem | null;
  conflictDetails?: ConcurrencyConflictDetails;
  error?: unknown;
}> {
  const {
    userId,
    entity,
    action,
    targetId,
    payload,
    preEditRecord,
    createdAtIso = new Date().toISOString(),
    linkedReminderUpdate,
    oemRemindersToCreate,
    deleteOptions,
  } = params;

  const baseVersion = resolveEntityBaseCloudVersion(userId, entity, targetId, preEditRecord);

  const queuedItem = enqueueOfflineMutation({
    userId,
    entity,
    action,
    targetId,
    payload:
      payload ??
      (action === 'delete' && preEditRecord
        ? (preEditRecord as unknown as Record<string, unknown>)
        : { id: targetId }),
    createdAtIso,
    baseCloudUpdatedAt: baseVersion.baseCloudUpdatedAt,
    baseCloudVersion: baseVersion.baseCloudVersion,
    expectedCloudAbsent: baseVersion.expectedCloudAbsent,
    baseVersionUntrusted: baseVersion.baseVersionUntrusted,
  });

  const expectedGeneration = queuedItem.mutationGeneration ?? 1;
  const concurrency: WriteConcurrencyOptions = {
    enforceVersionCheck: true,
    baseCloudUpdatedAt: queuedItem.baseCloudUpdatedAt ?? null,
    baseCloudVersion: queuedItem.baseCloudVersion ?? null,
    expectedCloudAbsent: Boolean(queuedItem.expectedCloudAbsent),
    baseVersionUntrusted: Boolean(queuedItem.baseVersionUntrusted),
  };

  let linkedRemQueuedItem: OfflineMutationItem | null = null;
  let linkedRemExpectedGeneration = 1;
  let linkedRemConcurrency: WriteConcurrencyOptions | undefined;

  if (linkedReminderUpdate?.reminder) {
    const remBase = resolveEntityBaseCloudVersion(
      userId,
      'reminder',
      linkedReminderUpdate.reminder.id,
      linkedReminderUpdate.preEditReminder
    );
    linkedRemQueuedItem = enqueueOfflineMutation({
      userId,
      entity: 'reminder',
      action: 'upsert',
      targetId: linkedReminderUpdate.reminder.id,
      payload: linkedReminderUpdate.reminder as unknown as Record<string, unknown>,
      createdAtIso,
      baseCloudUpdatedAt: remBase.baseCloudUpdatedAt,
      baseCloudVersion: remBase.baseCloudVersion,
      expectedCloudAbsent: remBase.expectedCloudAbsent,
      baseVersionUntrusted: remBase.baseVersionUntrusted,
    });
    linkedRemExpectedGeneration = linkedRemQueuedItem.mutationGeneration ?? 1;
    linkedRemConcurrency = {
      enforceVersionCheck: true,
      baseCloudUpdatedAt: linkedRemQueuedItem.baseCloudUpdatedAt ?? null,
      baseCloudVersion: linkedRemQueuedItem.baseCloudVersion ?? null,
      expectedCloudAbsent: Boolean(linkedRemQueuedItem.expectedCloudAbsent),
      baseVersionUntrusted: Boolean(linkedRemQueuedItem.baseVersionUntrusted),
    };
  }

  try {
    if (entity === 'motorcycle') {
      if (action === 'upsert' && payload) {
        await saveMotorcycleToFirestore(payload as unknown as Motorcycle, userId, concurrency);
        if (oemRemindersToCreate && oemRemindersToCreate.length > 0) {
          await saveRemindersBatchToFirestore(oemRemindersToCreate, userId, {
            defaultConcurrency: {
              enforceVersionCheck: true,
              baseCloudUpdatedAt: null,
              baseCloudVersion: null,
              expectedCloudAbsent: true,
            },
          });
        }
      } else if (action === 'update_fields' && payload) {
        await updateMotorcycleFieldsInFirestore(targetId, userId, payload as any, concurrency);
      } else if (action === 'delete') {
        await deleteMotorcycleFromFirestore(targetId, userId, {
          deleteReminders: deleteOptions?.deleteReminders ?? true,
          deleteServiceHistoryConfirmed: deleteOptions?.deleteServiceHistoryConfirmed ?? false,
          concurrency,
        });
      }
    } else if (entity === 'reminder') {
      if (action === 'upsert' && payload) {
        await saveReminderToFirestore(
          payload as unknown as MaintenanceReminder,
          userId,
          concurrency
        );
      } else if (action === 'delete') {
        await deleteReminderFromFirestore(targetId, userId, concurrency);
      }
    } else if (entity === 'serviceRecord') {
      if (action === 'upsert' && payload) {
        await saveServiceRecordToFirestore(
          payload as unknown as ServiceRecord,
          userId,
          linkedReminderUpdate?.reminder,
          concurrency,
          linkedRemConcurrency
        );
      } else if (action === 'delete') {
        await deleteServiceRecordFromFirestore(targetId, userId, concurrency);
      }
    }

    completeDirectOnlineMutation({
      userId,
      mutationId: queuedItem.id,
      expectedGeneration,
      entity,
      targetId,
      concurrency,
    });

    if (linkedRemQueuedItem && linkedRemConcurrency) {
      completeDirectOnlineMutation({
        userId,
        mutationId: linkedRemQueuedItem.id,
        expectedGeneration: linkedRemExpectedGeneration,
        entity: 'reminder',
        targetId: linkedRemQueuedItem.targetId,
        concurrency: linkedRemConcurrency,
      });
    }

    return { status: 'synced', queuedItem, concurrency };
  } catch (err) {
    const handled = handleDirectOnlineMutationError(err, {
      userId,
      mutationId: queuedItem.id,
      expectedGeneration,
      fallbackItem: queuedItem,
    });

    if (linkedRemQueuedItem) {
      handleDirectOnlineMutationError(err, {
        userId,
        mutationId: linkedRemQueuedItem.id,
        expectedGeneration: linkedRemExpectedGeneration,
        fallbackItem: linkedRemQueuedItem,
      });
    }

    if (handled.classification === 'version_conflict') {
      return {
        status: 'version_conflict',
        queuedItem,
        concurrency,
        quarantinedItem: handled.quarantinedItem,
        conflictDetails: handled.conflictDetails,
        error: err,
      };
    }

    if (
      handled.classification === 'quota_exceeded' ||
      handled.classification === 'permission_or_validation_error'
    ) {
      return {
        status: 'quota_or_permission_error',
        queuedItem,
        concurrency,
        quarantinedItem: handled.quarantinedItem,
        error: err,
      };
    }

    // Offline / temporary network failure: also enqueue any OEM reminders for newly created bike
    if (oemRemindersToCreate && oemRemindersToCreate.length > 0) {
      for (const rem of oemRemindersToCreate) {
        enqueueOfflineMutation({
          userId,
          entity: 'reminder',
          action: 'upsert',
          targetId: rem.id,
          payload: rem as unknown as Record<string, unknown>,
          createdAtIso,
          baseCloudUpdatedAt: null,
          baseCloudVersion: null,
          expectedCloudAbsent: true,
        });
      }
    }

    return {
      status: 'offline_queued',
      queuedItem,
      concurrency,
      error: err,
    };
  }
}

export async function flushOfflineMutationQueue(userId: string): Promise<{
  flushedCount: number;
  failedCount: number;
  quarantinedCount: number;
  skippedOffline: boolean;
}> {
  if (!userId) {
    return { flushedCount: 0, failedCount: 0, quarantinedCount: 0, skippedOffline: false };
  }

  // Prevent retries while offline: do not flush, do not increment retryCount, do not modify or remove queued mutations
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { flushedCount: 0, failedCount: 0, quarantinedCount: 0, skippedOffline: true };
  }

  const queue = getOfflineMutationQueue(userId);
  if (queue.length === 0) {
    return { flushedCount: 0, failedCount: 0, quarantinedCount: 0, skippedOffline: false };
  }

  let flushedCount = 0;
  let failedCount = 0;
  let quarantinedCount = 0;
  const remainingQueue = [...queue];
  const MAX_RETRIES = 5;

  for (const item of queue) {
    // Re-check offline status before each item so mid-queue disconnection never increments retryCount
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      saveOfflineMutationQueue(userId, remainingQueue);
      return { flushedCount, failedCount, quarantinedCount, skippedOffline: true };
    }

    const hasValidBaseTimestamp =
      typeof item.baseCloudUpdatedAt === 'string' && item.baseCloudUpdatedAt.length > 0;
    const hasValidBaseRevision =
      typeof item.baseCloudVersion === 'number' && Number.isFinite(item.baseCloudVersion);
    const isExpectedAbsent =
      item.expectedCloudAbsent === true && !item.baseCloudUpdatedAt && !hasValidBaseRevision;
    const isUntrustedLegacy =
      Boolean(item.baseVersionUntrusted) ||
      (!hasValidBaseTimestamp && !hasValidBaseRevision && !isExpectedAbsent);

    const concurrencyOptions: WriteConcurrencyOptions = {
      enforceVersionCheck: true,
      baseCloudUpdatedAt: hasValidBaseTimestamp ? item.baseCloudUpdatedAt : null,
      baseCloudVersion: hasValidBaseRevision ? item.baseCloudVersion : null,
      expectedCloudAbsent: isExpectedAbsent,
      baseVersionUntrusted: isUntrustedLegacy,
    };

    try {
      if (item.entity === 'motorcycle') {
        if (item.action === 'upsert' && item.payload) {
          await saveMotorcycleToFirestore(
            item.payload as unknown as Motorcycle,
            userId,
            concurrencyOptions
          );
        } else if (item.action === 'update_fields' && item.payload) {
          await updateMotorcycleFieldsInFirestore(
            item.targetId,
            userId,
            item.payload as any,
            concurrencyOptions
          );
        } else if (item.action === 'delete') {
          await deleteMotorcycleFromFirestore(item.targetId, userId, {
            concurrency: concurrencyOptions,
          });
        }
      } else if (item.entity === 'reminder') {
        if (item.action === 'upsert' && item.payload) {
          await saveReminderToFirestore(
            item.payload as unknown as MaintenanceReminder,
            userId,
            concurrencyOptions
          );
        } else if (item.action === 'delete') {
          await deleteReminderFromFirestore(item.targetId, userId, concurrencyOptions);
        }
      } else if (item.entity === 'serviceRecord') {
        if (item.action === 'upsert' && item.payload) {
          await saveServiceRecordToFirestore(
            item.payload as unknown as ServiceRecord,
            userId,
            undefined,
            concurrencyOptions
          );
        } else if (item.action === 'delete') {
          await deleteServiceRecordFromFirestore(item.targetId, userId, concurrencyOptions);
        }
      }

      removeOfflineMutation(userId, item.id);
      const idx = remainingQueue.findIndex((q) => q.id === item.id);
      if (idx >= 0) remainingQueue.splice(idx, 1);
      flushedCount++;
    } catch (err: any) {
      const isNowOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
      if (isNowOffline) {
        // Device went offline during the attempt: do NOT increment retryCount or discard/quarantine
        saveOfflineMutationQueue(userId, remainingQueue);
        return { flushedCount, failedCount, quarantinedCount, skippedOffline: true };
      }

      failedCount++;
      const errMsg = err?.message || String(err);
      const nextRetryCount = (item.retryCount || 0) + 1;
      const classification = classifyMutationFailure(
        errMsg,
        nextRetryCount,
        MAX_RETRIES,
        false
      );

      const shouldQuarantine =
        classification === 'version_conflict' ||
        classification === 'permission_or_validation_error' ||
        classification === 'quota_exceeded' ||
        classification === 'retry_exhausted';

      const conflictDetails: ConcurrencyConflictDetails | undefined = (err as any)?.conflictDetails;

      const idx = remainingQueue.findIndex((q) => q.id === item.id);
      if (idx >= 0) {
        if (shouldQuarantine) {
          // Preserve complete original payload and base version in UID-scoped quarantine BEFORE removing from active queue
          quarantineOfflineMutation({
            item: isUntrustedLegacy ? { ...item, baseVersionUntrusted: true } : item,
            lastError: errMsg,
            retryCount: nextRetryCount,
            failureClassification: classification,
            conflictCloudUpdatedAt: conflictDetails?.currentCloudUpdatedAt ?? undefined,
            conflictCloudVersion: conflictDetails?.currentCloudVersion ?? undefined,
            conflictReason: conflictDetails?.reason ?? undefined,
          });
          remainingQueue.splice(idx, 1);
          removeOfflineMutation(userId, item.id);
          quarantinedCount++;
        } else {
          // Temporary network error: keep in active queue with updated retryCount and lastError
          remainingQueue[idx] = {
            ...remainingQueue[idx],
            retryCount: nextRetryCount,
            lastError: errMsg,
          };
        }
      }
    }
  }

  saveOfflineMutationQueue(userId, remainingQueue);
  return { flushedCount, failedCount, quarantinedCount, skippedOffline: false };
}

/**
 * Safely recovers/requeues a quarantined mutation for `userId`.
 * - Strictly UID-scoped: never accesses or recovers another user's quarantined items.
 * - Requires trustworthy base-version information (`baseCloudUpdatedAt`, `baseCloudVersion`, or `expectedCloudAbsent === true`).
 * - Pre-read when online acts as an early warning/preview; the decisive concurrency check
 *   is always enforced inside the Firestore transaction when `flushOfflineMutationQueue` replays.
 */
export async function recoverQuarantinedMutationSafely(
  userId: string,
  mutationId: string
): Promise<{
  status: 'requeued' | 'skipped_newer_cloud' | 'missing_base_version' | 'not_found';
  item?: OfflineMutationItem;
  detail: string;
}> {
  if (!userId || !mutationId) {
    return { status: 'not_found', detail: 'User ID and mutation ID are required.' };
  }

  const quarantinedList = getQuarantinedMutationQueue(userId);
  const target = quarantinedList.find((q) => q.id === mutationId && q.userId === userId);
  if (!target) {
    return {
      status: 'not_found',
      detail: 'Quarantined mutation not found for the current authenticated user.',
    };
  }

  const hasTrustworthyBaseVersion =
    !target.baseVersionUntrusted &&
    ((typeof target.baseCloudUpdatedAt === 'string' && target.baseCloudUpdatedAt.length > 0) ||
      typeof target.baseCloudVersion === 'number' ||
      target.expectedCloudAbsent === true);

  if (!hasTrustworthyBaseVersion) {
    return {
      status: 'missing_base_version',
      detail:
        'Cannot automatically requeue: mutation is missing a trustworthy base cloud version. Manual conflict review is required.',
    };
  }

  // Early-warning preview when online (the decisive concurrency check still occurs inside the replay transaction)
  const isOnline = typeof navigator === 'undefined' || navigator.onLine !== false;
  if (isOnline) {
    const colName =
      target.entity === 'motorcycle'
        ? 'motorcycles'
        : target.entity === 'reminder'
        ? 'reminders'
        : 'serviceRecords';
    try {
      const snap = await getDoc(doc(db, colName, target.targetId));
      if (snap.exists()) {
        const cloudData = snap.data();
        const cloudUpdatedIso =
          normalizeFirestoreTimestampToIso(cloudData?.updatedAt) ||
          normalizeFirestoreTimestampToIso(cloudData?.createdAt) ||
          null;
        const cloudUpdatedMs =
          parseTimestampToMillis(cloudData?.updatedAt) ??
          parseTimestampToMillis(cloudData?.createdAt);
        const cloudRev =
          typeof cloudData?.cloudVersion === 'number' && Number.isFinite(cloudData.cloudVersion)
            ? cloudData.cloudVersion
            : null;

        if (target.expectedCloudAbsent && !target.baseCloudUpdatedAt && target.baseCloudVersion == null) {
          return {
            status: 'skipped_newer_cloud',
            detail: `Firestore already contains a document for ${target.entity} #${target.targetId} (version ${cloudUpdatedIso || 'unknown'}). Recovery blocked to prevent overwriting cloud data.`,
          };
        }

        if (typeof target.baseCloudVersion === 'number' && cloudRev !== null && cloudRev !== target.baseCloudVersion) {
          return {
            status: 'skipped_newer_cloud',
            detail: `Firestore contains a newer revision (v${cloudRev}) than the mutation base revision (v${target.baseCloudVersion}). Recovery skipped to prevent overwriting newer cloud data.`,
          };
        }

        if (target.baseCloudUpdatedAt) {
          const baseMs = parseTimestampToMillis(target.baseCloudUpdatedAt);
          const isoMatches =
            cloudUpdatedIso !== null && cloudUpdatedIso === target.baseCloudUpdatedAt;
          const msMatches =
            cloudUpdatedMs !== null && baseMs !== null && cloudUpdatedMs === baseMs;

          if (!isoMatches || !msMatches) {
            return {
              status: 'skipped_newer_cloud',
              detail: `Firestore contains a newer version (${cloudUpdatedIso || 'unknown'}) than the mutation base version (${target.baseCloudUpdatedAt}). Recovery skipped to prevent overwriting newer cloud data.`,
            };
          }
        }

        if (
          target.entity === 'motorcycle' &&
          typeof cloudData?.odometer === 'number' &&
          typeof target.payload?.odometer === 'number' &&
          cloudData.odometer > target.payload.odometer
        ) {
          return {
            status: 'skipped_newer_cloud',
            detail: `Cloud motorcycle odometer (${cloudData.odometer.toLocaleString()} km) is higher than quarantined payload (${Number(target.payload.odometer).toLocaleString()} km).`,
          };
        }
      }
    } catch {
      // If offline or unable to pre-read, requeued item retains baseCloudUpdatedAt/baseCloudVersion so the replay transaction enforces the check
    }
  }

  const requeued = requeueQuarantinedMutation(userId, mutationId);
  if (!requeued) {
    return { status: 'not_found', detail: 'Could not requeue quarantined mutation.' };
  }

  return {
    status: 'requeued',
    item: requeued,
    detail: `Mutation ${requeued.id} (${requeued.action} ${requeued.entity}) returned to active queue with base version preserved and retryCount reset to 0.`,
  };
}

export interface SyncStorageToFirestoreOptions {
  userId: string;
  userEmail: string;
  hasProAccess: boolean;
  /**
   * Explicit user confirmation is required before migrating legacy unscoped LocalStorage records.
   */
  userConfirmedOwnership: boolean;
  /**
   * Optional list of selected motorcycle IDs when a Free user has >1 local motorcycle.
   */
  selectedBikeIds?: string[];
  motorcyclesToSync?: Motorcycle[];
  remindersToSync?: MaintenanceReminder[];
  serviceRecordsToSync?: ServiceRecord[];
  existingCloudMotorcycles?: Motorcycle[];
  existingCloudReminders?: MaintenanceReminder[];
  existingCloudServiceRecords?: ServiceRecord[];
}

export interface SyncStorageToFirestoreResult {
  ledger: MigrationLedger;
  migratedMotorcyclesCount: number;
  migratedRemindersCount: number;
  migratedServiceRecordsCount: number;
  skippedDuplicateCount: number;
  protectedNewerCloudCount: number;
  conflicts: SyncConflictItem[];
}

/**
 * `syncStorageToFirestore`:
 * Detects local changes and performs atomic/transactional writes to user-scoped Firestore collections
 * for motorcycles, reminders, and service records, ensuring that LocalStorage acts only as a
 * read-through cache.
 *
 * Enforces all Phase 2, Phase 3, and Phase 4 safety invariants:
 * 1. Requires `userConfirmedOwnership === true` before migrating unscoped legacy records.
 * 2. Creates an immutable UID-scoped backup (`motocare_pre_cloud_migration_backup_v1_${userId}`).
 * 3. Rejects foreign UIDs and filters out all mock/sample IDs.
 * 4. Checkpoints every migrated ID in `MigrationLedger` so interrupted runs resume idempotently.
 * 5. Never overwrites newer Firestore records with older LocalStorage records (enforced inside transactions).
 * 6. Enforces the 1-motorcycle Free quota using `selectedBikeIds` when `!hasProAccess`.
 */
export async function syncStorageToFirestore(
  options: SyncStorageToFirestoreOptions
): Promise<SyncStorageToFirestoreResult> {
  const {
    userId,
    userEmail,
    hasProAccess,
    userConfirmedOwnership,
    selectedBikeIds,
    motorcyclesToSync = [],
    remindersToSync = [],
    serviceRecordsToSync = [],
    existingCloudMotorcycles,
    existingCloudReminders,
    existingCloudServiceRecords,
  } = options;

  if (!userId) {
    throw new Error('AUTH_REQUIRED: Cannot synchronize to Firestore without an authenticated userId.');
  }

  if (!userConfirmedOwnership) {
    throw new Error('CONFIRMATION_REQUIRED: Rider must explicitly confirm ownership of legacy local records before migration.');
  }

  // 1. Always create the immutable pre-migration backup first
  createImmutablePreMigrationBackup(userId, userEmail);

  // 2. Load or initialize the idempotent MigrationLedger
  const existingLedger = loadMigrationLedger(userId);
  const nowIso = new Date().toISOString();
  const ledger: MigrationLedger = existingLedger
    ? {
        ...existingLedger,
        status: 'in_progress',
        selectedBikeIds: selectedBikeIds ?? existingLedger.selectedBikeIds,
        updatedAt: nowIso,
      }
    : {
        userId,
        userEmail,
        status: 'in_progress',
        selectedBikeIds,
        motorcyclesCompletedIds: [],
        remindersCompletedIds: [],
        serviceRecordsCompletedIds: [],
        bikeIdRemap: {},
        backupKey: getPreMigrationBackupKey(userId),
        startedAt: nowIso,
        updatedAt: nowIso,
      };
  saveMigrationLedger(ledger);

  // 3. Fetch authoritative cloud state if not provided
  const cloudBikes = existingCloudMotorcycles ?? (await fetchUserMotorcyclesOnce(userId));
  const cloudReminders = existingCloudReminders ?? (await fetchUserRemindersOnce(userId));
  const cloudRecords = existingCloudServiceRecords ?? (await fetchUserServiceRecordsOnce(userId));

  const cloudBikesById = new Map(cloudBikes.map((b) => [b.id, b]));
  const cloudRemindersById = new Map(cloudReminders.map((r) => [r.id, r]));
  const cloudRecordsById = new Map(cloudRecords.map((r) => [r.id, r]));

  let migratedMotorcyclesCount = 0;
  let migratedRemindersCount = 0;
  let migratedServiceRecordsCount = 0;
  let skippedDuplicateCount = 0;
  let protectedNewerCloudCount = 0;
  const conflicts: SyncConflictItem[] = [];

  const normalizeKey = (s: string | undefined) => (s || '').trim().toLowerCase();

  // --- STAGE 1: MOTORCYCLES ---
  const allowedNewBikesQuota = hasProAccess ? 999 : Math.max(0, 1 - cloudBikes.length);
  let newBikesCreatedInThisRun = 0;

  for (const localBike of motorcyclesToSync) {
    if (!localBike || !localBike.id) continue;
    if (CONFIRMED_SAMPLE_MOTORCYCLE_IDS.has(localBike.id)) continue;
    if (localBike.userId && localBike.userId !== userId) continue;

    // If user specified selectedBikeIds (e.g. Free tier selection), only sync selected motorcycles
    if (
      selectedBikeIds &&
      selectedBikeIds.length > 0 &&
      !selectedBikeIds.includes(localBike.id)
    ) {
      continue;
    }

    const existingCloud = cloudBikesById.get(localBike.id);
    if (existingCloud) {
      const resolution = resolveMotorcycleConflict(localBike, existingCloud);
      if (resolution.conflict) {
        conflicts.push(resolution.conflict);
      }
      if (resolution.winner === 'cloud') {
        protectedNewerCloudCount++;
        if (!ledger.motorcyclesCompletedIds.includes(localBike.id)) {
          ledger.motorcyclesCompletedIds.push(localBike.id);
          saveMigrationLedger(ledger);
        }
        continue;
      }
      // Local explicitly has a newer client_pending timestamp and non-contradictory odometer:
      // still enforce version check against `existingCloud` inside the Firestore transaction!
      await saveMotorcycleToFirestore(
        { ...localBike, userId },
        userId,
        {
          enforceVersionCheck: true,
          baseCloudUpdatedAt: existingCloud.updatedAt || existingCloud.createdAt || null,
          baseCloudVersion: existingCloud.cloudVersion ?? null,
          expectedCloudAbsent: false,
        }
      );
      migratedMotorcyclesCount++;
      if (!ledger.motorcyclesCompletedIds.includes(localBike.id)) {
        ledger.motorcyclesCompletedIds.push(localBike.id);
        saveMigrationLedger(ledger);
      }
      continue;
    }

    // Check semantic duplicate in cloud (same non-empty licensePlate or identical brand+model+year)
    const semanticMatch = cloudBikes.find((cb) => {
      const samePlate =
        localBike.licensePlate &&
        cb.licensePlate &&
        normalizeKey(localBike.licensePlate) === normalizeKey(cb.licensePlate);
      const sameModelYear =
        normalizeKey(localBike.brand) === normalizeKey(cb.brand) &&
        normalizeKey(localBike.model) === normalizeKey(cb.model) &&
        localBike.year === cb.year &&
        normalizeKey(localBike.nickname) === normalizeKey(cb.nickname);
      return Boolean(samePlate || sameModelYear);
    });

    if (semanticMatch) {
      ledger.bikeIdRemap[localBike.id] = semanticMatch.id;
      if (!ledger.motorcyclesCompletedIds.includes(localBike.id)) {
        ledger.motorcyclesCompletedIds.push(localBike.id);
      }
      saveMigrationLedger(ledger);
      skippedDuplicateCount++;
      continue;
    }

    // Check Free tier quota before creating a new bike
    if (!hasProAccess && newBikesCreatedInThisRun >= allowedNewBikesQuota) {
      continue;
    }

    await saveMotorcycleToFirestore(
      { ...localBike, userId },
      userId,
      {
        enforceVersionCheck: true,
        baseCloudUpdatedAt: null,
        baseCloudVersion: null,
        expectedCloudAbsent: true,
      }
    );
    newBikesCreatedInThisRun++;
    migratedMotorcyclesCount++;
    cloudBikesById.set(localBike.id, { ...localBike, userId });
    if (!ledger.motorcyclesCompletedIds.includes(localBike.id)) {
      ledger.motorcyclesCompletedIds.push(localBike.id);
    }
    saveMigrationLedger(ledger);
  }

  // --- STAGE 2: REMINDERS ---
  const remindersBatch: MaintenanceReminder[] = [];
  const reminderConcurrencyById: Record<string, WriteConcurrencyOptions> = {};
  for (const localRem of remindersToSync) {
    if (!localRem || !localRem.id) continue;
    if (CONFIRMED_SAMPLE_REMINDER_IDS.has(localRem.id)) continue;
    if (localRem.userId && localRem.userId !== userId) continue;
    if (ledger.remindersCompletedIds.includes(localRem.id)) continue;

    const targetBikeId = ledger.bikeIdRemap[localRem.bikeId] || localRem.bikeId;
    // Reminder must reference a motorcycle owned by the user in cloud
    if (!cloudBikesById.has(targetBikeId)) {
      continue;
    }

    const existingCloudRem = cloudRemindersById.get(localRem.id);
    if (existingCloudRem) {
      // Protect newer or equal cloud reminder
      const localOdo = localRem.lastCompletedOdo || 0;
      const cloudOdo = existingCloudRem.lastCompletedOdo || 0;
      if (cloudOdo >= localOdo) {
        protectedNewerCloudCount++;
        if (!ledger.remindersCompletedIds.includes(localRem.id)) {
          ledger.remindersCompletedIds.push(localRem.id);
        }
        continue;
      }
      reminderConcurrencyById[localRem.id] = {
        enforceVersionCheck: true,
        baseCloudUpdatedAt: existingCloudRem.updatedAt || existingCloudRem.createdAt || null,
        baseCloudVersion: existingCloudRem.cloudVersion ?? null,
        expectedCloudAbsent: false,
      };
    } else {
      // Semantic duplicate check (same bikeId + title + category)
      const duplicateRem = cloudReminders.find(
        (cr) =>
          cr.bikeId === targetBikeId &&
          normalizeKey(cr.title) === normalizeKey(localRem.title) &&
          normalizeKey(cr.category) === normalizeKey(localRem.category)
      );
      if (duplicateRem) {
        skippedDuplicateCount++;
        if (!ledger.remindersCompletedIds.includes(localRem.id)) {
          ledger.remindersCompletedIds.push(localRem.id);
        }
        continue;
      }
      reminderConcurrencyById[localRem.id] = {
        enforceVersionCheck: true,
        baseCloudUpdatedAt: null,
        baseCloudVersion: null,
        expectedCloudAbsent: true,
      };
    }

    remindersBatch.push({
      ...localRem,
      bikeId: targetBikeId,
      userId,
    });
  }

  if (remindersBatch.length > 0) {
    await saveRemindersBatchToFirestore(remindersBatch, userId, {
      concurrencyById: reminderConcurrencyById,
      onChunkCommitted: (committedIds) => {
        for (const id of committedIds) {
          migratedRemindersCount++;
          if (!ledger.remindersCompletedIds.includes(id)) {
            ledger.remindersCompletedIds.push(id);
          }
        }
        saveMigrationLedger(ledger);
      },
    });
  }

  // --- STAGE 3: SERVICE RECORDS (Append-Mostly, Preserves History) ---
  const recordsBatch: ServiceRecord[] = [];
  for (const localRec of serviceRecordsToSync) {
    if (!localRec || !localRec.id) continue;
    if (CONFIRMED_SAMPLE_SERVICE_RECORD_IDS.has(localRec.id)) continue;
    if (localRec.userId && localRec.userId !== userId) continue;
    if (ledger.serviceRecordsCompletedIds.includes(localRec.id)) continue;

    const targetBikeId = ledger.bikeIdRemap[localRec.bikeId] || localRec.bikeId;

    const existingCloudRec = cloudRecordsById.get(localRec.id);
    if (existingCloudRec) {
      protectedNewerCloudCount++;
      if (!ledger.serviceRecordsCompletedIds.includes(localRec.id)) {
        ledger.serviceRecordsCompletedIds.push(localRec.id);
      }
      continue;
    }

    // Semantic duplicate check (same bikeId + date + odometer + title + totalCostPhp)
    const duplicateRec = cloudRecords.find(
      (cr) =>
        cr.bikeId === targetBikeId &&
        cr.date === localRec.date &&
        cr.odometer === localRec.odometer &&
        normalizeKey(cr.title) === normalizeKey(localRec.title) &&
        cr.totalCostPhp === localRec.totalCostPhp
    );
    if (duplicateRec) {
      skippedDuplicateCount++;
      if (!ledger.serviceRecordsCompletedIds.includes(localRec.id)) {
        ledger.serviceRecordsCompletedIds.push(localRec.id);
      }
      continue;
    }

    recordsBatch.push({
      ...localRec,
      bikeId: targetBikeId,
      userId,
    });
  }

  if (recordsBatch.length > 0) {
    await saveServiceRecordsBatchToFirestore(recordsBatch, userId, {
      defaultConcurrency: {
        enforceVersionCheck: true,
        baseCloudUpdatedAt: null,
        baseCloudVersion: null,
        expectedCloudAbsent: true,
      },
      onChunkCommitted: (committedIds) => {
        for (const id of committedIds) {
          migratedServiceRecordsCount++;
          if (!ledger.serviceRecordsCompletedIds.includes(id)) {
            ledger.serviceRecordsCompletedIds.push(id);
          }
        }
        saveMigrationLedger(ledger);
      },
    });
  }

  // Mark ledger completed
  ledger.status = 'completed';
  ledger.completedAt = new Date().toISOString();
  ledger.updatedAt = ledger.completedAt;
  saveMigrationLedger(ledger);

  // Update UID-scoped read-through caches
  saveUserScopedMotorcycles(userId, Array.from(cloudBikesById.values()));
  saveUserScopedReminders(userId, [...cloudReminders, ...remindersBatch]);
  saveUserScopedServiceRecords(userId, [...cloudRecords, ...recordsBatch]);

  return {
    ledger,
    migratedMotorcyclesCount,
    migratedRemindersCount,
    migratedServiceRecordsCount,
    skippedDuplicateCount,
    protectedNewerCloudCount,
    conflicts,
  };
}

// 8. Admin: Subscribe to All Users Live
export function subscribeToAllUsers(
  callback: (users: Record<string, any>[]) => void
): () => void {
  const path = 'users';
  return onSnapshot(
    collection(db, 'users'),
    (snapshot) => {
      const items: Record<string, any>[] = [];
      snapshot.forEach((docSnap) => {
        items.push({ id: docSnap.id, ...docSnap.data() });
      });
      callback(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch {
        // Prevent uncaught listener throw in offline mode
      }
    }
  );
}

