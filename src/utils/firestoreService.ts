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
  Timestamp,
} from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from './firebase';
import { User } from 'firebase/auth';
import { Motorcycle, MaintenanceReminder, ServiceRecord, UserSubscription, PaymentMethod } from '../types';

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
      handleFirestoreError(error, OperationType.GET, path);
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
      handleFirestoreError(error, OperationType.LIST, path);
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

// 9. Server-Enforced Motorcycle Garage Persistence (Atomic Quota Enforcement)
export async function saveMotorcycleToFirestore(bike: Motorcycle, userId: string): Promise<void> {
  const bikeDocRef = doc(db, 'motorcycles', bike.id);
  const userDocRef = doc(db, 'users', userId);

  try {
    await runTransaction(db, async (transaction) => {
      const bikeSnap = await transaction.get(bikeDocRef);
      const userSnap = await transaction.get(userDocRef);

      if (bikeSnap.exists()) {
        // Updating existing motorcycle does NOT consume additional quota
        transaction.update(bikeDocRef, {
          ...bike,
          userId,
          updatedAt: new Date().toISOString(),
        });
      } else {
        // Creating NEW motorcycle: Verify quota before writing
        const isPro =
          userSnap.exists() &&
          userSnap.data()?.subscriptionTier === 'pro' &&
          (() => {
            const exp = parseExpiryToDate(userSnap.data()?.expiryDate);
            return exp !== null && exp.getTime() > Date.now();
          })();

        const currentCount =
          userSnap.exists() && typeof userSnap.data()?.bikeCount === 'number'
            ? userSnap.data().bikeCount
            : 0;

        if (!isPro && currentCount >= 1) {
          throw new Error('QUOTA_EXCEEDED: Free plan is limited to 1 motorcycle. Upgrade to Pro for unlimited garage bikes.');
        }

        const nowIso = new Date().toISOString();
        transaction.set(bikeDocRef, {
          ...bike,
          userId,
          createdAt: nowIso,
          updatedAt: nowIso,
        });

        transaction.update(userDocRef, {
          bikeCount: currentCount + 1,
          lastBikeId: bike.id,
          lastBikeAction: 'create',
          updatedAt: nowIso,
        });
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('QUOTA_EXCEEDED')) {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, `motorcycles/${bike.id}`);
  }
}

export async function deleteMotorcycleFromFirestore(bikeId: string, userId?: string): Promise<void> {
  const currentUserId = userId || auth.currentUser?.uid;
  if (!currentUserId) {
    throw new Error('AUTH_REQUIRED: You must be logged in to delete a motorcycle.');
  }

  const bikeDocRef = doc(db, 'motorcycles', bikeId);
  const userDocRef = doc(db, 'users', currentUserId);

  try {
    await runTransaction(db, async (transaction) => {
      const bikeSnap = await transaction.get(bikeDocRef);
      const userSnap = await transaction.get(userDocRef);

      if (bikeSnap.exists()) {
        const currentCount =
          userSnap.exists() && typeof userSnap.data()?.bikeCount === 'number'
            ? userSnap.data().bikeCount
            : 1;

        const newCount = Math.max(0, currentCount - 1);
        const nowIso = new Date().toISOString();

        transaction.delete(bikeDocRef);
        transaction.update(userDocRef, {
          bikeCount: newCount,
          lastBikeId: bikeId,
          lastBikeAction: 'delete',
          updatedAt: nowIso,
        });
      }
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `motorcycles/${bikeId}`);
  }
}

export function subscribeToUserMotorcycles(
  userId: string,
  callback: (bikes: Motorcycle[]) => void
): () => void {
  const path = 'motorcycles';
  const q = query(collection(db, 'motorcycles'), where('userId', '==', userId));
  return onSnapshot(
    q,
    (snapshot) => {
      const bikes: Motorcycle[] = [];
      snapshot.forEach((docSnap) => {
        bikes.push(docSnap.data() as Motorcycle);
      });
      callback(bikes);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
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
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}
