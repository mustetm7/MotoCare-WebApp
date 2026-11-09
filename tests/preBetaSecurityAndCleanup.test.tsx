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
  saveUserScopedMotorcycles,
} from '../src/utils/storage';
import {
  calculateNextMonthlyExpiry,
  getManilaDay,
  canCreateMotorcycleInGarage,
} from '../src/utils/firestoreService';
import { isCountedAsActivePaidProSubscriber } from '../src/components/AdminUsersPortal';
import { GarageModal } from '../src/components/GarageModal';
import { GpsRideTrackerSheet } from '../src/components/GpsRideTrackerSheet';
import { ServiceLogbookView } from '../src/components/ServiceLogbookView';
import { CasaBookletModal } from '../src/components/CasaBookletModal';

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
});
