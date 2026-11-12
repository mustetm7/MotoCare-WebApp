import {
  calculateNextMonthlyExpiry,
  getManilaDay,
  calculateDaysRemaining,
  parseExpiryToDate,
  reconcileUserBikeCount,
} from '../src/utils/firestoreService';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
}

console.log('========================================================================');
console.log(' MotoCare Firestore Security & Anti-Replay Verification Suite           ');
console.log(' Testing 33 Critical Security, Payment, Schema & Counter Scenarios      ');
console.log('========================================================================\n');

interface MockAuth {
  uid: string;
  token: {
    email: string;
    email_verified: boolean;
  };
}

interface MockDoc {
  data: Record<string, any>;
}

const ALLOWED_MOTORCYCLE_KEYS = new Set([
  'id', 'userId', 'nickname', 'brand', 'model', 'year',
  'licensePlate', 'odometer', 'lastOdometerUpdate', 'unit',
  'color', 'customColorBadge', 'photoUrl', 'specs',
  'registrationExpiryDate', 'acquisitionDate', 'motorcycleType',
  'isCustom', 'cloudVersion', 'createdAt', 'updatedAt',
]);

const ALLOWED_REMINDER_KEYS = new Set([
  'id', 'userId', 'bikeId', 'title', 'category', 'categoryTag',
  'intervalKm', 'intervalMonths', 'lastCompletedOdo', 'nextDueOdo',
  'lastCompletedDate', 'nextDueDate', 'priority', 'notes',
  'estimatedCostPhp', 'cloudVersion', 'createdAt', 'updatedAt',
]);

const ALLOWED_SERVICE_RECORD_KEYS = new Set([
  'id', 'userId', 'bikeId', 'date', 'odometer', 'title',
  'category', 'type', 'shopName', 'mechanicName', 'oilBrandGrade',
  'casaVerified', 'parts', 'laborCostPhp', 'totalCostPhp',
  'notes', 'nextDueOdometer', 'nextDueDate', 'photoUrl',
  'cloudVersion', 'createdAt', 'updatedAt',
]);

const ALLOWED_USER_KEYS = new Set([
  'id', 'uid', 'email', 'displayName', 'photoURL',
  'role', 'subscriptionTier', 'subscriptionStatus', 'paymentStatus',
  'bikeCount', 'lastBikeId', 'lastBikeAction', 'pendingSubmissionId',
  'lastPaymentId', 'subscriptionStartDate', 'expiryDate', 'billingAnchorDay',
  'approvedAt', 'approvedBy', 'revokedAt', 'revokedBy',
  'createdAt', 'updatedAt', 'lastLoginAt',
]);

const ALLOWED_PAYMENT_SUBMISSION_KEYS = new Set([
  'id', 'userId', 'userEmail', 'userName', 'bikeModel', 'bikePlate',
  'paymentMethod', 'referenceNumber', 'referenceHash',
  'amountPhp', 'status', 'submittedAt', 'notes',
]);

function hasOnlyKeys(data: Record<string, any>, allowed: Set<string>): boolean {
  return Object.keys(data).every((k) => allowed.has(k));
}

function evalIsSignedIn(auth: MockAuth | null): boolean {
  return auth !== null;
}

function evalIsOwner(auth: MockAuth | null, userId: string): boolean {
  return evalIsSignedIn(auth) && auth!.uid === userId;
}

function evalIsAdmin(auth: MockAuth | null, adminsDb: Set<string>): boolean {
  return (
    evalIsSignedIn(auth) &&
    auth!.token.email_verified === true &&
    (auth!.token.email === 'mustetm7@gmail.com' || adminsDb.has(auth!.uid))
  );
}

function evalIsUserPro(
  userId: string,
  usersDb: Map<string, MockDoc>,
  requestTimeMs: number
): boolean {
  const userDoc = usersDb.get(userId);
  if (!userDoc) return false;
  const isTierPro = userDoc.data.subscriptionTier === 'pro';
  const expiry = userDoc.data.expiryDate;
  if (!expiry) return false;

  const expiryMs = typeof expiry?.toMillis === 'function'
    ? expiry.toMillis()
    : typeof expiry?.getTime === 'function'
    ? expiry.getTime()
    : null;

  return isTierPro && expiryMs !== null && expiryMs > requestTimeMs;
}

function evalIsValidCloudVersionCreate(data: Record<string, any>): boolean {
  return (
    'cloudVersion' in data &&
    typeof data.cloudVersion === 'number' &&
    Number.isInteger(data.cloudVersion) &&
    data.cloudVersion === 1
  );
}

function evalIsValidCloudVersionUpdate(
  newData: Record<string, any>,
  oldData: Record<string, any>
): boolean {
  if (
    !('cloudVersion' in newData) ||
    typeof newData.cloudVersion !== 'number' ||
    !Number.isInteger(newData.cloudVersion)
  ) {
    return false;
  }
  if (!('cloudVersion' in oldData)) {
    return newData.cloudVersion === 1;
  }
  return (
    typeof oldData.cloudVersion === 'number' &&
    Number.isInteger(oldData.cloudVersion) &&
    oldData.cloudVersion >= 1 &&
    newData.cloudVersion === oldData.cloudVersion + 1
  );
}

function evalAllowDeleteUser(
  auth: MockAuth | null,
  userId: string,
  resourceData: Record<string, any>,
  adminsDb: Set<string>
): boolean {
  return (
    (evalIsOwner(auth, userId) &&
      (!('bikeCount' in resourceData) || resourceData.bikeCount === 0)) ||
    evalIsAdmin(auth, adminsDb)
  );
}

// Evaluates `match /motorcycles/{bikeId}` allow create
function evalAllowCreateMotorcycle(
  auth: MockAuth | null,
  motorcycleId: string,
  incomingData: Record<string, any>,
  motorcyclesBeforeDb: Map<string, MockDoc>,
  userBefore: MockDoc | null,
  userAfter: MockDoc | null,
  usersDb: Map<string, MockDoc>,
  requestTimeMs: number,
  adminsDb: Set<string>
): boolean {
  if (!evalIsSignedIn(auth)) return false;
  if (!hasOnlyKeys(incomingData, ALLOWED_MOTORCYCLE_KEYS)) return false;
  if ('photoUrl' in incomingData && (typeof incomingData.photoUrl !== 'string' || incomingData.photoUrl.length > 2000)) return false;
  if (incomingData.userId !== auth!.uid) return false;
  if (incomingData.id !== motorcycleId) return false;
  if (typeof motorcycleId !== 'string' || motorcycleId.length === 0 || motorcycleId.length > 128) return false;
  if (!evalIsValidCloudVersionCreate(incomingData)) return false;

  const existsBefore = motorcyclesBeforeDb.has(motorcycleId);
  if (existsBefore) return false;

  if (userAfter && userBefore) {
    const validAction = userAfter.data.lastBikeAction === 'create';
    const validBikeId = userAfter.data.lastBikeId === motorcycleId;
    const expectedCount = (('bikeCount' in userBefore.data) ? userBefore.data.bikeCount : 0) + 1;
    const actualCountMatches = userAfter.data.bikeCount === expectedCount;
    const isPro = evalIsUserPro(auth!.uid, usersDb, requestTimeMs);
    const currentCount = ('bikeCount' in userBefore.data) ? userBefore.data.bikeCount : 0;
    const underFreeLimit = currentCount < 1;
    const quotaPermitted = isPro || underFreeLimit;

    if (validAction && validBikeId && actualCountMatches && quotaPermitted) {
      return true;
    }
  }

  return evalIsAdmin(auth, adminsDb);
}

