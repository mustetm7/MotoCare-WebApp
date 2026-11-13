import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  limit,
  startAfter,
  serverTimestamp,
  writeBatch,
  runTransaction,
  Timestamp,
  QueryDocumentSnapshot,
  DocumentData,
} from 'firebase/firestore';
import {
  db,
  auth,
  OWNER_ADMIN_EMAIL,
  OperationType,
  handleFirestoreError,
  User,
  reauthenticateUserForDeletion,
  deleteCurrentAuthUser,
} from './firebase';
import {
  Motorcycle,
  MaintenanceReminder,
  ServiceRecord,
  PaymentSubmissionRecord,
  PaymentProvider,
  OfflineMutationItem,
  MigrationLedger,
  CloudSyncStatus,
} from '../types';
import {
  purgeDeletedUserAccountLocalData,
  getOfflineMutationQueue,
  saveOfflineMutationQueue,
  enqueueOfflineMutation,
  removeOfflineMutation,
  getQuarantinedMutationQueue,
  quarantineOfflineMutation,
  requeueQuarantinedMutation,
  classifyMutationFailure,
  getKnownCloudVersion,
  getKnownCloudRevision,
  recordKnownCloudVersion,
  removeKnownCloudVersion,
  recordCloudSyncOperation,
  createImmutablePreMigrationBackup,
  loadMigrationLedger,
  saveMigrationLedger,
  getPreMigrationBackupKey,
  parseTimestampToMillis,
  CONFIRMED_SAMPLE_MOTORCYCLE_IDS,
  CONFIRMED_SAMPLE_REMINDER_IDS,
  CONFIRMED_SAMPLE_SERVICE_RECORD_IDS,
} from './storage';

export const SAFE_BATCH_TRANSACTION_CHUNK_SIZE = 8;
export const SAFE_CLEANUP_DELETE_BATCH_CHUNK_SIZE = 50;

/**
 * Strips keys whose values are `undefined` so Firestore never rejects a document write.
 */
