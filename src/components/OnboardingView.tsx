import React from 'react';
import { Bike, Wrench, ShieldCheck, ChevronRight } from 'lucide-react';
import { sounds } from '../utils/audio';
import { PWAInstallButton } from './PWAInstallButton';

interface OnboardingViewProps {
  onAddMotorcycle: () => void;
  onAddCustomMotorcycle?: () => void;
  onStartOnboarding?: () => void;
  isAuthenticated?: boolean;
  userName?: string | null;
  onQuickLoadSample?: () => void;
}

export const OnboardingView: React.FC<OnboardingViewProps> = ({
  onAddMotorcycle,
  onAddCustomMotorcycle,
  onStartOnboarding,
  isAuthenticated = false,
}) => {
  return (
    <div className="w-full max-w-md mx-auto bg-white rounded-3xl shadow-xl border border-slate-100 overflow-hidden my-3 pb-7 animate-in fade-in duration-200">
      {/* Rider Hero Banner with Integrated MotoCare Crest */}
      <div className="relative w-full aspect-[956/500] overflow-hidden bg-slate-100">
        <img
          src="/assets/aistudio/MotoCare_Motorcycle_Welcome_Screen_630e7edc.png"
          alt="MotoCare Philippine Motorcycle Rider Welcome"
          referrerPolicy="no-referrer"
          className="w-full h-auto block select-none pointer-events-none"
        />
        <div className="absolute inset-x-0 bottom-0 h-4 bg-gradient-to-t from-white to-transparent pointer-events-none" />
      </div>

      <div className="px-6 space-y-5 relative z-10 text-center pt-1">
        {isAuthenticated ? (
          /* Post-Authentication First-Time Rider Motorcycle Registration Prompt */
          <div className="space-y-2 pt-1" data-testid="post-auth-register-bike-prompt">
            <div className="text-[11px] font-extrabold text-[#FF6B00] tracking-[0.16em] uppercase">
              ACCOUNT VERIFIED • STEP 2 OF 2
            </div>
            <h1 className="text-2xl sm:text-3xl font-black text-[#0B132B] tracking-tight leading-tight">
              Let&apos;s Register Your Motorcycle
            </h1>
            <p className="text-[13.5px] font-medium text-[#1E293B] leading-relaxed max-w-[340px] mx-auto pt-1">
              Add your motorcycle to start tracking maintenance and important reminders.
            </p>
          </div>
        ) : (
          /* Unauthenticated Welcome Title & Subtitle */
          <div className="space-y-1.5">
            <h1 className="text-4xl font-black text-[#0B132B] tracking-tight leading-none">
              Moto<span className="text-[#FF6B00]">Care</span>
            </h1>
            <div className="text-[11px] font-extrabold text-[#3B4E6B] tracking-[0.18em] uppercase pt-1">
              MAINTENANCE • REMINDERS • MORE
            </div>
            <p className="text-[13.5px] font-medium text-[#1E293B] leading-relaxed max-w-[340px] mx-auto pt-1.5">
              Designed specifically for Philippine motorcycle riders. Track routine maintenance for scooters (CVT &amp; gear oil), underbones, commuters, and big bikes.
            </p>
          </div>
        )}

        {/* 3 Feature Bullets */}
        <div className="text-left space-y-4 pt-1">
          <div className="flex items-start gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-[#FFF3E6] text-[#FF6B00] flex items-center justify-center shrink-0 mt-0.5">
              <Bike className="w-5 h-5 stroke-[2.2]" />
            </div>
            <div>
              <div className="text-[15px] font-extrabold text-[#0B132B] leading-snug">
                Philippine Bike Presets
              </div>
              <div className="text-[13px] text-[#3B4E6B] leading-snug">
                NMAX, Click, Aerox, Raider, PCX, Barako, Dominar 400 &amp; more
              </div>
            </div>
          </div>

          <div className="flex items-start gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-[#FFF3E6] text-[#FF6B00] flex items-center justify-center shrink-0 mt-0.5">
              <Wrench className="w-5 h-5 stroke-[2.2]" />
            </div>
            <div>
              <div className="text-[15px] font-extrabold text-[#0B132B] leading-snug">
                CVT &amp; Transmission Care
              </div>
              <div className="text-[13px] text-[#3B4E6B] leading-snug">
                Langis at Gear Oil, Flyballs, V-Belt, and Chain Slack intervals
              </div>
            </div>
          </div>

          <div className="flex items-start gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-[#FFF3E6] text-[#FF6B00] flex items-center justify-center shrink-0 mt-0.5">
              <ShieldCheck className="w-5 h-5 stroke-[2.2]" />
            </div>
            <div>
              <div className="text-[15px] font-extrabold text-[#0B132B] leading-snug">
                LTO Registration Tracker
              </div>
              <div className="text-[13px] text-[#3B4E6B] leading-snug">
                Plate ending digit renewal month reminders
              </div>
            </div>
          </div>
        </div>

        {/* In-App PWA Installation Banner for Android & iOS */}
        <div className="pt-1">
          <PWAInstallButton variant="banner" />
        </div>

        {/* Primary CTA Button & Tagline */}
        <div className="space-y-3 pt-1">
          {isAuthenticated ? (
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => {
                  sounds.playClick();
                  onAddMotorcycle();
                }}
                className="w-full py-3.5 px-6 bg-gradient-to-b from-[#FF8A00] via-[#FF6B00] to-[#F05000] hover:from-[#FF7A00] hover:to-[#E04400] text-white rounded-2xl font-extrabold shadow-lg shadow-[#FF6B00]/30 transition-all flex items-center justify-between active:scale-98 cursor-pointer"
              >
                <span className="w-6" aria-hidden="true" />
                <span className="flex items-center justify-center gap-2.5">
                  <span className="text-xl sm:text-2xl font-extrabold tracking-wide">
                    Irehistro ang Motor Ko
                  </span>
                  <span className="sr-only">Add Your Motorcycle</span>
                </span>
                <ChevronRight className="w-6 h-6 stroke-[2.5] text-white/95 shrink-0" />
              </button>

              <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2">
                <p className="text-xs font-bold text-slate-600">
                  Wala sa listahan ang motor mo? Idagdag ito manually.
                </p>
                <button
                  type="button"
                  data-testid="onboarding-add-custom-bike-btn"
                  onClick={() => {
                    sounds.playClick();
                    if (onAddCustomMotorcycle) {
                      onAddCustomMotorcycle();
                    } else {
                      onAddMotorcycle();
                    }
                  }}
                  className="w-full py-2.5 px-4 bg-white hover:bg-orange-50 text-[#FF6B00] border-2 border-[#FF6B00] rounded-xl font-extrabold text-xs transition-colors cursor-pointer shadow-2xs"
                >
                  + Add My Motorcycle Manually
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                sounds.playClick();
                if (onStartOnboarding) {
                  onStartOnboarding();
                } else {
                  onAddMotorcycle();
                }
              }}
              className="w-full py-3.5 px-6 bg-gradient-to-b from-[#FF8A00] via-[#FF6B00] to-[#F05000] hover:from-[#FF7A00] hover:to-[#E04400] text-white rounded-2xl font-extrabold shadow-lg shadow-[#FF6B00]/30 transition-all flex items-center justify-between active:scale-98 cursor-pointer"
            >
              <span className="w-6" aria-hidden="true" />
              <span className="flex items-center justify-center gap-2.5">
                <span className="text-2xl font-extrabold italic tracking-wide">
                  Simulan Na!
                </span>
                <span className="sr-only">Add Your Motorcycle</span>
              </span>
              <ChevronRight className="w-6 h-6 stroke-[2.5] text-white/95 shrink-0" />
            </button>
          )}

          <p className="text-[13px] font-bold italic text-[#2B4270] text-center">
            Alagaan ang motor mo. Bawat biyahe, mas panatag!
          </p>
        </div>
      </div>
    </div>
  );
};