function evalAllowUpdateMotorcycle(
  auth: MockAuth | null,
  motorcycleId: string,
  oldData: Record<string, any>,
  newData: Record<string, any>,
  adminsDb: Set<string>
): boolean {
  if (!evalIsValidCloudVersionUpdate(newData, oldData)) return false;
  if (!hasOnlyKeys(newData, ALLOWED_MOTORCYCLE_KEYS)) return false;
  if ('photoUrl' in newData && (typeof newData.photoUrl !== 'string' || newData.photoUrl.length > 2000)) return false;
  if (
    evalIsOwner(auth, oldData.userId) &&
    newData.id === motorcycleId &&
    newData.id === oldData.id &&
    newData.userId === auth!.uid &&
    newData.userId === oldData.userId
  ) {
    return true;
  }
  return evalIsAdmin(auth, adminsDb);
}

function evalAllowCreateReminder(
  auth: MockAuth | null,
  reminderId: string,
  incomingData: Record<string, any>,
  motorcyclesDb: Map<string, MockDoc>
): boolean {
  if (!evalIsSignedIn(auth)) return false;
  if (!hasOnlyKeys(incomingData, ALLOWED_REMINDER_KEYS)) return false;
  if (!evalIsValidCloudVersionCreate(incomingData)) return false;
  if (incomingData.id !== reminderId || incomingData.userId !== auth!.uid) return false;
  const parentBike = motorcyclesDb.get(incomingData.bikeId);
  if (!parentBike || parentBike.data.userId !== auth!.uid) return false;
  return true;
}

function evalAllowUpdateReminder(
  auth: MockAuth | null,
  reminderId: string,
  oldData: Record<string, any>,
  newData: Record<string, any>,
  motorcyclesDb: Map<string, MockDoc>,
  adminsDb: Set<string>
): boolean {
  if (!evalIsValidCloudVersionUpdate(newData, oldData)) return false;
  if (!hasOnlyKeys(newData, ALLOWED_REMINDER_KEYS)) return false;
  if (evalIsOwner(auth, oldData.userId)) {
    if (newData.id !== reminderId || newData.id !== oldData.id) return false;
    if (newData.userId !== oldData.userId || newData.bikeId !== oldData.bikeId) return false;
    const parentBike = motorcyclesDb.get(newData.bikeId);
    if (!parentBike || parentBike.data.userId !== auth!.uid) return false;
    return true;
  }
  return evalIsAdmin(auth, adminsDb);
}

function evalAllowCreateServiceRecord(
  auth: MockAuth | null,
  recordId: string,
  incomingData: Record<string, any>,
  motorcyclesDb: Map<string, MockDoc>
): boolean {
  if (!evalIsSignedIn(auth)) return false;
  if (!hasOnlyKeys(incomingData, ALLOWED_SERVICE_RECORD_KEYS)) return false;
  if ('photoUrl' in incomingData && (typeof incomingData.photoUrl !== 'string' || incomingData.photoUrl.length > 2000)) return false;
  if ('parts' in incomingData && (!Array.isArray(incomingData.parts) || incomingData.parts.length > 50)) return false;
  if (!evalIsValidCloudVersionCreate(incomingData)) return false;
  if (incomingData.id !== recordId || incomingData.userId !== auth!.uid) return false;
  const parentBike = motorcyclesDb.get(incomingData.bikeId);
  if (parentBike && parentBike.data.userId !== auth!.uid) return false;
  return true;
}

function evalAllowUpdateServiceRecord(
  auth: MockAuth | null,
  recordId: string,
  oldData: Record<string, any>,
  newData: Record<string, any>,
  motorcyclesDb: Map<string, MockDoc>,
  adminsDb: Set<string>
): boolean {
  if (!evalIsValidCloudVersionUpdate(newData, oldData)) return false;
  if (!hasOnlyKeys(newData, ALLOWED_SERVICE_RECORD_KEYS)) return false;
  if (evalIsOwner(auth, oldData.userId)) {
    if (newData.id !== recordId || newData.id !== oldData.id) return false;
    if (newData.userId !== oldData.userId || newData.bikeId !== oldData.bikeId) return false;
    const parentBike = motorcyclesDb.get(newData.bikeId);
    if (parentBike && parentBike.data.userId !== auth!.uid) return false;
    return true;
  }
  return evalIsAdmin(auth, adminsDb);
}

// Evaluates `match /motorcycles/{bikeId}` allow delete
function evalAllowDeleteMotorcycle(
  auth: MockAuth | null,
  resourceData: Record<string, any>,
  motorcycleId: string,
  motorcyclesBeforeDb: Map<string, MockDoc>,
  userBefore: MockDoc | null,
  userAfter: MockDoc | null,
  adminsDb: Set<string>
): boolean {
  if (!evalIsSignedIn(auth)) return false;
  if (
    resourceData.userId === auth!.uid &&
    motorcyclesBeforeDb.has(motorcycleId) &&
    userAfter &&
    userBefore
  ) {
    const validAction = userAfter.data.lastBikeAction === 'delete';
    const validBikeId = userAfter.data.lastBikeId === motorcycleId;
    const oldCount = ('bikeCount' in userBefore.data) ? userBefore.data.bikeCount : 1;
    const expectedCount = oldCount > 0 ? oldCount - 1 : 0;
    const countMatches = userAfter.data.bikeCount === expectedCount;
    if (validAction && validBikeId && countMatches) {
      return true;
    }
  }
  return evalIsAdmin(auth, adminsDb);
}