function stripUndefined<T extends Record<string, any>>(obj: T): Record<string, any> {
  const cleaned: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

/**
 * Normalizes a Firestore Timestamp, { seconds, nanoseconds }, Date, or ISO string
 * into an ISO-8601 string with millisecond precision preserved.
 */
export function normalizeFirestoreTimestampToIso(val: unknown): string | undefined {
  const ms = parseTimestampToMillis(val);
  if (ms !== null && Number.isFinite(ms)) {
    return new Date(ms).toISOString();
  }
  if (typeof val === 'string' && val.trim().length > 0) {
    return val;
  }
  return undefined;
}

/**
 * Resolves the next monotonic `cloudVersion` integer for an update operation.
 * - Legacy documents without `cloudVersion` receive `cloudVersion = 1` on their first update.
 * - Valid existing positive integer `cloudVersion` increments by +1 (`cloudVersion + 1`).
 * - Malformed `cloudVersion` values fail safely with `PERMISSION_DENIED: Malformed cloudVersion`.
 */
export function resolveNextCloudVersionForUpdate(
  existingData: Record<string, any> | undefined | null,
  entity: string = 'document',
  targetId: string = ''
): number {
  if (
    !existingData ||
    !('cloudVersion' in existingData) ||
    existingData.cloudVersion === undefined ||
    existingData.cloudVersion === null
  ) {
    return 1;
  }
  const current = existingData.cloudVersion;
  if (typeof current !== 'number' || !Number.isInteger(current) || current < 1) {
    throw new Error(
      `PERMISSION_DENIED: Malformed cloudVersion on ${entity} (${targetId}): ${String(current)}`
    );
  }
  return current + 1;
}

export interface ConcurrencyCheckOptions {
  enforceVersionCheck?: boolean;
  baseCloudUpdatedAt?: string | null;
  baseCloudVersion?: number | null;
  expectedCloudAbsent?: boolean;
  baseVersionUntrusted?: boolean;
}

function verifyTransactionConcurrency(params: {
  entity: 'motorcycle' | 'reminder' | 'serviceRecord';
  targetId: string;
  snapExists: boolean;
  cloudData: Record<string, any> | undefined;
  opts?: ConcurrencyCheckOptions;
}): void {
  const { entity, targetId, snapExists, cloudData, opts } = params;
  if (!opts || !opts.enforceVersionCheck) return;

  const cloudUpdatedAtIso = snapExists
    ? normalizeFirestoreTimestampToIso(cloudData?.updatedAt) || null
    : null;
  const cloudVersion =
    snapExists && typeof cloudData?.cloudVersion === 'number' ? cloudData.cloudVersion : null;

  if (opts.baseVersionUntrusted) {
    const err: any = new Error(
      `CONCURRENCY_CONFLICT: Untrusted or missing base cloud version for ${entity} (${targetId}); refusing to overwrite existing cloud state.`
    );
    err.conflictCloudUpdatedAt = cloudUpdatedAtIso;
    err.conflictCloudVersion = cloudVersion;
    err.conflictReason = `Missing trustworthy base cloud version for ${entity} (${targetId}).`;
    throw err;
  }

  if (opts.expectedCloudAbsent === true) {
    if (snapExists) {
      const err: any = new Error(
        `CONCURRENCY_CONFLICT: Expected ${entity} (${targetId}) to be absent in cloud, but it was already created by another device.`
      );
      err.conflictCloudUpdatedAt = cloudUpdatedAtIso;
      err.conflictCloudVersion = cloudVersion;
      err.conflictReason = `Document ${entity}/${targetId} was created concurrently by another device.`;
      throw err;
    }
    return;
  }

  const hasBaseVersionNum =
    typeof opts.baseCloudVersion === 'number' && Number.isFinite(opts.baseCloudVersion);
  const hasBaseUpdatedAtStr =
    typeof opts.baseCloudUpdatedAt === 'string' && opts.baseCloudUpdatedAt.length > 0;

  if (!hasBaseVersionNum && !hasBaseUpdatedAtStr) {
    if (snapExists) {
      const err: any = new Error(
        `CONCURRENCY_CONFLICT: Missing base cloud version for existing ${entity} (${targetId}).`
      );
      err.conflictCloudUpdatedAt = cloudUpdatedAtIso;
      err.conflictCloudVersion = cloudVersion;
      err.conflictReason = `Missing base cloud version for existing ${entity}/${targetId}.`;
      throw err;
    }
    return;
  }

  if (!snapExists) {
    const err: any = new Error(
      `CONCURRENCY_CONFLICT: ${entity} (${targetId}) was deleted on another device.`
    );
    err.conflictCloudUpdatedAt = null;
    err.conflictCloudVersion = null;
    err.conflictReason = `Document ${entity}/${targetId} was modified or removed by another device.`;
    throw err;
  }

  if (hasBaseVersionNum && cloudVersion !== null && opts.baseCloudVersion !== cloudVersion) {
    const err: any = new Error(
      `CONCURRENCY_CONFLICT: ${entity} (${targetId}) was modified by another device (base v${opts.baseCloudVersion} vs cloud v${cloudVersion}).`
    );
    err.conflictCloudUpdatedAt = cloudUpdatedAtIso;
    err.conflictCloudVersion = cloudVersion;
    err.conflictReason = `${entity} (${targetId}) was modified by another device (base v${opts.baseCloudVersion} vs cloud v${cloudVersion}).`;
    throw err;
  }

  if (
    hasBaseUpdatedAtStr &&
    cloudUpdatedAtIso !== null &&
    opts.baseCloudUpdatedAt !== cloudUpdatedAtIso
  ) {
    const err: any = new Error(
      `CONCURRENCY_CONFLICT: ${entity} (${targetId}) was modified by another device (base ${opts.baseCloudUpdatedAt} vs cloud ${cloudUpdatedAtIso}).`
    );
    err.conflictCloudUpdatedAt = cloudUpdatedAtIso;
    err.conflictCloudVersion = cloudVersion;
    err.conflictReason = `${entity} (${targetId}) was modified by another device (base ${opts.baseCloudUpdatedAt} vs cloud ${cloudUpdatedAtIso}).`;
    throw err;
  }
}

/**
 * Normalizes a payment reference number (uppercase, trimmed, spaces/hyphens removed)
 */
export function normalizeReferenceNumber(ref: string): string {
  return ref.trim().toUpperCase().replace(/[\s-]+/g, '');
}

/**
 * Validates a real GCash/payment reference number:
 * - Trimmed
 * - 8 to 64 characters after normalization
 * - Letters and digits only after normalization
 * - Rejects auto-generated placeholder prefixes (MC-GCASH-)
 */
export function validatePaymentReferenceNumber(rawRef: string): {
  valid: boolean;
  normalized: string;
  trimmed: string;
  error?: string;
} {
  const trimmed = (rawRef || '').trim();
  if (!trimmed) {
    return {
      valid: false,
      normalized: '',
      trimmed: '',
      error: 'Please enter your official GCash reference number (8–64 letters or digits).',
    };
  }
  if (/^MC-GCASH-/i.test(trimmed)) {
    return {
      valid: false,
      normalized: '',
      trimmed,
      error: 'Please enter the real GCash reference number from your receipt, not a placeholder code.',
    };
  }
  if (!/^[A-Za-z0-9\s-]+$/.test(trimmed)) {
    return {
      valid: false,
      normalized: '',
      trimmed,
      error: 'Reference number may only contain letters and digits (8–64 characters).',
    };
  }
  const normalized = normalizeReferenceNumber(trimmed);
  if (normalized.length < 8 || normalized.length > 64 || !/^[A-Z0-9]{8,64}$/.test(normalized)) {
    return {
      valid: false,
      normalized,
      trimmed,
      error: 'Reference number must be 8 to 64 letters and digits.',
    };
  }
  return { valid: true, normalized, trimmed };
}

/**
 * Computes a deterministic SHA-256 hex digest of a normalized reference number
 * for the `/paymentReferences/{refHash}` uniqueness index.
 */
export async function computeReferenceHash(rawRef: string): Promise<string> {
  const normalized = normalizeReferenceNumber(rawRef);
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const msgBuffer = new TextEncoder().encode(normalized);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  let hash = 5381;
  for (let i = 0; i < normalized.length; i++) {
    hash = (hash * 33) ^ normalized.charCodeAt(i);
  }
  return `ref_${(hash >>> 0).toString(16)}_${normalized}`;
}

/**
 * Helper: Safely converts a Firestore Timestamp, Date, or ISO string into a JavaScript Date
 */
export function parseExpiryToDate(val: any): Date | null {
  if (!val) return null;
  if (val instanceof Timestamp) {
    return val.toDate();
  }
  if (typeof val?.toDate === 'function') {
    return val.toDate();
  }
  if (typeof val?.toMillis === 'function') {
    return new Date(val.toMillis());
  }
  if (typeof val?.seconds === 'number') {
    return new Date(val.seconds * 1000);
  }
  if (val instanceof Date) {
    return isNaN(val.getTime()) ? null : val;
  }
  if (typeof val === 'string' || typeof val === 'number') {
    const parsed = new Date(val);
    return isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

/**
 * Date Math Helper: Computes the next monthly expiry date in Asia/Manila (UTC+8)
 * preserving the billing anchor day where possible (clamping to month end e.g. Jan 31 -> Feb 28).
 */
export function calculateNextMonthlyExpiry(
  baseDate: Date,
  billingAnchorDay?: number
): { expiryIso: string; expiryTimestamp: Timestamp; anchorDay: number } {
  const manilaOffsetMs = 8 * 60 * 60 * 1000;
  const manilaTime = new Date(baseDate.getTime() + manilaOffsetMs);

  const year = manilaTime.getUTCFullYear();
  const month = manilaTime.getUTCMonth();
  const currentDay = manilaTime.getUTCDate();
  const hours = manilaTime.getUTCHours();
  const minutes = manilaTime.getUTCMinutes();
  const seconds = manilaTime.getUTCSeconds();
  const ms = manilaTime.getUTCMilliseconds();

  const anchorDay =
    billingAnchorDay && billingAnchorDay >= 1 && billingAnchorDay <= 31
      ? billingAnchorDay
      : currentDay;

  const targetMonthTotal = month + 1;
  const targetYear = year + Math.floor(targetMonthTotal / 12);
  const targetMonth = targetMonthTotal % 12;

  const maxDaysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(anchorDay, maxDaysInTargetMonth);

  const nextManilaUtcMs = Date.UTC(
    targetYear,
    targetMonth,
    clampedDay,
    hours,
    minutes,
    seconds,
    ms
  );
  const expiryDateObj = new Date(nextManilaUtcMs - manilaOffsetMs);

  return {
    expiryIso: expiryDateObj.toISOString(),
    expiryTimestamp: Timestamp.fromDate(expiryDateObj),
    anchorDay,
  };
}

/**
 * Extracts the day of the month (1-31) in Asia/Manila (UTC+8) for a given Date.
 */
export function getManilaDay(date: Date): number {
  const manilaOffsetMs = 8 * 60 * 60 * 1000;
  const manilaTime = new Date(date.getTime() + manilaOffsetMs);
  return manilaTime.getUTCDate();
}

/**
 * Calculates remaining whole days from now until expiryDate
 */
export function calculateDaysRemaining(expiryVal: any, now: Date = new Date()): number {
  const expiry = parseExpiryToDate(expiryVal);
  if (!expiry) return 0;
  const diffMs = expiry.getTime() - now.getTime();
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Syncs or creates the User Profile in Firestore upon sign-in.
 * Read-cost & write-cost optimization: when the profile already exists, only writes
 * (`updateDoc`) if `displayName` or `photoURL` actually changed.
 */
export async function syncUserProfile(user: User): Promise<void> {
  const path = `users/${user.uid}`;
  try {
    const userRef = doc(db, 'users', user.uid);
    const existing = await getDoc(userRef);

    if (!existing.exists()) {
      await setDoc(userRef, {
        id: user.uid,
        uid: user.uid,
        email: (user.email || '').toLowerCase(),
        displayName: user.displayName || 'MotoCare Rider',
        photoURL: user.photoURL || '',
        role: 'rider',
        subscriptionTier: 'free',
        subscriptionStatus: 'free',
        paymentStatus: 'unpaid_free',
        bikeCount: 0,
        pendingSubmissionId: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        lastLoginAt: serverTimestamp(),
      });
    } else {
      const existingData = existing.data() || {};
      const nextDisplayName = user.displayName || existingData.displayName || 'MotoCare Rider';
      const nextPhotoURL = user.photoURL || existingData.photoURL || '';
      const displayNameChanged = existingData.displayName !== nextDisplayName;
      const photoUrlChanged = (existingData.photoURL || '') !== nextPhotoURL;

      if (displayNameChanged || photoUrlChanged) {
        await updateDoc(userRef, {
          displayName: nextDisplayName,
          photoURL: nextPhotoURL,
          updatedAt: serverTimestamp(),
        });
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

/**
 * Determines whether a user is allowed to create an additional motorcycle in Firestore.
 */
export function canCreateMotorcycleInGarage(params: {
  authUser: { uid?: string; email?: string | null; emailVerified?: boolean } | null | undefined;
  targetUserId: string;
  userDocData?: Record<string, any> | null;
  currentCount: number;
  nowMs?: number;
}): boolean {
  const { authUser, targetUserId, userDocData, currentCount, nowMs = Date.now() } = params;

  const isVerifiedOwnerAdmin =
    Boolean(authUser) &&
    authUser?.email?.toLowerCase() === OWNER_ADMIN_EMAIL &&
    authUser?.emailVerified === true &&
    authUser?.uid === targetUserId;

  if (isVerifiedOwnerAdmin) {
    return true;
  }

  const tier = userDocData?.subscriptionTier;
  const status = userDocData?.subscriptionStatus;
  const expiryDateObj = parseExpiryToDate(userDocData?.expiryDate);
  const isActivePaidPro =
    tier === 'pro' &&
    status !== 'revoked' &&
    expiryDateObj !== null &&
    expiryDateObj.getTime() > nowMs;

  if (isActivePaidPro) {
    return true;
  }

  return currentCount < 1;
}

function obtainMonotonicServerTimestamp(previousUpdatedAt?: any): { tsValue: any; tsIso: string } {
  const raw = serverTimestamp();
  const prevMs = parseTimestampToMillis(previousUpdatedAt) ?? 0;
  const rawMs = parseTimestampToMillis(raw) ?? 0;
  if (rawMs > 0 && prevMs > 0 && rawMs <= prevMs && typeof Timestamp?.fromDate === 'function') {
    const bumpedDate = new Date(prevMs + 1);
    const bumpedTs = Timestamp.fromDate(bumpedDate);
    return { tsValue: bumpedTs, tsIso: bumpedDate.toISOString() };
  }
  const iso =
    normalizeFirestoreTimestampToIso(raw) ||
    new Date(prevMs > 0 ? Math.max(Date.now(), prevMs + 1) : Date.now()).toISOString();
  return { tsValue: raw, tsIso: iso };
}

/**
 * Saves or updates a Motorcycle document in Firestore.
 * Uses a Firestore Transaction when creating or updating a motorcycle to atomically enforce
 * `bikeCount`, ownership, and `cloudVersion` concurrency.
 */
export async function saveMotorcycleToFirestore(
  bike: Motorcycle,
  userId: string,
  concurrencyOpts?: ConcurrencyCheckOptions
): Promise<Motorcycle> {
  const path = `motorcycles/${bike.id}`;
  try {
    const bikeRef = doc(db, 'motorcycles', bike.id);
    const userRef = doc(db, 'users', userId);
    const currentAuthUser = auth.currentUser;

    const result = await runTransaction(db, async (transaction) => {
      const bikeSnap = await transaction.get(bikeRef);
      const userSnap = await transaction.get(userRef);

      verifyTransactionConcurrency({
        entity: 'motorcycle',
        targetId: bike.id,
        snapExists: bikeSnap.exists(),
        cloudData: bikeSnap.data(),
        opts: concurrencyOpts,
      });

      if (!bikeSnap.exists()) {
        const { tsValue: tsNow, tsIso } = obtainMonotonicServerTimestamp();
        const userData = userSnap.exists() ? userSnap.data() : null;
        const currentCount =
          userData && typeof userData.bikeCount === 'number' ? userData.bikeCount : 0;

        const isAllowedToCreate = canCreateMotorcycleInGarage({
          authUser: currentAuthUser,
          targetUserId: userId,
          userDocData: userData,
          currentCount,
          nowMs: Date.now(),
        });

        if (!isAllowedToCreate) {
          throw new Error(
            'QUOTA_EXCEEDED: Free Plan Limit Reached: Only 1 motorcycle is allowed on the Free tier. Upgrade to MotoCare Pro for unlimited motorcycles.'
          );
        }

        const version = 1;
        const payload = stripUndefined({
          ...bike,
          userId,
          cloudVersion: version,
          createdAt: tsNow,
          updatedAt: tsNow,
          timestampSource: 'server',
        });
        if (typeof payload.photoUrl === 'string' && payload.photoUrl.length > 2000) {
          payload.photoUrl = payload.photoUrl.slice(0, 2000);
        }

        transaction.set(bikeRef, payload);

        if (userSnap.exists()) {
          transaction.update(userRef, {
            bikeCount: currentCount + 1,
            lastBikeId: bike.id,
            lastBikeAction: 'create',
            updatedAt: tsNow,
          });
        }
        return { version, tsIso };
      } else {
        const existingData = bikeSnap.data() || {};
        if (existingData.userId && existingData.userId !== userId) {
          throw new Error(
            `PERMISSION_DENIED: Cannot modify motorcycle (${bike.id}) owned by another user.`
          );
        }
        const version = resolveNextCloudVersionForUpdate(existingData, 'motorcycle', bike.id);
        const { tsValue: tsNow, tsIso } = obtainMonotonicServerTimestamp(existingData.updatedAt);

        const payload = stripUndefined({
          ...bike,
          userId,
          cloudVersion: version,
          updatedAt: tsNow,
          timestampSource: 'server',
        });
        if (typeof payload.photoUrl === 'string' && payload.photoUrl.length > 2000) {
          payload.photoUrl = payload.photoUrl.slice(0, 2000);
        }
        transaction.set(bikeRef, payload, { merge: true });
        return { version, tsIso };
      }
    });

    recordKnownCloudVersion(userId, 'motorcycle', bike.id, result.tsIso, result.version);
    recordCloudSyncOperation({
      userId,
      status: 'success',
      operation: 'upsert_motorcycle',
      entity: 'motorcycle',
      targetId: bike.id,
      detail: `Saved motorcycle ${bike.brand} ${bike.model} (v${result.version})`,
    });

    return {
      ...bike,
      userId,
      cloudVersion: result.version,
      updatedAt: result.tsIso,
      timestampSource: 'server',
    };
  } catch (error: any) {
    const msg = String(error?.message || '');
    if (
      msg.includes('CONCURRENCY_CONFLICT') ||
      msg.includes('QUOTA_EXCEEDED') ||
      msg.includes('PERMISSION_DENIED')
    ) {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

/**
 * Updates specific fields on an existing Motorcycle document in Firestore
 * inside a transaction with `cloudVersion` increment and concurrency checks.
 */
export async function updateMotorcycleFieldsInFirestore(
  bikeId: string,
  userId: string,
  fields: Partial<Motorcycle> & Record<string, any>,
  concurrencyOpts?: ConcurrencyCheckOptions
): Promise<{ cloudVersion: number; updatedAtIso: string }> {
  const path = `motorcycles/${bikeId}`;
  try {
    const bikeRef = doc(db, 'motorcycles', bikeId);
    const result = await runTransaction(db, async (transaction) => {
      const bikeSnap = await transaction.get(bikeRef);
      verifyTransactionConcurrency({
        entity: 'motorcycle',
        targetId: bikeId,
        snapExists: bikeSnap.exists(),
        cloudData: bikeSnap.data(),
        opts: concurrencyOpts,
      });

      if (!bikeSnap.exists()) {
        throw new Error(`NOT_FOUND: Motorcycle ${bikeId} does not exist.`);
      }

      const existingData = bikeSnap.data() || {};
      if (existingData.userId && existingData.userId !== userId) {
        throw new Error(
          `PERMISSION_DENIED: Cannot update motorcycle (${bikeId}) owned by another user.`
        );
      }

      const nextVersion = resolveNextCloudVersionForUpdate(existingData, 'motorcycle', bikeId);
      const { tsValue: tsNow, tsIso } = obtainMonotonicServerTimestamp(existingData.updatedAt);

      const sanitizedFields = stripUndefined({
        ...fields,
        cloudVersion: nextVersion,
        updatedAt: tsNow,
        timestampSource: 'server',
      });
      if (typeof sanitizedFields.photoUrl === 'string' && sanitizedFields.photoUrl.length > 2000) {
        sanitizedFields.photoUrl = sanitizedFields.photoUrl.slice(0, 2000);
      }

      transaction.update(bikeRef, sanitizedFields);
      return { cloudVersion: nextVersion, updatedAtIso: tsIso };
    });

    recordKnownCloudVersion(userId, 'motorcycle', bikeId, result.updatedAtIso, result.cloudVersion);
    return result;
  } catch (error: any) {
    const msg = String(error?.message || '');
    if (
      msg.includes('CONCURRENCY_CONFLICT') ||
      msg.includes('PERMISSION_DENIED') ||
      msg.includes('NOT_FOUND')
    ) {
      throw error;
    }
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

/**
 * Deletes a Motorcycle document from Firestore and atomically decrements `bikeCount` on `/users/{userId}`.
 * By default (`deleteReminders !== false`), removes scheduled reminders for this bike in chunked batches
 * while preserving historical `serviceRecords` unless `deleteServiceHistoryConfirmed: true` is passed.
 */
export async function deleteMotorcycleFromFirestore(
  bikeId: string,
  userId?: string,
  options?: ConcurrencyCheckOptions & {
    deleteReminders?: boolean;
    deleteServiceHistoryConfirmed?: boolean;
  }
): Promise<void> {
  const path = `motorcycles/${bikeId}`;
  try {
    const bikeRef = doc(db, 'motorcycles', bikeId);
    const resolvedOwnerId = await runTransaction(db, async (transaction) => {
      const bikeSnap = await transaction.get(bikeRef);
      verifyTransactionConcurrency({
        entity: 'motorcycle',
        targetId: bikeId,
        snapExists: bikeSnap.exists(),
        cloudData: bikeSnap.data(),
        opts: options,
      });

      if (!bikeSnap.exists()) return userId || null;

      const existingData = bikeSnap.data() || {};
      if (userId && existingData.userId && existingData.userId !== userId) {
        throw new Error(
          `PERMISSION_DENIED: Cannot delete motorcycle (${bikeId}) owned by another user.`
        );
      }

      const ownerId = userId || existingData.userId;
      if (ownerId) {
        const userRef = doc(db, 'users', ownerId);
        const userSnap = await transaction.get(userRef);

        transaction.delete(bikeRef);

        if (userSnap.exists()) {
          const userData = userSnap.data();
          const currentCount =
            typeof userData.bikeCount === 'number' ? userData.bikeCount : 1;
          const nextCount = Math.max(0, currentCount - 1);

          transaction.update(userRef, {
            bikeCount: nextCount,
            lastBikeId: bikeId,
            lastBikeAction: 'delete',
            updatedAt: serverTimestamp(),
          });
        }
      } else {
        transaction.delete(bikeRef);
      }
      return ownerId || null;
    });

    if (resolvedOwnerId) {
      removeKnownCloudVersion(resolvedOwnerId, 'motorcycle', bikeId);

      // Delete associated reminders in chunked batches of SAFE_CLEANUP_DELETE_BATCH_CHUNK_SIZE (50)
      if (options?.deleteReminders !== false) {
        const remsSnap = await getDocs(
          query(collection(db, 'reminders'), where('userId', '==', resolvedOwnerId))
        );
        const matchingRemDocs = remsSnap.docs.filter((d) => d.data()?.bikeId === bikeId);
        for (let i = 0; i < matchingRemDocs.length; i += SAFE_CLEANUP_DELETE_BATCH_CHUNK_SIZE) {
          const chunk = matchingRemDocs.slice(i, i + SAFE_CLEANUP_DELETE_BATCH_CHUNK_SIZE);
          const batch = writeBatch(db);
          for (const remDoc of chunk) {
            batch.delete(remDoc.ref);
            removeKnownCloudVersion(resolvedOwnerId, 'reminder', remDoc.id);
          }
          await batch.commit();
        }
      }

      // Only delete service history when explicitly confirmed
      if (options?.deleteServiceHistoryConfirmed === true) {
        const recsSnap = await getDocs(
          query(collection(db, 'serviceRecords'), where('userId', '==', resolvedOwnerId))
        );
        const matchingRecDocs = recsSnap.docs.filter((d) => d.data()?.bikeId === bikeId);
        for (let i = 0; i < matchingRecDocs.length; i += SAFE_CLEANUP_DELETE_BATCH_CHUNK_SIZE) {
          const chunk = matchingRecDocs.slice(i, i + SAFE_CLEANUP_DELETE_BATCH_CHUNK_SIZE);
          const batch = writeBatch(db);
          for (const recDoc of chunk) {
            batch.delete(recDoc.ref);
            removeKnownCloudVersion(resolvedOwnerId, 'serviceRecord', recDoc.id);
          }
          await batch.commit();
        }
      }
    }
  } catch (error: any) {
    const msg = String(error?.message || '');
    if (msg.includes('CONCURRENCY_CONFLICT') || msg.includes('PERMISSION_DENIED')) {
      throw error;
    }
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

/**
 * Saves or updates a Maintenance Reminder document in Firestore with monotonic `cloudVersion`
 */
export async function saveReminderToFirestore(
  reminder: MaintenanceReminder,
  userId: string,
  concurrencyOpts?: ConcurrencyCheckOptions
): Promise<MaintenanceReminder> {
  const path = `reminders/${reminder.id}`;
  try {
    const remRef = doc(db, 'reminders', reminder.id);
    const result = await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(remRef);
      verifyTransactionConcurrency({
        entity: 'reminder',
        targetId: reminder.id,
        snapExists: snap.exists(),
        cloudData: snap.data(),
        opts: concurrencyOpts,
      });

      let version = 1;
      let prevUpdatedAt: any;
      if (snap.exists()) {
        const existingData = snap.data() || {};
        if (existingData.userId && existingData.userId !== userId) {
          throw new Error(
            `PERMISSION_DENIED: Cannot modify reminder (${reminder.id}) owned by another user.`
          );
        }
        version = resolveNextCloudVersionForUpdate(existingData, 'reminder', reminder.id);
        prevUpdatedAt = existingData.updatedAt;
      }

      const { tsValue: tsNow, tsIso } = obtainMonotonicServerTimestamp(prevUpdatedAt);

      const payload = stripUndefined({
        ...reminder,
        userId,
        cloudVersion: version,
        createdAt: snap.exists() ? snap.data()?.createdAt || tsNow : tsNow,
        updatedAt: tsNow,
        timestampSource: 'server',
      });
      transaction.set(remRef, payload, { merge: true });
      return { version, tsIso };
    });

    recordKnownCloudVersion(userId, 'reminder', reminder.id, result.tsIso, result.version);

    return {
      ...reminder,
      userId,
      cloudVersion: result.version,
      updatedAt: result.tsIso,
      timestampSource: 'server',
    };
  } catch (error: any) {
    const msg = String(error?.message || '');
    if (msg.includes('CONCURRENCY_CONFLICT') || msg.includes('PERMISSION_DENIED')) {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

/**
 * Transactional Batch Helper for Reminders:
 * Splits writes into `SAFE_BATCH_TRANSACTION_CHUNK_SIZE` (8) chunks so each transaction
 * stays well below the 20-document-access rules limit, performs all reads before writes,
 * validates parent motorcycle ownership, and protects newer cloud revisions.
 */
export async function saveRemindersBatchToFirestore(
  reminders: MaintenanceReminder[],
  userId: string,
  options?:
    | Record<string, ConcurrencyCheckOptions | any>
    | {
        onChunkCommitted?: (committedIds: string[]) => void;
        concurrencyMap?: Record<string, ConcurrencyCheckOptions>;
      }
): Promise<void> {
  if (!reminders || reminders.length === 0) return;

  const onChunkCommitted =
    typeof (options as any)?.onChunkCommitted === 'function'
      ? ((options as any).onChunkCommitted as (ids: string[]) => void)
      : undefined;
  const concurrencyMap: Record<string, ConcurrencyCheckOptions> =
    (options as any)?.concurrencyMap || (options as Record<string, ConcurrencyCheckOptions>) || {};

  for (let i = 0; i < reminders.length; i += SAFE_BATCH_TRANSACTION_CHUNK_SIZE) {
    const chunk = reminders.slice(i, i + SAFE_BATCH_TRANSACTION_CHUNK_SIZE);

    const committedChunkMeta = await runTransaction(db, async (transaction) => {
      // 1. ALL READS FIRST: read distinct parent motorcycles and target reminder documents
      const distinctBikeIds = Array.from(
        new Set(chunk.map((r) => r.bikeId).filter((id): id is string => Boolean(id)))
      );
      const bikeSnaps = new Map<string, any>();
      for (const bikeId of distinctBikeIds) {
        const bSnap = await transaction.get(doc(db, 'motorcycles', bikeId));
        bikeSnaps.set(bikeId, bSnap);
      }

      const remSnaps = new Map<string, any>();
      for (const rem of chunk) {
        const rSnap = await transaction.get(doc(db, 'reminders', rem.id));
        remSnaps.set(rem.id, rSnap);
      }

      // 2. VALIDATE & STAGE WRITES
      const committed: Array<{ id: string; version: number; tsIso: string }> = [];
      for (const rem of chunk) {
        if (rem.bikeId) {
          const parentSnap = bikeSnaps.get(rem.bikeId);
          if (!parentSnap || !parentSnap.exists() || parentSnap.data()?.userId !== userId) {
            throw new Error(
              `PERMISSION_DENIED: Reminder (${rem.id}) references nonexistent or unauthorized parent motorcycle (${rem.bikeId}).`
            );
          }
        }

        const rSnap = remSnaps.get(rem.id);
        const itemOpts = concurrencyMap[rem.id];
        if (itemOpts && typeof itemOpts === 'object' && 'enforceVersionCheck' in itemOpts) {
          verifyTransactionConcurrency({
            entity: 'reminder',
            targetId: rem.id,
            snapExists: rSnap.exists(),
            cloudData: rSnap.data(),
            opts: itemOpts,
          });
        }

        const tsNow = serverTimestamp();
        const tsIso = normalizeFirestoreTimestampToIso(tsNow) || new Date().toISOString();

        if (rSnap.exists()) {
          const existingData = rSnap.data() || {};
          if (existingData.userId && existingData.userId !== userId) {
            throw new Error(
              `PERMISSION_DENIED: Cannot modify reminder (${rem.id}) owned by another user.`
            );
          }

          // Protect newer cloud revision when not explicitly forcing overwrite
          const cloudVer =
            typeof existingData.cloudVersion === 'number' ? existingData.cloudVersion : null;
          const localVer = typeof rem.cloudVersion === 'number' ? rem.cloudVersion : null;
          if (cloudVer !== null && localVer !== null && localVer < cloudVer) {
            continue;
          }
          const cloudMs = parseTimestampToMillis(existingData.updatedAt);
          const localMs = parseTimestampToMillis(rem.updatedAt);
          if (cloudMs !== null && localMs !== null && localMs < cloudMs && cloudVer !== null) {
            continue;
          }

          const nextVersion = resolveNextCloudVersionForUpdate(existingData, 'reminder', rem.id);
          const payload = stripUndefined({
            ...rem,
            userId,
            cloudVersion: nextVersion,
            updatedAt: tsNow,
            timestampSource: 'server',
          });
          transaction.set(doc(db, 'reminders', rem.id), payload, { merge: true });
          committed.push({ id: rem.id, version: nextVersion, tsIso });
        } else {
          const payload = stripUndefined({
            ...rem,
            userId,
            cloudVersion: 1,
            createdAt: tsNow,
            updatedAt: tsNow,
            timestampSource: 'server',
          });
          transaction.set(doc(db, 'reminders', rem.id), payload);
          committed.push({ id: rem.id, version: 1, tsIso });
        }
      }

      return committed;
    });

    for (const meta of committedChunkMeta) {
      recordKnownCloudVersion(userId, 'reminder', meta.id, meta.tsIso, meta.version);
    }
    if (onChunkCommitted) {
      onChunkCommitted(chunk.map((r) => r.id));
    }
  }
}

/**
 * Deletes a Maintenance Reminder document from Firestore
 */
export async function deleteReminderFromFirestore(
  reminderId: string,
  userId?: string,
  concurrencyOpts?: ConcurrencyCheckOptions
): Promise<void> {
  const path = `reminders/${reminderId}`;
  try {
    const remRef = doc(db, 'reminders', reminderId);
    if (concurrencyOpts?.enforceVersionCheck) {
      await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(remRef);
        verifyTransactionConcurrency({
          entity: 'reminder',
          targetId: reminderId,
          snapExists: snap.exists(),
          cloudData: snap.data(),
          opts: concurrencyOpts,
        });
        if (snap.exists()) {
          if (userId && snap.data()?.userId && snap.data()?.userId !== userId) {
            throw new Error(
              `PERMISSION_DENIED: Cannot delete reminder (${reminderId}) owned by another user.`
            );
          }
          transaction.delete(remRef);
        }
      });
    } else {
      await deleteDoc(remRef);
    }
    if (userId) {
      removeKnownCloudVersion(userId, 'reminder', reminderId);
    }
  } catch (error: any) {
    const msg = String(error?.message || '');
    if (msg.includes('CONCURRENCY_CONFLICT') || msg.includes('PERMISSION_DENIED')) {
      throw error;
    }
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

/**
 * Saves or updates a Service Record document in Firestore (with optional atomic linked reminder reset)
 */
export async function saveServiceRecordToFirestore(
  record: ServiceRecord,
  userId: string,
  linkedReminderToUpdate?: MaintenanceReminder,
  concurrencyOpts?: ConcurrencyCheckOptions
): Promise<ServiceRecord> {
  const path = `serviceRecords/${record.id}`;
  try {
    const recRef = doc(db, 'serviceRecords', record.id);
    const result = await runTransaction(db, async (transaction) => {
      // Read all docs before writes
      const recSnap = await transaction.get(recRef);
      const remRef = linkedReminderToUpdate
        ? doc(db, 'reminders', linkedReminderToUpdate.id)
        : null;
      const remSnap = remRef ? await transaction.get(remRef) : null;

      verifyTransactionConcurrency({
        entity: 'serviceRecord',
        targetId: record.id,
        snapExists: recSnap.exists(),
        cloudData: recSnap.data(),
        opts: concurrencyOpts,
      });

      let recVersion = 1;
      let prevUpdatedAt: any;
      if (recSnap.exists()) {
        const existingData = recSnap.data() || {};
        if (existingData.userId && existingData.userId !== userId) {
          throw new Error(
            `PERMISSION_DENIED: Cannot modify service record (${record.id}) owned by another user.`
          );
        }
        recVersion = resolveNextCloudVersionForUpdate(existingData, 'serviceRecord', record.id);
        prevUpdatedAt = existingData.updatedAt;
      }

      const { tsValue: tsNow, tsIso } = obtainMonotonicServerTimestamp(prevUpdatedAt);

      const sanitizedParts = Array.isArray(record.parts)
        ? record.parts.slice(0, 50).map((p) => ({
            name: String(p.name || '').slice(0, 200),
            costPhp: Number(p.costPhp) || 0,
          }))
        : [];

      const recPayload = stripUndefined({
        ...record,
        parts: sanitizedParts,
        userId,
        cloudVersion: recVersion,
        createdAt: recSnap.exists() ? recSnap.data()?.createdAt || tsNow : tsNow,
        updatedAt: tsNow,
        timestampSource: 'server',
      });
      if (typeof recPayload.photoUrl === 'string' && recPayload.photoUrl.length > 2000) {
        recPayload.photoUrl = recPayload.photoUrl.slice(0, 2000);
      }

      transaction.set(recRef, recPayload, { merge: true });

      let remVersion: number | null = null;
      if (linkedReminderToUpdate && remRef) {
        remVersion =
          remSnap && remSnap.exists()
            ? resolveNextCloudVersionForUpdate(
                remSnap.data(),
                'reminder',
                linkedReminderToUpdate.id
              )
            : 1;
        const remPayload = stripUndefined({
          ...linkedReminderToUpdate,
          userId,
          cloudVersion: remVersion,
          updatedAt: tsNow,
          timestampSource: 'server',
        });
        transaction.set(remRef, remPayload, { merge: true });
      }

      return { recVersion, remVersion, tsIso };
    });

    recordKnownCloudVersion(userId, 'serviceRecord', record.id, result.tsIso, result.recVersion);
    if (linkedReminderToUpdate && result.remVersion !== null) {
      recordKnownCloudVersion(
        userId,
        'reminder',
        linkedReminderToUpdate.id,
        result.tsIso,
        result.remVersion
      );
    }

    return {
      ...record,
      userId,
      cloudVersion: result.recVersion,
      updatedAt: result.tsIso,
      timestampSource: 'server',
    };
  } catch (error: any) {
    const msg = String(error?.message || '');
    if (msg.includes('CONCURRENCY_CONFLICT') || msg.includes('PERMISSION_DENIED')) {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

/**
 * Transactional Batch Helper for Service Records:
 * Splits writes into `SAFE_BATCH_TRANSACTION_CHUNK_SIZE` (8) chunks, performs all reads before writes,
 * verifies parent motorcycle ownership if the parent exists, and protects newer cloud revisions.
 */
export async function saveServiceRecordsBatchToFirestore(
  records: ServiceRecord[],
  userId: string,
  options?:
    | Record<string, ConcurrencyCheckOptions | any>
    | {
        onChunkCommitted?: (committedIds: string[]) => void;
        concurrencyMap?: Record<string, ConcurrencyCheckOptions>;
      }
): Promise<void> {
  if (!records || records.length === 0) return;

  const onChunkCommitted =
    typeof (options as any)?.onChunkCommitted === 'function'
      ? ((options as any).onChunkCommitted as (ids: string[]) => void)
      : undefined;
  const concurrencyMap: Record<string, ConcurrencyCheckOptions> =
    (options as any)?.concurrencyMap || (options as Record<string, ConcurrencyCheckOptions>) || {};

  for (let i = 0; i < records.length; i += SAFE_BATCH_TRANSACTION_CHUNK_SIZE) {
    const chunk = records.slice(i, i + SAFE_BATCH_TRANSACTION_CHUNK_SIZE);

    const committedChunkMeta = await runTransaction(db, async (transaction) => {
      // 1. ALL READS FIRST: read distinct parent motorcycles and target serviceRecord documents
      const distinctBikeIds = Array.from(
        new Set(chunk.map((r) => r.bikeId).filter((id): id is string => Boolean(id)))
      );
      const bikeSnaps = new Map<string, any>();
      for (const bikeId of distinctBikeIds) {
        const bSnap = await transaction.get(doc(db, 'motorcycles', bikeId));
        bikeSnaps.set(bikeId, bSnap);
      }

      const recSnaps = new Map<string, any>();
      for (const rec of chunk) {
        const rSnap = await transaction.get(doc(db, 'serviceRecords', rec.id));
        recSnaps.set(rec.id, rSnap);
      }

      // 2. VALIDATE & STAGE WRITES
      const committed: Array<{ id: string; version: number; tsIso: string }> = [];
      for (const rec of chunk) {
        if (rec.bikeId) {
          const parentSnap = bikeSnaps.get(rec.bikeId);
          // Service records for retired motorcycles are allowed if parent no longer exists,
          // but if the parent motorcycle DOES exist and belongs to another user, reject!
          if (parentSnap && parentSnap.exists() && parentSnap.data()?.userId !== userId) {
            throw new Error(
              `PERMISSION_DENIED: Service record (${rec.id}) references a motorcycle (${rec.bikeId}) owned by another user.`
            );
          }
        }

        const rSnap = recSnaps.get(rec.id);
        const itemOpts = concurrencyMap[rec.id];
        if (itemOpts && typeof itemOpts === 'object' && 'enforceVersionCheck' in itemOpts) {
          verifyTransactionConcurrency({
            entity: 'serviceRecord',
            targetId: rec.id,
            snapExists: rSnap.exists(),
            cloudData: rSnap.data(),
            opts: itemOpts,
          });
        }

        const tsNow = serverTimestamp();
        const tsIso = normalizeFirestoreTimestampToIso(tsNow) || new Date().toISOString();

        const sanitizedParts = Array.isArray(rec.parts)
          ? rec.parts.slice(0, 50).map((p) => ({
              name: String(p.name || '').slice(0, 200),
              costPhp: Number(p.costPhp) || 0,
            }))
          : [];

        if (rSnap.exists()) {
          const existingData = rSnap.data() || {};
          if (existingData.userId && existingData.userId !== userId) {
            throw new Error(
              `PERMISSION_DENIED: Cannot modify service record (${rec.id}) owned by another user.`
            );
          }

          const cloudVer =
            typeof existingData.cloudVersion === 'number' ? existingData.cloudVersion : null;
          const localVer = typeof rec.cloudVersion === 'number' ? rec.cloudVersion : null;
          if (cloudVer !== null && localVer !== null && localVer < cloudVer) {
            continue;
          }
          const cloudMs = parseTimestampToMillis(existingData.updatedAt);
          const localMs = parseTimestampToMillis(rec.updatedAt);
          if (cloudMs !== null && localMs !== null && localMs < cloudMs && cloudVer !== null) {
            continue;
          }

          const nextVersion = resolveNextCloudVersionForUpdate(
            existingData,
            'serviceRecord',
            rec.id
          );
          const payload = stripUndefined({
            ...rec,
            parts: sanitizedParts,
            userId,
            cloudVersion: nextVersion,
            updatedAt: tsNow,
            timestampSource: 'server',
          });
          if (typeof payload.photoUrl === 'string' && payload.photoUrl.length > 2000) {
            payload.photoUrl = payload.photoUrl.slice(0, 2000);
          }
          transaction.set(doc(db, 'serviceRecords', rec.id), payload, { merge: true });
          committed.push({ id: rec.id, version: nextVersion, tsIso });
        } else {
          const payload = stripUndefined({
            ...rec,
            parts: sanitizedParts,
            userId,
            cloudVersion: 1,
            createdAt: tsNow,
            updatedAt: tsNow,
            timestampSource: 'server',
          });
          if (typeof payload.photoUrl === 'string' && payload.photoUrl.length > 2000) {
            payload.photoUrl = payload.photoUrl.slice(0, 2000);
          }
          transaction.set(doc(db, 'serviceRecords', rec.id), payload);
          committed.push({ id: rec.id, version: 1, tsIso });
        }
      }

      return committed;
    });

    for (const meta of committedChunkMeta) {
      recordKnownCloudVersion(userId, 'serviceRecord', meta.id, meta.tsIso, meta.version);
    }
    if (onChunkCommitted) {
      onChunkCommitted(chunk.map((r) => r.id));
    }
  }
}

/**
 * Deletes a Service Record document from Firestore
 */
export async function deleteServiceRecordFromFirestore(
  recordId: string,
  userId?: string,
  concurrencyOpts?: ConcurrencyCheckOptions
): Promise<void> {
  const path = `serviceRecords/${recordId}`;
  try {
    const recRef = doc(db, 'serviceRecords', recordId);
    if (concurrencyOpts?.enforceVersionCheck) {
      await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(recRef);
        verifyTransactionConcurrency({
          entity: 'serviceRecord',
          targetId: recordId,
          snapExists: snap.exists(),
          cloudData: snap.data(),
          opts: concurrencyOpts,
        });
        if (snap.exists()) {
          if (userId && snap.data()?.userId && snap.data()?.userId !== userId) {
            throw new Error(
              `PERMISSION_DENIED: Cannot delete service record (${recordId}) owned by another user.`
            );
          }
          transaction.delete(recRef);
        }
      });
    } else {
      await deleteDoc(recRef);
    }
    if (userId) {
      removeKnownCloudVersion(userId, 'serviceRecord', recordId);
    }
  } catch (error: any) {
    const msg = String(error?.message || '');
    if (msg.includes('CONCURRENCY_CONFLICT') || msg.includes('PERMISSION_DENIED')) {
      throw error;
    }
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// ============================================================================
// OFFLINE QUEUE FLUSH, QUARANTINE RECOVERY & DIRECT ONLINE WRITE HELPERS
// ============================================================================

const MAX_OFFLINE_MUTATION_RETRIES = 5;

function hasTrustworthyBaseVersionMetadata(item: OfflineMutationItem): boolean {
  if (item.baseVersionUntrusted) return false;
  if (item.expectedCloudAbsent === true) return true;
  if (typeof item.baseCloudVersion === 'number' && Number.isFinite(item.baseCloudVersion)) {
    return true;
  }
  if (typeof item.baseCloudUpdatedAt === 'string' && item.baseCloudUpdatedAt.length > 0) {
    return true;
  }
  return false;
}

/**
 * Replays queued offline mutations for `userId` in FIFO order with atomic write-time
 * concurrency verification and automatic quarantine on permanent/conflict/exhausted failures.
 */
export async function flushOfflineMutationQueue(userId: string): Promise<{
  skippedOffline: boolean;
  flushedCount: number;
  failedCount: number;
  quarantinedCount: number;
}> {
  if (!userId) {
    return { skippedOffline: false, flushedCount: 0, failedCount: 0, quarantinedCount: 0 };
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { skippedOffline: true, flushedCount: 0, failedCount: 0, quarantinedCount: 0 };
  }

  const queue = getOfflineMutationQueue(userId);
  if (queue.length === 0) {
    return { skippedOffline: false, flushedCount: 0, failedCount: 0, quarantinedCount: 0 };
  }

  let flushedCount = 0;
  let failedCount = 0;
  let quarantinedCount = 0;
  const remainingQueue: OfflineMutationItem[] = [];

  for (const item of queue) {
    // Check if legacy queued item lacks trustworthy base version metadata
    if (!hasTrustworthyBaseVersionMetadata(item)) {
      const untrustedItem: OfflineMutationItem = {
        ...item,
        baseVersionUntrusted: true,
      };
      quarantineOfflineMutation({
        item: untrustedItem,
        lastError:
          'CONCURRENCY_CONFLICT: Queued mutation lacks trustworthy base cloud version metadata.',
        retryCount: (item.retryCount || 0) + 1,
        failureClassification: 'version_conflict',
        conflictReason:
          'Mutation was queued without a verified base cloud version and cannot safely overwrite existing cloud documents.',
      });
      quarantinedCount += 1;
      failedCount += 1;
      continue;
    }

    const concurrencyOpts: ConcurrencyCheckOptions = {
      enforceVersionCheck: true,
      baseCloudUpdatedAt: item.baseCloudUpdatedAt,
      baseCloudVersion: item.baseCloudVersion,
      expectedCloudAbsent: item.expectedCloudAbsent,
      baseVersionUntrusted: item.baseVersionUntrusted,
    };

    try {
      if (item.entity === 'motorcycle') {
        if (item.action === 'upsert' && item.payload) {
          await saveMotorcycleToFirestore(
            { ...(item.payload as unknown as Motorcycle), id: item.targetId },
            userId,
            concurrencyOpts
          );
        } else if (item.action === 'update_fields' && item.payload) {
          await updateMotorcycleFieldsInFirestore(
            item.targetId,
            userId,
            item.payload as Partial<Motorcycle>,
            concurrencyOpts
          );
        } else if (item.action === 'delete') {
          await deleteMotorcycleFromFirestore(item.targetId, userId, concurrencyOpts);
        }
      } else if (item.entity === 'reminder') {
        if ((item.action === 'upsert' || item.action === 'update_fields') && item.payload) {
          await saveReminderToFirestore(
            { ...(item.payload as unknown as MaintenanceReminder), id: item.targetId },
            userId,
            concurrencyOpts
          );
        } else if (item.action === 'delete') {
          await deleteReminderFromFirestore(item.targetId, userId, concurrencyOpts);
        }
      } else if (item.entity === 'serviceRecord') {
        if ((item.action === 'upsert' || item.action === 'update_fields') && item.payload) {
          await saveServiceRecordToFirestore(
            { ...(item.payload as unknown as ServiceRecord), id: item.targetId },
            userId,
            undefined,
            concurrencyOpts
          );
        } else if (item.action === 'delete') {
          await deleteServiceRecordFromFirestore(item.targetId, userId, concurrencyOpts);
        }
      }

      flushedCount += 1;
    } catch (err: any) {
      failedCount += 1;
      const errMsg = String(err?.message || err || 'Unknown Firestore error');
      const nextRetryCount = (item.retryCount || 0) + 1;
      const classification = classifyMutationFailure(
        errMsg,
        nextRetryCount,
        MAX_OFFLINE_MUTATION_RETRIES,
        typeof navigator !== 'undefined' && navigator.onLine === false
      );

      recordCloudSyncOperation({
        userId,
        status: 'failed',
        operation: `${item.action}_${item.entity}`,
        entity: item.entity,
        targetId: item.targetId,
        errorMessage: errMsg,
      });

      if (
        classification === 'version_conflict' ||
        classification === 'quota_exceeded' ||
        classification === 'permission_or_validation_error' ||
        classification === 'retry_exhausted'
      ) {
        quarantineOfflineMutation({
          item,
          lastError: errMsg,
          retryCount: nextRetryCount,
          failureClassification: classification,
          conflictCloudUpdatedAt: err?.conflictCloudUpdatedAt,
          conflictCloudVersion: err?.conflictCloudVersion,
          conflictReason: err?.conflictReason || errMsg,
        });
        quarantinedCount += 1;
      } else {
        remainingQueue.push({
          ...item,
          retryCount: nextRetryCount,
          lastError: errMsg,
        });
      }
    }
  }

  saveOfflineMutationQueue(userId, remainingQueue);
  return {
    skippedOffline: false,
    flushedCount,
    failedCount,
    quarantinedCount,
  };
}

/**
 * Safely inspects and recovers a quarantined mutation for `userId`.
 * Verifies UID isolation and trustworthy base version metadata before requeuing.
 */
export async function recoverQuarantinedMutationSafely(
  userId: string,
  mutationId: string
): Promise<{
  status: 'requeued' | 'version_conflict' | 'missing_base_version' | 'not_found';
  message?: string;
}> {
  if (!userId || !mutationId) {
    return { status: 'not_found' };
  }
  const list = getQuarantinedMutationQueue(userId);
  const found = list.find((q) => q.id === mutationId && q.userId === userId);
  if (!found) {
    return { status: 'not_found' };
  }

  if (
    found.baseVersionUntrusted ||
    (found.expectedCloudAbsent !== true &&
      typeof found.baseCloudVersion !== 'number' &&
      (!found.baseCloudUpdatedAt || found.baseCloudUpdatedAt.length === 0))
  ) {
    return {
      status: 'missing_base_version',
      message: 'Mutation lacks a trustworthy base cloud version and cannot be auto-requeued.',
    };
  }

  const requeued = requeueQuarantinedMutation(userId, mutationId);
  if (!requeued) {
    return { status: 'missing_base_version' };
  }
  return { status: 'requeued' };
}

/**
 * Removes a completed direct-online mutation from the active queue ONLY IF:
 * 1) `enforceVersionCheck === true` was used for the write, AND
 * 2) the queued item's `mutationGeneration` still matches `expectedGeneration`
 *    (preventing an older in-flight write from deleting a newer rapid edit).
 */
export function completeDirectOnlineMutation(params: {
  userId: string;
  mutationId: string;
  expectedGeneration: number;
  enforceVersionCheck: boolean;
}): boolean {
  const { userId, mutationId, expectedGeneration, enforceVersionCheck } = params;
  if (!userId || !mutationId || !enforceVersionCheck) {
    return false;
  }
  const queue = getOfflineMutationQueue(userId);
  const target = queue.find((q) => q.id === mutationId && q.userId === userId);
  if (!target) return false;

  const currentGen = target.mutationGeneration ?? 1;
  if (currentGen !== expectedGeneration) {
    return false;
  }

  removeOfflineMutation(userId, mutationId);
  return true;
}

/**
 * Executes a direct online write with durable queue protection and atomic `cloudVersion` / timestamp
 * concurrency checking.
 */
export async function executeDirectOnlineWrite(params: {
  userId: string;
  entity: 'motorcycle' | 'reminder' | 'serviceRecord';
  action: 'upsert' | 'update_fields' | 'delete';
  targetId: string;
  payload?: Record<string, unknown>;
  preEditRecord?: Motorcycle | MaintenanceReminder | ServiceRecord | null;
  linkedReminderToUpdate?: MaintenanceReminder;
}): Promise<{
  status: 'synced' | 'queued_offline' | 'version_conflict' | 'error';
  errorMessage?: string;
}> {
  const {
    userId,
    entity,
    action,
    targetId,
    payload,
    preEditRecord,
    linkedReminderToUpdate,
  } = params;

  const baseCloudUpdatedAt =
    preEditRecord?.updatedAt && preEditRecord.timestampSource !== 'client_pending'
      ? preEditRecord.updatedAt
      : getKnownCloudVersion(userId, entity, targetId);
  const baseCloudVersion =
    typeof preEditRecord?.cloudVersion === 'number'
      ? preEditRecord.cloudVersion
      : getKnownCloudRevision(userId, entity, targetId);
  const expectedCloudAbsent =
    !preEditRecord && baseCloudUpdatedAt === null && baseCloudVersion === null && action === 'upsert';

  // 1. Enqueue into durable local queue first (coalescing rapid edits while preserving original base version)
  const queuedItem = enqueueOfflineMutation({
    userId,
    entity,
    action,
    targetId,
    payload,
    baseCloudUpdatedAt,
    baseCloudVersion,
    expectedCloudAbsent,
  });

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { status: 'queued_offline' };
  }

  const concurrencyOpts: ConcurrencyCheckOptions = {
    enforceVersionCheck: true,
    baseCloudUpdatedAt: queuedItem.baseCloudUpdatedAt,
    baseCloudVersion: queuedItem.baseCloudVersion,
    expectedCloudAbsent: queuedItem.expectedCloudAbsent,
    baseVersionUntrusted: queuedItem.baseVersionUntrusted,
  };

  try {
    if (entity === 'motorcycle') {
      if (action === 'upsert' && payload) {
        await saveMotorcycleToFirestore(
          { ...(payload as unknown as Motorcycle), id: targetId },
          userId,
          concurrencyOpts
        );
      } else if (action === 'update_fields' && payload) {
        await updateMotorcycleFieldsInFirestore(
          targetId,
          userId,
          payload as Partial<Motorcycle>,
          concurrencyOpts
        );
      } else if (action === 'delete') {
        await deleteMotorcycleFromFirestore(targetId, userId, concurrencyOpts);
      }
    } else if (entity === 'reminder') {
      if ((action === 'upsert' || action === 'update_fields') && payload) {
        await saveReminderToFirestore(
          { ...(payload as unknown as MaintenanceReminder), id: targetId },
          userId,
          concurrencyOpts
        );
      } else if (action === 'delete') {
        await deleteReminderFromFirestore(targetId, userId, concurrencyOpts);
      }
    } else if (entity === 'serviceRecord') {
      if ((action === 'upsert' || action === 'update_fields') && payload) {
        await saveServiceRecordToFirestore(
          { ...(payload as unknown as ServiceRecord), id: targetId },
          userId,
          linkedReminderToUpdate,
          concurrencyOpts
        );
      } else if (action === 'delete') {
        await deleteServiceRecordFromFirestore(targetId, userId, concurrencyOpts);
      }
    }

    completeDirectOnlineMutation({
      userId,
      mutationId: queuedItem.id,
      expectedGeneration: queuedItem.mutationGeneration ?? 1,
      enforceVersionCheck: true,
    });
    return { status: 'synced' };
  } catch (err: any) {
    const errMsg = String(err?.message || err || 'Unknown error');
    const classification = classifyMutationFailure(errMsg, 1, MAX_OFFLINE_MUTATION_RETRIES, false);
    if (
      classification === 'version_conflict' ||
      classification === 'quota_exceeded' ||
      classification === 'permission_or_validation_error'
    ) {
      quarantineOfflineMutation({
        item: queuedItem,
        lastError: errMsg,
        retryCount: 1,
        failureClassification: classification,
        conflictCloudUpdatedAt: err?.conflictCloudUpdatedAt,
        conflictCloudVersion: err?.conflictCloudVersion,
        conflictReason: err?.conflictReason || errMsg,
      });
      removeOfflineMutation(userId, queuedItem.id);
      if (classification === 'version_conflict') {
        return { status: 'version_conflict', errorMessage: errMsg };
      }
    }
    return { status: 'error', errorMessage: errMsg };
  }
}

/**
 * Debounces rapid odometer updates (default 600ms) while immediately persisting the coalesced
 * mutation in the durable queue with the original pre-edit base version.
 */
export function scheduleDirectOnlineOdometerUpdate(params: {
  userId: string;
  targetBikeId: string;
  newOdo: number;
  preEditBike: Motorcycle;
  debounceTimerRef: { current: ReturnType<typeof setTimeout> | null };
  delayMs?: number;
  onStatusChange?: (status: CloudSyncStatus) => void;
}): void {
  const {
    userId,
    targetBikeId,
    newOdo,
    preEditBike,
    debounceTimerRef,
    delayMs = 600,
    onStatusChange,
  } = params;

  const baseCloudUpdatedAt =
    preEditBike.updatedAt && preEditBike.timestampSource !== 'client_pending'
      ? preEditBike.updatedAt
      : getKnownCloudVersion(userId, 'motorcycle', targetBikeId);
  const baseCloudVersion =
    typeof preEditBike.cloudVersion === 'number'
      ? preEditBike.cloudVersion
      : getKnownCloudRevision(userId, 'motorcycle', targetBikeId);

  const queued = enqueueOfflineMutation({
    userId,
    entity: 'motorcycle',
    action: 'update_fields',
    targetId: targetBikeId,
    payload: { odometer: newOdo },
    baseCloudUpdatedAt,
    baseCloudVersion,
    expectedCloudAbsent: false,
  });

  if (debounceTimerRef.current) {
    clearTimeout(debounceTimerRef.current);
  }

  onStatusChange?.('syncing');

  debounceTimerRef.current = setTimeout(async () => {
    debounceTimerRef.current = null;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      onStatusChange?.('offline_cache');
      return;
    }

    const latestQueue = getOfflineMutationQueue(userId);
    const currentItem =
      latestQueue.find((q) => q.id === queued.id) ||
      latestQueue.find((q) => q.entity === 'motorcycle' && q.targetId === targetBikeId);
    if (!currentItem) {
      onStatusChange?.('synced');
      return;
    }

    const generationToComplete = currentItem.mutationGeneration ?? 1;
    try {
      await updateMotorcycleFieldsInFirestore(
        targetBikeId,
        userId,
        (currentItem.payload as Partial<Motorcycle>) || { odometer: newOdo },
        {
          enforceVersionCheck: true,
          baseCloudUpdatedAt: currentItem.baseCloudUpdatedAt,
          baseCloudVersion: currentItem.baseCloudVersion,
          expectedCloudAbsent: currentItem.expectedCloudAbsent,
        }
      );

      completeDirectOnlineMutation({
        userId,
        mutationId: currentItem.id,
        expectedGeneration: generationToComplete,
        enforceVersionCheck: true,
      });
      onStatusChange?.('synced');
    } catch (err: any) {
      const errMsg = String(err?.message || err || 'Odometer sync failed');
      const classification = classifyMutationFailure(errMsg, 1, MAX_OFFLINE_MUTATION_RETRIES, false);
      if (
        classification === 'version_conflict' ||
        classification === 'quota_exceeded' ||
        classification === 'permission_or_validation_error'
      ) {
        quarantineOfflineMutation({
          item: currentItem,
          lastError: errMsg,
          retryCount: 1,
          failureClassification: classification,
          conflictCloudUpdatedAt: err?.conflictCloudUpdatedAt,
          conflictCloudVersion: err?.conflictCloudVersion,
          conflictReason: err?.conflictReason || errMsg,
        });
        removeOfflineMutation(userId, currentItem.id);
      }
      onStatusChange?.('sync_error');
    }
  }, delayMs);
}

/**
 * Controlled Legacy LocalStorage -> Firestore Migration with Per-Entity Ledger Checkpoints
 * and Pre-Migration Immutable Backup.
 */
export async function syncStorageToFirestore(params: {
  userId: string;
  userEmail: string;
  hasProAccess: boolean;
  userConfirmedOwnership: boolean;
  selectedBikeIds?: string[];
  motorcyclesToSync: Motorcycle[];
  remindersToSync: MaintenanceReminder[];
  serviceRecordsToSync: ServiceRecord[];
  existingCloudMotorcycles?: Motorcycle[];
  existingCloudReminders?: MaintenanceReminder[];
  existingCloudServiceRecords?: ServiceRecord[];
}): Promise<{
  ledger: MigrationLedger;
  migratedMotorcyclesCount: number;
  migratedRemindersCount: number;
  migratedServiceRecordsCount: number;
}> {
  const {
    userId,
    userEmail,
    hasProAccess,
    userConfirmedOwnership,
    selectedBikeIds,
    motorcyclesToSync = [],
    remindersToSync = [],
    serviceRecordsToSync = [],
  } = params;

  if (!userConfirmedOwnership) {
    throw new Error(
      'CONFIRMATION_REQUIRED: Explicit user ownership confirmation is required before migrating local records to Firestore.'
    );
  }

  // 1. Always create an immutable pre-migration backup before touching Firestore
  createImmutablePreMigrationBackup(userId, userEmail);

  const nowIso = new Date().toISOString();
  const existingLedger = loadMigrationLedger(userId);
  const ledger: MigrationLedger = existingLedger
    ? {
        ...existingLedger,
        status: 'in_progress',
        updatedAt: nowIso,
      }
    : {
        userId,
        userEmail,
        status: 'in_progress',
        motorcyclesCompletedIds: [],
        remindersCompletedIds: [],
        serviceRecordsCompletedIds: [],
        bikeIdRemap: {},
        backupKey: getPreMigrationBackupKey(userId),
        startedAt: nowIso,
        updatedAt: nowIso,
      };
  saveMigrationLedger(ledger);

  // Filter out sample IDs & foreign UIDs
  let eligibleBikes = motorcyclesToSync.filter(
    (b) =>
      b &&
      b.id &&
      !CONFIRMED_SAMPLE_MOTORCYCLE_IDS.has(b.id) &&
      (!b.userId || b.userId === userId)
  );
  if (selectedBikeIds && selectedBikeIds.length > 0) {
    const selectedSet = new Set(selectedBikeIds);
    eligibleBikes = eligibleBikes.filter((b) => selectedSet.has(b.id));
  }
  if (!hasProAccess && eligibleBikes.length > 1) {
    eligibleBikes = eligibleBikes.slice(0, 1);
  }

  let migratedMotorcyclesCount = 0;
  for (const bike of eligibleBikes) {
    if (ledger.motorcyclesCompletedIds.includes(bike.id)) {
      continue;
    }
    await saveMotorcycleToFirestore({ ...bike, userId }, userId);
    ledger.motorcyclesCompletedIds.push(bike.id);
    ledger.bikeIdRemap[bike.id] = bike.id;
    ledger.updatedAt = new Date().toISOString();
    saveMigrationLedger(ledger);
    migratedMotorcyclesCount += 1;
  }

  const eligibleReminders = remindersToSync.filter(
    (r) =>
      r &&
      r.id &&
      !CONFIRMED_SAMPLE_REMINDER_IDS.has(r.id) &&
      (!r.userId || r.userId === userId) &&
      !ledger.remindersCompletedIds.includes(r.id)
  );

  let migratedRemindersCount = 0;
  if (eligibleReminders.length > 0) {
    await saveRemindersBatchToFirestore(eligibleReminders, userId, {
      onChunkCommitted: (chunkIds) => {
        for (const id of chunkIds) {
          if (!ledger.remindersCompletedIds.includes(id)) {
            ledger.remindersCompletedIds.push(id);
            migratedRemindersCount += 1;
          }
        }
        ledger.updatedAt = new Date().toISOString();
        saveMigrationLedger(ledger);
      },
    });
  }

  const eligibleRecords = serviceRecordsToSync.filter(
    (r) =>
      r &&
      r.id &&
      !CONFIRMED_SAMPLE_SERVICE_RECORD_IDS.has(r.id) &&
      (!r.userId || r.userId === userId) &&
      !ledger.serviceRecordsCompletedIds.includes(r.id)
  );

  let migratedServiceRecordsCount = 0;
  if (eligibleRecords.length > 0) {
    await saveServiceRecordsBatchToFirestore(eligibleRecords, userId, {
      onChunkCommitted: (chunkIds) => {
        for (const id of chunkIds) {
          if (!ledger.serviceRecordsCompletedIds.includes(id)) {
            ledger.serviceRecordsCompletedIds.push(id);
            migratedServiceRecordsCount += 1;
          }
        }
        ledger.updatedAt = new Date().toISOString();
        saveMigrationLedger(ledger);
      },
    });
  }

  ledger.status = 'completed';
  ledger.completedAt = new Date().toISOString();
  ledger.updatedAt = ledger.completedAt;
  saveMigrationLedger(ledger);

  return {
    ledger,
    migratedMotorcyclesCount,
    migratedRemindersCount,
    migratedServiceRecordsCount,
  };
}

export interface PermanentAccountDeletionSummary {
  deletedUid: string;
  releasedEmail: string | null;
  deletedMotorcyclesCount: number;
  deletedRemindersCount: number;
  deletedServiceRecordsCount: number;
  deletedPaymentSubmissionsCount: number;
}

/**
 * Permanently deletes a user's MotoCare account and all associated personal data:
 * (a) Re-authenticates the user first (Google popup or Email/Password credential).
 * (b) Deletes reminders, service records, pending payment submissions, then motorcycles
 *     via the atomic `deleteMotorcycleFromFirestore` transaction so `bikeCount` reaches 0.
 * (c) Deletes the `/users/{uid}` document only after `bikeCount` is 0.
 * (d) Calls Firebase Auth `deleteUser` last and purges local storage caches.
 *
 * Errors are never swallowed: if any step fails, execution halts immediately and throws a clear error.
 */
export async function permanentlyDeleteUserAccount(
  authUser?:
    | User
    | {
        uid: string;
        email?: string | null;
        providerData?: Array<{ providerId: string }>;
        delete?: () => Promise<void>;
      }
    | null,
  password?: string
): Promise<PermanentAccountDeletionSummary> {
  const targetUser = authUser || auth.currentUser;
  if (!targetUser || !targetUser.uid) {
    throw new Error('No authenticated user found to delete.');
  }

  const uid = targetUser.uid;
  const email = targetUser.email ? targetUser.email.trim().toLowerCase() : null;

  // (a) Re-authenticate first
  await reauthenticateUserForDeletion(targetUser, password);

  // (b) Query and delete reminders, service records, pending payment submissions, then motorcycles
  const [remindersSnap, recordsSnap, paymentsSnap, motorcyclesSnap] = await Promise.all([
    getDocs(query(collection(db, 'reminders'), where('userId', '==', uid))),
    getDocs(query(collection(db, 'serviceRecords'), where('userId', '==', uid))),
    getDocs(query(collection(db, 'paymentSubmissions'), where('userId', '==', uid))),
    getDocs(query(collection(db, 'motorcycles'), where('userId', '==', uid))),
  ]);

  let deletedRemindersCount = 0;
  for (const remDoc of remindersSnap.docs) {
    await deleteDoc(remDoc.ref);
    deletedRemindersCount++;
  }

  let deletedServiceRecordsCount = 0;
  for (const recDoc of recordsSnap.docs) {
    await deleteDoc(recDoc.ref);
    deletedServiceRecordsCount++;
  }

  let deletedPaymentSubmissionsCount = 0;
  const pendingSubmissionDocs = paymentsSnap.docs.filter(
    (d) => d.data()?.status === 'pending_approval'
  );
  for (const payDoc of pendingSubmissionDocs) {
    const batch = writeBatch(db);
    batch.delete(payDoc.ref);
    batch.set(
      doc(db, 'users', uid),
      {
        pendingSubmissionId: null,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    await batch.commit();
    deletedPaymentSubmissionsCount++;
  }

  // Delete motorcycles via atomic deleteMotorcycleFromFirestore (with deleteReminders: false since already deleted above) so bikeCount reaches 0
  let deletedMotorcyclesCount = 0;
  for (const bikeDoc of motorcyclesSnap.docs) {
    await deleteMotorcycleFromFirestore(bikeDoc.id, uid, {
      deleteReminders: false,
      deleteServiceHistoryConfirmed: false,
    });
    deletedMotorcyclesCount++;
  }

  // (c) Delete the user doc only after bikeCount is 0
  await deleteDoc(doc(db, 'users', uid));

  // (d) Call deleteUser last
  await deleteCurrentAuthUser(targetUser as User);

  // Purge local device caches for the deleted account
  purgeDeletedUserAccountLocalData(uid, email);

  return {
    deletedUid: uid,
    releasedEmail: email,
    deletedMotorcyclesCount,
    deletedRemindersCount,
    deletedServiceRecordsCount,
    deletedPaymentSubmissionsCount,
  };
}

export const permanentAccountDelete = permanentlyDeleteUserAccount;

/**
 * Submits a GCash / GoTyme Payment Reference for Admin Verification.
 * - Requires verified email (`emailVerified == true`).
 * - Validates reference format (8–64 alphanumeric chars after normalization).
 * - Does NOT pre-read `/paymentReferences/{refHash}` (since `get` is admin-only).
 * - Atomically writes `/paymentReferences/{refHash}` (with `submissionId`), `/paymentSubmissions/{submissionId}`,
 *   and sets `pendingSubmissionId: submissionId` on `/users/{uid}` in a single transaction.
 * - Maps duplicate reference permission errors to `"This reference number has already been submitted."`
 */
export async function submitPaymentReferenceToFirestore(submission: {
  userId: string;
  userEmail: string;
  userName: string;
  bikeModel: string;
  bikePlate?: string;
  paymentMethod: PaymentProvider;
  referenceNumber: string;
  amountPhp?: number;
  notes?: string;
}): Promise<string> {
  const currentUser = auth.currentUser;
  if (currentUser && currentUser.uid === submission.userId && !currentUser.emailVerified) {
    throw new Error('Please verify your email address before submitting a payment reference.');
  }

  const validation = validatePaymentReferenceNumber(submission.referenceNumber);
  if (!validation.valid) {
    throw new Error(validation.error || 'Please enter a valid payment reference number.');
  }

  const refHash = await computeReferenceHash(validation.trimmed);
  const submissionId = `pay_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const submissionPath = `paymentSubmissions/${submissionId}`;

  try {
    const reservationRef = doc(db, 'paymentReferences', refHash);
    const submissionRef = doc(db, 'paymentSubmissions', submissionId);
    const userRef = doc(db, 'users', submission.userId);

    await runTransaction(db, async (transaction) => {
      const userSnap = await transaction.get(userRef);
      if (userSnap.exists()) {
        const userData = userSnap.data();
        if (userData?.pendingSubmissionId) {
          throw new Error(
            'You already have a payment reference pending verification. Please wait for admin review.'
          );
        }
      }

      const timestamp = new Date().toISOString();
      const newSubmission: Record<string, any> = stripUndefined({
        id: submissionId,
        userId: submission.userId,
        userEmail: (submission.userEmail || '').trim().slice(0, 200),
        userName: (submission.userName || 'MotoCare Rider').trim().slice(0, 200),
        bikeModel: (submission.bikeModel || 'Motorcycle').trim().slice(0, 200),
        bikePlate: submission.bikePlate ? submission.bikePlate.trim().slice(0, 200) : undefined,
        paymentMethod: submission.paymentMethod,
        referenceNumber: validation.trimmed,
        referenceHash: refHash,
        amountPhp: 49,
        status: 'pending_approval',
        submittedAt: timestamp,
        notes: submission.notes ? submission.notes.trim().slice(0, 200) : undefined,
      });

      transaction.set(reservationRef, {
        id: refHash,
        status: 'reserved',
        createdAt: timestamp,
        submissionId,
      });

      transaction.set(submissionRef, newSubmission);

      if (userSnap.exists()) {
        transaction.update(userRef, {
          pendingSubmissionId: submissionId,
          updatedAt: serverTimestamp(),
        });
      } else {
        transaction.set(userRef, {
          id: submission.userId,
          uid: submission.userId,
          email: (submission.userEmail || '').trim().toLowerCase().slice(0, 200),
          displayName: (submission.userName || 'MotoCare Rider').trim().slice(0, 200),
          photoURL: '',
          role: 'rider',
          subscriptionTier: 'free',
          subscriptionStatus: 'free',
          paymentStatus: 'unpaid_free',
          bikeCount: 0,
          pendingSubmissionId: submissionId,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    });

    return submissionId;
  } catch (error: any) {
    const msg = String(error?.message || '');
    if (
      msg.includes('already have a payment reference pending') ||
      msg.includes('Please verify your email') ||
      msg.includes('reference number')
    ) {
      throw error;
    }
    if (
      error?.code === 'permission-denied' ||
      msg.includes('Missing or insufficient permissions') ||
      msg.includes('PERMISSION_DENIED')
    ) {
      throw new Error('This reference number has already been submitted.');
    }
    handleFirestoreError(error, OperationType.CREATE, submissionPath);
  }
}

/**
 * Admin Action: Approves a payment submission in Firestore and activates/extends Pro for 1 calendar month.
 * Also clears `pendingSubmissionId: null` on `/users/{userId}`.
 */
export async function approveProAccessInFirestore(
  submissionId: string,
  userId: string,
  adminEmail: string
): Promise<{ expiryIso: string; anchorDay: number }> {
  const path = `paymentSubmissions/${submissionId}`;
  try {
    const result = await runTransaction(db, async (transaction) => {
      const subRef = doc(db, 'paymentSubmissions', submissionId);
      const subSnap = await transaction.get(subRef);

      if (!subSnap.exists()) {
        throw new Error('Payment submission not found.');
      }

      const subData = subSnap.data() as PaymentSubmissionRecord;
      if (subData.status !== 'pending_approval') {
        throw new Error(
          `This payment submission has already been reviewed (status: ${subData.status}).`
        );
      }

      const userRef = doc(db, 'users', userId);
      const userSnap = await transaction.get(userRef);
      const userData = userSnap.exists() ? userSnap.data() : null;

      const approvalNow = new Date();
      const approvalIso = approvalNow.toISOString();
      const approvalTimestamp = Timestamp.fromDate(approvalNow);

      const currentExpiryDate = parseExpiryToDate(userData?.expiryDate);
      const isEarlyRenewal =
        userData?.subscriptionTier === 'pro' &&
        currentExpiryDate !== null &&
        currentExpiryDate.getTime() > approvalNow.getTime();

      const baseDate = isEarlyRenewal && currentExpiryDate ? currentExpiryDate : approvalNow;
      const existingAnchorDay =
        isEarlyRenewal && typeof userData?.billingAnchorDay === 'number'
          ? userData.billingAnchorDay
          : getManilaDay(approvalNow);

      const { expiryIso, expiryTimestamp, anchorDay } = calculateNextMonthlyExpiry(
        baseDate,
        existingAnchorDay
      );

      const startTimestamp =
        isEarlyRenewal && userData?.subscriptionStartDate instanceof Timestamp
          ? userData.subscriptionStartDate
          : approvalTimestamp;

      transaction.update(subRef, {
        status: 'active_pro',
        reviewedAt: approvalIso,
        reviewedBy: adminEmail,
      });

      transaction.set(
        userRef,
        {
          id: userId,
          uid: userId,
          subscriptionTier: 'pro',
          subscriptionStatus: 'active',
          paymentStatus: 'active_pro',
          subscriptionStartDate: startTimestamp,
          expiryDate: expiryTimestamp,
          billingAnchorDay: anchorDay,
          lastPaymentId: submissionId,
          pendingSubmissionId: null,
          approvedAt: approvalIso,
          approvedBy: adminEmail,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      if (subData.referenceHash) {
        const refDoc = doc(db, 'paymentReferences', subData.referenceHash);
        transaction.set(
          refDoc,
          {
            id: subData.referenceHash,
            status: 'approved',
            approvedAt: approvalIso,
          },
          { merge: true }
        );
      }

      return { expiryIso, anchorDay };
    });

    return result;
  } catch (error: any) {
    if (error?.message?.includes('already been reviewed')) {
      throw error;
    }
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

/**
 * Admin Action: Rejects a pending payment submission OR revokes Pro access in Firestore.
 * Also clears `pendingSubmissionId: null` on `/users/{userId}`.
 */
export async function revokeProAccessInFirestore(
  submissionId: string | null,
  userId: string,
  adminEmail: string
): Promise<void> {
  const path = `users/${userId}`;
  try {
    await runTransaction(db, async (transaction) => {
      const nowIso = new Date().toISOString();
      const userRef = doc(db, 'users', userId);

      // Perform all transaction reads before any writes
      const userSnap = await transaction.get(userRef);
      const userData = userSnap.exists() ? userSnap.data() : null;

      let subRef: ReturnType<typeof doc> | null = null;
      let subData: PaymentSubmissionRecord | null = null;

      if (submissionId) {
        subRef = doc(db, 'paymentSubmissions', submissionId);
        const subSnap = await transaction.get(subRef);
        if (subSnap.exists()) {
          subData = subSnap.data() as PaymentSubmissionRecord;
        }
      }

      if (subData && subData.userId && subData.userId !== userId) {
        throw new Error('Payment submission userId does not match target userId.');
      }

      if (subRef && subData) {
        // Case 1: Rejecting a pending payment submission
        if (subData.status === 'pending_approval') {
          transaction.update(subRef, {
            status: 'rejected',
            reviewedAt: nowIso,
            reviewedBy: adminEmail,
          });

          if (subData.referenceHash) {
            const refDoc = doc(db, 'paymentReferences', subData.referenceHash);
            transaction.set(
              refDoc,
              {
                id: subData.referenceHash,
                status: 'rejected',
                rejectedAt: nowIso,
              },
              { merge: true }
            );
          }

          const currentExpiry = parseExpiryToDate(userData?.expiryDate);
          const hasActivePro =
            userData?.subscriptionTier === 'pro' &&
            userData?.subscriptionStatus !== 'revoked' &&
            currentExpiry !== null &&
            currentExpiry.getTime() > Date.now();

          const shouldClearPending =
            !userData?.pendingSubmissionId || userData.pendingSubmissionId === submissionId;

          if (!hasActivePro) {
            transaction.set(
              userRef,
              {
                id: userId,
                uid: userId,
                subscriptionTier: 'free',
                subscriptionStatus: 'free',
                paymentStatus: 'rejected',
                ...(shouldClearPending ? { pendingSubmissionId: null } : {}),
                updatedAt: serverTimestamp(),
              },
              { merge: true }
            );
          } else if (shouldClearPending) {
            transaction.set(
              userRef,
              {
                id: userId,
                uid: userId,
                pendingSubmissionId: null,
                updatedAt: serverTimestamp(),
              },
              { merge: true }
            );
          }
          return;
        }

        // Case 2: If a superseded/older submissionId was passed that does not match the user's
        // newer active subscription (lastPaymentId), do not overwrite the newer subscription state.
        if (
          userData?.lastPaymentId &&
          userData.lastPaymentId !== submissionId &&
          userData?.subscriptionTier === 'pro'
        ) {
          return;
        }
      }

      // Case 3: Revoking an active Pro subscription (either via an 'active_pro' submissionId or directly by userId).
      // Do NOT modify the approved /paymentSubmissions/{submissionId} or /paymentReferences/{referenceHash} documents.
      const shouldClearPendingOnRevoke =
        !userData?.pendingSubmissionId ||
        !submissionId ||
        userData.pendingSubmissionId === submissionId;

      transaction.set(
        userRef,
        {
          id: userId,
          uid: userId,
          subscriptionTier: 'free',
          subscriptionStatus: 'revoked',
          paymentStatus: 'rejected',
          expiryDate: Timestamp.fromDate(new Date(0)),
          ...(shouldClearPendingOnRevoke ? { pendingSubmissionId: null } : {}),
          revokedAt: nowIso,
          revokedBy: adminEmail,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

function normalizeIncomingDocTimestamps<T extends Record<string, any>>(raw: T): T {
  const clone: Record<string, any> = { ...raw };
  if (clone.updatedAt) {
    const iso = normalizeFirestoreTimestampToIso(clone.updatedAt);
    if (iso) clone.updatedAt = iso;
  }
  if (clone.createdAt) {
    const iso = normalizeFirestoreTimestampToIso(clone.createdAt);
    if (iso) clone.createdAt = iso;
  }
  return clone as T;
}

/**
 * Real-time listener for a user's Motorcycles
 */
export function subscribeToUserMotorcycles(
  userId: string,
  callback: (bikes: Motorcycle[]) => void
): () => void {
  const q = query(collection(db, 'motorcycles'), where('userId', '==', userId));
  return onSnapshot(
    q,
    (snapshot) => {
      const bikes: Motorcycle[] = [];
      snapshot.forEach((docSnap) => {
        const normalized = normalizeIncomingDocTimestamps(docSnap.data() as Motorcycle);
        bikes.push(normalized);
        if (normalized.updatedAt) {
          recordKnownCloudVersion(
            userId,
            'motorcycle',
            normalized.id,
            normalized.updatedAt,
            normalized.cloudVersion
          );
        }
      });
      callback(bikes);
    },
    (error) => {
      console.warn('Motorcycles snapshot listener error:', error);
    }
  );
}

/**
 * Real-time listener for a user's Reminders
 */
export function subscribeToUserReminders(
  userId: string,
  callback: (reminders: MaintenanceReminder[]) => void
): () => void {
  const q = query(collection(db, 'reminders'), where('userId', '==', userId));
  return onSnapshot(
    q,
    (snapshot) => {
      const rems: MaintenanceReminder[] = [];
      snapshot.forEach((docSnap) => {
        const normalized = normalizeIncomingDocTimestamps(docSnap.data() as MaintenanceReminder);
        rems.push(normalized);
        if (normalized.updatedAt) {
          recordKnownCloudVersion(
            userId,
            'reminder',
            normalized.id,
            normalized.updatedAt,
            normalized.cloudVersion
          );
        }
      });
      callback(rems);
    },
    (error) => {
      console.warn('Reminders snapshot listener error:', error);
    }
  );
}

/**
 * Real-time listener for a user's Service Records
 */
export function subscribeToUserServiceRecords(
  userId: string,
  callback: (records: ServiceRecord[]) => void
): () => void {
  const q = query(collection(db, 'serviceRecords'), where('userId', '==', userId));
  return onSnapshot(
    q,
    (snapshot) => {
      const recs: ServiceRecord[] = [];
      snapshot.forEach((docSnap) => {
        const normalized = normalizeIncomingDocTimestamps(docSnap.data() as ServiceRecord);
        recs.push(normalized);
        if (normalized.updatedAt) {
          recordKnownCloudVersion(
            userId,
            'serviceRecord',
            normalized.id,
            normalized.updatedAt,
            normalized.cloudVersion
          );
        }
      });
      recs.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      callback(recs);
    },
    (error) => {
      console.warn('Service records snapshot listener error:', error);
    }
  );
}

/**
 * One-shot fetch of a user's Motorcycles from Firestore
 */
export async function fetchUserMotorcyclesOnce(userId: string): Promise<Motorcycle[]> {
  const q = query(collection(db, 'motorcycles'), where('userId', '==', userId));
  const snap = await getDocs(q);
  const bikes: Motorcycle[] = [];
  snap.forEach((docSnap) => {
    bikes.push(normalizeIncomingDocTimestamps(docSnap.data() as Motorcycle));
  });
  return bikes;
}

/**
 * One-shot fetch of a user's Maintenance Reminders from Firestore
 */
export async function fetchUserRemindersOnce(userId: string): Promise<MaintenanceReminder[]> {
  const q = query(collection(db, 'reminders'), where('userId', '==', userId));
  const snap = await getDocs(q);
  const rems: MaintenanceReminder[] = [];
  snap.forEach((docSnap) => {
    rems.push(normalizeIncomingDocTimestamps(docSnap.data() as MaintenanceReminder));
  });
  return rems;
}

/**
 * One-shot fetch of a user's Service Records from Firestore
 */
export async function fetchUserServiceRecordsOnce(userId: string): Promise<ServiceRecord[]> {
  const q = query(collection(db, 'serviceRecords'), where('userId', '==', userId));
  const snap = await getDocs(q);
  const recs: ServiceRecord[] = [];
  snap.forEach((docSnap) => {
    recs.push(normalizeIncomingDocTimestamps(docSnap.data() as ServiceRecord));
  });
  recs.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return recs;
}

/**
 * Real-time listener for a user's own Subscription status on `/users/{userId}`
 */
export function subscribeToUserProfile(
  userId: string,
  callback: (profile: any) => void
): () => void {
  const userRef = doc(db, 'users', userId);
  return onSnapshot(
    userRef,
    (docSnap) => {
      if (docSnap.exists()) {
        callback(docSnap.data());
      } else {
        callback(null);
      }
    },
    (error) => {
      console.warn('User profile listener error:', error);
    }
  );
}

/**
 * Real-time listener for a user's own Payment Submissions
 */
export function subscribeToUserPaymentSubmissions(
  userId: string,
  callback: (submissions: PaymentSubmissionRecord[]) => void
): () => void {
  const q = query(collection(db, 'paymentSubmissions'), where('userId', '==', userId));
  return onSnapshot(
    q,
    (snapshot) => {
      const subs: PaymentSubmissionRecord[] = [];
      snapshot.forEach((docSnap) => {
        subs.push(docSnap.data() as PaymentSubmissionRecord);
      });
      subs.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
      callback(subs);
    },
    (error) => {
      console.warn('User payment submissions listener error:', error);
    }
  );
}

/**
 * Admin Real-Time Listener: Listens ONLY to pending Payment Submissions (`status == 'pending_approval'`)
 * to protect the free Spark plan 50K daily read quota.
 */
export function subscribeToAllPaymentSubmissions(
  callback: (submissions: PaymentSubmissionRecord[]) => void,
  onError?: (errorMessage: string) => void
): () => void {
  const q = query(
    collection(db, 'paymentSubmissions'),
    where('status', '==', 'pending_approval')
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const list: PaymentSubmissionRecord[] = [];
      snapshot.forEach((docSnap) => {
        list.push(docSnap.data() as PaymentSubmissionRecord);
      });
      list.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
      callback(list);
    },
    (error) => {
      const detail = error instanceof Error ? error.message : String(error);
      const formatted = `Firestore read failed on collection "paymentSubmissions" (path: "/paymentSubmissions?status=pending_approval"): ${detail}`;
      console.warn(formatted);
      if (onError) {
        onError(formatted);
      }
    }
  );
}

/**
 * Admin On-Demand Fetch: Loads reviewed payment submissions (`active_pro` or `rejected`) with `limit(100)`
 * when the admin explicitly switches to a reviewed status tab or clicks Refresh.
 */
export async function fetchReviewedPaymentSubmissionsOnce(
  statusFilter: 'active_pro' | 'rejected',
  maxCount = 100
): Promise<PaymentSubmissionRecord[]> {
  const queryPath = `/paymentSubmissions (where status == "${statusFilter}", limit ${maxCount})`;
  try {
    const constraints: any[] = [where('status', '==', statusFilter)];
    if (typeof limit === 'function') {
      constraints.push(limit(maxCount));
    }
    const q = query(collection(db, 'paymentSubmissions'), ...constraints);
    const snap = await getDocs(q);
    const list: PaymentSubmissionRecord[] = [];
    snap.forEach((docSnap) => {
      list.push(docSnap.data() as PaymentSubmissionRecord);
    });
    list.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
    return list;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Firestore read failed on collection "paymentSubmissions" (path: ${queryPath}): ${detail}`
    );
  }
}

/**
 * Admin On-Demand Paginated User Fetch:
 * Uses `getDocs` with `limit(pageSize)` (default 100) and optional `startAfter(lastDoc)` cursor
 * instead of an unbounded real-time `onSnapshot` over all users.
 */
export async function fetchAdminUsersPage(
  pageSize = 100,
  lastDoc?: QueryDocumentSnapshot<DocumentData> | null
): Promise<{
  users: any[];
  lastDoc: QueryDocumentSnapshot<DocumentData> | null;
  hasMore: boolean;
}> {
  const queryPath = lastDoc
    ? `/users (startAfter cursor, limit ${pageSize})`
    : `/users (limit ${pageSize})`;
  try {
    const colRef = collection(db, 'users');
    const constraints: any[] = [];
    if (lastDoc && typeof startAfter === 'function') {
      constraints.push(startAfter(lastDoc));
    }
    if (typeof limit === 'function') {
      constraints.push(limit(pageSize));
    }
    const q = constraints.length > 0 ? query(colRef, ...constraints) : query(colRef);
    const snap = await getDocs(q);
    const users: any[] = [];
    snap.forEach((docSnap) => {
      users.push(docSnap.data());
    });
    const nextCursor = snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null;
    return {
      users,
      lastDoc: nextCursor,
      hasMore: snap.docs.length === pageSize,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Firestore read failed on collection "users" (path: ${queryPath}): ${detail}`);
  }
}

export interface BikeCountReconciliationItem {
  userId: string;
  email: string;
  previousBikeCount: number | undefined;
  actualBikeCount: number;
  needsUpdate: boolean;
}

export interface BikeCountReconciliationReport {
  dryRun: boolean;
  totalUsersScanned: number;
  discrepanciesFound: number;
  usersUpdated: number;
  items: BikeCountReconciliationItem[];
}

/**
 * Admin Migration & Reconciliation Utility:
 * Audits `/users/{userId}.bikeCount` against actual `/motorcycles` documents owned by that user.
 */
export async function reconcileAllUserBikeCounts(
  dryRun = true
): Promise<BikeCountReconciliationReport> {
  const usersSnap = await getDocs(query(collection(db, 'users'), limit(500)));
  const bikesSnap = await getDocs(query(collection(db, 'motorcycles'), limit(1000)));

  const actualCountsByUser = new Map<string, number>();
  bikesSnap.forEach((bikeDoc) => {
    const data = bikeDoc.data();
    const uid = data?.userId;
    if (typeof uid === 'string' && uid.length > 0) {
      actualCountsByUser.set(uid, (actualCountsByUser.get(uid) || 0) + 1);
    }
  });

  const items: BikeCountReconciliationItem[] = [];
  let discrepanciesFound = 0;
  let usersUpdated = 0;

  let batch = writeBatch(db);
  let batchOpCount = 0;

  for (const userDoc of usersSnap.docs) {
    const userData = userDoc.data();
    const uid = userDoc.id;
    const prevCount = typeof userData.bikeCount === 'number' ? userData.bikeCount : undefined;
    const actualCount = actualCountsByUser.get(uid) || 0;
    const needsUpdate = prevCount !== actualCount;

    items.push({
      userId: uid,
      email: userData.email || uid,
      previousBikeCount: prevCount,
      actualBikeCount: actualCount,
      needsUpdate,
    });

    if (needsUpdate) {
      discrepanciesFound++;
      if (!dryRun) {
        const userRef = doc(db, 'users', uid);
        batch.update(userRef, {
          bikeCount: actualCount,
          updatedAt: serverTimestamp(),
        });
        batchOpCount++;
        usersUpdated++;

        if (batchOpCount >= 400) {
          await batch.commit();
          batch = writeBatch(db);
          batchOpCount = 0;
        }
      }
    }
  }

  if (!dryRun && batchOpCount > 0) {
    await batch.commit();
  }

  return {
    dryRun,
    totalUsersScanned: usersSnap.size,
    discrepanciesFound,
    usersUpdated,
    items,
  };
}

/**
 * Reconciles a single user's `bikeCount` against their actual `/motorcycles` documents.
 */
export async function reconcileUserBikeCount(
  userId: string,
  dryRun = false
): Promise<BikeCountReconciliationItem> {
  const userRef = doc(db, 'users', userId);
  const userSnap = await getDoc(userRef);
  const bikesQuery = query(collection(db, 'motorcycles'), where('userId', '==', userId));
  const bikesSnap = await getDocs(bikesQuery);

  const actualCount = bikesSnap.size;
  const userData = userSnap.exists() ? userSnap.data() : null;
  const prevCount =
    userData && typeof userData.bikeCount === 'number' ? userData.bikeCount : undefined;
  const needsUpdate = prevCount !== actualCount;

  if (needsUpdate && !dryRun && userSnap.exists()) {
    await updateDoc(userRef, {
      bikeCount: actualCount,
      updatedAt: serverTimestamp(),
    });
  }

  return {
    userId,
    email: userData?.email || userId,
    previousBikeCount: prevCount,
    actualBikeCount: actualCount,
    needsUpdate,
  };
}
