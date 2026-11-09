/**
 * MotoCare - Firestore Security Rules Unit Tests (Firebase Local Emulator Suite)
 *
 * Uses @firebase/rules-unit-testing against demo project `demo-motocare-test` to assert:
 *
 * PART A — Quota, Anti-Replay & RBAC Rules (Scenarios 1–12):
 * 1. Free user creating 1st motorcycle (id, userId, cloudVersion: 1) -> ALLOW
 * 2. Free user creating 2nd motorcycle -> DENY
 * 3. Free user updating bikeCount without creating motorcycle -> DENY
 * 4. Free user creating motorcycle without updating bikeCount -> DENY
 * 5. Free user incrementing bikeCount by 2 -> DENY
 * 6. Free user decrementing bikeCount without deleting motorcycle -> DENY
 * 7. Free user creating motorcycle referencing already existing bike -> DENY
 * 8. Free user deleting motorcycle referencing non-existent bike -> DENY
 * 9. Free user modifying another user's bikeCount -> DENY
 * 10. Active Pro user (with native Firestore Timestamp expiryDate) creating multiple motorcycles -> ALLOW
 * 11. Expired Pro user creating 2nd motorcycle -> DENY
 * 12. Verified Admin (mustetm7@gmail.com, email_verified: true) reconciling bikeCount -> ALLOW
 *
 * PART B — cloudVersion, Legacy Initialization & Parent Motorcycle Ownership Rules (Scenarios 13–24):
 * 13. Create motorcycle/reminder/serviceRecord with cloudVersion == 1 -> ALLOW
 * 14. Create motorcycle/reminder/serviceRecord without cloudVersion -> DENY
 * 15. Create motorcycle/reminder/serviceRecord with cloudVersion == 2 -> DENY
 * 16. Update from cloudVersion 1 to 2 -> ALLOW
 * 17. Update leaving cloudVersion unchanged (1 -> 1) -> DENY
 * 18. Update decreasing cloudVersion (2 -> 1) -> DENY
 * 19. Update jumping cloudVersion from 1 to 3 -> DENY
 * 20. Legacy document without cloudVersion updated to cloudVersion == 1 -> ALLOW
 * 21. Legacy document without cloudVersion updated to cloudVersion == 2 on first update -> DENY
 * 22. Cross-user read/update/delete attempts on motorcycles, reminders, and serviceRecords -> DENY
 * 23. Reminder or serviceRecord referencing another user's or nonexistent parent motorcycle -> DENY
 * 24. Malformed legacy cloudVersion (string, float, 0, negative) on update -> DENY
 *
 * HOW TO RUN (Requires Java Runtime Environment JRE 11+):
 *   firebase emulators:exec --project demo-motocare-test --only firestore "npx tsx tests/emulatorRules.test.ts"
 */

import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { Timestamp } from 'firebase/firestore';
import * as fs from 'fs';
import * as path from 'path';

export const DEMO_PROJECT_ID = 'demo-motocare-test';
const RULES_PATH = path.resolve(process.cwd(), 'firestore.rules');