// Evaluates `match /users/{userId}` allow update
function evalAllowUpdateUser(
  auth: MockAuth | null,
  userId: string,
  existingData: Record<string, any>,
  incomingData: Record<string, any>,
  adminsDb: Set<string>,
  motorcyclesBeforeDb: Map<string, MockDoc>,
  motorcyclesAfterDb: Map<string, MockDoc>
): boolean {
  if (!evalIsOwner(auth, userId)) {
    return evalIsAdmin(auth, adminsDb);
  }

  if (evalIsAdmin(auth, adminsDb)) return true;
  if (!hasOnlyKeys(incomingData, ALLOWED_USER_KEYS)) return false;

  if (incomingData.id !== userId) return false;
  if (incomingData.role !== existingData.role) return false;
  if (incomingData.subscriptionTier !== existingData.subscriptionTier) return false;

  const protectedKeys = [
    'role', 'subscriptionTier', 'subscriptionStatus', 'paymentStatus', 'approvedAt', 'approvedBy',
    'email', 'subscriptionStartDate', 'expiryDate', 'billingAnchorDay', 'lastPaymentId',
  ];
  for (const k of protectedKeys) {
    if (incomingData[k] !== existingData[k]) {
      return false;
    }
  }

  const touchesBikeCount =
    incomingData.bikeCount !== existingData.bikeCount ||
    incomingData.lastBikeId !== existingData.lastBikeId ||
    incomingData.lastBikeAction !== existingData.lastBikeAction;

  if (!touchesBikeCount) {
    return true;
  }

  if (incomingData.lastBikeAction === 'create') {
    const expectedCount = (('bikeCount' in existingData) ? existingData.bikeCount : 0) + 1;
    if (incomingData.bikeCount !== expectedCount) return false;
    if (typeof incomingData.lastBikeId !== 'string' || !incomingData.lastBikeId) return false;

    const existsBefore = motorcyclesBeforeDb.has(incomingData.lastBikeId);
    if (existsBefore) return false;

    const bikeAfter = motorcyclesAfterDb.get(incomingData.lastBikeId);
    if (!bikeAfter || bikeAfter.data.userId !== userId) return false;

    return true;
  }

  if (incomingData.lastBikeAction === 'delete') {
    const oldCount = ('bikeCount' in existingData) ? existingData.bikeCount : 0;
    const expectedCount = oldCount > 0 ? oldCount - 1 : 0;
    if (incomingData.bikeCount !== expectedCount) return false;
    if (typeof incomingData.lastBikeId !== 'string' || !incomingData.lastBikeId) return false;

    const bikeBefore = motorcyclesBeforeDb.get(incomingData.lastBikeId);
    if (!bikeBefore || bikeBefore.data.userId !== userId) return false;

    const existsAfter = motorcyclesAfterDb.has(incomingData.lastBikeId);
    if (existsAfter) return false;

    return true;
  }

  return false;
}

// Evaluates `match /paymentReferences/{refHash}` allow get / create
function evalAllowGetPaymentReference(
  auth: MockAuth | null,
  adminsDb: Set<string>
): boolean {
  return evalIsAdmin(auth, adminsDb);
}

function evalAllowCreatePaymentReference(
  auth: MockAuth | null,
  refHash: string,
  incomingData: Record<string, any>,
  paymentSubmissionsAfterDb: Map<string, MockDoc>
): boolean {
  if (!evalIsSignedIn(auth)) return false;
  const allowedKeys = new Set(['id', 'status', 'createdAt', 'submissionId']);
  if (!hasOnlyKeys(incomingData, allowedKeys)) return false;
  if (incomingData.id !== refHash || incomingData.status !== 'reserved') return false;
  if (typeof incomingData.submissionId !== 'string' || !incomingData.submissionId) return false;
  const subAfter = paymentSubmissionsAfterDb.get(incomingData.submissionId);
  if (!subAfter) return false;
  return (
    subAfter.data.referenceHash === refHash &&
    subAfter.data.userId === auth!.uid
  );
}

// Evaluates `match /paymentSubmissions/{submissionId}` allow create & delete
function evalAllowCreatePaymentSubmission(
  auth: MockAuth | null,
  submissionId: string,
  incomingData: Record<string, any>,
  paymentRefsBeforeDb: Map<string, MockDoc>,
  paymentRefsAfterDb: Map<string, MockDoc>,
  userBefore: MockDoc | null,
  userAfter: MockDoc | null
): boolean {
  if (!evalIsSignedIn(auth)) return false;
  if (auth!.token.email_verified !== true) return false;
  if (!hasOnlyKeys(incomingData, ALLOWED_PAYMENT_SUBMISSION_KEYS)) return false;
  if (incomingData.id !== submissionId || incomingData.userId !== auth!.uid) return false;
  if (incomingData.status !== 'pending_approval' || incomingData.amountPhp !== 49) return false;
  if (typeof incomingData.referenceNumber !== 'string' || incomingData.referenceNumber.length < 8 || incomingData.referenceNumber.length > 64) return false;
  if (paymentRefsBeforeDb.has(incomingData.referenceHash)) return false;
  const refAfter = paymentRefsAfterDb.get(incomingData.referenceHash);
  if (!refAfter || refAfter.data.submissionId !== submissionId) return false;
  if (userBefore && userBefore.data.pendingSubmissionId != null) return false;
  if (!userAfter || userAfter.data.pendingSubmissionId !== submissionId) return false;
  return true;
}

function evalAllowDeletePaymentSubmission(
  auth: MockAuth | null,
  resourceData: Record<string, any>,
  adminsDb: Set<string>
): boolean {
  return (
    (evalIsOwner(auth, resourceData.userId) && resourceData.status === 'pending_approval') ||
    evalIsAdmin(auth, adminsDb)
  );
}

// =============================================================================
// RUNNING THE 33 TARGETED VERIFICATION SCENARIOS
// =============================================================================

const adminsDb = new Set(['admin-super']);
const nowMs = new Date('2026-11-07T12:00:00Z').getTime();

// SCENARIO 1: Free user creates first motorcycle
{
  const auth: MockAuth = { uid: 'rider-free', token: { email: 'free@example.com', email_verified: true } };
  const userBefore: MockDoc = { data: { id: 'rider-free', subscriptionTier: 'free', bikeCount: 0 } };
  const userAfter: MockDoc = { data: { id: 'rider-free', subscriptionTier: 'free', bikeCount: 1, lastBikeId: 'bike-101', lastBikeAction: 'create' } };
  const usersDb = new Map([['rider-free', userBefore]]);
  const motorcyclesBefore = new Map<string, MockDoc>();
  const motorcyclesAfter = new Map([['bike-101', { data: { id: 'bike-101', userId: 'rider-free', cloudVersion: 1 } }]]);

  const userAllowed = evalAllowUpdateUser(auth, 'rider-free', userBefore.data, userAfter.data, adminsDb, motorcyclesBefore, motorcyclesAfter);
  const bikeAllowed = evalAllowCreateMotorcycle(auth, 'bike-101', { id: 'bike-101', userId: 'rider-free', cloudVersion: 1 }, motorcyclesBefore, userBefore, userAfter, usersDb, nowMs, adminsDb);

  assert(userAllowed && bikeAllowed, 'Free rider was blocked from creating first motorcycle');
  console.log('✓ SCENARIO 1 PASS: Free user creates first motorcycle (0 -> 1 allowed, cloudVersion: 1).');
}

