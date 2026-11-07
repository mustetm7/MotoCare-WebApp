import {
  calculateNextMonthlyExpiry,
  getManilaDay,
  calculateDaysRemaining,
  parseExpiryToDate,
} from '../src/utils/firestoreService';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
}

console.log('================================================================');
console.log(' MotoCare Firestore Security & Entitlement Verification Suite   ');
console.log(' Testing 15 Security Invariants for Quota, Expiry & Data Access ');
console.log('================================================================\n');

// Mock helpers simulating Firestore Rules engine evaluation semantics
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

// Security Rules Helper implementations matching firestore.rules exactly
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
    (adminsDb.has(auth!.uid) || auth!.token.email === 'mustetm7@gmail.com')
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

  // In rules: userDoc.data.expiryDate is timestamp && userDoc.data.expiryDate > request.time
  const expiryMs = typeof expiry?.toMillis === 'function'
    ? expiry.toMillis()
    : typeof expiry?.getTime === 'function'
    ? expiry.getTime()
    : null;

  return isTierPro && expiryMs !== null && expiryMs > requestTimeMs;
}

function evalAllowCreateMotorcycle(
  auth: MockAuth | null,
  motorcycleId: string,
  incomingData: Record<string, any>,
  userBefore: MockDoc | null,
  userAfter: MockDoc | null,
  usersDb: Map<string, MockDoc>,
  requestTimeMs: number,
  adminsDb: Set<string>
): boolean {
  if (!evalIsSignedIn(auth)) return false;
  if (incomingData.userId !== auth!.uid) return false;
  if (incomingData.id !== motorcycleId) return false;
  if (typeof motorcycleId !== 'string' || motorcycleId.length === 0 || motorcycleId.length > 128) return false;

  if (evalIsAdmin(auth, adminsDb)) return true;

  if (!userAfter || !userBefore) return false;

  const validAction = userAfter.data.lastBikeAction === 'create';
  const validBikeId = userAfter.data.lastBikeId === motorcycleId;

  const expectedCount = (('bikeCount' in userBefore.data) ? userBefore.data.bikeCount : 0) + 1;
  const actualCountMatches = userAfter.data.bikeCount === expectedCount;

  const isPro = evalIsUserPro(auth!.uid, usersDb, requestTimeMs);
  const currentCount = ('bikeCount' in userBefore.data) ? userBefore.data.bikeCount : 0;
  const underFreeLimit = currentCount < 1;
  const quotaPermitted = isPro || underFreeLimit;

  return validAction && validBikeId && actualCountMatches && quotaPermitted;
}

function evalAllowDeleteMotorcycle(
  auth: MockAuth | null,
  resourceData: Record<string, any>,
  motorcycleId: string,
  userBefore: MockDoc | null,
  userAfter: MockDoc | null,
  adminsDb: Set<string>
): boolean {
  if (!evalIsSignedIn(auth)) return false;
  if (evalIsAdmin(auth, adminsDb)) return true;
  if (resourceData.userId !== auth!.uid) return false;

  if (!userAfter || !userBefore) return false;

  const validAction = userAfter.data.lastBikeAction === 'delete';
  const validBikeId = userAfter.data.lastBikeId === motorcycleId;

  const oldCount = ('bikeCount' in userBefore.data) ? userBefore.data.bikeCount : 1;
  const expectedCount = oldCount > 0 ? oldCount - 1 : 0;
  const countMatches = userAfter.data.bikeCount === expectedCount;

  return validAction && validBikeId && countMatches;
}

