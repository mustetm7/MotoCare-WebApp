import React from 'react';
import {
  Motorcycle,
  MaintenanceReminder,
  ServiceRecord,
  ActiveTab,
  UserSubscription,
  PaymentMethod,
  UserAccount,
} from './types';
import {
  loadMotorcycles,
  saveMotorcycles,
  loadReminders,
  saveReminders,
  loadServiceRecords,
  saveServiceRecords,
  loadActiveBikeId,
  saveActiveBikeId,
  loadSubscription,
  saveSubscription,
  loadQuickKmPresets,
  saveQuickKmPresets,
  resetAllToDefault,
  analyzeReminder,
  loadUserAccounts,
  saveUserAccounts,
  INITIAL_USER_ACCOUNTS,
} from './utils/storage';
import { sounds } from './utils/audio';

// Components
import { Navbar } from './components/Navbar';
import { GarageHeader } from './components/GarageHeader';
import { MaintenanceCard } from './components/MaintenanceCard';
import { ServiceLogbookView } from './components/ServiceLogbookView';
import { LtoView } from './components/LtoView';
import { OnboardingView } from './components/OnboardingView';
import { GpsRideTrackerSheet } from './components/GpsRideTrackerSheet';
import { OfflineIndicator } from './components/OfflineIndicator';
import { OverdueAlertBanner } from './components/OverdueAlertBanner';
import { triggerOverdueAlert } from './utils/notifications';
import { AdminUsersPortal } from './components/AdminUsersPortal';

// Modals
import { QuickAddOdometerModal } from './components/QuickAddOdometerModal';
import { GarageModal } from './components/GarageModal';
import { AddReminderModal } from './components/AddReminderModal';
import { AddServiceRecordModal } from './components/AddServiceRecordModal';
import { PaywallModal } from './components/PaywallModal';

import { Plus } from 'lucide-react';
import { generateOemSchedule, PhilippineModelPreset } from './data/philippinePresets';
import { INITIAL_MOTORCYCLES, INITIAL_REMINDERS } from './data/initialData';
import { useAuth } from './context/AuthContext';
import { saveMotorcycleToFirestore } from './utils/firestoreService';