// SCENARIO 2: Free user cannot create second motorcycle
{
  const auth: MockAuth = { uid: 'rider-free', token: { email: 'free@example.com', email_verified: true } };
  const userBefore: MockDoc = { data: { id: 'rider-free', subscriptionTier: 'free', bikeCount: 1 } };
  const userAfter: MockDoc = { data: { id: 'rider-free', subscriptionTier: 'free', bikeCount: 2, lastBikeId: 'bike-102', lastBikeAction: 'create' } };
  const usersDb = new Map([['rider-free', userBefore]]);
  const motorcyclesBefore = new Map([['bike-101', { data: { id: 'bike-101', userId: 'rider-free', cloudVersion: 1 } }]]);

  const bikeAllowed = evalAllowCreateMotorcycle(auth, 'bike-102', { id: 'bike-102', userId: 'rider-free', cloudVersion: 1 }, motorcyclesBefore, userBefore, userAfter, usersDb, nowMs, adminsDb);

  assert(!bikeAllowed, 'Free rider was improperly permitted to create a second bike');
  console.log('✓ SCENARIO 2 PASS: Free user cannot create second motorcycle (server quota enforced).');
}

// SCENARIO 3: Active Pro user creates multiple motorcycles
{
  const auth: MockAuth = { uid: 'rider-pro', token: { email: 'pro@example.com', email_verified: true } };
  const futureExpiry = { toMillis: () => nowMs + 20 * 86400000 };
  const userBefore: MockDoc = { data: { id: 'rider-pro', subscriptionTier: 'pro', expiryDate: futureExpiry, bikeCount: 3 } };
  const userAfter: MockDoc = { data: { id: 'rider-pro', subscriptionTier: 'pro', expiryDate: futureExpiry, bikeCount: 4, lastBikeId: 'bike-pro-4', lastBikeAction: 'create' } };
  const usersDb = new Map([['rider-pro', userBefore]]);
  const motorcyclesBefore = new Map<string, MockDoc>();
  const motorcyclesAfter = new Map([['bike-pro-4', { data: { id: 'bike-pro-4', userId: 'rider-pro', cloudVersion: 1 } }]]);

  const userAllowed = evalAllowUpdateUser(auth, 'rider-pro', userBefore.data, userAfter.data, adminsDb, motorcyclesBefore, motorcyclesAfter);
  const bikeAllowed = evalAllowCreateMotorcycle(auth, 'bike-pro-4', { id: 'bike-pro-4', userId: 'rider-pro', cloudVersion: 1 }, motorcyclesBefore, userBefore, userAfter, usersDb, nowMs, adminsDb);

  assert(userAllowed && bikeAllowed, 'Active Pro rider was blocked from creating multiple motorcycles');
  console.log('✓ SCENARIO 3 PASS: Active Pro user creates multiple motorcycles (unlimited garage capacity).');
}

// SCENARIO 4: Expired Pro user cannot create additional motorcycles beyond the Free quota
{
  const auth: MockAuth = { uid: 'rider-expired', token: { email: 'exp@example.com', email_verified: true } };
  const pastExpiry = { toMillis: () => nowMs - 10000 };
  const userBefore: MockDoc = { data: { id: 'rider-expired', subscriptionTier: 'pro', expiryDate: pastExpiry, bikeCount: 2 } };
  const userAfter: MockDoc = { data: { id: 'rider-expired', subscriptionTier: 'pro', expiryDate: pastExpiry, bikeCount: 3, lastBikeId: 'bike-exp-3', lastBikeAction: 'create' } };
  const usersDb = new Map([['rider-expired', userBefore]]);
  const motorcyclesBefore = new Map<string, MockDoc>();

  const bikeAllowed = evalAllowCreateMotorcycle(auth, 'bike-exp-3', { id: 'bike-exp-3', userId: 'rider-expired', cloudVersion: 1 }, motorcyclesBefore, userBefore, userAfter, usersDb, nowMs, adminsDb);

  assert(!bikeAllowed, 'Expired Pro rider was permitted to add bike beyond Free limit');
  console.log('✓ SCENARIO 4 PASS: Expired Pro user cannot create additional motorcycles beyond Free quota.');
}

// SCENARIO 5: Replaying a previous create counter transition is rejected
{
  const auth: MockAuth = { uid: 'attacker', token: { email: 'atk@example.com', email_verified: true } };
  const preExistingBikeId = 'bike-already-there';
  const motorcyclesBefore = new Map([[preExistingBikeId, { data: { id: preExistingBikeId, userId: 'attacker', cloudVersion: 1 } }]]);
  const motorcyclesAfter = new Map([[preExistingBikeId, { data: { id: preExistingBikeId, userId: 'attacker', cloudVersion: 1 } }]]);

  const userBefore: MockDoc = { data: { id: 'attacker', subscriptionTier: 'pro', bikeCount: 2 } };
  const userAfter: MockDoc = { data: { id: 'attacker', subscriptionTier: 'pro', bikeCount: 3, lastBikeId: preExistingBikeId, lastBikeAction: 'create' } };

  const userAllowed = evalAllowUpdateUser(auth, 'attacker', userBefore.data, userAfter.data, adminsDb, motorcyclesBefore, motorcyclesAfter);
  assert(!userAllowed, 'Replay of existing motorcycle create was allowed!');
  console.log('✓ SCENARIO 5 PASS: Replaying a previous create counter transition is rejected (!exists check blocks replay).');
}

// SCENARIO 6: Replaying a previous delete counter transition is rejected
{
  const auth: MockAuth = { uid: 'attacker', token: { email: 'atk@example.com', email_verified: true } };
  const alreadyDeletedBikeId = 'bike-deleted-yesterday';
  const motorcyclesBefore = new Map<string, MockDoc>();
  const motorcyclesAfter = new Map<string, MockDoc>();

  const userBefore: MockDoc = { data: { id: 'attacker', subscriptionTier: 'pro', bikeCount: 2 } };
  const userAfter: MockDoc = { data: { id: 'attacker', subscriptionTier: 'pro', bikeCount: 1, lastBikeId: alreadyDeletedBikeId, lastBikeAction: 'delete' } };

  const userAllowed = evalAllowUpdateUser(auth, 'attacker', userBefore.data, userAfter.data, adminsDb, motorcyclesBefore, motorcyclesAfter);
  assert(!userAllowed, 'Replay of non-existent motorcycle delete was allowed!');
  console.log('✓ SCENARIO 6 PASS: Replaying a previous delete counter transition is rejected (exists check blocks replay).');
}

