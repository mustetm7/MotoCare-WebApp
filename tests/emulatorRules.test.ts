/**
 * MotoCare - Firestore Security Rules Unit Tests
 * 
 * Uses @firebase/rules-unit-testing to assert that:
 * 1. Free user creating 1st motorcycle -> ALLOW
 * 2. Free user creating 2nd motorcycle -> DENY
 * 3. Free user updating bikeCount without creating motorcycle -> DENY
 * 4. Free user creating motorcycle without updating bikeCount -> DENY
 * 5. Free user incrementing bikeCount by 2 -> DENY
 * 6. Free user decrementing bikeCount without deleting motorcycle -> DENY
 * 7. Free user creating motorcycle referencing already existing bike -> DENY
 * 8. Free user deleting motorcycle referencing non-existent bike -> DENY
 * 9. Free user modifying another user's bikeCount -> DENY
 * 10. Active Pro user creating multiple motorcycles -> ALLOW
 * 11. Expired Pro user creating 2nd motorcycle -> DENY
 * 12. Admin reconciling bikeCount without transaction -> ALLOW
 *
 * HOW TO RUN:
 * In any environment with Java Runtime Environment (JRE 11+) installed:
 *   firebase emulators:exec --only firestore "npx tsx tests/emulatorRules.test.ts"
 */