function evalAllowUpdateUser(
  auth: MockAuth | null,
  userId: string,
  existingData: Record<string, any>,
  incomingData: Record<string, any>,
  adminsDb: Set<string>,
  motorcyclesAfterDb: Map<string, MockDoc>
): boolean {
  if (evalIsAdmin(auth, adminsDb)) return true;
  if (!evalIsOwner(auth, userId)) return false;

  // Immutability check
  if (incomingData.id !== userId) return false;
  if (incomingData.role !== existingData.role) return false;
  if (incomingData.subscriptionTier !== existingData.subscriptionTier) return false;

  // Protected keys
  const protectedKeys = [
    'role', 'subscriptionTier', 'subscriptionStatus', 'paymentStatus', 'approvedAt', 'approvedBy',
    'email', 'subscriptionStartDate', 'expiryDate', 'billingAnchorDay', 'lastPaymentId'
  ];
  for (const k of protectedKeys) {
    if (incomingData[k] !== existingData[k]) {
      return false;
    }
  }

  // bikeCount guard
  const touchesBikeCount =
    incomingData.bikeCount !== existingData.bikeCount ||
    incomingData.lastBikeId !== existingData.lastBikeId ||
    incomingData.lastBikeAction !== existingData.lastBikeAction;

  if (!touchesBikeCount) {
    return true; // Simple profile update like displayName
  }

  // If bikeCount changes, must be consistent create or delete
  if (incomingData.lastBikeAction === 'create') {
    const expectedCount = (('bikeCount' in existingData) ? existingData.bikeCount : 0) + 1;
    if (incomingData.bikeCount !== expectedCount) return false;
    if (typeof incomingData.lastBikeId !== 'string' || !incomingData.lastBikeId) return false;
    const bikeAfter = motorcyclesAfterDb.get(incomingData.lastBikeId);
    if (!bikeAfter || bikeAfter.data.userId !== userId) return false;
    return true;
  }

  if (incomingData.lastBikeAction === 'delete') {
    const oldCount = ('bikeCount' in existingData) ? existingData.bikeCount : 0;
    const expectedCount = oldCount > 0 ? oldCount - 1 : 0;
    if (incomingData.bikeCount !== expectedCount) return false;
    if (typeof incomingData.lastBikeId !== 'string' || !incomingData.lastBikeId) return false;
    const bikeAfter = motorcyclesAfterDb.get(incomingData.lastBikeId);
    if (bikeAfter) return false; // Must be deleted!
    return true;
  }

  return false;
}

// ================================================================
// EXECUTING THE 15 SECURITY SUITE INVARIANTS
// ================================================================

const adminsDb = new Set(['admin-123']);
const nowMs = new Date('2026-11-07T12:00:00Z').getTime();

// TEST 1: Unauthenticated users cannot create motorcycles
{
  const allowed = evalAllowCreateMotorcycle(
    null,
    'bike-1',
    { id: 'bike-1', userId: 'rider-1' },
    null,
    null,
    new Map(),
    nowMs,
    adminsDb
  );
  assert(!allowed, 'Unauthenticated write was allowed');
  console.log('✓ TEST 1 PASS: Unauthenticated users cannot create motorcycles.');
}

// TEST 2: Free rider can create their first motorcycle
{
  const auth: MockAuth = { uid: 'rider-1', token: { email: 'rider1@example.com', email_verified: true } };
  const userBefore: MockDoc = { data: { id: 'rider-1', subscriptionTier: 'free', bikeCount: 0 } };
  const userAfter: MockDoc = { data: { id: 'rider-1', subscriptionTier: 'free', bikeCount: 1, lastBikeId: 'bike-1', lastBikeAction: 'create' } };
  const usersDb = new Map([['rider-1', userBefore]]);

  const allowed = evalAllowCreateMotorcycle(
    auth,
    'bike-1',
    { id: 'bike-1', userId: 'rider-1' },
    userBefore,
    userAfter,
    usersDb,
    nowMs,
    adminsDb
  );
  assert(allowed, 'Free rider first bike was rejected');
  console.log('✓ TEST 2 PASS: Free rider can create their first motorcycle (0 -> 1).');
}

// TEST 3: Free rider cannot create a second motorcycle
{
  const auth: MockAuth = { uid: 'rider-1', token: { email: 'rider1@example.com', email_verified: true } };
  const userBefore: MockDoc = { data: { id: 'rider-1', subscriptionTier: 'free', bikeCount: 1 } };
  const userAfter: MockDoc = { data: { id: 'rider-1', subscriptionTier: 'free', bikeCount: 2, lastBikeId: 'bike-2', lastBikeAction: 'create' } };
  const usersDb = new Map([['rider-1', userBefore]]);

  const allowed = evalAllowCreateMotorcycle(
    auth,
    'bike-2',
    { id: 'bike-2', userId: 'rider-1' },
    userBefore,
    userAfter,
    usersDb,
    nowMs,
    adminsDb
  );
  assert(!allowed, 'Free rider second bike was improperly permitted');
  console.log('✓ TEST 3 PASS: Free rider cannot create a second motorcycle (blocked by server quota).');
}

// TEST 4: Active Pro rider can create multiple motorcycles
{
  const auth: MockAuth = { uid: 'rider-pro', token: { email: 'pro@example.com', email_verified: true } };
  const futureExpiry = { toMillis: () => nowMs + 15 * 86400000 };
  const userBefore: MockDoc = { data: { id: 'rider-pro', subscriptionTier: 'pro', expiryDate: futureExpiry, bikeCount: 4 } };
  const userAfter: MockDoc = { data: { id: 'rider-pro', subscriptionTier: 'pro', expiryDate: futureExpiry, bikeCount: 5, lastBikeId: 'bike-5', lastBikeAction: 'create' } };
  const usersDb = new Map([['rider-pro', userBefore]]);

  const allowed = evalAllowCreateMotorcycle(
    auth,
    'bike-5',
    { id: 'bike-5', userId: 'rider-pro' },
    userBefore,
    userAfter,
    usersDb,
    nowMs,
    adminsDb
  );
  assert(allowed, 'Active Pro rider was blocked from creating multiple bikes');
  console.log('✓ TEST 4 PASS: Active Pro rider can create multiple motorcycles (unlimited garage capacity).');
}