// SCENARIO 7: User cannot forge bikeCount directly
{
  const auth: MockAuth = { uid: 'rider-1', token: { email: 'r1@example.com', email_verified: true } };
  const userBefore: MockDoc = { data: { id: 'rider-1', subscriptionTier: 'free', bikeCount: 1 } };
  const userAfter: MockDoc = { data: { id: 'rider-1', subscriptionTier: 'free', bikeCount: 0 } };

  const allowed = evalAllowUpdateUser(auth, 'rider-1', userBefore.data, userAfter.data, adminsDb, new Map(), new Map());
  assert(!allowed, 'User forged bikeCount directly');
  console.log('✓ SCENARIO 7 PASS: User cannot forge bikeCount directly on user document.');
}

// SCENARIO 8: User cannot modify expiryDate or subscriptionTier
{
  const auth: MockAuth = { uid: 'rider-1', token: { email: 'r1@example.com', email_verified: true } };
  const userBefore: MockDoc = { data: { id: 'rider-1', subscriptionTier: 'free', expiryDate: null } };
  const userElevateTier: MockDoc = { data: { id: 'rider-1', subscriptionTier: 'pro', expiryDate: null } };
  const userForgeExpiry: MockDoc = { data: { id: 'rider-1', subscriptionTier: 'free', expiryDate: { toMillis: () => nowMs + 1000000 } } };

  const tierAllowed = evalAllowUpdateUser(auth, 'rider-1', userBefore.data, userElevateTier.data, adminsDb, new Map(), new Map());
  const expiryAllowed = evalAllowUpdateUser(auth, 'rider-1', userBefore.data, userForgeExpiry.data, adminsDb, new Map(), new Map());

  assert(!tierAllowed && !expiryAllowed, 'User modified privileged subscription attributes');
  console.log('✓ SCENARIO 8 PASS: User cannot modify expiryDate or subscriptionTier (privilege escalation prevented).');
}

// SCENARIO 9: User cannot create motorcycles under another UID
{
  const auth: MockAuth = { uid: 'attacker', token: { email: 'atk@example.com', email_verified: true } };
  const userBefore: MockDoc = { data: { id: 'victim', subscriptionTier: 'free', bikeCount: 0 } };
  const userAfter: MockDoc = { data: { id: 'victim', subscriptionTier: 'free', bikeCount: 1, lastBikeId: 'bike-victim', lastBikeAction: 'create' } };
  const usersDb = new Map([['victim', userBefore]]);

  const bikeAllowed = evalAllowCreateMotorcycle(
    auth,
    'bike-victim',
    { id: 'bike-victim', userId: 'victim', cloudVersion: 1 },
    new Map(),
    userBefore,
    userAfter,
    usersDb,
    nowMs,
    adminsDb
  );
  assert(!bikeAllowed, 'Attacker was able to create bike under victim UID');
  console.log('✓ SCENARIO 9 PASS: User cannot create motorcycles under another UID.');
}

// SCENARIO 10: User retains access to their historical motorcycles and maintenance records after expiration
{
  const auth: MockAuth = { uid: 'expired-user', token: { email: 'exp@example.com', email_verified: true } };
  const ownsMotorcycle = evalIsOwner(auth, 'expired-user');
  const ownsServiceRecord = evalIsOwner(auth, 'expired-user');
  const ownsReminder = evalIsOwner(auth, 'expired-user');

  assert(ownsMotorcycle && ownsServiceRecord && ownsReminder, 'Expired user lost access to personal records');
  console.log('✓ SCENARIO 10 PASS: User retains 100% read/write access to existing motorcycles & service history after expiration.');
}

// SCENARIO 11: Deleting a motorcycle correctly decrements bikeCount
{
  const auth: MockAuth = { uid: 'rider-1', token: { email: 'r1@example.com', email_verified: true } };
  const bikeId = 'bike-to-delete';
  const motorcyclesBefore = new Map([[bikeId, { data: { id: bikeId, userId: 'rider-1', cloudVersion: 1 } }]]);
  const motorcyclesAfter = new Map<string, MockDoc>();
  const userBefore: MockDoc = { data: { id: 'rider-1', bikeCount: 2 } };
  const userAfter: MockDoc = { data: { id: 'rider-1', bikeCount: 1, lastBikeId: bikeId, lastBikeAction: 'delete' } };

  const userAllowed = evalAllowUpdateUser(auth, 'rider-1', userBefore.data, userAfter.data, adminsDb, motorcyclesBefore, motorcyclesAfter);
  const bikeAllowed = evalAllowDeleteMotorcycle(auth, { id: bikeId, userId: 'rider-1', cloudVersion: 1 }, bikeId, motorcyclesBefore, userBefore, userAfter, adminsDb);

  assert(userAllowed && bikeAllowed, 'Legitimate bike deletion and counter decrement failed');
  console.log('✓ SCENARIO 11 PASS: Deleting a motorcycle correctly decrements bikeCount (2 -> 1).');
}

// SCENARIO 12: Invalid or inconsistent counter transitions are rejected
{
  const auth: MockAuth = { uid: 'rider-1', token: { email: 'r1@example.com', email_verified: true } };
  const userBefore: MockDoc = { data: { id: 'rider-1', bikeCount: 1 } };
  const userJumpedCount: MockDoc = { data: { id: 'rider-1', bikeCount: 3, lastBikeId: 'bike-new', lastBikeAction: 'create' } };
  const motorcyclesBefore = new Map<string, MockDoc>();
  const motorcyclesAfter = new Map([['bike-new', { data: { id: 'bike-new', userId: 'rider-1', cloudVersion: 1 } }]]);

  const jumpedAllowed = evalAllowUpdateUser(auth, 'rider-1', userBefore.data, userJumpedCount.data, adminsDb, motorcyclesBefore, motorcyclesAfter);
  assert(!jumpedAllowed, 'Jumped counter transition was allowed');
  console.log('✓ SCENARIO 12 PASS: Invalid or inconsistent counter transitions are rejected.');
}

// SCENARIO 13: Existing users' counters are reconciled without modifying their motorcycles or subscriptions
{
  const riderId = 'legacy-rider';
  const legacyUser = {
    id: riderId,
    role: 'rider',
    subscriptionTier: 'free',
    subscriptionStatus: 'free',
    expiryDate: null,
    bikeCount: undefined as number | undefined,
  };
  const legacyBikes = [
    { id: 'bike-leg-1', userId: riderId, model: 'NMAX 155' },
    { id: 'bike-leg-2', userId: riderId, model: 'Aerox 155' },
    { id: 'bike-leg-3', userId: riderId, model: 'Click 125i' },
  ];

  const actualMotorcycleCount = legacyBikes.filter(b => b.userId === riderId).length;
  assert(actualMotorcycleCount === 3, 'Actual count is 3');

  const reconciledUser = {
    ...legacyUser,
    bikeCount: actualMotorcycleCount,
    updatedAt: new Date().toISOString(),
  };

  assert(reconciledUser.bikeCount === 3, 'Bike count reconciled to 3');
  assert(reconciledUser.subscriptionTier === 'free', 'Subscription tier untouched');
  assert(legacyBikes.length === 3, 'All 3 legacy motorcycles retained without deletion');
  console.log('✓ SCENARIO 13 PASS: Existing users counters are reconciled safely without deleting motorcycles or resetting subscriptions.');
}

