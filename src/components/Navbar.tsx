import React from 'react';
import { ActiveTab, Motorcycle, UserSubscription } from '../types';
import { Bell, ChevronDown, Plus, Sparkles, Check, Vibrate, AlertTriangle } from 'lucide-react';
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
  onToggleDemoTier: () => void;
  onSelectBike: (bikeId: string) => void;
  onOpenAddBike: () => void;
  onOpenAddService: () => void;
  onOpenPaywall: () => void;
  onOpenCasaBooklet?: () => void;
  onGoToHome?: () => void;
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
  onToggleDemoTier,
  onSelectBike,
  onOpenAddBike,
  onOpenAddService,
  onOpenPaywall,
  onGoToHome,
  overdueCount,
  overdueReminders = [],
  onOpenServiceForReminder,
}) => {
  const [bikeMenuOpen, setBikeMenuOpen] = React.useState(false);
  const [bellOpen, setBellOpen] = React.useState(false);
  const dropdownRef = React.useRef<HTMLDivElement>(null);
  const bellContainerRef = React.useRef<HTMLDivElement>(null);
  const isPro = subscription.tier === 'pro';

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
                  Moto<span className="text-[#FF6B00]">Care</span>
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

            {/* Demo Toggle Switch (Evaluation helper) */}
            <button
              type="button"
              onClick={onToggleDemoTier}
              className="px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-200 text-[9px] sm:text-[10px] font-medium text-slate-600 transition-all flex items-center gap-1 shrink-0"
              title="Click to toggle between Free and Pro tiers"
            >
              <span className="hidden xs:inline text-slate-400">Tier:</span>
              <span className={`font-bold ${isPro ? 'text-[#FF6B00]' : 'text-slate-600'}`}>
                {isPro ? 'PRO' : 'FREE'}
              </span>
            </button>

            {/* Notification Bell */}
            <div className="relative shrink-0" ref={bellContainerRef}>
              <button
                type="button"
                onClick={() => setBellOpen(!bellOpen)}
                className="p-1.5 sm:p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors relative"
                title="Notifications"
              >
                <Bell className="w-4 h-4 sm:w-5 sm:h-5" />
                {overdueCount > 0 && (
                  <span className="absolute top-1 sm:top-1.5 right-1 sm:right-1.5 w-2 h-2 rounded-full bg-red-500 ring-2 ring-white animate-pulse" />
                )}
              </button>

              {bellOpen && (
                <div className="absolute right-0 mt-2 w-80 bg-white rounded-3xl shadow-2xl border border-slate-100 p-4 z-50 text-xs space-y-3 animate-in fade-in zoom-in-95 duration-100">
                  <div className="font-extrabold text-slate-900 pb-2 border-b border-slate-100 flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <Bell className="w-4 h-4 text-[#FF6B00]" />
                      <span>Maintenance Alerts</span>
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                      overdueCount > 0 ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'
                    }`}>
                      {overdueCount} Overdue
                    </span>
                  </div>

                  {/* Push Notification & Vibration Controls */}
                  <div className="p-2.5 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-slate-700 flex items-center gap-1">
                        <Vibrate className="w-3.5 h-3.5 text-blue-600" />
                        <span>Phone Push & Vibration</span>
                      </span>
                      <span className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded ${
                        notifPerm === 'granted' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'
                      }`}>
                        {notifPerm === 'granted' ? 'ACTIVE ✓' : 'STANDBY'}
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
                          testingVibration ? 'animate-bounce text-[#FF6B00]' : ''
                        }`}
                      >
                        <Vibrate className="w-3 h-3 text-amber-500" />
                        <span>Test Phone Vibrate</span>
                      </button>
                    </div>
                  </div>

                  {/* Overdue Task List */}
                  <div className="space-y-1.5 max-h-56 overflow-y-auto">
                    {overdueReminders && overdueReminders.length > 0 ? (
                      overdueReminders.map((rem) => {
                        const overdueKm = (activeBike?.odometer || 0) - rem.nextDueOdo;
                        return (
                          <div
                            key={rem.id}
                            className="p-2.5 bg-red-50/70 border border-red-200 rounded-2xl text-left space-y-1"
                          >
                            <div className="flex items-center justify-between text-[10px]">
                              <span className="font-extrabold text-red-700 flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3" />
                                <span>OVERDUE by {Math.abs(overdueKm).toLocaleString()} km</span>
                              </span>
                              <span className="text-slate-400 font-mono">Due: {rem.nextDueOdo.toLocaleString()} km</span>
                            </div>
                            <div className="font-bold text-slate-800 text-xs truncate">{rem.title}</div>
                            {onOpenServiceForReminder && (
                              <button
                                type="button"
                                onClick={() => {
                                  setBellOpen(false);
                                  onOpenServiceForReminder(rem);
                                }}
                                className="text-[10px] font-bold text-[#FF6B00] hover:underline block pt-0.5"
                              >
                                + Mark as Serviced Now →
                              </button>
                            )}
                          </div>
                        );
                      })
                    ) : (
                      <div className="py-3 text-center text-slate-500">
                        <Check className="w-6 h-6 text-emerald-500 mx-auto mb-1" />
                        <p className="font-medium text-xs">All PMS intervals are up to date!</p>
                        <p className="text-[10px] text-slate-400">Alerts will trigger when odometer passes service km.</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Upgrade & Motorcycle Nickname Container - Explicitly anchored stack */}
            <div className="relative flex flex-col items-end justify-center shrink-0 min-w-0" ref={dropdownRef}>
              {/* UPGRADE / PRO Button */}
              {isPro ? (
                <div className="flex items-center gap-1 sm:gap-1.5">
                  <button
                    type="button"
                    onClick={onOpenPaywall}
                    className="px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-lg sm:rounded-xl border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-800 text-[10px] sm:text-xs font-extrabold flex items-center gap-1 transition-all shadow-2xs leading-none shrink-0"
                    title="MotoCare Pro Active - Tap to view subscription"
                  >
                    <span className="text-amber-500 text-[11px]">★</span>
                    <span className="tracking-wide">PRO</span>
                  </button>
                  {/* Profile / Bike Avatar Dot matching screenshot 6 */}
                  <div
                    className="w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-cyan-100 border border-cyan-300 text-cyan-800 flex items-center justify-center text-[10px] sm:text-xs font-black shrink-0"
                    title="User Profile"
                  >
                    {activeBike?.nickname ? activeBike.nickname.charAt(0).toLowerCase() : 't'}
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={onOpenPaywall}
                  className="px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-lg sm:rounded-xl border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-800 text-[10px] sm:text-xs font-extrabold flex items-center gap-1 shadow-2xs transition-all leading-none shrink-0"
                  title="Upgrade to MotoCare Pro"
                >
                  <span className="text-amber-500 text-[11px]">★</span>
                  <span className="tracking-wider">UPGRADE</span>
                </button>
              )}

              {/* Motorcycle Nickname explicitly anchored directly below the UPGRADE / PRO button on mobile */}
              {activeBike && (
                <button
                  type="button"
                  onClick={() => setBikeMenuOpen(!bikeMenuOpen)}
                  className="sm:hidden mt-1 px-1.5 py-0.5 rounded-md bg-orange-50/90 hover:bg-orange-100 border border-orange-200/90 text-[10px] font-bold text-[#FF6B00] hover:text-[#d44d00] transition-all flex items-center gap-1 max-w-[96px] xs:max-w-[120px] truncate shadow-2xs cursor-pointer active:scale-95 leading-none shrink-0"
                  title="Switch Active Motorcycle"
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: activeBike.customColorBadge || '#00C5FF' }}
                  />
                  <span className="truncate font-bold tracking-tight">
                    {activeBike.nickname ? `'${activeBike.nickname}'` : activeBike.model}
                  </span>
                  <ChevronDown className="w-2.5 h-2.5 text-orange-400 shrink-0" />
                </button>
              )}

              {/* Shared Garage Switcher Dropdown (for mobile & desktop) */}
              {bikeMenuOpen && (
                <div className="absolute right-0 top-full mt-2 w-64 bg-white border border-slate-100 rounded-2xl shadow-xl py-2 z-50 animate-in fade-in zoom-in-95 duration-100">
                  <div className="px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-100 flex items-center justify-between">
                    <span>Garage Bikes ({motorcycles.length})</span>
                    {!isPro && <span className="text-[#FF6B00]">Free (1 bike)</span>}
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
                            ? 'bg-orange-50 text-[#FF6B00] font-bold'
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
                        {activeBike?.id === bike.id && <Check className="w-4 h-4 text-[#FF6B00] shrink-0" />}
                      </button>
                    ))}
                  </div>

                  <div className="border-t border-slate-100 mt-1 pt-1.5 px-2">
                    <button
                      onClick={() => {
                        setBikeMenuOpen(false);
                        onOpenAddBike();
                      }}
                      className="w-full text-left px-3 py-2 text-xs text-[#FF6B00] hover:bg-orange-50 rounded-xl flex items-center gap-1.5 font-bold transition-colors"
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
