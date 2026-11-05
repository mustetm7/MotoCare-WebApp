import React from 'react';
import { ActiveTab, Motorcycle, UserSubscription, AppNotification, PaymentSubmission } from '../types';
import {
  Bell,
  ChevronDown,
  Plus,
  Sparkles,
  Check,
  Vibrate,
  AlertTriangle,
  ShieldCheck,
  Zap,
  CreditCard,
  Calendar,
  CheckCircle2,
  Trash2,
  ArrowRight,
} from 'lucide-react';
import { sounds } from '../utils/audio';
import { PWAInstallButton } from './PWAInstallButton';
import { MaintenanceReminder } from '../types';
import {
  testOverdueAlert,
  getNotificationPermission,
  requestNotificationPermission,
} from '../utils/notifications';

interface NavbarProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  motorcycles: Motorcycle[];
  activeBike: Motorcycle | null;
  subscription: UserSubscription;
  notifications: AppNotification[];
  submissions: PaymentSubmission[];
  onToggleDemoTier: () => void;
  onSelectBike: (bikeId: string) => void;
  onOpenAddBike: () => void;
  onOpenAddService: () => void;
  onOpenPaywall: () => void;
  onOpenCasaBooklet?: () => void;
  onGoToHome?: () => void;
  onClearNotifications: () => void;
  onMarkNotificationRead: (id: string) => void;
  overdueCount: number;
  overdueReminders?: MaintenanceReminder[];
  onOpenServiceForReminder?: (reminder: MaintenanceReminder) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  onTabChange,
  motorcycles,
  activeBike,
  subscription,
  notifications = [],
  submissions = [],
  onToggleDemoTier,
  onSelectBike,
  onOpenAddBike,
  onOpenAddService,
  onOpenPaywall,
  onGoToHome,
  onClearNotifications,
  onMarkNotificationRead,
  overdueCount,
  overdueReminders = [],
  onOpenServiceForReminder,
}) => {
  const [bikeMenuOpen, setBikeMenuOpen] = React.useState(false);
  const [bellOpen, setBellOpen] = React.useState(false);
  const [activeNotifTab, setActiveNotifTab] = React.useState<'actions' | 'logs'>('actions');
  const dropdownRef = React.useRef<HTMLDivElement>(null);
  const bellContainerRef = React.useRef<HTMLDivElement>(null);
  const isPro = subscription.tier === 'pro';

  const pendingSubmissions = submissions.filter((s) => s.status === 'pending');
  const unreadNotifs = notifications.filter((n) => !n.isRead);

  // Total count of actions requiring immediate attention
  const totalActionCount = overdueCount + pendingSubmissions.length + unreadNotifs.length;

  const [notifPerm, setNotifPerm] = React.useState<NotificationPermission>(() =>
    getNotificationPermission()
  );
  const [testingVibration, setTestingVibration] = React.useState(false);

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setBikeMenuOpen(false);
      }
      if (bellContainerRef.current && !bellContainerRef.current.contains(event.target as Node)) {
        setBellOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleRequestPermission = async () => {
    const perm = await requestNotificationPermission();
    setNotifPerm(perm);
  };

  const handleTestAlert = async () => {
    setTestingVibration(true);
    await testOverdueAlert();
    setTimeout(() => setTestingVibration(false), 1600);
  };

  return (
    <header className="sticky top-0 z-40 bg-white border-b border-slate-100 shadow-sm">
      <div className="max-w-2xl lg:max-w-4xl mx-auto px-3 sm:px-6">
        <div className="flex items-center justify-between min-h-[60px] sm:h-16 py-1.5 sm:py-0 gap-1.5 sm:gap-3">
          {/* Logo & App Name - Clicking returns to Welcome Homepage */}
          <button
            type="button"
            onClick={() => {
              sounds.playClick();
              if (onGoToHome) onGoToHome();
              else onTabChange('garage');
            }}
            className="flex items-center gap-2 sm:gap-2.5 text-left group shrink-0 min-w-0"
            title="Go to Home / Welcome"
          >
            {/* Official MotoCare Logo Image */}
            <img
              src="/logo.png"
              alt="MotoCare Official Logo"
              className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl sm:rounded-2xl object-contain shadow-md shadow-slate-900/10 shrink-0 border border-slate-100 bg-[#0B0F19]"
            />

            <div className="min-w-0">
              <div className="flex items-center gap-1 leading-none">
                <span className="text-lg sm:text-xl font-extrabold tracking-tight text-slate-900 group-hover:text-black">
                  Moto<span className="text-[#F95A00]">Care</span>
                </span>
              </div>
              <div className="text-[8px] sm:text-[9.5px] font-bold text-slate-400 tracking-wider uppercase mt-0.5 truncate max-w-[130px] sm:max-w-none">
                MAINTENANCE • REMINDERS • MORE
              </div>
            </div>
          </button>

          {/* Right Header Controls */}
          <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
            {/* In-App PWA Install Button (Android & iOS) */}
            <PWAInstallButton variant="header" />

            {/* Admin Portal Header Shortcut with Pending Payment Badge */}
            <button
              type="button"
              onClick={() => {
                sounds.playClick();
                onTabChange(activeTab === 'admin' ? 'garage' : 'admin');
              }}
              className={`px-2 py-1 sm:px-2.5 sm:py-1 rounded-xl text-[10px] sm:text-xs font-bold transition-all flex items-center gap-1 shadow-2xs ${
                activeTab === 'admin'
                  ? 'bg-slate-900 text-amber-300 ring-2 ring-slate-900'
                  : 'bg-white hover:bg-slate-100 border border-slate-200 text-slate-700'
              }`}
              title="Open Admin Dashboard to verify payments & manage auto-km"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
              <span className="hidden xs:inline">Admin</span>
              {pendingSubmissions.length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-amber-500 text-white text-[9px] font-black animate-pulse">
                  {pendingSubmissions.length}
                </span>
              )}
            </button>

            {/* Demo Toggle Switch (Evaluation helper) */}
            <button
              type="button"
              onClick={onToggleDemoTier}
              className="px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-200 text-[9px] sm:text-[10px] font-medium text-slate-600 transition-all flex items-center gap-1 shrink-0"
              title="Click to toggle between Free and Pro tiers"
            >
              <span className="hidden xs:inline text-slate-400">Tier:</span>
              <span className={`font-bold ${isPro ? 'text-[#F95A00]' : 'text-slate-600'}`}>
                {isPro ? 'PRO' : 'FREE'}
              </span>
            </button>

            {/* Notification Bell with Full Actions Center */}
            <div className="relative shrink-0" ref={bellContainerRef}>
              <button
                type="button"
                onClick={() => setBellOpen(!bellOpen)}
                className="p-1.5 sm:p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors relative"
                title="Notifications & Actions Center"
              >
                <Bell className="w-4 h-4 sm:w-5 sm:h-5" />
                {totalActionCount > 0 && (
                  <span className="absolute top-1 sm:top-1.5 right-1 sm:right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-black flex items-center justify-center ring-2 ring-white animate-pulse">
                    {totalActionCount}
                  </span>
                )}
              </button>

              {bellOpen && (
                <div className="absolute right-0 mt-2 w-84 sm:w-92 bg-white rounded-3xl shadow-2xl border border-slate-100 p-4 z-50 text-xs space-y-3 animate-in fade-in zoom-in-95 duration-100">
                  {/* Notification Center Header */}
                  <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                    <div className="flex items-center gap-1.5">
                      <Bell className="w-4 h-4 text-[#F95A00]" />
                      <span className="font-extrabold text-slate-900 text-sm">Actions & Notifications</span>
                    </div>

                    <div className="flex items-center gap-1">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                          totalActionCount > 0 ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'
                        }`}
                      >
                        {totalActionCount > 0 ? `${totalActionCount} Required` : 'All Done ✓'}
                      </span>
                      {notifications.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            sounds.playClick();
                            onClearNotifications();
                          }}
                          className="p-1 text-slate-400 hover:text-red-600 rounded transition-colors"
                          title="Clear all notification logs"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Filter Sub-Tabs */}
                  <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl text-[11px]">
                    <button
                      type="button"
                      onClick={() => setActiveNotifTab('actions')}
                      className={`flex-1 py-1 rounded-lg font-bold transition-all text-center ${
                        activeNotifTab === 'actions'
                          ? 'bg-white text-slate-900 shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Actions to Perform ({overdueCount + pendingSubmissions.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveNotifTab('logs')}
                      className={`flex-1 py-1 rounded-lg font-bold transition-all text-center ${
                        activeNotifTab === 'logs'
                          ? 'bg-white text-slate-900 shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Activity Log ({notifications.length})
                    </button>
                  </div>

                  {/* Push Notification & Vibration Controls Banner */}
                  <div className="p-2.5 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-slate-700 flex items-center gap-1">
                        <Vibrate className="w-3.5 h-3.5 text-blue-600" />
                        <span>Push Alerts & Phone Vibration</span>
                      </span>
                      <span
                        className={`text-[9.5px] font-extrabold px-1.5 py-0.5 rounded ${
                          notifPerm === 'granted'
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-slate-200 text-slate-600'
                        }`}
                      >
                        {notifPerm === 'granted' ? 'ENABLED ✓' : 'STANDBY'}
                      </span>
                    </div>

                    <div className="flex gap-1.5 pt-0.5">
                      {notifPerm !== 'granted' && (
                        <button
                          type="button"
                          onClick={handleRequestPermission}
                          className="flex-1 py-1.5 px-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-[10px] rounded-xl transition-colors shadow-sm"
                        >
                          Enable Browser Alerts
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleTestAlert}
                        className={`flex-1 py-1.5 px-2 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 font-bold text-[10px] rounded-xl transition-colors shadow-2xs flex items-center justify-center gap-1 ${
                          testingVibration ? 'animate-bounce text-[#F95A00]' : ''
                        }`}
                      >
                        <Vibrate className="w-3 h-3 text-amber-500" />
                        <span>Test Phone Vibrate</span>
                      </button>
                    </div>
                  </div>

                  {/* Tab 1: Actions To Be Performed */}
                  {activeNotifTab === 'actions' && (
                    <div className="space-y-2 max-h-64 overflow-y-auto pr-0.5">
                      {/* 1. Pending Payments Needing Admin Approval */}
                      {pendingSubmissions.length > 0 && (
                        <div className="p-3 bg-amber-50/80 border border-amber-200 rounded-2xl space-y-1.5">
                          <div className="flex items-center justify-between text-[10px]">
                            <span className="font-extrabold text-amber-800 flex items-center gap-1">
                              <ShieldCheck className="w-3.5 h-3.5 text-amber-600" />
                              <span>ADMIN ACTION REQUIRED</span>
                            </span>
                            <span className="font-mono text-amber-700 font-bold">
                              {pendingSubmissions.length} Payment(s) Pending
                            </span>
                          </div>
                          <div className="font-bold text-slate-900 text-xs">
                            {pendingSubmissions[0].paymentMethod.toUpperCase()} ₱{pendingSubmissions[0].amountPhp} Ref #{pendingSubmissions[0].referenceNumber}
                          </div>
                          <p className="text-[10px] text-slate-600">
                            Confirm rider payment reference to approve Pro features.
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              setBellOpen(false);
                              onTabChange('admin');
                            }}
                            className="w-full py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-extrabold text-[11px] rounded-xl shadow-2xs flex items-center justify-center gap-1 transition-all"
                          >
                            <span>Open Admin Portal & Approve Pro →</span>
                          </button>
                        </div>
                      )}

                      {/* 2. Overdue Maintenance Tasks */}
                      {overdueReminders && overdueReminders.length > 0 ? (
                        overdueReminders.map((rem) => {
                          const overdueKm = (activeBike?.odometer || 0) - rem.nextDueOdo;
                          return (
                            <div
                              key={rem.id}
                              className="p-3 bg-red-50/80 border border-red-200 rounded-2xl text-left space-y-1.5"
                            >
                              <div className="flex items-center justify-between text-[10px]">
                                <span className="font-extrabold text-red-700 flex items-center gap-1">
                                  <AlertTriangle className="w-3.5 h-3.5" />
                                  <span>OVERDUE by {Math.abs(overdueKm).toLocaleString()} km</span>
                                </span>
                                <span className="text-slate-400 font-mono">
                                  Due: {rem.nextDueOdo.toLocaleString()} km
                                </span>
                              </div>
                              <div className="font-bold text-slate-900 text-xs">{rem.title}</div>
                              <p className="text-[10px] text-slate-600">
                                Current odo {activeBike?.odometer.toLocaleString()} km exceeds OEM service interval.
                              </p>
                              {onOpenServiceForReminder && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setBellOpen(false);
                                    onOpenServiceForReminder(rem);
                                  }}
                                  className="w-full py-1.5 bg-red-600 hover:bg-red-700 text-white font-extrabold text-[11px] rounded-xl shadow-2xs flex items-center justify-center gap-1 transition-all"
                                >
                                  <span>+ Mark as Serviced Now →</span>
                                </button>
                              )}
                            </div>
                          );
                        })
                      ) : null}

                      {/* Fallback if no overdue and no pending submissions */}
                      {overdueReminders.length === 0 && pendingSubmissions.length === 0 && (
                        <div className="py-6 text-center text-slate-500">
                          <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-1.5" />
                          <p className="font-bold text-xs text-slate-800">All actions are up to date!</p>
                          <p className="text-[10px] text-slate-400 mt-0.5">
                            Any pending payments or overdue maintenance will appear here with direct action buttons.
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Tab 2: Activity Logs & Events */}
                  {activeNotifTab === 'logs' && (
                    <div className="space-y-1.5 max-h-64 overflow-y-auto pr-0.5">
                      {notifications.length > 0 ? (
                        notifications.map((notif) => (
                          <div
                            key={notif.id}
                            className={`p-2.5 rounded-2xl border text-left space-y-1 transition-colors ${
                              notif.isRead
                                ? 'bg-slate-50 border-slate-100 text-slate-600'
                                : 'bg-white border-slate-200 text-slate-900 shadow-2xs'
                            }`}
                          >
                            <div className="flex items-center justify-between text-[10px]">
                              <span className="font-bold flex items-center gap-1">
                                {notif.type === 'auto_km_added' && (
                                  <Zap className="w-3 h-3 text-amber-500" />
                                )}
                                {notif.type.includes('payment') && (
                                  <CreditCard className="w-3 h-3 text-blue-500" />
                                )}
                                {notif.type.includes('maintenance') && (
                                  <AlertTriangle className="w-3 h-3 text-orange-500" />
                                )}
                                <span>{notif.title}</span>
                              </span>
                              <span className="text-slate-400 font-mono text-[9px]">
                                {new Date(notif.timestamp).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-600 leading-snug">{notif.message}</p>
                            {notif.actionLabel && (
                              <button
                                type="button"
                                onClick={() => {
                                  onMarkNotificationRead(notif.id);
                                  setBellOpen(false);
                                  if (notif.actionPayload?.tab) {
                                    onTabChange(notif.actionPayload.tab);
                                  }
                                }}
                                className="text-[10px] font-bold text-[#F95A00] hover:underline flex items-center gap-0.5 pt-0.5"
                              >
                                <span>{notif.actionLabel}</span>
                                <ArrowRight className="w-2.5 h-2.5" />
                              </button>
                            )}
                          </div>
                        ))
                      ) : (
                        <div className="py-6 text-center text-slate-400 text-xs">
                          No recent notification logs.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Upgrade & Motorcycle Nickname Container */}
            <div className="relative flex flex-col items-end shrink-0" ref={dropdownRef}>
              {/* UPGRADE / PRO Button */}
              {isPro ? (
                <div className="flex items-center gap-1 sm:gap-1.5">
                  <button
                    type="button"
                    onClick={onOpenPaywall}
                    className="px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-xl border border-amber-300 bg-amber-50/70 hover:bg-amber-100 text-amber-700 text-[11px] sm:text-xs font-bold flex items-center gap-1 transition-all shadow-sm"
                  >
                    <span className="text-amber-500">★</span>
                    <span>PRO</span>
                  </button>
                  {/* Profile / Bike Avatar Dot matching screenshot 6 */}
                  <div
                    className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-cyan-100 border border-cyan-300 text-cyan-700 flex items-center justify-center text-[10px] sm:text-xs font-bold shrink-0"
                    title="User Profile"
                  >
                    {activeBike?.nickname ? activeBike.nickname.charAt(0).toLowerCase() : 't'}
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={onOpenPaywall}
                  className="px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-xl border border-amber-300/80 bg-amber-50/50 hover:bg-amber-100/70 text-amber-700 text-[11px] sm:text-xs font-bold flex items-center gap-1 shadow-sm transition-all"
                >
                  <span className="text-amber-500">★</span>
                  <span className="tracking-wide">UPGRADE</span>
                </button>
              )}

              {/* Motorcycle Nickname directly below the UPGRADE button on mobile */}
              {activeBike && (
                <button
                  type="button"
                  onClick={() => setBikeMenuOpen(!bikeMenuOpen)}
                  className="sm:hidden flex items-center justify-end gap-1 mt-0.5 text-[11px] font-bold text-[#F95A00] hover:text-[#d44d00] active:scale-95 transition-all max-w-[110px] truncate text-right cursor-pointer"
                  title="Switch Motorcycle"
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: activeBike.customColorBadge || '#00C5FF' }}
                  />
                  <span className="truncate">
                    {activeBike.nickname ? `'${activeBike.nickname}'` : activeBike.model}
                  </span>
                  <ChevronDown className="w-2.5 h-2.5 text-slate-400 shrink-0" />
                </button>
              )}

              {/* Shared Garage Switcher Dropdown (for mobile & desktop) */}
              {bikeMenuOpen && (
                <div className="absolute right-0 top-full mt-2 w-64 bg-white border border-slate-100 rounded-2xl shadow-xl py-2 z-50 animate-in fade-in zoom-in-95 duration-100">
                  <div className="px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-100 flex items-center justify-between">
                    <span>Garage Bikes ({motorcycles.length})</span>
                    {!isPro && <span className="text-[#F95A00]">Free (1 bike)</span>}
                  </div>

                  <div className="max-h-60 overflow-y-auto py-1">
                    {motorcycles.map((bike) => (
                      <button
                        key={bike.id}
                        onClick={() => {
                          onSelectBike(bike.id);
                          setBikeMenuOpen(false);
                        }}
                        className={`w-full text-left px-3.5 py-2 text-xs flex items-center justify-between transition-colors ${
                          activeBike?.id === bike.id
                            ? 'bg-orange-50 text-[#F95A00] font-bold'
                            : 'text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <div className="truncate pr-2">
                          <div className="font-bold truncate flex items-center gap-1.5">
                            <span
                              className="w-2 h-2 rounded-full inline-block shrink-0"
                              style={{ backgroundColor: bike.customColorBadge || '#00C5FF' }}
                            />
                            {bike.nickname ? `"${bike.nickname}"` : `${bike.brand} ${bike.model}`}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            {bike.year} {bike.brand} {bike.model} · {bike.odometer.toLocaleString()} km
                          </div>
                        </div>
                        {activeBike?.id === bike.id && <Check className="w-4 h-4 text-[#F95A00] shrink-0" />}
                      </button>
                    ))}
                  </div>

                  <div className="border-t border-slate-100 mt-1 pt-1.5 px-2">
                    <button
                      onClick={() => {
                        setBikeMenuOpen(false);
                        onOpenAddBike();
                      }}
                      className="w-full text-left px-3 py-2 text-xs text-[#F95A00] hover:bg-orange-50 rounded-xl flex items-center gap-1.5 font-bold transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add Motorcycle to Garage
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Desktop-only Garage Switcher Pill */}
            <div className="hidden sm:block">
              <button
                type="button"
                onClick={() => setBikeMenuOpen(!bikeMenuOpen)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-medium border border-slate-200"
                title="Switch Motorcycle"
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: activeBike?.customColorBadge || '#00C5FF' }}
                />
                <span className="max-w-[110px] truncate font-bold text-slate-800">
                  {activeBike?.nickname ? `'${activeBike.nickname}'` : activeBike?.model || 'My Bike'}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};