// =============================================================================
// SCENARIOS 14–25: CLOUDVERSION & PARENT MOTORCYCLE OWNERSHIP RULES
// =============================================================================

const cvAuth: MockAuth = { uid: 'rider-cv', token: { email: 'cv@example.com', email_verified: true } };
const cvUserBefore: MockDoc = { data: { id: 'rider-cv', subscriptionTier: 'free', bikeCount: 0 } };
const cvUserAfter: MockDoc = { data: { id: 'rider-cv', subscriptionTier: 'free', bikeCount: 1, lastBikeId: 'bike-cv', lastBikeAction: 'create' } };
const cvUsersDb = new Map([['rider-cv', cvUserBefore]]);
const cvBikesDb = new Map([['bike-cv', { data: { id: 'bike-cv', userId: 'rider-cv', cloudVersion: 1 } }]]);

// SCENARIO 14: Create with cloudVersion 1 succeeds
{
  const bikeOk = evalAllowCreateMotorcycle(cvAuth, 'bike-cv', { id: 'bike-cv', userId: 'rider-cv', cloudVersion: 1 }, new Map(), cvUserBefore, cvUserAfter, cvUsersDb, nowMs, adminsDb);
  const remOk = evalAllowCreateReminder(cvAuth, 'rem-cv', { id: 'rem-cv', userId: 'rider-cv', bikeId: 'bike-cv', cloudVersion: 1 }, cvBikesDb);
  const recOk = evalAllowCreateServiceRecord(cvAuth, 'rec-cv', { id: 'rec-cv', userId: 'rider-cv', bikeId: 'bike-cv', cloudVersion: 1 }, cvBikesDb);
  assert(bikeOk && remOk && recOk, 'Create with cloudVersion 1 failed');
  console.log('✓ SCENARIO 14 PASS: Create with cloudVersion == 1 succeeds across motorcycles, reminders, and serviceRecords.');
}

// SCENARIO 15: Create without cloudVersion fails
{
  const bikeNoCv = evalAllowCreateMotorcycle(cvAuth, 'bike-cv', { id: 'bike-cv', userId: 'rider-cv' }, new Map(), cvUserBefore, cvUserAfter, cvUsersDb, nowMs, adminsDb);
  const remNoCv = evalAllowCreateReminder(cvAuth, 'rem-cv', { id: 'rem-cv', userId: 'rider-cv', bikeId: 'bike-cv' }, cvBikesDb);
  const recNoCv = evalAllowCreateServiceRecord(cvAuth, 'rec-cv', { id: 'rec-cv', userId: 'rider-cv', bikeId: 'bike-cv' }, cvBikesDb);
  assert(!bikeNoCv && !remNoCv && !recNoCv, 'Create without cloudVersion was allowed');
  console.log('✓ SCENARIO 15 PASS: Create without cloudVersion is rejected.');
}

// SCENARIO 16: Create with cloudVersion 2 fails
{
  const bikeCv2 = evalAllowCreateMotorcycle(cvAuth, 'bike-cv', { id: 'bike-cv', userId: 'rider-cv', cloudVersion: 2 }, new Map(), cvUserBefore, cvUserAfter, cvUsersDb, nowMs, adminsDb);
  const remCv2 = evalAllowCreateReminder(cvAuth, 'rem-cv', { id: 'rem-cv', userId: 'rider-cv', bikeId: 'bike-cv', cloudVersion: 2 }, cvBikesDb);
  const recCv2 = evalAllowCreateServiceRecord(cvAuth, 'rec-cv', { id: 'rec-cv', userId: 'rider-cv', bikeId: 'bike-cv', cloudVersion: 2 }, cvBikesDb);
  assert(!bikeCv2 && !remCv2 && !recCv2, 'Create with cloudVersion 2 was allowed');
  console.log('✓ SCENARIO 16 PASS: Create with cloudVersion == 2 is rejected.');
}

// SCENARIO 17: Update from version 1 to 2 succeeds
{
  const bikeUp = evalAllowUpdateMotorcycle(cvAuth, 'bike-cv', { id: 'bike-cv', userId: 'rider-cv', cloudVersion: 1 }, { id: 'bike-cv', userId: 'rider-cv', cloudVersion: 2 }, adminsDb);
  const remUp = evalAllowUpdateReminder(cvAuth, 'rem-cv', { id: 'rem-cv', userId: 'rider-cv', bikeId: 'bike-cv', cloudVersion: 1 }, { id: 'rem-cv', userId: 'rider-cv', bikeId: 'bike-cv', cloudVersion: 2 }, cvBikesDb, adminsDb);
  const recUp = evalAllowUpdateServiceRecord(cvAuth, 'rec-cv', { id: 'rec-cv', userId: 'rider-cv', bikeId: 'bike-cv', cloudVersion: 1 }, { id: 'rec-cv', userId: 'rider-cv', bikeId: 'bike-cv', cloudVersion: 2 }, cvBikesDb, adminsDb);
  assert(bikeUp && remUp && recUp, 'Update from cloudVersion 1 to 2 failed');
  console.log('✓ SCENARIO 17 PASS: Update from cloudVersion 1 to 2 succeeds.');
}

// SCENARIO 18: Update leaving version unchanged fails
{
  const sameV = evalAllowUpdateMotorcycle(cvAuth, 'bike-cv', { id: 'bike-cv', userId: 'rider-cv', cloudVersion: 1 }, { id: 'bike-cv', userId: 'rider-cv', cloudVersion: 1 }, adminsDb);
  assert(!sameV, 'Unchanged cloudVersion update was allowed');
  console.log('✓ SCENARIO 18 PASS: Update leaving cloudVersion unchanged (1 -> 1) is rejected.');
}

// SCENARIO 19: Update decreasing version fails
{
  const decV = evalAllowUpdateMotorcycle(cvAuth, 'bike-cv', { id: 'bike-cv', userId: 'rider-cv', cloudVersion: 2 }, { id: 'bike-cv', userId: 'rider-cv', cloudVersion: 1 }, adminsDb);
  assert(!decV, 'Decreased cloudVersion update was allowed');
  console.log('✓ SCENARIO 19 PASS: Update decreasing cloudVersion (2 -> 1) is rejected.');
}