export default function App() {
  const { user, subscription, setSubscription, submitPaymentRef } = useAuth();

  // --- Persistent State ---
  const [motorcycles, setMotorcycles] = React.useState<Motorcycle[]>(() => loadMotorcycles());
  const [activeBikeId, setActiveBikeId] = React.useState<string>(() => loadActiveBikeId(motorcycles));
  const [reminders, setReminders] = React.useState<MaintenanceReminder[]>(() => loadReminders());
  const [serviceRecords, setServiceRecords] = React.useState<ServiceRecord[]>(() => loadServiceRecords());
  const [quickPresets, setQuickPresets] = React.useState<number[]>(() => loadQuickKmPresets());

  // User Accounts State (persisted for Admin Review)
  const [userAccounts, setUserAccounts] = React.useState<UserAccount[]>(() => loadUserAccounts());

  // Separate Admin Page URL detection (/admin or #admin)
  const checkIsAdminPage = () => {
    if (typeof window === 'undefined') return false;
    const path = window.location.pathname.toLowerCase();
    const hash = window.location.hash.toLowerCase();
    const query = new URLSearchParams(window.location.search).get('admin');
    return (
      path === '/admin' ||
      path.startsWith('/admin/') ||
      hash === '#admin' ||
      query === 'true'
    );
  };

  const [isAdminPortal, setIsAdminPortal] = React.useState<boolean>(() => checkIsAdminPage());

  // Active Tab
  const [activeTab, setActiveTab] = React.useState<ActiveTab>('garage');

  // Modals state
  const [isQuickAddOdoOpen, setIsQuickAddOdoOpen] = React.useState(false);
  const [isGarageModalOpen, setIsGarageModalOpen] = React.useState(false);
  const [editingBike, setEditingBike] = React.useState<Motorcycle | null>(null);

  const [isReminderModalOpen, setIsReminderModalOpen] = React.useState(false);
  const [editingReminder, setEditingReminder] = React.useState<MaintenanceReminder | null>(null);

  const [isServiceModalOpen, setIsServiceModalOpen] = React.useState(false);
  const [serviceModalInitialTitle, setServiceModalInitialTitle] = React.useState<string>('');
  const [serviceModalInitialReminderId, setServiceModalInitialReminderId] = React.useState<string | undefined>();

  const [isPaywallOpen, setIsPaywallOpen] = React.useState(false);
  const [isGpsModalOpen, setIsGpsModalOpen] = React.useState(false);
  const [isOverdueBannerDismissed, setIsOverdueBannerDismissed] = React.useState(false);
  const alertedOverdueIds = React.useRef<Set<string>>(new Set());

  // Listen to path, hash and popstate changes (for direct /admin URL)
  React.useEffect(() => {
    const handleUrlChange = () => {
      setIsAdminPortal(checkIsAdminPage());
    };

    window.addEventListener('hashchange', handleUrlChange);
    window.addEventListener('popstate', handleUrlChange);
    return () => {
      window.removeEventListener('hashchange', handleUrlChange);
      window.removeEventListener('popstate', handleUrlChange);
    };
  }, []);

  // Sync to local storage
  React.useEffect(() => {
    saveMotorcycles(motorcycles);
  }, [motorcycles]);

  React.useEffect(() => {
    saveReminders(reminders);
  }, [reminders]);

  React.useEffect(() => {
    saveServiceRecords(serviceRecords);
  }, [serviceRecords]);

  React.useEffect(() => {
    saveSubscription(subscription);
  }, [subscription]);

  React.useEffect(() => {
    saveQuickKmPresets(quickPresets);
  }, [quickPresets]);

  React.useEffect(() => {
    saveUserAccounts(userAccounts);
  }, [userAccounts]);

  React.useEffect(() => {
    if (activeBikeId) {
      saveActiveBikeId(activeBikeId);
    }
  }, [activeBikeId]);

  // Active Bike lookup
  const activeBike: Motorcycle =
    motorcycles.find((b) => b.id === activeBikeId) || motorcycles[0] || ({} as Motorcycle);

  // Reminders & Overdue tracking for active bike
  const activeReminders = reminders.filter((r) => r.bikeId === activeBike?.id);
  const overdueReminders = activeReminders.filter(
    (r) => analyzeReminder(r, activeBike?.odometer || 0).status === 'overdue'
  );
  const overdueCount = overdueReminders.length;

  // --- Handlers ---
  const handleSelectBike = (bikeId: string) => {
    sounds.playClick();
    setActiveBikeId(bikeId);
    setIsOverdueBannerDismissed(false);
  };

  const handleUpdateOdometer = (newOdo: number) => {
    const updated = motorcycles.map((b) => (b.id === activeBike.id ? { ...b, odometer: newOdo } : b));
    setMotorcycles(updated);

    // Check if newly reached odometer pushes any maintenance task into OVERDUE
    const newlyOverdue = activeReminders.filter((r) => {
      const isOverdueNow = analyzeReminder(r, newOdo).status === 'overdue';
      const wasAlreadyAlerted = alertedOverdueIds.current.has(r.id);
      return isOverdueNow && !wasAlreadyAlerted;
    });

    if (newlyOverdue.length > 0) {
      // Trigger browser push notification, phone vibration, and urgent automotive sound
      newlyOverdue.forEach((rem) => {
        triggerOverdueAlert(rem, { ...activeBike, odometer: newOdo }, newOdo - rem.nextDueOdo);
        alertedOverdueIds.current.add(rem.id);
      });
      setIsOverdueBannerDismissed(false);
    }
  };

  const handleAddKm = (km: number) => {
    handleUpdateOdometer(activeBike.odometer + km);
  };

  const handleFinishGpsRide = (rideDistanceKm: number) => {
    const newOdo = Math.round(activeBike.odometer + rideDistanceKm);
    handleUpdateOdometer(newOdo);
    sounds.playSuccess();
  };

  const handleSaveBike = (bike: Motorcycle, selectedPreset?: PhilippineModelPreset) => {
    const exists = motorcycles.some((b) => b.id === bike.id);
    if (exists) {
      setMotorcycles(motorcycles.map((b) => (b.id === bike.id ? bike : b)));
    } else {
      setMotorcycles([...motorcycles, bike]);
      setActiveBikeId(bike.id);

      // Auto-populate OEM Philippine Maintenance Schedule if preset selected
      if (selectedPreset) {
        const oemReminders = generateOemSchedule(bike.id, selectedPreset, bike.odometer);
        setReminders([...reminders, ...oemReminders]);
      }
    }
  };

  const handleDeleteBike = (bikeId: string) => {
    sounds.playClick();
    const remaining = motorcycles.filter((b) => b.id !== bikeId);
    setMotorcycles(remaining);
    setActiveBikeId(remaining.length > 0 ? remaining[0].id : '');
    setReminders(reminders.filter((r) => r.bikeId !== bikeId));
    setServiceRecords(serviceRecords.filter((r) => r.bikeId !== bikeId));
  };

  const handleSaveReminder = (reminder: MaintenanceReminder) => {
    const exists = reminders.some((r) => r.id === reminder.id);
    if (exists) {
      setReminders(reminders.map((r) => (r.id === reminder.id ? reminder : r)));
    } else {
      setReminders([...reminders, reminder]);
    }
  };

  const handleDeleteReminder = (reminderId: string) => {
    sounds.playClick();
    setReminders(reminders.filter((r) => r.id !== reminderId));
  };

  const handleSaveServiceRecord = (record: ServiceRecord, linkedReminderId?: string) => {
    setServiceRecords([record, ...serviceRecords]);

    // Reset linked reminder target if provided
    if (linkedReminderId) {
      alertedOverdueIds.current.delete(linkedReminderId);
      setReminders((prev) =>
        prev.map((r) => {
          if (r.id === linkedReminderId) {
            return {
              ...r,
              lastCompletedDate: record.date,
              lastCompletedOdo: record.odometer,
              nextDueOdo: record.odometer + r.intervalKm,
            };
          }
          return r;
        })
      );
    }
  };

  const handleDeleteServiceRecord = (recordId: string) => {
    sounds.playClick();
    setServiceRecords(serviceRecords.filter((r) => r.id !== recordId));
  };

  const handleCloseAdminPortal = () => {
    sounds.playClick();
    if (typeof window !== 'undefined') {
      window.history.pushState(null, '', '/');
    }
    setIsAdminPortal(false);
  };

  const handleApprovePro = (userId: string) => {
    setUserAccounts((prev) =>
      prev.map((u) =>
        u.id === userId
          ? {
              ...u,
              subscriptionTier: 'pro',
              paymentStatus: 'active_pro',
              approvedAt: new Date().toISOString(),
              approvedBy: 'Admin (Manual)',
            }
          : u
      )
    );

    // If approving the active rider or user-001, unlock Pro in the active app
    const target = userAccounts.find((u) => u.id === userId);
    if (
      target &&
      (target.id === 'user-001' ||
        target.email === 'mustetm7@gmail.com' ||
        (activeBike && target.bikeModel.toLowerCase().includes(activeBike.model.toLowerCase())))
    ) {
      setSubscription({
        tier: 'pro',
        plan: 'monthly',
        status: 'active',
        paymentMethod: target.paymentMethod || 'gcash',
        referenceNumber: target.referenceNumber,
      });
    }
  };

  const handleRevokePro = (userId: string) => {
    setUserAccounts((prev) =>
      prev.map((u) =>
        u.id === userId
          ? {
              ...u,
              subscriptionTier: 'free',
              paymentStatus: 'unpaid_free',
            }
          : u
      )
    );

    const target = userAccounts.find((u) => u.id === userId);
    if (target && (target.id === 'user-001' || target.email === 'mustetm7@gmail.com')) {
      setSubscription({
        tier: 'free',
        plan: null,
        status: 'free',
      });
    }
  };

  const handleAddUser = (user: Omit<UserAccount, 'id' | 'registeredAt'>) => {
    const newUser: UserAccount = {
      ...user,
      id: `user-${Date.now().toString(36)}`,
      registeredAt: new Date().toISOString().split('T')[0],
    };
    setUserAccounts((prev) => [newUser, ...prev]);
  };

  const handleResetUsersToDefault = () => {
    setUserAccounts(INITIAL_USER_ACCOUNTS);
  };

  const handleSubscribe = (
    plan: 'monthly' | 'annual',
    paymentMethod: PaymentMethod,
    referenceNumber?: string
  ) => {
    const refCode = referenceNumber || `GCASH-${Math.floor(100000 + Math.random() * 900000)}`;
    setSubscription({
      tier: 'pro',
      plan,
      status: 'active',
      paymentMethod,
      referenceNumber: refCode,
    });

    // Sync into userAccounts so admin can inspect the payment
    setUserAccounts((prev) =>
      prev.map((u) =>
        u.id === 'user-001' || u.email === 'mustetm7@gmail.com'
          ? {
              ...u,
              subscriptionTier: 'pro',
              paymentStatus: 'active_pro',
              paymentMethod,
              referenceNumber: refCode,
              amountPhp: 49,
              lastPaymentDate: new Date().toISOString(),
              approvedAt: new Date().toISOString(),
              approvedBy: 'Instant / In-App',
            }
          : u
      )
    );
  };

  const currentRider = userAccounts.find(
    (u) => u.id === 'user-001' || u.email === 'mustetm7@gmail.com'
  );
  const isAlreadyPending = currentRider?.paymentStatus === 'pending_approval';
  const existingPendingRef = currentRider?.referenceNumber;

  const handleSubmitReference = async (
    paymentMethod: PaymentMethod,
    referenceNumber: string
  ) => {
    const refCode = referenceNumber.trim() || `GCASH-${Math.floor(100000 + Math.random() * 900000)}`;

    // 1. Submit to Firebase Firestore
    try {
      await submitPaymentRef(
        paymentMethod,
        refCode,
        activeBike?.model || 'Motorcycle',
        activeBike?.licensePlate || ''
      );
    } catch (err) {
      console.warn('Could not submit payment to Firestore:', err);
    }

    // 2. Update local state
    setUserAccounts((prev) =>
      prev.map((u) =>
        u.id === 'user-001' || u.email === (user?.email || 'mustetm7@gmail.com')
          ? {
              ...u,
              subscriptionTier: 'free', // stays free until owner approves in /admin
              paymentStatus: 'pending_approval',
              paymentMethod,
              referenceNumber: refCode,
              amountPhp: 49,
              lastPaymentDate: new Date().toISOString(),
              notes: 'Submitted via Payment Gateway. Awaiting Admin manual approval.',
            }
          : u
      )
    );
  };

  const handleCancelSubscription = () => {
    setSubscription({
      tier: 'free',
      plan: null,
      status: 'free',
    });
  };

  const handleToggleDemoTier = () => {
    sounds.playClick();
    if (subscription.tier === 'pro') {
      setSubscription({
        tier: 'free',
        plan: null,
        status: 'free',
      });
    } else {
      setSubscription({
        tier: 'pro',
        plan: 'monthly',
        status: 'active',
        paymentMethod: 'gcash',
      });
      sounds.playSuccess();
    }
  };

  const handleQuickLoadSample = () => {
    setMotorcycles(INITIAL_MOTORCYCLES);
    setActiveBikeId(INITIAL_MOTORCYCLES[0].id);
    setReminders(INITIAL_REMINDERS);
    sounds.playSuccess();
  };

  if (isAdminPortal) {
    return (
      <AdminUsersPortal
        users={userAccounts}
        onApprovePro={handleApprovePro}
        onRevokePro={handleRevokePro}
        onAddUser={handleAddUser}
        onResetUsersToDefault={handleResetUsersToDefault}
        onReturnToApp={handleCloseAdminPortal}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-slate-900 flex flex-col font-sans selection:bg-[#FF6B00] selection:text-white">
      {/* Top Navbar matching screenshots */}
      <Navbar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        motorcycles={motorcycles}
        activeBike={activeBike}
        subscription={subscription}
        onToggleDemoTier={handleToggleDemoTier}
        onSelectBike={handleSelectBike}
        onOpenAddBike={() => {
          if (subscription.tier === 'free' && motorcycles.length >= 1) {
            setIsPaywallOpen(true);
            return;
          }
          setEditingBike(null);
          setIsGarageModalOpen(true);
        }}
        onOpenAddService={() => {
          setServiceModalInitialTitle('');
          setServiceModalInitialReminderId(undefined);
          setIsServiceModalOpen(true);
        }}
        onOpenPaywall={() => setIsPaywallOpen(true)}
        onGoToHome={() => {
          setActiveTab('garage');
        }}
        overdueCount={overdueCount}
        overdueReminders={overdueReminders}
        onOpenServiceForReminder={(rem) => {
          setServiceModalInitialTitle(rem.title);
          setServiceModalInitialReminderId(rem.id);
          setIsServiceModalOpen(true);
        }}
      />

      {/* Main App Container matching mobile app width on desktop */}
      <main className="flex-1 max-w-md w-full mx-auto px-4 py-5 space-y-5 relative pb-24">
        {motorcycles.length === 0 ? (
          <OnboardingView
            onAddMotorcycle={() => {
              setEditingBike(null);
              setIsGarageModalOpen(true);
            }}
            onQuickLoadSample={handleQuickLoadSample}
          />
        ) : (
          <>
            {/* Urgent In-App Push Notification Alert Banner with Vibration & Quick Action */}
            {overdueReminders.length > 0 && !isOverdueBannerDismissed && (
              <OverdueAlertBanner
                overdueReminders={overdueReminders}
                bike={activeBike}
                onOpenServiceModal={(rem) => {
                  setServiceModalInitialTitle(rem.title);
                  setServiceModalInitialReminderId(rem.id);
                  setIsServiceModalOpen(true);
                }}
                onDismiss={() => setIsOverdueBannerDismissed(true)}
              />
            )}

            {/* Garage & Schedule Tabs */}
            {(activeTab === 'garage' || activeTab === 'reminders') && (
              <div className="space-y-6 animate-in fade-in duration-150">
                {/* Active Bike Profile, Odometer & Quick Actions matching screenshot 2 */}
                <GarageHeader
                  bike={activeBike}
                  reminders={reminders}
                  activeTab={activeTab}
                  onTabChange={setActiveTab}
                  onAddKm={handleAddKm}
                  onOpenEditOdometer={() => setIsQuickAddOdoOpen(true)}
                  onOpenEditBike={() => {
                    setEditingBike(activeBike);
                    setIsGarageModalOpen(true);
                  }}
                  onOpenGpsRide={() => setIsGpsModalOpen(true)}
                  onOpenPaywall={() => setIsPaywallOpen(true)}
                  isPro={subscription.tier === 'pro'}
                />

                {/* Maintenance Schedule Header matching screenshot 2 */}
                <div className="flex items-center justify-between pt-1">
                  <h2 className="text-xl font-bold text-slate-900 tracking-tight">
                    Maintenance Schedule
                  </h2>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingReminder(null);
                      setIsReminderModalOpen(true);
                    }}
                    className="text-xs font-bold text-[#FF6B00] hover:underline flex items-center gap-1"
                  >
                    <span>+ Add Task</span>
                  </button>
                </div>

                {/* Maintenance Cards List matching screenshots 2, 3, 4 */}
                <div className="space-y-3.5">
                  {activeReminders.map((reminder) => (
                    <MaintenanceCard
                      key={reminder.id}
                      reminder={reminder}
                      bike={activeBike}
                      onComplete={(rem) => {
                        setServiceModalInitialTitle(rem.title);
                        setServiceModalInitialReminderId(rem.id);
                        setIsServiceModalOpen(true);
                      }}
                      onEdit={(rem) => {
                        setEditingReminder(rem);
                        setIsReminderModalOpen(true);
                      }}
                      onDelete={handleDeleteReminder}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Service History Tab */}
            {activeTab === 'logbook' && (
              <div className="animate-in fade-in duration-150">
                <ServiceLogbookView
                  records={serviceRecords}
                  bike={activeBike}
                  subscription={subscription}
                  onOpenAddService={() => {
                    setServiceModalInitialTitle('');
                    setServiceModalInitialReminderId(undefined);
                    setIsServiceModalOpen(true);
                  }}
                  onOpenCasaBooklet={() => {}}
                  onDeleteRecord={handleDeleteServiceRecord}
                  onOpenPaywall={() => setIsPaywallOpen(true)}
                  onBack={() => setActiveTab('garage')}
                />
              </div>
            )}

            {/* Garage / LTO Registration Tab */}
            {activeTab === 'lto' && (
              <div className="animate-in fade-in duration-150">
                <LtoView
                  bike={activeBike}
                  onUpdatePlate={(newPlate) => {
                    setMotorcycles(
                      motorcycles.map((b) => (b.id === activeBike.id ? { ...b, licensePlate: newPlate } : b))
                    );
                    sounds.playSuccess();
                  }}
                  onBack={() => setActiveTab('garage')}
                />
              </div>
            )}

            {/* Floating Action Button (+ New Task) matching screenshots 2, 3, 4 */}
            {(activeTab === 'garage' || activeTab === 'reminders') && (
              <div className="fixed bottom-6 right-4 sm:right-auto sm:left-1/2 sm:translate-x-28 z-30">
                <button
                  type="button"
                  onClick={() => {
                    sounds.playClick();
                    setEditingReminder(null);
                    setIsReminderModalOpen(true);
                  }}
                  className="px-5 py-3 rounded-2xl bg-[#FF6B00] hover:bg-[#EA580C] text-white font-bold text-xs shadow-xl shadow-[#FF6B00]/35 flex items-center gap-1.5 transition-all active:scale-95 hover:scale-105"
                >
                  <Plus className="w-4 h-4 stroke-[3]" />
                  <span>New Task</span>
                </button>
              </div>
            )}
          </>
        )}

        {/* User-Facing Clean Footer (Zero admin links) */}
        <footer className="pt-8 pb-4 text-center text-[10px] text-slate-400">
          <p>MotoCare PH • Motorcycle Maintenance & Digital Garage</p>
        </footer>
      </main>

      {/* Modals */}
      <QuickAddOdometerModal
        isOpen={isQuickAddOdoOpen}
        onClose={() => setIsQuickAddOdoOpen(false)}
        bike={activeBike}
        presets={quickPresets}
        onSavePresets={setQuickPresets}
        onUpdateOdometer={handleUpdateOdometer}
      />

      <GarageModal
        isOpen={isGarageModalOpen}
        onClose={() => setIsGarageModalOpen(false)}
        bike={editingBike}
        subscription={subscription}
        existingCount={motorcycles.length}
        onSave={handleSaveBike}
        onDelete={handleDeleteBike}
        canDelete={true}
        onOpenPaywall={() => {
          setIsGarageModalOpen(false);
          setIsPaywallOpen(true);
        }}
      />

      <AddReminderModal
        isOpen={isReminderModalOpen}
        onClose={() => setIsReminderModalOpen(false)}
        bike={activeBike}
        editingReminder={editingReminder}
        onSave={handleSaveReminder}
        onDelete={handleDeleteReminder}
      />

      <AddServiceRecordModal
        isOpen={isServiceModalOpen}
        onClose={() => setIsServiceModalOpen(false)}
        bike={activeBike}
        reminders={reminders}
        initialTitle={serviceModalInitialTitle}
        initialReminderId={serviceModalInitialReminderId}
        onSave={handleSaveServiceRecord}
      />

      <PaywallModal
        isOpen={isPaywallOpen}
        onClose={() => setIsPaywallOpen(false)}
        subscription={subscription}
        onSubmitReference={handleSubmitReference}
        onCancelSubscription={handleCancelSubscription}
        isAlreadyPending={isAlreadyPending}
        existingPendingRef={existingPendingRef}
      />

      {/* GPS Ride Tracker Modal */}
      {isGpsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <GpsRideTrackerSheet
            bike={activeBike}
            subscription={subscription}
            onFinishRide={handleFinishGpsRide}
            onClose={() => setIsGpsModalOpen(false)}
            onOpenPaywall={() => {
              setIsGpsModalOpen(false);
              setIsPaywallOpen(true);
            }}
          />
        </div>
      )}

      {/* Offline Connectivity Toast for PWA */}
      <OfflineIndicator />
    </div>
  );
}