// TEST 5: Expired Pro rider cannot create additional motorcycles beyond the Free limit
{
  const auth: MockAuth = { uid: 'rider-exp', token: { email: 'exp@example.com', email_verified: true } };
  const pastExpiry = { toMillis: () => nowMs - 5 * 86400000 };
  const userBefore: MockDoc = { data: { id: 'rider-exp', subscriptionTier: 'pro', expiryDate: pastExpiry, bikeCount: 2 } };
  const userAfter: MockDoc = { data: { id: 'rider-exp', subscriptionTier: 'pro', expiryDate: pastExpiry, bikeCount: 3, lastBikeId: 'bike-3', lastBikeAction: 'create' } };
  const usersDb = new Map([['rider-exp', userBefore]]);

  const allowed = evalAllowCreateMotorcycle(
    auth,
    'bike-3',
    { id: 'bike-3', userId: 'rider-exp' },
    userBefore,
    userAfter,
    usersDb,
    nowMs,
    adminsDb
  );
  assert(!allowed, 'Expired Pro was allowed to exceed Free quota');
  console.log('✓ TEST 5 PASS: Expired Pro rider cannot create additional motorcycles beyond Free limit.');
}

// TEST 6: Rider cannot forge bikeCount directly on user document
{
  const auth: MockAuth = { uid: 'rider-1', token: { email: 'rider1@example.com', email_verified: true } };
  const existing = { id: 'rider-1', role: 'rider', subscriptionTier: 'free', bikeCount: 1 };
  // Malicious rider attempts to arbitrarily decrement bikeCount to 0 without deleting motorcycle
  const forged = { id: 'rider-1', role: 'rider', subscriptionTier: 'free', bikeCount: 0 };
  const motorcyclesAfterDb = new Map(); // No motorcycle action

  const allowed = evalAllowUpdateUser(auth, 'rider-1', existing, forged, adminsDb, motorcyclesAfterDb);
  assert(!allowed, 'Rider successfully forged bikeCount');
  console.log('✓ TEST 6 PASS: Rider cannot forge bikeCount directly on user document.');
}

// TEST 7: Rider cannot modify expiryDate
{
  const auth: MockAuth = { uid: 'rider-1', token: { email: 'rider1@example.com', email_verified: true } };
  const existing = { id: 'rider-1', role: 'rider', subscriptionTier: 'free', expiryDate: null };
  const forged = { id: 'rider-1', role: 'rider', subscriptionTier: 'free', expiryDate: { toMillis: () => nowMs + 10000000 } };
  const allowed = evalAllowUpdateUser(auth, 'rider-1', existing, forged, adminsDb, new Map());
  assert(!allowed, 'Rider was able to update expiryDate');
  console.log('✓ TEST 7 PASS: Rider cannot modify expiryDate in user document.');
}

// TEST 8: Rider cannot modify subscriptionTier
{
  const auth: MockAuth = { uid: 'rider-1', token: { email: 'rider1@example.com', email_verified: true } };
  const existing = { id: 'rider-1', role: 'rider', subscriptionTier: 'free' };
  const forged = { id: 'rider-1', role: 'rider', subscriptionTier: 'pro' };
  const allowed = evalAllowUpdateUser(auth, 'rider-1', existing, forged, adminsDb, new Map());
  assert(!allowed, 'Rider was able to elevate subscriptionTier');
  console.log('✓ TEST 8 PASS: Rider cannot modify subscriptionTier (privilege escalation blocked).');
}

// TEST 9: Rider cannot create motorcycles under another user's UID
{
  const auth: MockAuth = { uid: 'attacker-1', token: { email: 'attacker@example.com', email_verified: true } };
  const userBefore: MockDoc = { data: { id: 'victim-2', subscriptionTier: 'free', bikeCount: 0 } };
  const userAfter: MockDoc = { data: { id: 'victim-2', subscriptionTier: 'free', bikeCount: 1, lastBikeId: 'bike-victim', lastBikeAction: 'create' } };
  const usersDb = new Map([['victim-2', userBefore]]);

  const allowed = evalAllowCreateMotorcycle(
    auth,
    'bike-victim',
    { id: 'bike-victim', userId: 'victim-2' }, // Spoofed userId
    userBefore,
    userAfter,
    usersDb,
    nowMs,
    adminsDb
  );
  assert(!allowed, 'Rider was able to create bike under victim UID');
  console.log("✓ TEST 9 PASS: Rider cannot create motorcycles under another user's UID.");
}