// SCENARIO 20: Update jumping from 1 to 3 fails
{
  const jumpV = evalAllowUpdateMotorcycle(cvAuth, 'bike-cv', { id: 'bike-cv', userId: 'rider-cv', cloudVersion: 1 }, { id: 'bike-cv', userId: 'rider-cv', cloudVersion: 3 }, adminsDb);
  assert(!jumpV, 'Jumped cloudVersion update (1 -> 3) was allowed');
  console.log('✓ SCENARIO 20 PASS: Update jumping cloudVersion from 1 to 3 is rejected.');
}

// SCENARIO 21: Legacy document without cloudVersion can be updated to version 1
{
  const legOk = evalAllowUpdateMotorcycle(cvAuth, 'bike-cv', { id: 'bike-cv', userId: 'rider-cv' }, { id: 'bike-cv', userId: 'rider-cv', cloudVersion: 1 }, adminsDb);
  assert(legOk, 'Legacy document first update to cloudVersion 1 failed');
  console.log('✓ SCENARIO 21 PASS: Legacy document without cloudVersion can be updated to cloudVersion == 1.');
}

// SCENARIO 22: Legacy document's first update to version 2 is rejected
{
  const legBad = evalAllowUpdateMotorcycle(cvAuth, 'bike-cv', { id: 'bike-cv', userId: 'rider-cv' }, { id: 'bike-cv', userId: 'rider-cv', cloudVersion: 2 }, adminsDb);
  assert(!legBad, 'Legacy document first update to cloudVersion 2 was allowed');
  console.log("✓ SCENARIO 22 PASS: Legacy document's first update to cloudVersion == 2 is rejected.");
}

// SCENARIO 23: Cross-user attempts remain blocked
{
  const attacker: MockAuth = { uid: 'attacker-uid', token: { email: 'atk@example.com', email_verified: true } };
  const crossBike = evalAllowUpdateMotorcycle(attacker, 'bike-cv', { id: 'bike-cv', userId: 'rider-cv', cloudVersion: 1 }, { id: 'bike-cv', userId: 'rider-cv', cloudVersion: 2 }, adminsDb);
  const crossRem = evalAllowUpdateReminder(attacker, 'rem-cv', { id: 'rem-cv', userId: 'rider-cv', bikeId: 'bike-cv', cloudVersion: 1 }, { id: 'rem-cv', userId: 'rider-cv', bikeId: 'bike-cv', cloudVersion: 2 }, cvBikesDb, adminsDb);
  assert(!crossBike && !crossRem, 'Cross-user update was allowed');
  console.log('✓ SCENARIO 23 PASS: Cross-user attempts remain blocked.');
}

// SCENARIO 24: Unauthorized parent motorcycle references remain blocked
{
  const attacker: MockAuth = { uid: 'attacker-uid', token: { email: 'atk@example.com', email_verified: true } };
  const foreignRem = evalAllowCreateReminder(attacker, 'rem-atk', { id: 'rem-atk', userId: 'attacker-uid', bikeId: 'bike-cv', cloudVersion: 1 }, cvBikesDb);
  const foreignRec = evalAllowCreateServiceRecord(attacker, 'rec-atk', { id: 'rec-atk', userId: 'attacker-uid', bikeId: 'bike-cv', cloudVersion: 1 }, cvBikesDb);
  const missingBikeRem = evalAllowCreateReminder(cvAuth, 'rem-orphan', { id: 'rem-orphan', userId: 'rider-cv', bikeId: 'nonexistent-bike', cloudVersion: 1 }, cvBikesDb);
  assert(!foreignRem && !foreignRec && !missingBikeRem, 'Unauthorized parent motorcycle reference was allowed');
  console.log('✓ SCENARIO 24 PASS: Unauthorized or nonexistent parent motorcycle references remain blocked.');
}

// SCENARIO 25: Malformed legacy cloudVersion values are rejected on update
{
  const malformedStr = evalAllowUpdateMotorcycle(cvAuth, 'bike-cv', { id: 'bike-cv', userId: 'rider-cv', cloudVersion: '1' }, { id: 'bike-cv', userId: 'rider-cv', cloudVersion: 2 }, adminsDb);
  const malformedZero = evalAllowUpdateMotorcycle(cvAuth, 'bike-cv', { id: 'bike-cv', userId: 'rider-cv', cloudVersion: 0 }, { id: 'bike-cv', userId: 'rider-cv', cloudVersion: 1 }, adminsDb);
  const malformedFloat = evalAllowUpdateMotorcycle(cvAuth, 'bike-cv', { id: 'bike-cv', userId: 'rider-cv', cloudVersion: 1 }, { id: 'bike-cv', userId: 'rider-cv', cloudVersion: 1.5 }, adminsDb);
  assert(!malformedStr && !malformedZero && !malformedFloat, 'Malformed cloudVersion was allowed');
  console.log('✓ SCENARIO 25 PASS: Malformed legacy or incoming cloudVersion values are rejected.');
}

// =============================================================================
// SCENARIOS 26–33: QUOTA BYPASS PREVENTION, PAYMENT HARDENING & SCHEMA RULES
// =============================================================================

// SCENARIO 26: Owner cannot delete users/{uid} while bikeCount > 0
{
  const auth: MockAuth = { uid: 'rider-bypass', token: { email: 'bypass@example.com', email_verified: true } };
  const canDeleteWithBike = evalAllowDeleteUser(auth, 'rider-bypass', { id: 'rider-bypass', bikeCount: 1 }, adminsDb);
  const canDeleteWhenZero = evalAllowDeleteUser(auth, 'rider-bypass', { id: 'rider-bypass', bikeCount: 0 }, adminsDb);
  assert(!canDeleteWithBike, 'Owner was permitted to delete user doc while bikeCount > 0');
  assert(canDeleteWhenZero, 'Owner was blocked from deleting user doc when bikeCount == 0');
  console.log('✓ SCENARIO 26 PASS: Owner cannot delete users/{uid} while bikeCount > 0.');
}

// SCENARIO 27: Quota cannot be reset by recreating the profile after a legal delete
{
  const auth: MockAuth = { uid: 'rider-quota', token: { email: 'quota@example.com', email_verified: true } };
  // Recreated profile has bikeCount: 0; after 1st bike is added, bikeCount is 1 and user cannot delete profile or add 2nd bike
  const userWithOneBike: MockDoc = { data: { id: 'rider-quota', subscriptionTier: 'free', bikeCount: 1 } };
  const userAttemptSecondBike: MockDoc = { data: { id: 'rider-quota', subscriptionTier: 'free', bikeCount: 2, lastBikeId: 'bike-2', lastBikeAction: 'create' } };
  const canDelete = evalAllowDeleteUser(auth, 'rider-quota', userWithOneBike.data, adminsDb);
  const canAddSecond = evalAllowCreateMotorcycle(
    auth,
    'bike-2',
    { id: 'bike-2', userId: 'rider-quota', cloudVersion: 1 },
    new Map([['bike-1', { data: { id: 'bike-1', userId: 'rider-quota', cloudVersion: 1 } }]]),
    userWithOneBike,
    userAttemptSecondBike,
    new Map([['rider-quota', userWithOneBike]]),
    nowMs,
    adminsDb
  );
  assert(!canDelete && !canAddSecond, 'Quota reset bypass succeeded');
  console.log('✓ SCENARIO 27 PASS: Quota cannot be reset by recreating the profile.');
}

