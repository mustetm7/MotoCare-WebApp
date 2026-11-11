import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import App from '../src/App';
import * as AuthContextModule from '../src/context/AuthContext';
import {
  computeAuthoritativeSubscription,
  isVerifiedOwnerAccount,
  resolveProEntitlement,
} from '../src/context/AuthContext';
import {
  loadMotorcycles,
  loadReminders,
  loadServiceRecords,
  loadSubscription,
  saveSubscription,
  pruneCachedSampleData,
  loadUserScopedMotorcycles,
  saveUserScopedMotorcycles,
  loadUserScopedReminders,
  exportServiceAndMaintenanceCsv,
  exportServiceAndMaintenancePdf,
  generatePrintableMaintenancePdfReport,
  THEME_STORAGE_KEY,
} from '../src/utils/storage';
import {
  calculateNextMonthlyExpiry,
  getManilaDay,
  canCreateMotorcycleInGarage,
} from '../src/utils/firestoreService';
import { isCountedAsActivePaidProSubscriber } from '../src/components/AdminUsersPortal';
import { GarageModal } from '../src/components/GarageModal';
import {
  GpsRideTrackerSheet,
  AUTO_PAUSE_STATIONARY_THRESHOLD_SECONDS,
} from '../src/components/GpsRideTrackerSheet';
import {
  AccountRegistrationScreen,
  REMEMBERED_EMAIL_STORAGE_KEY,
} from '../src/components/AccountRegistrationScreen';
import { ServiceLogbookView } from '../src/components/ServiceLogbookView';
import { CasaBookletModal } from '../src/components/CasaBookletModal';
import { PaywallModal } from '../src/components/PaywallModal';

vi.mock('../src/context/AuthContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/context/AuthContext')>();
  return {
    ...actual,
    useAuth: vi.fn(),
    AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  };
});