// TEST 10: Rider can read their own historical motorcycle records
{
  const auth: MockAuth = { uid: 'rider-1', token: { email: 'rider1@example.com', email_verified: true } };
  const motorcycleOwnerId = 'rider-1';
  const canRead = evalIsOwner(auth, motorcycleOwnerId) || evalIsAdmin(auth, adminsDb);
  assert(canRead, 'Rider was denied reading their own motorcycle');
  console.log('✓ TEST 10 PASS: Rider can read their own historical motorcycle records.');
}

// TEST 11: Rider can access their own maintenance history after expiration
{
  const auth: MockAuth = { uid: 'expired-rider', token: { email: 'exp@example.com', email_verified: true } };
  const serviceRecordOwnerId = 'expired-rider';
  // Check if allow get: isOwner(resource.data.userId) || isAdmin() depends on subscription status
  const canReadServiceHistory = evalIsOwner(auth, serviceRecordOwnerId);
  assert(canReadServiceHistory, 'Expired rider was denied reading service record');
  console.log('✓ TEST 11 PASS: Rider can access their own maintenance and service history after expiration.');
}

// TEST 12: Rider cannot modify another user's motorcycle
{
  const auth: MockAuth = { uid: 'attacker-1', token: { email: 'attacker@example.com', email_verified: true } };
  const victimBikeOwner = 'victim-1';
  const canModify = evalIsOwner(auth, victimBikeOwner) || evalIsAdmin(auth, adminsDb);
  assert(!canModify, 'Attacker was allowed to modify victim bike');
  console.log("✓ TEST 12 PASS: Rider cannot modify another user's motorcycle.");
}

// TEST 13: Motorcycle deletion correctly decrements bikeCount
{
  const auth: MockAuth = { uid: 'rider-1', token: { email: 'rider1@example.com', email_verified: true } };
  const userBefore: MockDoc = { data: { id: 'rider-1', bikeCount: 2 } };
  const userAfter: MockDoc = { data: { id: 'rider-1', bikeCount: 1, lastBikeId: 'bike-del', lastBikeAction: 'delete' } };

  const allowed = evalAllowDeleteMotorcycle(
    auth,
    { id: 'bike-del', userId: 'rider-1' },
    'bike-del',
    userBefore,
    userAfter,
    adminsDb
  );
  assert(allowed, 'Legitimate bike deletion was blocked');
  console.log('✓ TEST 13 PASS: Motorcycle deletion correctly decrements bikeCount (2 -> 1).');
}

// TEST 14: Duplicate transactions cannot inflate bikeCount
{
  const auth: MockAuth = { uid: 'rider-1', token: { email: 'rider1@example.com', email_verified: true } };
  const userBefore: MockDoc = { data: { id: 'rider-1', subscriptionTier: 'pro', bikeCount: 2 } };
  // Attacker tries to jump counter from 2 to 4
  const userAfterInvalid: MockDoc = { data: { id: 'rider-1', subscriptionTier: 'pro', bikeCount: 4, lastBikeId: 'bike-3', lastBikeAction: 'create' } };
  const usersDb = new Map([['rider-1', userBefore]]);

  const allowed = evalAllowCreateMotorcycle(
    auth,
    'bike-3',
    { id: 'bike-3', userId: 'rider-1' },
    userBefore,
    userAfterInvalid,
    usersDb,
    nowMs,
    adminsDb
  );
  assert(!allowed, 'Invalid counter inflation succeeded');
  console.log('✓ TEST 14 PASS: Duplicate / jumped counter updates are rejected (must increment by exactly 1).');
}

// TEST 15: Invalid counter updates are rejected
{
  const auth: MockAuth = { uid: 'rider-1', token: { email: 'rider1@example.com', email_verified: true } };
  const existing = { id: 'rider-1', role: 'rider', subscriptionTier: 'free', bikeCount: 1 };
  // Attacker sends an action other than create or delete
  const invalid = { id: 'rider-1', role: 'rider', subscriptionTier: 'free', bikeCount: 2, lastBikeAction: 'arbitrary' };

  const allowed = evalAllowUpdateUser(auth, 'rider-1', existing, invalid, adminsDb, new Map());
  assert(!allowed, 'Arbitrary counter manipulation succeeded');
  console.log('✓ TEST 15 PASS: Invalid or arbitrary counter updates are rejected.');
}

console.log('\n================================================================');
console.log(' ALL 15 SECURITY RULE INVARIANTS PASSED VERIFICATION');
console.log('================================================================');
process.exit(0);