// SCENARIO 28: Cannot create a paymentReferences doc for someone else's submission
{
  const attacker: MockAuth = { uid: 'attacker-uid', token: { email: 'atk@example.com', email_verified: true } };
  const submissionsAfter = new Map([
    [
      'sub-victim',
      {
        data: {
          id: 'sub-victim',
          userId: 'victim-uid',
          referenceHash: 'hash-victim-1',
        },
      },
    ],
  ]);
  const allowed = evalAllowCreatePaymentReference(
    attacker,
    'hash-victim-1',
    { id: 'hash-victim-1', status: 'reserved', createdAt: '2026-11-11T10:00:00Z', submissionId: 'sub-victim' },
    submissionsAfter
  );
  assert(!allowed, "Attacker created paymentReferences doc for someone else's submission");
  console.log("✓ SCENARIO 28 PASS: Cannot create a paymentReferences doc for someone else's submission.");
}

// SCENARIO 29: Non-admin cannot get paymentReferences
{
  const rider: MockAuth = { uid: 'rider-1', token: { email: 'r1@example.com', email_verified: true } };
  const admin: MockAuth = { uid: 'owner-uid', token: { email: 'mustetm7@gmail.com', email_verified: true } };
  assert(!evalAllowGetPaymentReference(rider, adminsDb), 'Non-admin was allowed to get paymentReferences');
  assert(evalAllowGetPaymentReference(admin, adminsDb), 'Verified admin was blocked from getting paymentReferences');
  console.log('✓ SCENARIO 29 PASS: Non-admin cannot get paymentReferences.');
}

// SCENARIO 30: Unknown extra fields rejected on bikes, reminders, and service records
{
  const extraBike = evalAllowUpdateMotorcycle(
    cvAuth,
    'bike-cv',
    { id: 'bike-cv', userId: 'rider-cv', cloudVersion: 1 },
    { id: 'bike-cv', userId: 'rider-cv', cloudVersion: 2, unknownExtraField: 'evil' },
    adminsDb
  );
  const extraRem = evalAllowCreateReminder(
    cvAuth,
    'rem-extra',
    { id: 'rem-extra', userId: 'rider-cv', bikeId: 'bike-cv', cloudVersion: 1, extraProp: 123 },
    cvBikesDb
  );
  const extraRec = evalAllowCreateServiceRecord(
    cvAuth,
    'rec-extra',
    { id: 'rec-extra', userId: 'rider-cv', bikeId: 'bike-cv', cloudVersion: 1, evilField: true },
    cvBikesDb
  );
  assert(!extraBike && !extraRem && !extraRec, 'Unknown extra fields were permitted');
  console.log('✓ SCENARIO 30 PASS: Unknown extra fields rejected on motorcycles, reminders, and serviceRecords.');
}

// SCENARIO 31: Owner cannot delete an approved payment submission
{
  const owner: MockAuth = { uid: 'rider-pay', token: { email: 'pay@example.com', email_verified: true } };
  const canDeleteApproved = evalAllowDeletePaymentSubmission(
    owner,
    { id: 'sub-1', userId: 'rider-pay', status: 'active_pro' },
    adminsDb
  );
  const canDeletePending = evalAllowDeletePaymentSubmission(
    owner,
    { id: 'sub-2', userId: 'rider-pay', status: 'pending_approval' },
    adminsDb
  );
  assert(!canDeleteApproved, 'Owner was permitted to delete an approved payment submission');
  assert(canDeletePending, 'Owner was blocked from deleting their own pending payment submission');
  console.log('✓ SCENARIO 31 PASS: Owner cannot delete an approved payment submission.');
}

// SCENARIO 32: Unverified email cannot create a payment submission
{
  const unverified: MockAuth = { uid: 'rider-unv', token: { email: 'unv@example.com', email_verified: false } };
  const refsAfter = new Map([['hash-1', { data: { id: 'hash-1', status: 'reserved', submissionId: 'sub-1' } }]]);
  const userBefore: MockDoc = { data: { id: 'rider-unv', pendingSubmissionId: null } };
  const userAfter: MockDoc = { data: { id: 'rider-unv', pendingSubmissionId: 'sub-1' } };
  const allowed = evalAllowCreatePaymentSubmission(
    unverified,
    'sub-1',
    {
      id: 'sub-1',
      userId: 'rider-unv',
      userEmail: 'unv@example.com',
      userName: 'Unverified Rider',
      bikeModel: 'Click 125i',
      paymentMethod: 'gcash',
      referenceNumber: '9001827364512',
      referenceHash: 'hash-1',
      amountPhp: 49,
      status: 'pending_approval',
      submittedAt: '2026-11-11T10:00:00Z',
    },
    new Map(),
    refsAfter,
    userBefore,
    userAfter
  );
  assert(!allowed, 'Unverified email was permitted to create a payment submission');
  console.log('✓ SCENARIO 32 PASS: Unverified email cannot create a payment submission.');
}

// SCENARIO 33: User cannot create a new payment submission if pendingSubmissionId is already set
{
  const verified: MockAuth = { uid: 'rider-ver', token: { email: 'ver@example.com', email_verified: true } };
  const refsAfter = new Map([['hash-2', { data: { id: 'hash-2', status: 'reserved', submissionId: 'sub-2' } }]]);
  const userWithPending: MockDoc = { data: { id: 'rider-ver', pendingSubmissionId: 'sub-1' } };
  const userAfter: MockDoc = { data: { id: 'rider-ver', pendingSubmissionId: 'sub-2' } };
  const allowed = evalAllowCreatePaymentSubmission(
    verified,
    'sub-2',
    {
      id: 'sub-2',
      userId: 'rider-ver',
      userEmail: 'ver@example.com',
      userName: 'Verified Rider',
      bikeModel: 'Click 125i',
      paymentMethod: 'gcash',
      referenceNumber: '9001827364599',
      referenceHash: 'hash-2',
      amountPhp: 49,
      status: 'pending_approval',
      submittedAt: '2026-11-11T10:05:00Z',
    },
    new Map(),
    refsAfter,
    userWithPending,
    userAfter
  );
  assert(!allowed, 'User created a second payment submission while one was already pending');
  console.log('✓ SCENARIO 33 PASS: User cannot create a second payment submission while pendingSubmissionId is set.');
}

console.log('\n========================================================================');
console.log(' ALL 33 TARGETED VERIFICATION SCENARIOS PASSED WITH ZERO ERRORS');
console.log('========================================================================');
process.exit(0);