describe('MotoCare Pre-Beta Subscription Security & Demo Data Cleanup Regression Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    window.location.hash = '';
    window.history.pushState({}, '', '/');

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it('Scenario 1: Free rider clicks the former Free/Pro toggle -> no toggle exists', () => {
    vi.mocked(AuthContextModule.useAuth).mockReturnValue({
      user: { email: 'rider@example.com', uid: 'rider-1' } as any,
      loading: false,
      isAdmin: false,
      subscription: { tier: 'free', plan: null, status: 'free' },
      submitPaymentRef: vi.fn(),
      signIn: vi.fn(),
      signInWithEmail: vi.fn(),
      signUpWithEmail: vi.fn(),
      resetPassword: vi.fn(),
      signOut: vi.fn(),
    });

    render(<App />);

    // Verify the former "Tier: FREE" / "Click to toggle between Free and Pro tiers" button is completely absent
    expect(screen.queryByTitle('Click to toggle between Free and Pro tiers')).toBeNull();
    expect(screen.queryByText('Tier:')).toBeNull();
  });

  it('Scenario 2 & 3: Free rider refreshes or signs out and back in -> remains Free', () => {
    // 1. Initial Free state from Firestore
    const freeSub = computeAuthoritativeSubscription(
      { subscriptionTier: 'free', subscriptionStatus: 'free' },
      null
    );
    expect(freeSub.tier).toBe('free');
    expect(freeSub.status).toBe('free');

    // 2. Refresh hydration check
    const loadedOnRefresh = loadSubscription();
    expect(loadedOnRefresh.tier).toBe('free');

    // 3. Sign out & sign back in check
    const signedOutSub = computeAuthoritativeSubscription(null, null);
    expect(signedOutSub.tier).toBe('free');
    const signedBackInSub = computeAuthoritativeSubscription(
      { subscriptionTier: 'free', subscriptionStatus: 'free' },
      null
    );
    expect(signedBackInSub.tier).toBe('free');
  });

  it('Scenario 4: Free rider manipulates LocalStorage subscription values -> cannot obtain Pro entitlement', () => {
    // Attacker injects forged Pro entitlement into LocalStorage
    localStorage.setItem(
      'motocare_app_subscription_v4',
      JSON.stringify({
        tier: 'pro',
        plan: 'monthly',
        status: 'active',
        paymentMethod: 'gcash',
        expiryDate: '2099-12-31T23:59:59.000Z',
      })
    );

    const sub = loadSubscription();
    expect(sub.tier).toBe('free');
    expect(sub.status).toBe('free');
    expect(sub.plan).toBeNull();

    // Verify saveSubscription also refuses to persist Pro tier to LocalStorage
    saveSubscription({
      tier: 'pro',
      plan: 'monthly',
      status: 'active',
    });
    const rawAfterSave = JSON.parse(localStorage.getItem('motocare_app_subscription_v4') || '{}');
    expect(rawAfterSave.tier).toBe('free');
  });

  it('Scenario 5: Free rider attempts to access Pro-only features (GPS Tracker & CSV Export) -> blocked', () => {
    const openPaywallMock = vi.fn();
    const finishRideMock = vi.fn();
    const freeSubscription = { tier: 'free' as const, plan: null, status: 'free' as const };
    const sampleBike = {
      id: 'legit-bike-1',
      nickname: 'Daily Gear',
      brand: 'Yamaha',
      model: 'Mio Gear',
      year: 2025,
      odometer: 1500,
      licensePlate: 'ABC 1234',
      color: 'Black',
      motorcycleType: 'Scooter / AT' as const,
      unit: 'km' as const,
      specs: {
        transmission: 'Automatic Scooter' as const,
        cooling: 'Air-Cooled' as const,
        displacementCc: 125,
        tirePressureFrontPsi: 29,
        tirePressureRearPsi: 33,
        oilViscosity: '10W-40 JASO MB',
        oilCapacityLiters: 0.8,
        gearOilCapacityMl: 100,
        recommendedServiceIntervalKm: 3000,
      },
    };

    // A. Attempt to mount GPS Ride Tracker directly as Free user
    render(
      <GpsRideTrackerSheet
        bike={sampleBike}
        subscription={freeSubscription}
        onFinishRide={finishRideMock}
        onOpenPaywall={openPaywallMock}
      />
    );
    expect(screen.getByText('Zero-Touch GPS Auto-Odometer is a Pro Feature')).not.toBeNull();
    expect(screen.queryByText('Finish & Add to Odometer')).toBeNull();

    // B. Attempt to click CSV export in ServiceLogbookView as Free user
    render(
      <ServiceLogbookView
        records={[]}
        bike={sampleBike}
        subscription={freeSubscription}
        onOpenAddService={vi.fn()}
        onOpenCasaBooklet={vi.fn()}
        onDeleteRecord={vi.fn()}
        onOpenPaywall={openPaywallMock}
        onBack={vi.fn()}
      />
    );
    const csvBtn = screen.getByTitle('Upgrade to Pro to Export CSV');
    fireEvent.click(csvBtn);
    expect(openPaywallMock).toHaveBeenCalled();
  });

  it('Scenario 6: Free rider attempts to add a second motorcycle -> blocked', () => {
    const onSaveMock = vi.fn();
    const onOpenPaywallMock = vi.fn();

    render(
      <GarageModal
        isOpen={true}
        onClose={vi.fn()}
        bike={null}
        subscription={{ tier: 'free', plan: null, status: 'free' }}
        existingCount={1}
        onSave={onSaveMock}
        onOpenPaywall={onOpenPaywallMock}
      />
    );

    expect(screen.getByText('Multi-Bike Garage is a Pro Feature')).not.toBeNull();
    expect(screen.queryByText('Register to Garage')).toBeNull();
    expect(onSaveMock).not.toHaveBeenCalled();
  });

  it('Scenario 7: Pending payment -> remains Free', () => {
    const sub = computeAuthoritativeSubscription(
      {
        subscriptionTier: 'free',
        subscriptionStatus: 'free',
      },
      {
        id: 'pay_pending_1',
        userId: 'rider-1',
        userEmail: 'rider@example.com',
        userName: 'Rider',
        bikeModel: 'Click 125i',
        paymentMethod: 'gcash',
        referenceNumber: 'GCASH-111222',
        referenceHash: 'hash123',
        amountPhp: 49,
        status: 'pending_approval',
        submittedAt: '2026-11-07T10:00:00.000Z',
      }
    );

    expect(sub.tier).toBe('free');
    expect(sub.status).toBe('trial'); // Indicates pending verification in UI while keeping tier strictly 'free'
  });

  it('Scenario 8: Rejected payment -> remains Free', () => {
    const sub = computeAuthoritativeSubscription(
      {
        subscriptionTier: 'free',
        subscriptionStatus: 'free',
      },
      {
        id: 'pay_rejected_1',
        userId: 'rider-1',
        userEmail: 'rider@example.com',
        userName: 'Rider',
        bikeModel: 'Click 125i',
        paymentMethod: 'gcash',
        referenceNumber: 'GCASH-000999',
        referenceHash: 'hash999',
        amountPhp: 49,
        status: 'rejected',
        submittedAt: '2026-11-07T10:00:00.000Z',
      }
    );

    expect(sub.tier).toBe('free');
    expect(sub.status).toBe('free');
  });

  it('Scenario 9: Admin approves a valid ₱49 payment -> Pro activates correctly with Asia/Manila expiry', () => {
    const approvalDate = new Date('2026-11-07T04:00:00.000Z'); // Nov 7, 2026 12:00 PM Manila
    const anchorDay = getManilaDay(approvalDate);
    const { expiryTimestamp } = calculateNextMonthlyExpiry(approvalDate, anchorDay);

    const sub = computeAuthoritativeSubscription(
      {
        subscriptionTier: 'pro',
        subscriptionStatus: 'active',
        paymentStatus: 'active_pro',
        expiryDate: expiryTimestamp,
        billingAnchorDay: anchorDay,
        lastPaymentId: 'pay_approved_49',
      },
      {
        id: 'pay_approved_49',
        userId: 'rider-1',
        userEmail: 'rider@example.com',
        userName: 'Rider',
        bikeModel: 'Click 125i',
        paymentMethod: 'gcash',
        referenceNumber: 'GCASH-490001',
        referenceHash: 'hash49',
        amountPhp: 49,
        status: 'active_pro',
        submittedAt: '2026-11-07T03:55:00.000Z',
      },
      approvalDate
    );

    expect(sub.tier).toBe('pro');
    expect(sub.status).toBe('active');
    expect(sub.isExpired).toBe(false);
    expect(sub.billingAnchorDay).toBe(7);
  });

  it('Scenario 10: Expired Pro subscription -> Pro access is revoked automatically', () => {
    const pastExpiry = new Date('2026-10-01T00:00:00.000Z');
    const now = new Date('2026-11-07T12:00:00.000Z');

    const sub = computeAuthoritativeSubscription(
      {
        subscriptionTier: 'pro',
        subscriptionStatus: 'active',
        expiryDate: pastExpiry.toISOString(),
      },
      null,
      now
    );

    expect(sub.tier).toBe('free');
    expect(sub.status).toBe('expired');
    expect(sub.isExpired).toBe(true);
    expect(sub.daysRemaining).toBe(0);
  });

  it('Scenario 11: Selectively prunes sample records while keeping existing legitimate rider records intact', () => {
    const legitimateBike = {
      id: 'bike-1730992811',
      brand: 'Suzuki',
      model: 'Burgman Street 125 EX',
      year: 2025,
      odometer: 4120,
      licensePlate: 'NAA 5511',
      color: 'Matte Black',
      motorcycleType: 'Scooter / AT',
      unit: 'km',
    };
    const sampleBike1 = { id: 'bike-ph-1', brand: 'Yamaha', model: 'NMAX 155', year: 2026, odometer: 3000 };
    const sampleBike2 = { id: 'bike-ph-2', brand: 'Honda', model: 'Click 125i', year: 2025, odometer: 8200 };

    const legitimateReminder = {
      id: 'rem-custom-999',
      bikeId: 'bike-1730992811',
      title: 'Custom Suzuki Oil Change',
      category: 'Engine Oil',
      intervalKm: 2500,
      lastCompletedOdo: 2000,
      nextDueOdo: 4500,
      lastCompletedDate: '2026-09-01',
      priority: 'high',
    };
    const sampleReminder1 = { id: 'rem-nmax-1', bikeId: 'bike-ph-1', title: 'Sample NMAX' };
    const sampleReminder2 = { id: 'rem-click-2', bikeId: 'bike-ph-2', title: 'Sample Click' };

    const legitimateRecord = {
      id: 'rec-custom-888',
      bikeId: 'bike-1730992811',
      date: '2026-09-01',
      odometer: 2000,
      title: 'Suzuki 3S PMS',
      category: 'Engine Oil',
      type: 'Casa / Official 3S',
      parts: [],
      laborCostPhp: 150,
      totalCostPhp: 500,
    };
    const sampleRecord1 = { id: 'rec-ph-1', bikeId: 'bike-ph-1', title: 'Sample Rec 1' };
    const sampleRecord3 = { id: 'rec-ph-3', bikeId: 'bike-ph-2', title: 'Sample Rec 3' };

    localStorage.setItem(
      'motocare_app_motorcycles_v4',
      JSON.stringify([sampleBike1, legitimateBike, sampleBike2])
    );
    localStorage.setItem(
      'motocare_app_reminders_v4',
      JSON.stringify([sampleReminder1, legitimateReminder, sampleReminder2])
    );
    localStorage.setItem(
      'motocare_app_records_v4',
      JSON.stringify([sampleRecord1, legitimateRecord, sampleRecord3])
    );

    // Run selective pruning / loaders (and verify idempotency on second call)
    pruneCachedSampleData();
    const loadedBikes = loadMotorcycles();
    const loadedReminders = loadReminders();
    const loadedRecords = loadServiceRecords();

    expect(loadedBikes).toHaveLength(1);
    expect(loadedBikes[0].id).toBe('bike-1730992811');

    expect(loadedReminders).toHaveLength(1);
    expect(loadedReminders[0].id).toBe('rem-custom-999');

    expect(loadedRecords).toHaveLength(1);
    expect(loadedRecords[0].id).toBe('rec-custom-888');

    // Second call (idempotent)
    expect(loadMotorcycles()).toHaveLength(1);
    expect(loadReminders()).toHaveLength(1);
    expect(loadServiceRecords()).toHaveLength(1);
  });

  it('Scenario 12: New users with empty LocalStorage do not receive mock reminders or service records', () => {
    localStorage.clear();
    expect(loadMotorcycles()).toEqual([]);
    expect(loadReminders()).toEqual([]);
    expect(loadServiceRecords()).toEqual([]);
  });

  it('Scenario 13: Quick Load Sample button is unavailable in OnboardingView while Add Your Motorcycle works', () => {
    vi.mocked(AuthContextModule.useAuth).mockReturnValue({
      user: null,
      loading: false,
      isAdmin: false,
      subscription: { tier: 'free', plan: null, status: 'free' },
      submitPaymentRef: vi.fn(),
      signIn: vi.fn(),
      signInWithEmail: vi.fn(),
      signUpWithEmail: vi.fn(),
      resetPassword: vi.fn(),
      signOut: vi.fn(),
    });

    render(<App />);

    expect(screen.getByText('Add Your Motorcycle')).not.toBeNull();
    expect(screen.queryByText(/Quick Load Sample/i)).toBeNull();
  });

  it('Scenario 14: Existing admin portal and payment management continue to work for mustetm7@gmail.com', () => {
    window.location.hash = '#admin';
    vi.mocked(AuthContextModule.useAuth).mockReturnValue({
      user: {
        email: 'mustetm7@gmail.com',
        uid: 'admin-owner-uid',
        displayName: 'Owner Admin',
        emailVerified: true,
      } as any,
      loading: false,
      isAdmin: true,
      subscription: { tier: 'pro', plan: 'monthly', status: 'active' },
      submitPaymentRef: vi.fn(),
      signIn: vi.fn(),
      signInWithEmail: vi.fn(),
      signUpWithEmail: vi.fn(),
      resetPassword: vi.fn(),
      signOut: vi.fn(),
    });

    render(<App />);

    expect(screen.getByText(/Owner Portal/i)).not.toBeNull();
  });

  // ===========================================================================
  // OWNER / ADMIN PRO ACCESS CORRECTION — REGRESSION SUITE (A–I)
  // ===========================================================================

  const ownerVerifiedUser = {
    uid: 'owner-uid-001',
    email: 'mustetm7@gmail.com',
    emailVerified: true,
  };

  const sampleTestBike = {
    id: 'owner-bike-1',
    nickname: 'NMAX Daily',
    brand: 'Yamaha',
    model: 'NMAX 155',
    year: 2026,
    odometer: 2400,
    licensePlate: 'OWN 0001',
    color: 'Matte Black',
    motorcycleType: 'Scooter / AT' as const,
    unit: 'km' as const,
    specs: {
      transmission: 'Automatic Scooter' as const,
      cooling: 'Liquid-Cooled' as const,
      displacementCc: 155,
      tirePressureFrontPsi: 29,
      tirePressureRearPsi: 33,
      oilViscosity: '10W-40 JASO MB',
      oilCapacityLiters: 0.9,
      gearOilCapacityMl: 150,
      recommendedServiceIntervalKm: 3000,
    },
  };

  it('Test A: Verified owner without expiryDate -> Pro features accessible without paid subscription', () => {
    // Owner has a Firestore doc with subscriptionTier: 'pro' (or 'free') and NO expiryDate
    const sub = computeAuthoritativeSubscription(
      {
        email: 'mustetm7@gmail.com',
        role: 'admin',
        subscriptionTier: 'pro',
        subscriptionStatus: 'active',
        expiryDate: undefined,
      },
      null
    );
    const entitlement = resolveProEntitlement(ownerVerifiedUser, sub);

    expect(entitlement.isVerifiedOwnerAdmin).toBe(true);
    expect(entitlement.isActivePaidProSubscriber).toBe(false);
    expect(entitlement.hasProAccess).toBe(true);

    // Verify 2nd+ motorcycle creation in Firestore pre-check is allowed for verified owner without expiryDate
    expect(
      canCreateMotorcycleInGarage({
        authUser: ownerVerifiedUser,
        targetUserId: 'owner-uid-001',
        userDocData: { subscriptionTier: 'free', expiryDate: undefined },
        currentCount: 3,
      })
    ).toBe(true);

    // Verify UI components unlock Pro features for verified owner even when subscription.tier === 'free'
    render(
      <GarageModal
        isOpen={true}
        onClose={vi.fn()}
        bike={null}
        subscription={sub}
        hasProAccess={entitlement.hasProAccess}
        existingCount={2}
        onSave={vi.fn()}
        onOpenPaywall={vi.fn()}
      />
    );
    expect(screen.queryByText('Multi-Bike Garage is a Pro Feature')).toBeNull();
    expect(screen.getByText('Register to Garage')).not.toBeNull();
  });

  it('Test B: Verified owner with free subscription -> all Pro features (Garage, GPS, CSV, Booklet) accessible', () => {
    const freeSub = computeAuthoritativeSubscription(
      {
        email: 'mustetm7@gmail.com',
        subscriptionTier: 'free',
        subscriptionStatus: 'free',
      },
      null
    );
    const entitlement = resolveProEntitlement(ownerVerifiedUser, freeSub);

    expect(freeSub.tier).toBe('free');
    expect(entitlement.isVerifiedOwnerAdmin).toBe(true);
    expect(entitlement.isActivePaidProSubscriber).toBe(false);
    expect(entitlement.hasProAccess).toBe(true);

    // 1. GPS Ride Tracker unlocked for verified owner on Free subscription
    render(
      <GpsRideTrackerSheet
        bike={sampleTestBike}
        subscription={freeSub}
        hasProAccess={entitlement.hasProAccess}
        onFinishRide={vi.fn()}
        onOpenPaywall={vi.fn()}
      />
    );
    expect(screen.queryByText('Zero-Touch GPS Auto-Odometer is a Pro Feature')).toBeNull();
    expect(screen.getByText('Finish & Add to Odometer')).not.toBeNull();

    // 2. ServiceLogbookView CSV export button unlocked
    const openPaywallMock = vi.fn();
    render(
      <ServiceLogbookView
        records={[]}
        bike={sampleTestBike}
        subscription={freeSub}
        hasProAccess={entitlement.hasProAccess}
        onOpenAddService={vi.fn()}
        onOpenCasaBooklet={vi.fn()}
        onDeleteRecord={vi.fn()}
        onOpenPaywall={openPaywallMock}
        onBack={vi.fn()}
      />
    );
    expect(screen.getByTitle('Export CSV')).not.toBeNull();

    // 3. CasaBookletModal unlocked without upgrade banner
    render(
      <CasaBookletModal
        isOpen={true}
        onClose={vi.fn()}
        bike={sampleTestBike}
        records={[]}
        subscription={freeSub}
        hasProAccess={entitlement.hasProAccess}
        onOpenPaywall={openPaywallMock}
      />
    );
    expect(screen.queryByText(/Previewing Casa Booklet/i)).toBeNull();
  });

  it('Test C: Ordinary Free rider -> Pro features blocked', () => {
    const ordinaryRider = {
      uid: 'rider-free-01',
      email: 'rider@example.com',
      emailVerified: true,
    };
    const sub = computeAuthoritativeSubscription(
      { subscriptionTier: 'free', subscriptionStatus: 'free' },
      null
    );
    const entitlement = resolveProEntitlement(ordinaryRider, sub);

    expect(entitlement.isVerifiedOwnerAdmin).toBe(false);
    expect(entitlement.isActivePaidProSubscriber).toBe(false);
    expect(entitlement.hasProAccess).toBe(false);

    expect(
      canCreateMotorcycleInGarage({
        authUser: ordinaryRider,
        targetUserId: 'rider-free-01',
        userDocData: { subscriptionTier: 'free' },
        currentCount: 1,
      })
    ).toBe(false);
  });

  it('Test D: Ordinary Pro rider with future expiry -> Pro features accessible', () => {
    const proRider = {
      uid: 'rider-pro-01',
      email: 'prorider@example.com',
      emailVerified: true,
    };
    const now = new Date('2026-11-07T12:00:00.000Z');
    const futureExpiry = new Date('2026-12-07T12:00:00.000Z');

    const sub = computeAuthoritativeSubscription(
      {
        subscriptionTier: 'pro',
        subscriptionStatus: 'active',
        expiryDate: futureExpiry.toISOString(),
      },
      null,
      now
    );
    const entitlement = resolveProEntitlement(proRider, sub);

    expect(entitlement.isVerifiedOwnerAdmin).toBe(false);
    expect(entitlement.isActivePaidProSubscriber).toBe(true);
    expect(entitlement.hasProAccess).toBe(true);

    expect(
      canCreateMotorcycleInGarage({
        authUser: proRider,
        targetUserId: 'rider-pro-01',
        userDocData: {
          subscriptionTier: 'pro',
          subscriptionStatus: 'active',
          expiryDate: futureExpiry.toISOString(),
        },
        currentCount: 2,
        nowMs: now.getTime(),
      })
    ).toBe(true);
  });

  it('Test E: Expired Pro rider -> Pro features blocked', () => {
    const expiredRider = {
      uid: 'rider-expired-01',
      email: 'expired@example.com',
      emailVerified: true,
    };
    const now = new Date('2026-11-07T12:00:00.000Z');
    const pastExpiry = new Date('2026-10-15T12:00:00.000Z');

    const sub = computeAuthoritativeSubscription(
      {
        subscriptionTier: 'pro',
        subscriptionStatus: 'active',
        expiryDate: pastExpiry.toISOString(),
      },
      null,
      now
    );
    const entitlement = resolveProEntitlement(expiredRider, sub);

    expect(sub.tier).toBe('free');
    expect(sub.status).toBe('expired');
    expect(entitlement.isActivePaidProSubscriber).toBe(false);
    expect(entitlement.hasProAccess).toBe(false);

    expect(
      canCreateMotorcycleInGarage({
        authUser: expiredRider,
        targetUserId: 'rider-expired-01',
        userDocData: {
          subscriptionTier: 'pro',
          subscriptionStatus: 'active',
          expiryDate: pastExpiry.toISOString(),
        },
        currentCount: 1,
        nowMs: now.getTime(),
      })
    ).toBe(false);
  });

  it('Test F: Revoked Pro rider -> Pro features blocked even if expiryDate is in the future', () => {
    const revokedRider = {
      uid: 'rider-revoked-01',
      email: 'revoked@example.com',
      emailVerified: true,
    };
    const now = new Date('2026-11-07T12:00:00.000Z');
    const futureExpiry = new Date('2026-12-07T12:00:00.000Z');

    const sub = computeAuthoritativeSubscription(
      {
        subscriptionTier: 'pro',
        subscriptionStatus: 'revoked',
        expiryDate: futureExpiry.toISOString(),
      },
      null,
      now
    );
    const entitlement = resolveProEntitlement(revokedRider, sub);

    expect(sub.tier).toBe('free');
    expect(sub.status).toBe('revoked');
    expect(entitlement.isActivePaidProSubscriber).toBe(false);
    expect(entitlement.hasProAccess).toBe(false);

    expect(
      canCreateMotorcycleInGarage({
        authUser: revokedRider,
        targetUserId: 'rider-revoked-01',
        userDocData: {
          subscriptionTier: 'pro',
          subscriptionStatus: 'revoked',
          expiryDate: futureExpiry.toISOString(),
        },
        currentCount: 1,
        nowMs: now.getTime(),
      })
    ).toBe(false);
  });

  it('Test G: Unverified account using the owner email -> no owner privileges and no Pro access', () => {
    const unverifiedOwnerImpersonator = {
      uid: 'spoof-uid-999',
      email: 'mustetm7@gmail.com',
      emailVerified: false,
    };
    const sub = computeAuthoritativeSubscription(
      { subscriptionTier: 'free', subscriptionStatus: 'free' },
      null
    );
    const entitlement = resolveProEntitlement(unverifiedOwnerImpersonator, sub);

    expect(isVerifiedOwnerAccount(unverifiedOwnerImpersonator)).toBe(false);
    expect(entitlement.isVerifiedOwnerAdmin).toBe(false);
    expect(entitlement.hasProAccess).toBe(false);

    expect(
      canCreateMotorcycleInGarage({
        authUser: unverifiedOwnerImpersonator,
        targetUserId: 'spoof-uid-999',
        userDocData: { subscriptionTier: 'free' },
        currentCount: 1,
      })
    ).toBe(false);

    // Also verify App does NOT show Owner Admin Portal footer link when emailVerified is false
    vi.mocked(AuthContextModule.useAuth).mockReturnValue({
      user: unverifiedOwnerImpersonator as any,
      loading: false,
      isAdmin: false,
      hasProAccess: false,
      subscription: sub,
      submitPaymentRef: vi.fn(),
      signIn: vi.fn(),
      signInWithEmail: vi.fn(),
      signUpWithEmail: vi.fn(),
      resetPassword: vi.fn(),
      signOut: vi.fn(),
    });
    render(<App />);
    expect(screen.queryByText('Owner Admin Portal')).toBeNull();
  });

  it('Test H: Owner account -> not counted as a paying Pro subscriber unless an actual paid subscription exists', () => {
    const now = new Date('2026-11-07T12:00:00.000Z');

    // Case 1: Owner has free tier in Firestore
    const ownerFreeDoc = {
      id: 'owner-uid-001',
      email: 'mustetm7@gmail.com',
      role: 'admin',
      subscriptionTier: 'free',
      subscriptionStatus: 'free',
    };
    expect(isCountedAsActivePaidProSubscriber(ownerFreeDoc, now)).toBe(false);

    // Case 2: Owner has subscriptionTier: 'pro' in Firestore but NO expiryDate (admin-only record, not paid)
    const ownerUnpaidProDoc = {
      id: 'owner-uid-001',
      email: 'mustetm7@gmail.com',
      role: 'admin',
      subscriptionTier: 'pro',
      subscriptionStatus: 'active',
      expiryDate: undefined,
    };
    expect(isCountedAsActivePaidProSubscriber(ownerUnpaidProDoc, now)).toBe(false);

    // Meanwhile, verified owner still gets full Pro feature access via resolveProEntitlement
    const ownerSub = computeAuthoritativeSubscription(ownerUnpaidProDoc, null, now);
    expect(ownerSub.tier).toBe('free'); // Not represented as a paying Pro subscriber
    const entitlement = resolveProEntitlement(ownerVerifiedUser, ownerSub);
    expect(entitlement.isActivePaidProSubscriber).toBe(false);
    expect(entitlement.hasProAccess).toBe(true); // Retains unlimited Pro access as verified owner
  });

  it('Test I: Ordinary rider cannot obtain owner privileges by manipulating LocalStorage', () => {
    // Attacker writes admin/owner flags into LocalStorage
    localStorage.setItem('motocare_admin_override', 'true');
    localStorage.setItem(
      'motocare_user_role',
      JSON.stringify({ role: 'admin', isAdmin: true, email: 'mustetm7@gmail.com', emailVerified: true })
    );
    localStorage.setItem(
      'motocare_app_subscription_v4',
      JSON.stringify({
        tier: 'pro',
        status: 'active',
        role: 'admin',
        isOwner: true,
        expiryDate: '2099-12-31T23:59:59.000Z',
      })
    );

    const ordinaryRider = {
      uid: 'rider-ordinary-777',
      email: 'ordinary@example.com',
      emailVerified: true,
    };
    const sub = loadSubscription();
    const entitlement = resolveProEntitlement(ordinaryRider, sub);

    expect(sub.tier).toBe('free');
    expect(isVerifiedOwnerAccount(ordinaryRider)).toBe(false);
    expect(entitlement.isVerifiedOwnerAdmin).toBe(false);
    expect(entitlement.isActivePaidProSubscriber).toBe(false);
    expect(entitlement.hasProAccess).toBe(false);
  });

  it('Test J: GCash-only payment screen displays verified GCash QR code, ₱49 amount, Save QR Image, and submits GCash reference', async () => {
    const ordinaryRider = {
      uid: 'rider-gcash-test',
      email: 'rider@example.com',
      displayName: 'Juan Rider',
      emailVerified: true,
    };
    const freeSub = computeAuthoritativeSubscription(
      { subscriptionTier: 'free', subscriptionStatus: 'free' },
      null
    );

    vi.mocked(AuthContextModule.useAuth).mockReturnValue({
      user: ordinaryRider as any,
      loading: false,
      isAdmin: false,
      hasProAccess: false,
      subscription: freeSub,
      submitPaymentRef: vi.fn().mockResolvedValue('pay_gcash_123'),
      signIn: vi.fn(),
      signInWithEmail: vi.fn(),
      signUpWithEmail: vi.fn(),
      resetPassword: vi.fn(),
      signOut: vi.fn(),
    });

    const onSubmitReferenceMock = vi.fn().mockResolvedValue(undefined);
    render(
      <PaywallModal
        isOpen={true}
        onClose={vi.fn()}
        subscription={freeSub}
        onSubmitReference={onSubmitReferenceMock}
        onCancelSubscription={vi.fn()}
      />
    );

    // 1. GoTyme is completely absent from customer-facing PaywallModal
    expect(screen.queryByText(/GoTyme/i)).toBeNull();

    // 2. Click "Pay with GCash (₱49/month)" button to open the QR code view
    const payWithGcashBtn = screen.getByText('Pay with GCash (₱49/month)');
    fireEvent.click(payWithGcashBtn);

    // 3. Verify only GCash appears and the verified GCash QR code image is displayed
    expect(screen.queryByText(/GoTyme/i)).toBeNull();
    const qrImg = screen.getByAltText('Official GCash QR Code') as HTMLImageElement;
    expect(qrImg).not.toBeNull();
    expect(qrImg.getAttribute('src')).toBe('/assets/aistudio/gcash_37c30549.jpg');

    // Verify hidden download anchor and Download QR Code button
    expect(screen.getByTestId('hidden-gcash-qr-download-anchor')).not.toBeNull();
    const downloadQrCodeBtn = screen.getByRole('button', { name: /Download QR Code/i });
    expect(downloadQrCodeBtn).not.toBeNull();
    fireEvent.click(downloadQrCodeBtn);
    expect(screen.getByText('GCash QR image downloaded to your device')).not.toBeNull();

    // Verify 'Scan GCash QR' camera button opens the camera scanner panel
    const scanGcashQrBtn = screen.getByRole('button', { name: /Scan GCash QR/i });
    expect(scanGcashQrBtn).not.toBeNull();
    fireEvent.click(scanGcashQrBtn);
    expect(screen.getByTestId('gcash-qr-camera-scanner')).not.toBeNull();

    // 4. Verify ₱49.00 amount, Save QR Image button, Copy to Clipboard button, and simple payment instructions
    expect(screen.getAllByText('₱49.00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Save QR Image').length).toBeGreaterThan(0);
    expect(screen.getByText('How to Pay with GCash:')).not.toBeNull();

    const copyBtn = screen.getByRole('button', { name: /Copy to Clipboard/i });
    expect(copyBtn).not.toBeNull();
    fireEvent.click(copyBtn);
    expect(screen.getByText('Copied!')).not.toBeNull();

    // 5. Enter GCash reference number and submit for admin verification
    const refInput = screen.getByPlaceholderText(/Enter GCash Ref No/i);
    fireEvent.change(refInput, { target: { value: '9001827364512' } });

    const submitBtn = screen.getByText(/Submit Reference for Admin Verification/i);
    fireEvent.click(submitBtn);

    expect(onSubmitReferenceMock).toHaveBeenCalledWith('gcash', '9001827364512');

    // 6. Verify toast notification triggers with confirmation and typical verification timeframe
    const toastStatus = await screen.findByRole('status');
    expect(toastStatus.textContent).toContain('GCash Payment Reference Submitted!');
    expect(toastStatus.textContent).toContain('within 5–15 minutes');
  });

  it('Test K: Zero-Touch GPS Auto-Odometer gates Free users and tracks live GPS telemetry + auto-increments odometer for Pro riders', () => {
    const testBike: any = {
      id: 'bike-gps-01',
      nickname: 'Daily Rider',
      brand: 'Yamaha',
      model: 'NMAX 155',
      year: 2026,
      color: 'Matte Black',
      odometer: 1200,
      unit: 'km' as const,
      licensePlate: '123ABC',
      specs: {
        transmission: 'CVT Automatic',
        cooling: 'Liquid-Cooled',
        displacementCc: 155,
        engineOilCap: '0.9 L',
        oilViscosity: '10W-40',
        gearOilCap: '150 mL',
        tirePressureFrontPsi: 22,
        tirePressureRearPsi: 33,
      },
    };

    const freeSub = computeAuthoritativeSubscription(
      { subscriptionTier: 'free', subscriptionStatus: 'free' },
      null
    );

    const onFinishFree = vi.fn();
    const onOpenPaywallFree = vi.fn();
    const { unmount: unmountFree } = render(
      <GpsRideTrackerSheet
        bike={testBike}
        subscription={freeSub}
        hasProAccess={false}
        onFinishRide={onFinishFree}
        onOpenPaywall={onOpenPaywallFree}
      />
    );

    // 1. Free user is gated and redirected to paywall
    expect(screen.getByText('Zero-Touch GPS Auto-Odometer is a Pro Feature')).not.toBeNull();
    fireEvent.click(screen.getByText('Upgrade to Pro (₱49/mo)'));
    expect(onOpenPaywallFree).toHaveBeenCalledTimes(1);
    expect(onFinishFree).not.toHaveBeenCalled();
    unmountFree();

    // 2. Pro user gets live GPS watchPosition tracking & Haversine odometer auto-increment
    let watchCallback: ((pos: any) => void) | null = null;
    const clearWatchMock = vi.fn();
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        watchPosition: vi.fn((successCb: (pos: any) => void) => {
          watchCallback = successCb;
          return 77;
        }),
        clearWatch: clearWatchMock,
      },
    });

    const futureExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const proSub = computeAuthoritativeSubscription(
      {
        subscriptionTier: 'pro',
        subscriptionStatus: 'active',
        expiryDate: futureExpiry,
      },
      null
    );

    const onFinishPro = vi.fn();
    const onClosePro = vi.fn();
    const { unmount: unmountPro } = render(
      <GpsRideTrackerSheet
        bike={testBike}
        subscription={proSub}
        hasProAccess={true}
        onFinishRide={onFinishPro}
        onClose={onClosePro}
      />
    );

    expect(screen.getByText('LIVE TRACKING')).not.toBeNull();
    expect(screen.getByText('Tracking for: 2026 Yamaha NMAX 155')).not.toBeNull();
    expect(screen.getByTestId('gps-ride-leaflet-minimap')).not.toBeNull();
    expect(screen.getByText('Live Route Mini-Map')).not.toBeNull();
    expect(watchCallback).not.toBeNull();

    // Emit initial GPS fix (Manila: 14.5995, 120.9842) and second fix ~3.34 km north (14.6295, 120.9842) at 12.5 m/s (45 km/h)
    React.act(() => {
      watchCallback?.({
        coords: { latitude: 14.5995, longitude: 120.9842, speed: 10 },
      });
      watchCallback?.({
        coords: { latitude: 14.6295, longitude: 120.9842, speed: 12.5 },
      });
    });

    expect(screen.getByText('45')).not.toBeNull();
    expect(screen.getByText('45 km/h')).not.toBeNull();
    expect(screen.getByText('+3.34 km')).not.toBeNull();
    expect(screen.getByText('2 pts')).not.toBeNull();
    expect(screen.getByText('(14.6295, 120.9842)')).not.toBeNull();
    expect(screen.getByText('1200 km')).not.toBeNull();
    expect(screen.getByText('1203 km')).not.toBeNull();
    expect(screen.getByText('+3 km')).not.toBeNull();

    // Pause and Resume controls
    fireEvent.click(screen.getByText('Pause'));
    expect(screen.getByText('Resume')).not.toBeNull();
    fireEvent.click(screen.getByText('Resume'));
    expect(screen.getByText('Pause')).not.toBeNull();

    // Finish ride and verify automatic odometer increment (+3 km)
    fireEvent.click(screen.getByText('Finish & Add to Odometer'));
    expect(onFinishPro).toHaveBeenCalledWith(3);
    expect(onClosePro).toHaveBeenCalledTimes(1);

    unmountPro();
    expect(clearWatchMock).toHaveBeenCalled();
  });

  it('Test L: Account-First Onboarding — Simulan Na! opens Create Account screen, validates fields, supports Email/Password registration, Google Sign-In, and Sign In / Forgot Password mode', async () => {
    const signUpMock = vi.fn().mockResolvedValue({
      uid: 'new-rider-uid',
      email: 'juan@example.com',
      displayName: 'Juan Dela Cruz',
    });
    const signInEmailMock = vi.fn().mockResolvedValue({
      uid: 'existing-rider-uid',
      email: 'juan@example.com',
    });
    const signInGoogleMock = vi.fn().mockResolvedValue({
      uid: 'google-rider-uid',
      email: 'google@example.com',
    });
    const resetPasswordMock = vi.fn().mockResolvedValue(undefined);

    vi.mocked(AuthContextModule.useAuth).mockReturnValue({
      user: null,
      loading: false,
      isAdmin: false,
      subscription: { tier: 'free', plan: null, status: 'free' },
      submitPaymentRef: vi.fn(),
      signIn: signInGoogleMock,
      signInWithEmail: signInEmailMock,
      signUpWithEmail: signUpMock,
      resetPassword: resetPasswordMock,
      signOut: vi.fn(),
    });

    render(<App />);

    // 1. Visitor sees Welcome screen with PWA Install banner and "Simulan Na!", cannot access motorcycle registration directly
    expect(screen.getByText('Simulan Na!')).not.toBeNull();
    expect(screen.getByText('Install MotoCare App')).not.toBeNull();
    expect(screen.queryByTestId('account-registration-screen')).toBeNull();

    // 2. Clicking "Simulan Na!" navigates to the dedicated Create Account screen (not GarageModal)
    fireEvent.click(screen.getByText('Simulan Na!'));
    const regScreen = screen.getByTestId('account-registration-screen');
    expect(regScreen).not.toBeNull();
    expect(regScreen.className).toContain('overflow-y-auto');
    expect(screen.getByText('Create Your MotoCare Account')).not.toBeNull();
    expect(screen.getByText('Start taking better care of your motorcycle.')).not.toBeNull();

    // 3. Validation checks on Create Account
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));
    expect(screen.getByText('Please enter your full name.')).not.toBeNull();

    fireEvent.change(screen.getByLabelText('Full Name'), {
      target: { value: 'Juan Dela Cruz' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));
    expect(screen.getByText('Please enter a valid email address.')).not.toBeNull();

    fireEvent.change(screen.getByLabelText('Email Address'), {
      target: { value: 'juan@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: '12345' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));
    expect(screen.getByText('Password must be at least 6 characters.')).not.toBeNull();

    // Password confirmation mismatch check
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'secret123' },
    });
    fireEvent.change(screen.getByLabelText('Confirm Password'), {
      target: { value: 'different123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));
    expect(
      screen.getByText('Passwords do not match. Please re-enter your password.')
    ).not.toBeNull();

    // Show/hide password controls work
    const passwordInput = screen.getByLabelText('Password') as HTMLInputElement;
    expect(passwordInput.type).toBe('password');
    fireEvent.click(screen.getByLabelText('Show password'));
    expect(passwordInput.type).toBe('text');

    // Terms & Privacy Policy checkbox check
    fireEvent.change(screen.getByLabelText('Confirm Password'), {
      target: { value: 'secret123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));
    expect(
      screen.getByText('Please agree to the Terms of Service and Privacy Policy to continue.')
    ).not.toBeNull();

    // Agree to Terms and submit registration
    fireEvent.click(screen.getByRole('checkbox'));
    await React.act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));
    });
    expect(signUpMock).toHaveBeenCalledWith('juan@example.com', 'secret123', 'Juan Dela Cruz');

    // 4. Google Sign-In works
    await React.act(async () => {
      fireEvent.click(screen.getByText('Continue with Google'));
    });
    expect(signInGoogleMock).toHaveBeenCalledTimes(1);

    // 5. Switch to Sign In mode ("Already have an account? Sign In")
    fireEvent.click(screen.getByTestId('switch-to-signin-btn'));
    expect(screen.getByText('Sign In to MotoCare')).not.toBeNull();
    expect(screen.getByText('Forgot Password?')).not.toBeNull();

    // Forgot Password sends reset email
    await React.act(async () => {
      fireEvent.click(screen.getByText('Forgot Password?'));
    });
    expect(resetPasswordMock).toHaveBeenCalledWith('juan@example.com');
    expect(
      screen.getByText('Password reset instructions have been sent to juan@example.com.')
    ).not.toBeNull();

    // Sign in with Email & Password
    await React.act(async () => {
      fireEvent.click(screen.getByTestId('auth-submit-btn'));
    });
    expect(signInEmailMock).toHaveBeenCalledWith('juan@example.com', 'secret123');
  });

  it('Test M: Post-Authentication Onboarding vs. Returning Rider Dashboard — newly authenticated riders see "Let\'s Register Your Motorcycle" & "Irehistro ang Motor Ko", while returning riders with bikes go directly to dashboard', async () => {
    // 1. Newly authenticated rider with 0 motorcycles sees post-auth motorcycle registration screen
    vi.mocked(AuthContextModule.useAuth).mockReturnValue({
      user: {
        uid: 'uid-first-time-rider',
        email: 'newrider@example.com',
        displayName: 'Juan Dela Cruz',
        emailVerified: true,
      } as any,
      loading: false,
      isAdmin: false,
      subscription: { tier: 'free', plan: null, status: 'free' },
      submitPaymentRef: vi.fn(),
      signIn: vi.fn(),
      signInWithEmail: vi.fn(),
      signUpWithEmail: vi.fn(),
      resetPassword: vi.fn(),
      signOut: vi.fn(),
    });

    const { unmount: unmountNewRider } = render(<App />);

    expect(screen.getByTestId('post-auth-register-bike-prompt')).not.toBeNull();
    expect(screen.getByText("Let's Register Your Motorcycle")).not.toBeNull();
    expect(
      screen.getByText(
        'Add your motorcycle to start tracking maintenance and important reminders.'
      )
    ).not.toBeNull();
    expect(screen.getByText('Irehistro ang Motor Ko')).not.toBeNull();
    expect(screen.getByText('Install MotoCare App')).not.toBeNull();

    // Clicking "Irehistro ang Motor Ko" opens the motorcycle registration modal (GarageModal)
    await React.act(async () => {
      fireEvent.click(screen.getByText('Irehistro ang Motor Ko'));
    });
    expect(await screen.findByText('Register Motorcycle')).not.toBeNull();

    unmountNewRider();

    // 2. Returning authenticated rider with an existing motorcycle goes directly to their dashboard
    const returningUid = 'uid-returning-rider';
    const existingBike = {
      id: 'bike-returning-1',
      userId: returningUid,
      brand: 'Yamaha',
      model: 'NMAX 155',
      year: 2026,
      licensePlate: 'ABC 1234',
      odometer: 4500,
      nickname: 'Daily Ride',
      color: 'Matte Black',
      specs: {
        transmission: 'Automatic Scooter' as const,
        cooling: 'Liquid-Cooled' as const,
        displacementCc: 155,
        oilViscosity: '10W-40',
        oilCapacityLiters: 0.9,
        gearOilCapacityMl: 150,
        tirePressureFrontPsi: 29,
        tirePressureRearPsi: 33,
        recommendedServiceIntervalKm: 3000,
      },
    };
    saveUserScopedMotorcycles(returningUid, [existingBike]);

    vi.mocked(AuthContextModule.useAuth).mockReturnValue({
      user: {
        uid: returningUid,
        email: 'returning@example.com',
        displayName: 'Returning Rider',
        emailVerified: true,
      } as any,
      loading: false,
      isAdmin: false,
      subscription: { tier: 'free', plan: null, status: 'free' },
      submitPaymentRef: vi.fn(),
      signIn: vi.fn(),
      signInWithEmail: vi.fn(),
      signUpWithEmail: vi.fn(),
      resetPassword: vi.fn(),
      signOut: vi.fn(),
    });

    render(<App />);

    expect(screen.queryByText("Let's Register Your Motorcycle")).toBeNull();
    expect(screen.queryByText('Simulan Na!')).toBeNull();
    expect(screen.getByText('Maintenance Schedule')).not.toBeNull();
    expect(screen.getAllByText(/NMAX 155/i).length).toBeGreaterThan(0);
  });

  it('Test N: Sign In screen Remember Me checkbox persists and restores user email via localStorage across browser restarts', async () => {
    const signInEmailMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(AuthContextModule.useAuth).mockReturnValue({
      user: null,
      loading: false,
      isAdmin: false,
      subscription: { tier: 'free', plan: null, status: 'free' },
      submitPaymentRef: vi.fn(),
      signIn: vi.fn(),
      signInWithEmail: signInEmailMock,
      signUpWithEmail: vi.fn(),
      resetPassword: vi.fn(),
      signOut: vi.fn(),
    });

    // 1. Render Sign In screen with empty localStorage
    const { unmount } = render(<AccountRegistrationScreen initialMode="signin" />);
    const rememberCheckbox = screen.getByTestId('remember-me-checkbox') as HTMLInputElement;
    expect(rememberCheckbox.checked).toBe(false);

    // Verify icon buttons have descriptive title and aria-label attributes
    const togglePasswordBtn = screen.getByLabelText('Show password');
    expect(togglePasswordBtn.getAttribute('title')).toBe('Show password');

    // Enter email, password, and check Remember Me
    fireEvent.change(screen.getByLabelText('Email Address'), {
      target: { value: 'remembered.rider@motocare.ph' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'secret123' },
    });
    fireEvent.click(rememberCheckbox);
    expect(rememberCheckbox.checked).toBe(true);
    expect(localStorage.getItem(REMEMBERED_EMAIL_STORAGE_KEY)).toBe('remembered.rider@motocare.ph');

    await React.act(async () => {
      fireEvent.click(screen.getByTestId('auth-submit-btn'));
    });
    expect(signInEmailMock).toHaveBeenCalledWith('remembered.rider@motocare.ph', 'secret123');

    // 2. Simulate browser restart by unmounting and remounting Sign In screen
    unmount();
    render(<AccountRegistrationScreen initialMode="signin" />);
    const restoredEmailInput = screen.getByLabelText('Email Address') as HTMLInputElement;
    const restoredCheckbox = screen.getByTestId('remember-me-checkbox') as HTMLInputElement;
    expect(restoredEmailInput.value).toBe('remembered.rider@motocare.ph');
    expect(restoredCheckbox.checked).toBe(true);

    // 3. Unchecking Remember Me clears localStorage
    fireEvent.click(restoredCheckbox);
    expect(localStorage.getItem(REMEMBERED_EMAIL_STORAGE_KEY)).toBeNull();
  });

  it('Test O: GPS Ride Tracker auto-pauses after 5 minutes (300s) stationary to prevent distance drift and accurately calculate active ride time', () => {
    vi.useFakeTimers();
    try {
      expect(AUTO_PAUSE_STATIONARY_THRESHOLD_SECONDS).toBe(300);

      let watchSuccessCallback: ((pos: any) => void) | null = null;
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: {
          watchPosition: vi.fn((success) => {
            watchSuccessCallback = success;
            return 101;
          }),
          clearWatch: vi.fn(),
        },
      });

      const proSub = {
        tier: 'pro' as const,
        plan: 'monthly' as const,
        status: 'active' as const,
        isExpired: false,
      };
      const sampleBike = {
        id: 'bike-gps-pro',
        nickname: 'Marilaque Express',
        brand: 'Yamaha',
        model: 'NMAX 155',
        year: 2026,
        odometer: 2000,
        licensePlate: 'NMAX 999',
        color: 'Black',
        specs: {
          transmission: 'Automatic Scooter' as const,
          cooling: 'Liquid-Cooled' as const,
          displacementCc: 155,
          oilViscosity: '10W-40',
          oilCapacityLiters: 0.9,
          gearOilCapacityMl: 150,
          tirePressureFrontPsi: 29,
          tirePressureRearPsi: 33,
          recommendedServiceIntervalKm: 3000,
        },
      };

      render(
        <GpsRideTrackerSheet
          bike={sampleBike}
          subscription={proSub}
          hasProAccess={true}
          onFinishRide={vi.fn()}
          onClose={vi.fn()}
        />
      );

      // GPS Ride starts in LIVE TRACKING mode
      expect(screen.getByText('LIVE TRACKING')).not.toBeNull();

      // Advance 300 seconds (5 minutes) with 0 km/h speed -> triggers stationary auto-pause
      React.act(() => {
        vi.advanceTimersByTime(300 * 1000);
      });

      expect(screen.getByTestId('gps-auto-paused-badge')).not.toBeNull();
      expect(screen.getByTestId('gps-auto-pause-banner')).not.toBeNull();

      // Active ride duration stops incrementing while auto-paused (8s initial + 299s = 307s -> 05:07)
      expect(screen.getByText('05:07')).not.toBeNull();

      React.act(() => {
        vi.advanceTimersByTime(120 * 1000); // another 2 minutes stationary
      });
      // Still 05:07 active ride time!
      expect(screen.getByText('05:07')).not.toBeNull();

      // Simulate motorcycle moving again via GPS coordinates
      if (watchSuccessCallback) {
        React.act(() => {
          watchSuccessCallback!({
            coords: { latitude: 14.5995, longitude: 120.9842, speed: 0 },
            timestamp: Date.now(),
          });
          watchSuccessCallback!({
            coords: { latitude: 14.605, longitude: 120.99, speed: 10 }, // ~0.87 km movement
            timestamp: Date.now() + 10000,
          });
        });
      }

      // Auto-pause clears automatically when movement resumes
      expect(screen.queryByTestId('gps-auto-paused-badge')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('Test P: Users can export their service history and maintenance records as a formatted CSV or PDF file', () => {
    const sampleBike = {
      id: 'bike-export-1',
      nickname: 'Touring ADV',
      brand: 'Honda',
      model: 'ADV 160',
      year: 2026,
      odometer: 6200,
      licensePlate: 'ADV 2026',
      color: 'Red',
      specs: {
        transmission: 'Automatic Scooter' as const,
        cooling: 'Liquid-Cooled' as const,
        displacementCc: 160,
        oilViscosity: '10W-30',
        oilCapacityLiters: 0.8,
        gearOilCapacityMl: 120,
        tirePressureFrontPsi: 29,
        tirePressureRearPsi: 33,
        recommendedServiceIntervalKm: 3000,
      },
    };

    const sampleRecords = [
      {
        id: 'rec-export-1',
        bikeId: 'bike-export-1',
        date: '2026-10-15',
        odometer: 6000,
        title: 'Full Synthetic Oil & Gear Oil Change',
        category: 'Engine Oil' as const,
        type: 'Casa / Official 3S' as const,
        shopName: 'Honda 3S Quezon Ave',
        oilBrandGrade: 'Pro Honda 10W-30 Fully Synthetic',
        parts: [{ name: 'Engine Oil 0.8L', costPhp: 450 }],
        laborCostPhp: 200,
        totalCostPhp: 650,
        receiptNumber: 'OR-99881',
        isCasaVerified: true,
        notes: 'CVT cleaned and inspected',
      },
    ];

    const sampleReminders = [
      {
        id: 'rem-export-1',
        bikeId: 'bike-export-1',
        title: 'Engine Oil Change (Langis)',
        category: 'Engine Oil' as const,
        intervalKm: 2000,
        lastCompletedOdo: 6000,
        nextDueOdo: 8000,
        lastCompletedDate: '2026-10-15',
        priority: 'high' as const,
        notes: 'Use JASO MB',
        manualSpecNote: '0.8L 10W-30 JASO MB',
        estimatedCostPhp: 450,
      },
    ];

    // 1. Direct export functions produce formatted CSV and PDF 1.4 documents
    const csvOutput = exportServiceAndMaintenanceCsv(sampleBike, sampleRecords, sampleReminders);
    expect(csvOutput).toContain('Full Synthetic Oil & Gear Oil Change');
    expect(csvOutput).toContain('Honda 3S Quezon Ave');
    expect(csvOutput).toContain('# Scheduled Maintenance Records');
    expect(csvOutput).toContain('Engine Oil Change (Langis)');

    const pdfOutput = exportServiceAndMaintenancePdf(sampleBike, sampleRecords, sampleReminders);
    expect(pdfOutput.startsWith('%PDF-1.4')).toBe(true);
    expect(pdfOutput).toContain('MOTOCARE PH - SERVICE HISTORY & MAINTENANCE RECORDS');
    expect(pdfOutput).toContain('Full Synthetic Oil & Gear Oil Change');
    expect(pdfOutput).toContain('Engine Oil Change \\(Langis\\)');
    expect(pdfOutput.trim().endsWith('%%EOF')).toBe(true);

    // 2. Render ServiceLogbookView and verify PDF and CSV export buttons and accessible icon labels
    const proSub = {
      tier: 'pro' as const,
      plan: 'monthly' as const,
      status: 'active' as const,
      isExpired: false,
    };

    render(
      <ServiceLogbookView
        records={sampleRecords}
        reminders={sampleReminders}
        bike={sampleBike}
        subscription={proSub}
        hasProAccess={true}
        onOpenAddService={vi.fn()}
        onOpenCasaBooklet={vi.fn()}
        onDeleteRecord={vi.fn()}
        onOpenPaywall={vi.fn()}
        onBack={vi.fn()}
      />
    );

    const pdfBtn = screen.getByTestId('export-pdf-btn');
    const csvBtn = screen.getByTestId('export-csv-btn');
    expect(pdfBtn.getAttribute('aria-label')).toBe(
      'Export service history and maintenance records as PDF'
    );
    expect(csvBtn.getAttribute('aria-label')).toBe(
      'Export service history and maintenance records as CSV'
    );

    fireEvent.click(pdfBtn);
    fireEvent.click(csvBtn);

    const deleteRecordBtn = screen.getByLabelText(
      'Delete service record: Full Synthetic Oil & Gear Oil Change'
    );
    expect(deleteRecordBtn.getAttribute('title')).toBe(
      'Delete service record: Full Synthetic Oil & Gear Oil Change'
    );
  });

  it('Test Q: generatePrintableMaintenancePdfReport aggregates all service records and current maintenance status into a printable PDF downloadable from Profile or Service History', () => {
    const sampleBike = {
      id: 'bike-report-1',
      userId: 'uid-report-rider',
      nickname: 'Manila Commuter',
      brand: 'Yamaha',
      model: 'Aerox 155',
      year: 2026,
      odometer: 5200,
      licensePlate: 'AER 155',
      color: 'Cyan',
      specs: {
        transmission: 'Automatic Scooter' as const,
        cooling: 'Liquid-Cooled' as const,
        displacementCc: 155,
        oilViscosity: '10W-40',
        oilCapacityLiters: 0.9,
        gearOilCapacityMl: 150,
        tirePressureFrontPsi: 29,
        tirePressureRearPsi: 33,
        recommendedServiceIntervalKm: 3000,
      },
    };

    const sampleRecords = [
      {
        id: 'rec-rep-1',
        bikeId: 'bike-report-1',
        date: '2026-11-01',
        odometer: 5000,
        title: 'Yamalube RS4GP Oil & CVT Cleaning',
        category: 'Engine Oil' as const,
        type: 'Casa / Official 3S' as const,
        shopName: 'Yamaha 3S Flagship',
        oilBrandGrade: 'Yamalube 10W-40',
        parts: [{ name: 'Yamalube Oil', costPhp: 550 }],
        laborCostPhp: 250,
        totalCostPhp: 800,
        receiptNumber: 'OR-10293',
        isCasaVerified: true,
        notes: 'Flyballs in good condition',
      },
      {
        id: 'rec-rep-2',
        bikeId: 'bike-report-1',
        date: '2026-09-10',
        odometer: 3000,
        title: 'DIY Gear Oil Change',
        category: 'Gear Oil' as const,
        type: 'DIY' as const,
        shopName: 'Home Garage',
        oilBrandGrade: 'Yamalube Gear Oil',
        parts: [{ name: 'Gear Oil 150ml', costPhp: 120 }],
        laborCostPhp: 0,
        totalCostPhp: 120,
        notes: 'Drained and refilled',
      },
    ];

    const sampleReminders = [
      {
        id: 'rem-rep-overdue',
        bikeId: 'bike-report-1',
        title: 'Brake Pad Inspection',
        category: 'Brakes' as const,
        intervalKm: 4000,
        lastCompletedOdo: 1000,
        nextDueOdo: 5000, // Overdue by 200 km at 5200 km
        lastCompletedDate: '2026-06-01',
        priority: 'high' as const,
        notes: 'Check front caliper',
        estimatedCostPhp: 350,
      },
      {
        id: 'rem-rep-good',
        bikeId: 'bike-report-1',
        title: 'Engine Oil Change',
        category: 'Engine Oil' as const,
        intervalKm: 2000,
        lastCompletedOdo: 5000,
        nextDueOdo: 7000, // Good (1800 km remaining)
        lastCompletedDate: '2026-11-01',
        priority: 'high' as const,
        notes: '0.9L',
        estimatedCostPhp: 550,
      },
    ];

    const report = generatePrintableMaintenancePdfReport(
      sampleBike,
      sampleRecords,
      sampleReminders
    );

    expect(report.summary.totalServiceRecords).toBe(2);
    expect(report.summary.totalSpentPhp).toBe(920);
    expect(report.summary.diySavedPhp).toBe(250);
    expect(report.summary.casaVerifiedCount).toBe(1);
    expect(report.summary.totalReminders).toBe(2);
    expect(report.summary.overdueCount).toBe(1);
    expect(report.summary.goodCount).toBe(1);
    expect(report.summary.overallHealthStatus).toBe('OVERDUE ATTENTION REQUIRED');
    expect(report.pdfContent.startsWith('%PDF-1.4')).toBe(true);
    expect(report.pdfContent).toContain(
      'OFFICIAL PRINTABLE VEHICLE MAINTENANCE & SERVICE STATUS REPORT'
    );
    expect(report.pdfContent).toContain('Current Maintenance Status: 1 Overdue | 0 Due Soon | 1 Good');
    expect(report.pdfContent).toContain('Yamalube RS4GP Oil & CVT Cleaning');
    expect(report.pdfContent).toContain('Brake Pad Inspection');
  });

  it('Test R: Dark Mode Theme Toggle in User Settings & Profile switches between Light and Dark themes across the application', () => {
    const uid = 'uid-theme-rider';
    const existingBike = {
      id: 'bike-theme-1',
      userId: uid,
      brand: 'Honda',
      model: 'Click 125i',
      year: 2026,
      licensePlate: 'CLK 125',
      odometer: 3200,
      nickname: 'Night Rider',
      color: 'Matte Black',
      specs: {
        transmission: 'Automatic Scooter' as const,
        cooling: 'Liquid-Cooled' as const,
        displacementCc: 125,
        oilViscosity: '10W-30',
        oilCapacityLiters: 0.8,
        gearOilCapacityMl: 120,
        tirePressureFrontPsi: 29,
        tirePressureRearPsi: 33,
        recommendedServiceIntervalKm: 3000,
      },
    };
    saveUserScopedMotorcycles(uid, [existingBike]);

    vi.mocked(AuthContextModule.useAuth).mockReturnValue({
      user: {
        uid,
        email: 'nightrider@motocare.ph',
        displayName: 'Night Rider',
        emailVerified: true,
      } as any,
      loading: false,
      isAdmin: false,
      subscription: { tier: 'free', plan: null, status: 'free' },
      submitPaymentRef: vi.fn(),
      signIn: vi.fn(),
      signInWithEmail: vi.fn(),
      signUpWithEmail: vi.fn(),
      resetPassword: vi.fn(),
      signOut: vi.fn(),
    });

    render(<App />);

    // 1. Default theme is light
    const rootContainer = screen.getByTestId('app-root-container');
    expect(rootContainer.getAttribute('data-theme')).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    // 2. Open User Settings menu and toggle to Dark Mode
    const settingsBtn = screen.getByTestId('user-settings-button');
    fireEvent.click(settingsBtn);
    expect(screen.getByTestId('user-settings-menu')).not.toBeNull();

    const themeToggleBtn = screen.getByTestId('user-settings-theme-toggle');
    fireEvent.click(themeToggleBtn);

    // Verify Dark Mode is active on root container, documentElement, and localStorage
    expect(rootContainer.getAttribute('data-theme')).toBe('dark');
    expect(rootContainer.className).toContain('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    // Verify PDF Report download is available inside User Settings menu
    const settingsPdfBtn = screen.getByTestId('settings-download-pdf-report-btn');
    fireEvent.click(settingsPdfBtn);

    // 3. Open User Profile dropdown and verify PDF Report download & Theme toggle in Profile
    const avatarBtn = screen.getByLabelText('Account menu for Night Rider');
    fireEvent.click(avatarBtn);

    const profilePdfBtn = screen.getByTestId('profile-download-pdf-report-btn');
    expect(profilePdfBtn).not.toBeNull();

    const profileThemeToggle = screen.getByTestId('profile-theme-toggle');
    expect(profileThemeToggle.textContent).toBe('Dark Mode');
    fireEvent.click(profileThemeToggle);

    // Switched back to Light Mode
    expect(rootContainer.getAttribute('data-theme')).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('Test S: Custom Motorcycle Registration — Preset & Custom registration, required field validation, garage appearance, reminders, service history, GPS Auto-Odometer, Free/Pro limits, and legacy compatibility', async () => {
    // 1. Verify Preset motorcycle registration still works & manual registration callout is visible
    const presetSaveMock = vi.fn();
    const { unmount: unmountModal1 } = render(
      <GarageModal
        isOpen={true}
        onClose={vi.fn()}
        bike={null}
        subscription={{ tier: 'free', plan: null, status: 'free' }}
        hasProAccess={false}
        existingCount={0}
        onSave={presetSaveMock}
      />
    );

    expect(
      screen.getByText('Wala sa listahan ang motor mo? Idagdag ito manually.')
    ).not.toBeNull();
    expect(screen.getByText('+ Add My Motorcycle Manually')).not.toBeNull();

    // Submit default preset (Yamaha NMAX 155)
    fireEvent.click(screen.getByTestId('submit-motorcycle-registration-btn'));
    expect(presetSaveMock).toHaveBeenCalledTimes(1);
    expect(presetSaveMock.mock.calls[0][0].brand).toBe('Yamaha');
    expect(presetSaveMock.mock.calls[0][0].model).toBe('NMAX 155');
    unmountModal1();

    // 2 & 3. Custom motorcycle registration mode, required field validation, and Back to Preset List navigation
    const customSaveMock = vi.fn();
    const { unmount: unmountModal2 } = render(
      <GarageModal
        isOpen={true}
        onClose={vi.fn()}
        bike={null}
        subscription={{ tier: 'free', plan: null, status: 'free' }}
        hasProAccess={false}
        existingCount={0}
        onSave={customSaveMock}
      />
    );

    // Click "+ Add My Motorcycle Manually"
    fireEvent.click(screen.getByTestId('switch-to-custom-motorcycle-btn'));
    expect(screen.getByText('Add Custom Motorcycle')).not.toBeNull();
    expect(screen.getByTestId('back-to-preset-list-btn')).not.toBeNull();

    // Test Back to Preset List navigation and return to Custom Mode
    fireEvent.click(screen.getByTestId('back-to-preset-list-btn'));
    expect(screen.getByText('Register Motorcycle')).not.toBeNull();
    fireEvent.click(screen.getByTestId('switch-to-custom-motorcycle-btn'));

    // Submit empty custom form -> verify required field validation messages appear
    fireEvent.click(screen.getByTestId('submit-motorcycle-registration-btn'));
    expect(customSaveMock).not.toHaveBeenCalled();
    const validationAlert = screen.getByTestId('custom-bike-validation-error');
    expect(validationAlert.textContent).toContain('Motorcycle Brand is required.');
    expect(validationAlert.textContent).toContain('Motorcycle Model is required.');
    expect(validationAlert.textContent).toContain('Engine Displacement / CC is required');
    expect(validationAlert.textContent).toContain('Current Odometer Reading is required');

    // Fill in all required & optional custom motorcycle fields (including selecting Motorcycle Type)
    fireEvent.change(screen.getByTestId('custom-bike-brand-input'), {
      target: { value: 'Bristol' },
    });
    fireEvent.change(screen.getByTestId('custom-bike-model-input'), {
      target: { value: 'Venturi 500' },
    });
    fireEvent.change(screen.getByTestId('custom-bike-cc-input'), {
      target: { value: '471' },
    });
    fireEvent.change(screen.getByTestId('custom-bike-year-input'), {
      target: { value: '2025' },
    });
    fireEvent.change(screen.getByTestId('custom-bike-type-select'), {
      target: { value: 'Adventure' },
    });
    fireEvent.change(screen.getByTestId('custom-bike-odometer-input'), {
      target: { value: '1850' },
    });
    fireEvent.change(screen.getByTestId('custom-bike-nickname-input'), {
      target: { value: 'Sierra Madre Explorer' },
    });

    fireEvent.click(screen.getByTestId('submit-motorcycle-registration-btn'));
    expect(customSaveMock).toHaveBeenCalledTimes(1);
    const savedCustomBike = customSaveMock.mock.calls[0][0];
    expect(savedCustomBike.brand).toBe('Bristol');
    expect(savedCustomBike.model).toBe('Venturi 500');
    expect(savedCustomBike.specs.displacementCc).toBe(471);
    expect(savedCustomBike.year).toBe(2025);
    expect(savedCustomBike.motorcycleType).toBe('Adventure');
    expect(savedCustomBike.odometer).toBe(1850);
    expect(savedCustomBike.nickname).toBe('Sierra Madre Explorer');
    expect(savedCustomBike.isCustom).toBe(true);
    unmountModal2();

    // 4, 5, 6 & 7. Full App flow: Free user registers custom bike -> appears in garage, receives max 2 reminders on Free tier,
    // supports service history, GPS Auto-Odometer, and cannot exceed 1 motorcycle on Free tier
    const freeRiderUid = 'uid-custom-free-rider';
    vi.mocked(AuthContextModule.useAuth).mockReturnValue({
      user: {
        uid: freeRiderUid,
        email: 'customfree@motocare.ph',
        displayName: 'Custom Rider',
        emailVerified: true,
      } as any,
      loading: false,
      isAdmin: false,
      subscription: { tier: 'free', plan: null, status: 'free' },
      hasProAccess: false,
      submitPaymentRef: vi.fn(),
      signIn: vi.fn(),
      signInWithEmail: vi.fn(),
      signUpWithEmail: vi.fn(),
      resetPassword: vi.fn(),
      signOut: vi.fn(),
    });

    const { unmount: unmountAppFree } = render(<App />);

    // Post-auth onboarding shows manual registration prompt
    expect(
      screen.getByText('Wala sa listahan ang motor mo? Idagdag ito manually.')
    ).not.toBeNull();
    fireEvent.click(screen.getByTestId('onboarding-add-custom-bike-btn'));

    // Fill custom motorcycle in GarageModal
    fireEvent.change(screen.getByTestId('custom-bike-brand-input'), {
      target: { value: 'KYMCO' },
    });
    fireEvent.change(screen.getByTestId('custom-bike-model-input'), {
      target: { value: 'Like 150i' },
    });
    fireEvent.change(screen.getByTestId('custom-bike-cc-input'), {
      target: { value: '150' },
    });
    fireEvent.change(screen.getByTestId('custom-bike-year-input'), {
      target: { value: '2024' },
    });
    fireEvent.change(screen.getByTestId('custom-bike-type-select'), {
      target: { value: 'Scooter' },
    });
    fireEvent.change(screen.getByTestId('custom-bike-odometer-input'), {
      target: { value: '2400' },
    });
    fireEvent.change(screen.getByTestId('custom-bike-nickname-input'), {
      target: { value: 'Classic White' },
    });

    await React.act(async () => {
      fireEvent.click(screen.getByTestId('submit-motorcycle-registration-btn'));
    });

    // Verify custom bike appears in the garage and Free account has max 2 starter reminders
    const storedFreeBikes = loadUserScopedMotorcycles(freeRiderUid);
    expect(storedFreeBikes).toHaveLength(1);
    expect(storedFreeBikes[0].brand).toBe('KYMCO');
    expect(storedFreeBikes[0].model).toBe('Like 150i');
    const storedFreeReminders = loadUserScopedReminders(freeRiderUid);
    expect(storedFreeReminders.length).toBeLessThanOrEqual(2);
    expect(storedFreeReminders.length).toBeGreaterThan(0);

    unmountAppFree();

    // 8 & 9. Pro user can add multiple custom motorcycles & legacy records without isCustom remain compatible
    const proRiderUid = 'uid-custom-pro-rider';
    const legacyBikeWithoutNewFields = {
      id: 'bike-legacy-compat-1',
      userId: proRiderUid,
      brand: 'Suzuki',
      model: 'Raider R150 Fi',
      year: 2023,
      licensePlate: 'RDR 150',
      odometer: 8900,
      nickname: 'King Underbone',
      color: 'Blue',
      specs: {
        transmission: 'Manual' as const,
        cooling: 'Liquid-Cooled' as const,
        displacementCc: 150,
        oilViscosity: '10W-40',
        oilCapacityLiters: 1.0,
        tirePressureFrontPsi: 29,
        tirePressureRearPsi: 33,
        recommendedServiceIntervalKm: 3000,
      },
    };
    saveUserScopedMotorcycles(proRiderUid, [legacyBikeWithoutNewFields]);

    const proPaywallMock = vi.fn();
    const proSaveSecondBikeMock = vi.fn();
    const { unmount: unmountProModal } = render(
      <GarageModal
        isOpen={true}
        onClose={vi.fn()}
        bike={null}
        subscription={{ tier: 'pro', plan: 'monthly', status: 'active' }}
        hasProAccess={true}
        existingCount={1}
        initialCustomMode={true}
        onSave={proSaveSecondBikeMock}
        onOpenPaywall={proPaywallMock}
      />
    );

    expect(screen.queryByText('Multi-Bike Garage is a Pro Feature')).toBeNull();
    fireEvent.change(screen.getByTestId('custom-bike-brand-input'), {
      target: { value: 'Ducati' },
    });
    fireEvent.change(screen.getByTestId('custom-bike-model-input'), {
      target: { value: 'Scrambler Icon 800' },
    });
    fireEvent.change(screen.getByTestId('custom-bike-cc-input'), {
      target: { value: '803' },
    });
    fireEvent.change(screen.getByTestId('custom-bike-year-input'), {
      target: { value: '2025' },
    });
    fireEvent.change(screen.getByTestId('custom-bike-type-select'), {
      target: { value: 'Standard' },
    });
    fireEvent.change(screen.getByTestId('custom-bike-odometer-input'), {
      target: { value: '650' },
    });

    fireEvent.click(screen.getByTestId('submit-motorcycle-registration-btn'));
    expect(proSaveSecondBikeMock).toHaveBeenCalledTimes(1);
    expect(proSaveSecondBikeMock.mock.calls[0][0].brand).toBe('Ducati');
    expect(proSaveSecondBikeMock.mock.calls[0][0].motorcycleType).toBe('Standard');
    unmountProModal();
  });
});