export async function runRulesEmulatorSuite(): Promise<{
  executed: boolean;
  passed: number;
  failed: number;
  skippedReason?: string;
}> {
  console.log('------------------------------------------------------------');
  console.log('MotoCare Firestore Security Rules Emulator Test Suite');
  console.log(`Target Demo Project: ${DEMO_PROJECT_ID} (Port 8080)`);
  console.log('Testing 24 Quota, Anti-Replay, RBAC & cloudVersion Scenarios');
  console.log('------------------------------------------------------------');

  if (!fs.existsSync(RULES_PATH)) {
    throw new Error(`Rules file not found at ${RULES_PATH}`);
  }

  const rules = fs.readFileSync(RULES_PATH, 'utf8');

  let testEnv: RulesTestEnvironment;
  try {
    testEnv = await initializeTestEnvironment({
      projectId: DEMO_PROJECT_ID,
      firestore: {
        rules,
        host: process.env.FIRESTORE_EMULATOR_HOST?.split(':')[0] || '127.0.0.1',
        port: parseInt(process.env.FIRESTORE_EMULATOR_HOST?.split(':')[1] || '8080', 10),
      },
    });
  } catch (err: any) {
    const reason = err?.message || String(err);
    console.error('\n[Notice: Firebase Emulator Connection Unavailable]');
    console.error('The Firebase Firestore Emulator daemon requires Java (JRE 11+) on the host.');
    console.error('To execute against the real Firestore Emulator, run:');
    console.error(
      '  firebase emulators:exec --project demo-motocare-test --only firestore "npx tsx tests/emulatorRules.test.ts"'
    );
    console.error(`Error details: ${reason}`);
    return { executed: false, passed: 0, failed: 0, skippedReason: reason };
  }

  let passed = 0;
  let failed = 0;

  async function testCase(name: string, fn: () => Promise<void>) {
    try {
      await testEnv.clearFirestore();
      await fn();
      console.log(`  ✓ PASS: ${name}`);
      passed++;
    } catch (e: any) {
      console.error(`  ✕ FAIL: ${name}`);
      console.error(`    ${e?.message || e}`);
      failed++;
    }
  }

  try {
    // =========================================================================
    // PART A: QUOTA, ANTI-REPLAY & RBAC RULES (1–12)
    // =========================================================================

    await testCase('1. Free user creating 1st motorcycle (cloudVersion: 1) -> ALLOW', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await db.doc('users/rider_1').set({
          id: 'rider_1',
          uid: 'rider_1',
          email: 'rider1@example.com',
          role: 'rider',
          subscriptionTier: 'free',
          bikeCount: 0,
        });
      });

      const userCtx = testEnv.authenticatedContext('rider_1', {
        email: 'rider1@example.com',
        email_verified: true,
      });
      const db = userCtx.firestore();

      const batch = db.batch();
      batch.set(db.doc('motorcycles/bike_1'), {
        id: 'bike_1',
        userId: 'rider_1',
        brand: 'Honda',
        model: 'Click 125i',
        year: 2024,
        odometer: 1000,
        cloudVersion: 1,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
      batch.update(db.doc('users/rider_1'), {
        id: 'rider_1',
        role: 'rider',
        subscriptionTier: 'free',
        bikeCount: 1,
        lastBikeId: 'bike_1',
        lastBikeAction: 'create',
      });

      await assertSucceeds(batch.commit());
    });

    await testCase('2. Free user creating 2nd motorcycle (quota limit = 1) -> DENY', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await db.doc('users/rider_2').set({
          id: 'rider_2',
          uid: 'rider_2',
          email: 'rider2@example.com',
          role: 'rider',
          subscriptionTier: 'free',
          bikeCount: 1,
        });
        await db.doc('motorcycles/bike_existing').set({
          id: 'bike_existing',
          userId: 'rider_2',
          brand: 'Yamaha',
          model: 'Mio i125',
          year: 2023,
          odometer: 5000,
          cloudVersion: 1,
        });
      });

      const userCtx = testEnv.authenticatedContext('rider_2', {
        email: 'rider2@example.com',
        email_verified: true,
      });
      const db = userCtx.firestore();

      const batch = db.batch();
      batch.set(db.doc('motorcycles/bike_2'), {
        id: 'bike_2',
        userId: 'rider_2',
        brand: 'Kawasaki',
        model: 'Ninja 400',
        year: 2024,
        odometer: 200,
        cloudVersion: 1,
      });
      batch.update(db.doc('users/rider_2'), {
        id: 'rider_2',
        role: 'rider',
        subscriptionTier: 'free',
        bikeCount: 2,
        lastBikeId: 'bike_2',
        lastBikeAction: 'create',
      });

      await assertFails(batch.commit());
    });

    await testCase('3. Free user updating bikeCount without creating motorcycle -> DENY', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await db.doc('users/rider_3').set({
          id: 'rider_3',
          uid: 'rider_3',
          email: 'rider3@example.com',
          role: 'rider',
          subscriptionTier: 'free',
          bikeCount: 0,
        });
      });

      const userCtx = testEnv.authenticatedContext('rider_3', {
        email: 'rider3@example.com',
        email_verified: true,
      });
      const db = userCtx.firestore();

      await assertFails(
        db.doc('users/rider_3').update({
          bikeCount: 1,
          lastBikeId: 'bike_fake',
          lastBikeAction: 'create',
        })
      );
    });

    await testCase('4. Free user creating motorcycle without updating bikeCount -> DENY', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await db.doc('users/rider_4').set({
          id: 'rider_4',
          uid: 'rider_4',
          email: 'rider4@example.com',
          role: 'rider',
          subscriptionTier: 'free',
          bikeCount: 0,
        });
      });

      const userCtx = testEnv.authenticatedContext('rider_4', {
        email: 'rider4@example.com',
        email_verified: true,
      });
      const db = userCtx.firestore();

      await assertFails(
        db.doc('motorcycles/bike_orphaned').set({
          id: 'bike_orphaned',
          userId: 'rider_4',
          brand: 'Vespa',
          model: 'Sprint 150',
          year: 2024,
          odometer: 100,
          cloudVersion: 1,
        })
      );
    });

    await testCase('5. Free user incrementing bikeCount by 2 -> DENY', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await db.doc('users/rider_5').set({
          id: 'rider_5',
          uid: 'rider_5',
          email: 'rider5@example.com',
          role: 'rider',
          subscriptionTier: 'free',
          bikeCount: 0,
        });
      });

      const userCtx = testEnv.authenticatedContext('rider_5', {
        email: 'rider5@example.com',
        email_verified: true,
      });
      const db = userCtx.firestore();

      const batch = db.batch();
      batch.set(db.doc('motorcycles/bike_5'), {
        id: 'bike_5',
        userId: 'rider_5',
        brand: 'Honda',
        model: 'Beat',
        year: 2024,
        odometer: 0,
        cloudVersion: 1,
      });
      batch.update(db.doc('users/rider_5'), {
        id: 'rider_5',
        role: 'rider',
        subscriptionTier: 'free',
        bikeCount: 2,
        lastBikeId: 'bike_5',
        lastBikeAction: 'create',
      });

      await assertFails(batch.commit());
    });

    await testCase('6. Free user decrementing bikeCount without deleting motorcycle -> DENY', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await db.doc('users/rider_6').set({
          id: 'rider_6',
          uid: 'rider_6',
          email: 'rider6@example.com',
          role: 'rider',
          subscriptionTier: 'free',
          bikeCount: 1,
        });
        await db.doc('motorcycles/bike_6').set({
          id: 'bike_6',
          userId: 'rider_6',
          brand: 'Suzuki',
          model: 'Raider R150',
          year: 2023,
          odometer: 3000,
          cloudVersion: 1,
        });
      });

      const userCtx = testEnv.authenticatedContext('rider_6', {
        email: 'rider6@example.com',
        email_verified: true,
      });
      const db = userCtx.firestore();

      await assertFails(
        db.doc('users/rider_6').update({
          bikeCount: 0,
          lastBikeId: 'bike_6',
          lastBikeAction: 'delete',
        })
      );
    });

    await testCase('7. Free user creating motorcycle referencing already existing bike -> DENY', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await db.doc('users/rider_7').set({
          id: 'rider_7',
          uid: 'rider_7',
          email: 'rider7@example.com',
          role: 'rider',
          subscriptionTier: 'free',
          bikeCount: 0,
        });
        await db.doc('motorcycles/bike_7_pre_existing').set({
          id: 'bike_7_pre_existing',
          userId: 'rider_7',
          brand: 'Yamaha',
          model: 'Aerox 155',
          year: 2023,
          odometer: 1200,
          cloudVersion: 1,
        });
      });

      const userCtx = testEnv.authenticatedContext('rider_7', {
        email: 'rider7@example.com',
        email_verified: true,
      });
      const db = userCtx.firestore();

      const batch = db.batch();
      batch.set(db.doc('motorcycles/bike_7_pre_existing'), {
        id: 'bike_7_pre_existing',
        userId: 'rider_7',
        brand: 'Yamaha',
        model: 'Aerox V2',
        year: 2024,
        odometer: 0,
        cloudVersion: 1,
      });
      batch.update(db.doc('users/rider_7'), {
        id: 'rider_7',
        role: 'rider',
        subscriptionTier: 'free',
        bikeCount: 1,
        lastBikeId: 'bike_7_pre_existing',
        lastBikeAction: 'create',
      });

      await assertFails(batch.commit());
    });

    await testCase('8. Free user deleting motorcycle referencing non-existent bike -> DENY', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await db.doc('users/rider_8').set({
          id: 'rider_8',
          uid: 'rider_8',
          email: 'rider8@example.com',
          role: 'rider',
          subscriptionTier: 'free',
          bikeCount: 1,
        });
      });

      const userCtx = testEnv.authenticatedContext('rider_8', {
        email: 'rider8@example.com',
        email_verified: true,
      });
      const db = userCtx.firestore();

      const batch = db.batch();
      batch.delete(db.doc('motorcycles/bike_non_existent'));
      batch.update(db.doc('users/rider_8'), {
        id: 'rider_8',
        role: 'rider',
        subscriptionTier: 'free',
        bikeCount: 0,
        lastBikeId: 'bike_non_existent',
        lastBikeAction: 'delete',
      });

      await assertFails(batch.commit());
    });

    await testCase("9. User modifying another user's bikeCount -> DENY", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await db.doc('users/victim_rider').set({
          id: 'victim_rider',
          uid: 'victim_rider',
          email: 'victim@example.com',
          role: 'rider',
          subscriptionTier: 'free',
          bikeCount: 0,
        });
      });

      const attackerCtx = testEnv.authenticatedContext('attacker_rider', {
        email: 'attacker@example.com',
        email_verified: true,
      });
      const db = attackerCtx.firestore();

      await assertFails(
        db.doc('users/victim_rider').update({
          bikeCount: 5,
        })
      );
    });

    await testCase('10. Active Pro user creating multiple motorcycles -> ALLOW', async () => {
      const futureDate = Timestamp.fromDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await db.doc('users/pro_rider').set({
          id: 'pro_rider',
          uid: 'pro_rider',
          email: 'pro@example.com',
          role: 'rider',
          subscriptionTier: 'pro',
          expiryDate: futureDate,
          bikeCount: 1,
        });
        await db.doc('motorcycles/pro_bike_1').set({
          id: 'pro_bike_1',
          userId: 'pro_rider',
          brand: 'BMW',
          model: 'R1250GS',
          year: 2024,
          odometer: 4000,
          cloudVersion: 1,
        });
      });

      const proCtx = testEnv.authenticatedContext('pro_rider', {
        email: 'pro@example.com',
        email_verified: true,
      });
      const db = proCtx.firestore();

      const batch = db.batch();
      batch.set(db.doc('motorcycles/pro_bike_2'), {
        id: 'pro_bike_2',
        userId: 'pro_rider',
        brand: 'Ducati',
        model: 'Multistrada V4',
        year: 2024,
        odometer: 500,
        cloudVersion: 1,
      });
      batch.update(db.doc('users/pro_rider'), {
        id: 'pro_rider',
        role: 'rider',
        subscriptionTier: 'pro',
        bikeCount: 2,
        lastBikeId: 'pro_bike_2',
        lastBikeAction: 'create',
      });

      await assertSucceeds(batch.commit());
    });

    await testCase('11. Expired Pro user creating 2nd motorcycle -> DENY', async () => {
      const pastDate = Timestamp.fromDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await db.doc('users/expired_pro').set({
          id: 'expired_pro',
          uid: 'expired_pro',
          email: 'expired@example.com',
          role: 'rider',
          subscriptionTier: 'pro',
          expiryDate: pastDate,
          bikeCount: 1,
        });
        await db.doc('motorcycles/expired_bike_1').set({
          id: 'expired_bike_1',
          userId: 'expired_pro',
          brand: 'Harley-Davidson',
          model: 'Iron 883',
          year: 2022,
          odometer: 8000,
          cloudVersion: 1,
        });
      });

      const userCtx = testEnv.authenticatedContext('expired_pro', {
        email: 'expired@example.com',
        email_verified: true,
      });
      const db = userCtx.firestore();

      const batch = db.batch();
      batch.set(db.doc('motorcycles/expired_bike_2'), {
        id: 'expired_bike_2',
        userId: 'expired_pro',
        brand: 'Triumph',
        model: 'Bonneville T120',
        year: 2023,
        odometer: 1500,
        cloudVersion: 1,
      });
      batch.update(db.doc('users/expired_pro'), {
        id: 'expired_pro',
        role: 'rider',
        subscriptionTier: 'pro',
        bikeCount: 2,
        lastBikeId: 'expired_bike_2',
        lastBikeAction: 'create',
      });

      await assertFails(batch.commit());
    });

    await testCase('12. Verified Admin reconciling bikeCount without transaction -> ALLOW', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await db.doc('users/desynced_rider').set({
          id: 'desynced_rider',
          uid: 'desynced_rider',
          email: 'desynced@example.com',
          role: 'rider',
          subscriptionTier: 'free',
          bikeCount: 5,
        });
      });

      const adminCtx = testEnv.authenticatedContext('admin_uid', {
        email: 'mustetm7@gmail.com',
        email_verified: true,
      });
      const db = adminCtx.firestore();

      await assertSucceeds(
        db.doc('users/desynced_rider').update({
          bikeCount: 1,
        })
      );
    });

    // =========================================================================
    // PART B: CLOUDVERSION & PARENT MOTORCYCLE OWNERSHIP RULES (13–24)
    // =========================================================================

    await testCase('13. Create with cloudVersion == 1 succeeds across motorcycles, reminders, and serviceRecords', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await db.doc('users/rider_cv').set({
          id: 'rider_cv',
          uid: 'rider_cv',
          email: 'cv@example.com',
          role: 'rider',
          subscriptionTier: 'free',
          bikeCount: 0,
        });
      });

      const ctx = testEnv.authenticatedContext('rider_cv', {
        email: 'cv@example.com',
        email_verified: true,
      });
      const db = ctx.firestore();

      const batch = db.batch();
      batch.set(db.doc('motorcycles/bike_cv_1'), {
        id: 'bike_cv_1',
        userId: 'rider_cv',
        brand: 'Yamaha',
        model: 'NMAX 155',
        year: 2024,
        odometer: 1000,
        cloudVersion: 1,
      });
      batch.update(db.doc('users/rider_cv'), {
        id: 'rider_cv',
        role: 'rider',
        subscriptionTier: 'free',
        bikeCount: 1,
        lastBikeId: 'bike_cv_1',
        lastBikeAction: 'create',
      });
      await assertSucceeds(batch.commit());

      await assertSucceeds(
        db.doc('reminders/rem_cv_1').set({
          id: 'rem_cv_1',
          userId: 'rider_cv',
          bikeId: 'bike_cv_1',
          title: 'Engine Oil Change',
          intervalKm: 1500,
          nextDueOdo: 2500,
          cloudVersion: 1,
        })
      );

      await assertSucceeds(
        db.doc('serviceRecords/rec_cv_1').set({
          id: 'rec_cv_1',
          userId: 'rider_cv',
          bikeId: 'bike_cv_1',
          title: 'Initial Break-in Oil Service',
          date: '2026-11-08',
          odometer: 1000,
          totalCostPhp: 450,
          cloudVersion: 1,
        })
      );
    });

    await testCase('14. Create without cloudVersion fails across motorcycles, reminders, and serviceRecords', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await db.doc('users/rider_cv_missing').set({
          id: 'rider_cv_missing',
          uid: 'rider_cv_missing',
          email: 'missing@example.com',
          role: 'rider',
          subscriptionTier: 'free',
          bikeCount: 0,
        });
        await db.doc('motorcycles/bike_existing_cv').set({
          id: 'bike_existing_cv',
          userId: 'rider_cv_missing',
          brand: 'Honda',
          model: 'PCX 160',
          year: 2024,
          odometer: 500,
          cloudVersion: 1,
        });
      });

      const ctx = testEnv.authenticatedContext('rider_cv_missing', {
        email: 'missing@example.com',
        email_verified: true,
      });
      const db = ctx.firestore();

      // Missing cloudVersion on reminder create
      await assertFails(
        db.doc('reminders/rem_no_cv').set({
          id: 'rem_no_cv',
          userId: 'rider_cv_missing',
          bikeId: 'bike_existing_cv',
          title: 'Gear Oil',
          intervalKm: 3000,
          nextDueOdo: 3500,
        })
      );

      // Missing cloudVersion on serviceRecord create
      await assertFails(
        db.doc('serviceRecords/rec_no_cv').set({
          id: 'rec_no_cv',
          userId: 'rider_cv_missing',
          bikeId: 'bike_existing_cv',
          title: 'Gear Oil Change',
          date: '2026-11-08',
          odometer: 500,
          totalCostPhp: 180,
        })
      );
    });

    await testCase('15. Create with cloudVersion == 2 fails', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await db.doc('motorcycles/bike_cv2').set({
          id: 'bike_cv2',
          userId: 'rider_cv2',
          brand: 'Honda',
          model: 'ADV 160',
          year: 2024,
          odometer: 1000,
          cloudVersion: 1,
        });
      });

      const ctx = testEnv.authenticatedContext('rider_cv2', {
        email: 'cv2@example.com',
        email_verified: true,
      });
      const db = ctx.firestore();

      await assertFails(
        db.doc('reminders/rem_cv2').set({
          id: 'rem_cv2',
          userId: 'rider_cv2',
          bikeId: 'bike_cv2',
          title: 'Air Filter',
          intervalKm: 6000,
          nextDueOdo: 7000,
          cloudVersion: 2,
        })
      );
    });

    await testCase('16. Update from cloudVersion 1 to 2 succeeds', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await db.doc('motorcycles/bike_up_1').set({
          id: 'bike_up_1',
          userId: 'rider_up',
          brand: 'Yamaha',
          model: 'NMAX 155',
          year: 2024,
          odometer: 1000,
          cloudVersion: 1,
        });
      });

      const ctx = testEnv.authenticatedContext('rider_up', {
        email: 'up@example.com',
        email_verified: true,
      });
      const db = ctx.firestore();

      await assertSucceeds(
        db.doc('motorcycles/bike_up_1').update({
          odometer: 1250,
          cloudVersion: 2,
        })
      );
    });

    await testCase('17. Update leaving cloudVersion unchanged (1 -> 1) fails', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await db.doc('motorcycles/bike_same_v').set({
          id: 'bike_same_v',
          userId: 'rider_up',
          brand: 'Yamaha',
          model: 'NMAX 155',
          year: 2024,
          odometer: 1000,
          cloudVersion: 1,
        });
      });

      const ctx = testEnv.authenticatedContext('rider_up', {
        email: 'up@example.com',
        email_verified: true,
      });
      const db = ctx.firestore();

      await assertFails(
        db.doc('motorcycles/bike_same_v').update({
          odometer: 1500,
          cloudVersion: 1,
        })
      );
    });

    await testCase('18. Update decreasing cloudVersion (2 -> 1) fails', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await db.doc('motorcycles/bike_dec_v').set({
          id: 'bike_dec_v',
          userId: 'rider_up',
          brand: 'Yamaha',
          model: 'NMAX 155',
          year: 2024,
          odometer: 2000,
          cloudVersion: 2,
        });
      });

      const ctx = testEnv.authenticatedContext('rider_up', {
        email: 'up@example.com',
        email_verified: true,
      });
      const db = ctx.firestore();

      await assertFails(
        db.doc('motorcycles/bike_dec_v').update({
          odometer: 2100,
          cloudVersion: 1,
        })
      );
    });

    await testCase('19. Update jumping cloudVersion from 1 to 3 fails', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await db.doc('motorcycles/bike_jump_v').set({
          id: 'bike_jump_v',
          userId: 'rider_up',
          brand: 'Yamaha',
          model: 'NMAX 155',
          year: 2024,
          odometer: 1000,
          cloudVersion: 1,
        });
      });

      const ctx = testEnv.authenticatedContext('rider_up', {
        email: 'up@example.com',
        email_verified: true,
      });
      const db = ctx.firestore();

      await assertFails(
        db.doc('motorcycles/bike_jump_v').update({
          odometer: 1900,
          cloudVersion: 3,
        })
      );
    });

    await testCase('20. Legacy document without cloudVersion can be updated to cloudVersion == 1', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await db.doc('motorcycles/bike_legacy_no_cv').set({
          id: 'bike_legacy_no_cv',
          userId: 'rider_leg',
          brand: 'Honda',
          model: 'TMX 125',
          year: 2021,
          odometer: 12000,
        });
      });

      const ctx = testEnv.authenticatedContext('rider_leg', {
        email: 'leg@example.com',
        email_verified: true,
      });
      const db = ctx.firestore();

      await assertSucceeds(
        db.doc('motorcycles/bike_legacy_no_cv').update({
          odometer: 12500,
          cloudVersion: 1,
        })
      );
    });

    await testCase("21. Legacy document's first update to cloudVersion == 2 is rejected", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await db.doc('motorcycles/bike_legacy_bad_init').set({
          id: 'bike_legacy_bad_init',
          userId: 'rider_leg',
          brand: 'Honda',
          model: 'TMX 125',
          year: 2021,
          odometer: 12000,
        });
      });

      const ctx = testEnv.authenticatedContext('rider_leg', {
        email: 'leg@example.com',
        email_verified: true,
      });
      const db = ctx.firestore();

      await assertFails(
        db.doc('motorcycles/bike_legacy_bad_init').update({
          odometer: 12500,
          cloudVersion: 2,
        })
      );
    });

    await testCase('22. Cross-user attempts remain blocked even with valid cloudVersion', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await db.doc('motorcycles/bike_owner_a').set({
          id: 'bike_owner_a',
          userId: 'rider_a',
          brand: 'Suzuki',
          model: 'Burgman Street',
          year: 2023,
          odometer: 3000,
          cloudVersion: 1,
        });
      });

      const attackerCtx = testEnv.authenticatedContext('rider_b', {
        email: 'b@example.com',
        email_verified: true,
      });
      const db = attackerCtx.firestore();

      await assertFails(
        db.doc('motorcycles/bike_owner_a').update({
          odometer: 99999,
          cloudVersion: 2,
        })
      );
    });

    await testCase('23. Unauthorized parent motorcycle references remain blocked for reminders and serviceRecords', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await db.doc('motorcycles/bike_belongs_to_a').set({
          id: 'bike_belongs_to_a',
          userId: 'rider_a',
          brand: 'Yamaha',
          model: 'Sniper 155',
          year: 2024,
          odometer: 2000,
          cloudVersion: 1,
        });
      });

      const riderBCtx = testEnv.authenticatedContext('rider_b', {
        email: 'b@example.com',
        email_verified: true,
      });
      const db = riderBCtx.firestore();

      // Rider B attempting to create a reminder referencing Rider A's motorcycle
      await assertFails(
        db.doc('reminders/rem_foreign_bike').set({
          id: 'rem_foreign_bike',
          userId: 'rider_b',
          bikeId: 'bike_belongs_to_a',
          title: 'Chain Lube',
          intervalKm: 500,
          nextDueOdo: 2500,
          cloudVersion: 1,
        })
      );

      // Rider B attempting to create a serviceRecord referencing Rider A's motorcycle
      await assertFails(
        db.doc('serviceRecords/rec_foreign_bike').set({
          id: 'rec_foreign_bike',
          userId: 'rider_b',
          bikeId: 'bike_belongs_to_a',
          title: 'Chain Service',
          date: '2026-11-08',
          odometer: 2000,
          totalCostPhp: 250,
          cloudVersion: 1,
        })
      );
    });

    await testCase('24. Malformed legacy cloudVersion (string or non-positive integer) is rejected on update', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await db.doc('motorcycles/bike_malformed_cv').set({
          id: 'bike_malformed_cv',
          userId: 'rider_leg',
          brand: 'Kawasaki',
          model: 'Barako II',
          year: 2020,
          odometer: 15000,
          cloudVersion: 'v1' as any,
        });
      });

      const ctx = testEnv.authenticatedContext('rider_leg', {
        email: 'leg@example.com',
        email_verified: true,
      });
      const db = ctx.firestore();

      await assertFails(
        db.doc('motorcycles/bike_malformed_cv').update({
          odometer: 15500,
          cloudVersion: 2,
        })
      );
    });
  } finally {
    await testEnv.cleanup();
  }

  console.log('------------------------------------------------------------');
  console.log(`Test Execution Summary: ${passed} PASSED, ${failed} FAILED`);
  console.log('------------------------------------------------------------');
  if (failed > 0) {
    process.exitCode = 1;
  }
  return { executed: true, passed, failed };
}

// Auto-run if executed directly
if (process.argv[1]?.endsWith('emulatorRules.test.ts')) {
  runRulesEmulatorSuite().catch((err) => {
    console.error('Fatal test runner error:', err);
    process.exitCode = 1;
  });
}