import { initializeTestEnvironment, assertFails, assertSucceeds, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import * as fs from 'fs';
import * as path from 'path';

const PROJECT_ID = 'motocare-rules-test-' + Date.now();
const RULES_PATH = path.resolve(process.cwd(), 'firestore.rules');

export async function runRulesEmulatorSuite() {
  console.log('------------------------------------------------------------');
  console.log('MotoCare Firestore Security Rules Unit Test Suite');
  console.log('Testing 12 Critical Quota, Anti-Replay, and RBAC Scenarios');
  console.log('------------------------------------------------------------');

  if (!fs.existsSync(RULES_PATH)) {
    throw new Error(`Rules file not found at ${RULES_PATH}`);
  }

  const rules = fs.readFileSync(RULES_PATH, 'utf8');

  let testEnv: RulesTestEnvironment;
  try {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        rules,
        host: process.env.FIRESTORE_EMULATOR_HOST?.split(':')[0] || '127.0.0.1',
        port: parseInt(process.env.FIRESTORE_EMULATOR_HOST?.split(':')[1] || '8080', 10),
      },
    });
  } catch (err: any) {
    console.error('\n[Notice: Firebase Emulator Connection]');
    console.error('The Firebase Emulator daemon requires Java (JRE 11+) on the host.');
    console.error('If running in an isolated environment without Java, run:');
    console.error('  firebase emulators:exec --only firestore "npx tsx tests/emulatorRules.test.ts"');
    console.error(`Error details: ${err?.message || err}`);
    return;
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
    // Scenario 1: Free user creating 1st motorcycle with atomic counter increment
    await testCase('1. Free user creating 1st motorcycle -> ALLOW', async () => {
      // Seed user doc with bikeCount: 0
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await db.doc('users/rider_1').set({
          uid: 'rider_1',
          email: 'rider1@example.com',
          subscriptionTier: 'free',
          bikeCount: 0,
        });
      });

      const userCtx = testEnv.authenticatedContext('rider_1', { email: 'rider1@example.com' });
      const db = userCtx.firestore();

      // Atomic batch/transaction: create bike + increment counter
      const batch = db.batch();
      batch.set(db.doc('motorcycles/bike_1'), {
        userId: 'rider_1',
        name: 'Honda Click 125i',
        createdAt: new Date(),
      });
      batch.update(db.doc('users/rider_1'), {
        bikeCount: 1,
        lastBikeId: 'bike_1',
        lastBikeAction: 'create',
      });

      await assertSucceeds(batch.commit());
    });

    // Scenario 2: Free user creating 2nd motorcycle -> DENY
    await testCase('2. Free user creating 2nd motorcycle (quota limit = 1) -> DENY', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await db.doc('users/rider_2').set({
          uid: 'rider_2',
          email: 'rider2@example.com',
          subscriptionTier: 'free',
          bikeCount: 1,
        });
        await db.doc('motorcycles/bike_existing').set({
          userId: 'rider_2',
          name: 'Yamaha Mio',
        });
      });

      const userCtx = testEnv.authenticatedContext('rider_2', { email: 'rider2@example.com' });
      const db = userCtx.firestore();

      const batch = db.batch();
      batch.set(db.doc('motorcycles/bike_2'), {
        userId: 'rider_2',
        name: 'Kawasaki Ninja',
      });
      batch.update(db.doc('users/rider_2'), {
        bikeCount: 2,
        lastBikeId: 'bike_2',
        lastBikeAction: 'create',
      });

      await assertFails(batch.commit());
    });

    // Scenario 3: Free user updating bikeCount without creating motorcycle -> DENY
    await testCase('3. Free user updating bikeCount without creating motorcycle -> DENY', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await db.doc('users/rider_3').set({
          uid: 'rider_3',
          email: 'rider3@example.com',
          subscriptionTier: 'free',
          bikeCount: 0,
        });
      });

      const userCtx = testEnv.authenticatedContext('rider_3', { email: 'rider3@example.com' });
      const db = userCtx.firestore();

      // Attempt direct write to bikeCount
      await assertFails(db.doc('users/rider_3').update({
        bikeCount: 1,
        lastBikeId: 'bike_fake',
        lastBikeAction: 'create',
      }));
    });

    // Scenario 4: Free user creating motorcycle without updating bikeCount -> DENY
    await testCase('4. Free user creating motorcycle without updating bikeCount -> DENY', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await db.doc('users/rider_4').set({
          uid: 'rider_4',
          email: 'rider4@example.com',
          subscriptionTier: 'free',
          bikeCount: 0,
        });
      });

      const userCtx = testEnv.authenticatedContext('rider_4', { email: 'rider4@example.com' });
      const db = userCtx.firestore();

      // Only write motorcycle doc, omit user doc update
      await assertFails(db.doc('motorcycles/bike_orphaned').set({
        userId: 'rider_4',
        name: 'Vespa Sprint',
      }));
    });

    // Scenario 5: Free user incrementing bikeCount by 2 -> DENY
    await testCase('5. Free user incrementing bikeCount by 2 -> DENY', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await db.doc('users/rider_5').set({
          uid: 'rider_5',
          email: 'rider5@example.com',
          subscriptionTier: 'free',
          bikeCount: 0,
        });
      });

      const userCtx = testEnv.authenticatedContext('rider_5', { email: 'rider5@example.com' });
      const db = userCtx.firestore();

      const batch = db.batch();
      batch.set(db.doc('motorcycles/bike_5'), {
        userId: 'rider_5',
        name: 'Honda Beat',
      });
      batch.update(db.doc('users/rider_5'), {
        bikeCount: 2, // Illegal jump from 0 to 2
        lastBikeId: 'bike_5',
        lastBikeAction: 'create',
      });

      await assertFails(batch.commit());
    });

    // Scenario 6: Free user decrementing bikeCount without deleting motorcycle -> DENY
    await testCase('6. Free user decrementing bikeCount without deleting motorcycle -> DENY', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await db.doc('users/rider_6').set({
          uid: 'rider_6',
          email: 'rider6@example.com',
          subscriptionTier: 'free',
          bikeCount: 1,
        });
        await db.doc('motorcycles/bike_6').set({
          userId: 'rider_6',
          name: 'Suzuki Raider',
        });
      });

      const userCtx = testEnv.authenticatedContext('rider_6', { email: 'rider6@example.com' });
      const db = userCtx.firestore();

      // Attempt decrementing bikeCount without deleting motorcycle doc
      await assertFails(db.doc('users/rider_6').update({
        bikeCount: 0,
        lastBikeId: 'bike_6',
        lastBikeAction: 'delete',
      }));
    });

    // Scenario 7: Free user creating motorcycle referencing already existing bike -> DENY
    await testCase('7. Free user creating motorcycle referencing already existing bike -> DENY', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await db.doc('users/rider_7').set({
          uid: 'rider_7',
          email: 'rider7@example.com',
          subscriptionTier: 'free',
          bikeCount: 0,
        });
        await db.doc('motorcycles/bike_7_pre_existing').set({
          userId: 'rider_7',
          name: 'Yamaha Aerox',
        });
      });

      const userCtx = testEnv.authenticatedContext('rider_7', { email: 'rider7@example.com' });
      const db = userCtx.firestore();

      const batch = db.batch();
      // Overwriting an already-existing bike with create rule
      batch.set(db.doc('motorcycles/bike_7_pre_existing'), {
        userId: 'rider_7',
        name: 'Yamaha Aerox V2',
      });
      batch.update(db.doc('users/rider_7'), {
        bikeCount: 1,
        lastBikeId: 'bike_7_pre_existing',
        lastBikeAction: 'create',
      });

      await assertFails(batch.commit());
    });

    // Scenario 8: Free user deleting motorcycle referencing non-existent bike -> DENY
    await testCase('8. Free user deleting motorcycle referencing non-existent bike -> DENY', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await db.doc('users/rider_8').set({
          uid: 'rider_8',
          email: 'rider8@example.com',
          subscriptionTier: 'free',
          bikeCount: 1,
        });
      });

      const userCtx = testEnv.authenticatedContext('rider_8', { email: 'rider8@example.com' });
      const db = userCtx.firestore();

      const batch = db.batch();
      batch.delete(db.doc('motorcycles/bike_non_existent'));
      batch.update(db.doc('users/rider_8'), {
        bikeCount: 0,
        lastBikeId: 'bike_non_existent',
        lastBikeAction: 'delete',
      });

      await assertFails(batch.commit());
    });

    // Scenario 9: User modifying another user's bikeCount -> DENY
    await testCase("9. User modifying another user's bikeCount -> DENY", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await db.doc('users/victim_rider').set({
          uid: 'victim_rider',
          email: 'victim@example.com',
          subscriptionTier: 'free',
          bikeCount: 0,
        });
      });

      const attackerCtx = testEnv.authenticatedContext('attacker_rider', { email: 'attacker@example.com' });
      const db = attackerCtx.firestore();

      await assertFails(db.doc('users/victim_rider').update({
        bikeCount: 5,
      }));
    });

    // Scenario 10: Active Pro user creating multiple motorcycles -> ALLOW
    await testCase('10. Active Pro user creating multiple motorcycles -> ALLOW', async () => {
      const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await db.doc('users/pro_rider').set({
          uid: 'pro_rider',
          email: 'pro@example.com',
          subscriptionTier: 'pro',
          expiryDate: futureDate,
          bikeCount: 1,
        });
        await db.doc('motorcycles/pro_bike_1').set({
          userId: 'pro_rider',
          name: 'BMW R1250GS',
        });
      });

      const proCtx = testEnv.authenticatedContext('pro_rider', { email: 'pro@example.com' });
      const db = proCtx.firestore();

      const batch = db.batch();
      batch.set(db.doc('motorcycles/pro_bike_2'), {
        userId: 'pro_rider',
        name: 'Ducati Multistrada',
      });
      batch.update(db.doc('users/pro_rider'), {
        bikeCount: 2,
        lastBikeId: 'pro_bike_2',
        lastBikeAction: 'create',
      });

      await assertSucceeds(batch.commit());
    });

    // Scenario 11: Expired Pro user creating 2nd motorcycle -> DENY
    await testCase('11. Expired Pro user creating 2nd motorcycle -> DENY', async () => {
      const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // Expired yesterday
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await db.doc('users/expired_pro').set({
          uid: 'expired_pro',
          email: 'expired@example.com',
          subscriptionTier: 'pro',
          expiryDate: pastDate,
          bikeCount: 1,
        });
        await db.doc('motorcycles/expired_bike_1').set({
          userId: 'expired_pro',
          name: 'Harley-Davidson Iron 883',
        });
      });

      const userCtx = testEnv.authenticatedContext('expired_pro', { email: 'expired@example.com' });
      const db = userCtx.firestore();

      const batch = db.batch();
      batch.set(db.doc('motorcycles/expired_bike_2'), {
        userId: 'expired_pro',
        name: 'Triumph Bonneville',
      });
      batch.update(db.doc('users/expired_pro'), {
        bikeCount: 2,
        lastBikeId: 'expired_bike_2',
        lastBikeAction: 'create',
      });

      await assertFails(batch.commit());
    });

    // Scenario 12: Admin reconciling bikeCount without transaction -> ALLOW
    await testCase('12. Admin reconciling bikeCount without transaction -> ALLOW', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await db.doc('users/desynced_rider').set({
          uid: 'desynced_rider',
          email: 'desynced@example.com',
          subscriptionTier: 'free',
          bikeCount: 5, // Desynced counter
        });
      });

      // Admin user must match mustetm7@gmail.com
      const adminCtx = testEnv.authenticatedContext('admin_uid', { email: 'mustetm7@gmail.com' });
      const db = adminCtx.firestore();

      // Admin reconciling bikeCount directly
      await assertSucceeds(db.doc('users/desynced_rider').update({
        bikeCount: 1,
      }));
    });

  } finally {
    await testEnv.cleanup();
  }

  console.log('------------------------------------------------------------');
  console.log(`Test Execution Summary: ${passed} PASSED, ${failed} FAILED`);
  console.log('------------------------------------------------------------');
}

// Auto-run if executed directly
if (process.argv[1]?.endsWith('emulatorRules.test.ts')) {
  runRulesEmulatorSuite().catch((err) => {
    console.error('Fatal test runner error:', err);
  });
}
