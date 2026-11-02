import React from 'react';
import { Bike, Wrench, ShieldCheck, Plus } from 'lucide-react';
import { sounds } from '../utils/audio';
import { PWAInstallButton } from './PWAInstallButton';

interface OnboardingViewProps {
  onAddMotorcycle: () => void;
  onQuickLoadSample: () => void;
}

export const OnboardingView: React.FC<OnboardingViewProps> = ({
  onAddMotorcycle,
  onQuickLoadSample,
}) => {
  return (
    <div className="w-full max-w-md mx-auto bg-white rounded-3xl shadow-xl border border-slate-100 overflow-hidden my-4 pb-8 space-y-6 animate-in fade-in duration-200">
      {/* Coastal Mountain Winding Road Banner matching screenshot 1 */}
      <div className="relative h-56 sm:h-64 overflow-hidden bg-slate-900">
        <img
          src="https://images.unsplash.com/photo-1558981403-c5f9899a28bc?auto=format&fit=crop&w=1200&q=80"
          alt="Philippine Motorcycle Coastal Road"
          className="w-full h-full object-cover object-center transform hover:scale-105 transition-transform duration-700"
        />
        {/* Soft bottom gradient fade matching screenshot 1 */}
        <div className="absolute inset-0 bg-gradient-to-t from-white via-white/30 to-transparent" />
      </div>

      <div className="px-6 space-y-6 -mt-12 relative z-10 text-center">
        {/* Official MotoCare Logo Image */}
        <div className="w-16 h-16 rounded-3xl bg-[#0B0F19] p-1 flex items-center justify-center mx-auto shadow-xl shadow-slate-900/15 border-2 border-white">
          <img
            src="/logo.png"
            alt="MotoCare Official Logo"
            className="w-full h-full object-contain rounded-2xl"
          />
        </div>

        {/* Title & Subtitle */}
        <div className="space-y-1">
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
            Moto<span className="text-[#F95A00]">Care</span>
          </h1>
          <div className="text-[10px] font-bold text-slate-400 tracking-widest uppercase">
            MAINTENANCE • REMINDERS • MORE
          </div>
          <p className="text-xs text-slate-500 leading-relaxed max-w-xs mx-auto pt-2">
            Designed specifically for Philippine motorcycle riders. Track routine maintenance for scooters (CVT & gear oil), underbones, commuters, and big bikes.
          </p>
        </div>

        {/* 3 Feature Bullets matching screenshot 1 */}
        <div className="text-left space-y-4 pt-2">
          {/* Feature 1 */}
          <div className="flex items-start gap-3.5">
            <div className="p-2 rounded-xl bg-orange-50 text-[#F95A00] shrink-0 mt-0.5">
              <Bike className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs font-bold text-slate-800">Philippine Bike Presets</div>
              <div className="text-[11px] text-slate-500 leading-normal">
                NMAX, Click, Aerox, Raider, PCX, Barako, Dominar 400 & more
              </div>
            </div>
          </div>

          {/* Feature 2 */}
          <div className="flex items-start gap-3.5">
            <div className="p-2 rounded-xl bg-orange-50 text-[#F95A00] shrink-0 mt-0.5">
              <Wrench className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs font-bold text-slate-800">CVT & Transmission Care</div>
              <div className="text-[11px] text-slate-500 leading-normal">
                Langis at Gear Oil, Flyballs, V-Belt, and Chain Slack intervals
              </div>
            </div>
          </div>

          {/* Feature 3 */}
          <div className="flex items-start gap-3.5">
            <div className="p-2 rounded-xl bg-orange-50 text-[#F95A00] shrink-0 mt-0.5">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs font-bold text-slate-800">LTO Registration Tracker</div>
              <div className="text-[11px] text-slate-500 leading-normal">
                Plate ending digit renewal month reminders
              </div>
            </div>
          </div>
        </div>

        {/* In-App PWA Installation Banner for Android & iOS */}
        <div className="pt-2">
          <PWAInstallButton variant="banner" />
        </div>

        {/* Buttons */}
        <div className="space-y-3 pt-2">
          <button
            type="button"
            onClick={() => {
              sounds.playClick();
              onAddMotorcycle();
            }}
            className="w-full py-3.5 bg-[#F95A00] hover:bg-[#EA580C] text-white rounded-2xl font-bold text-sm shadow-lg shadow-[#F95A00]/25 transition-all flex items-center justify-center gap-1.5 active:scale-98"
          >
            <Plus className="w-4 h-4 stroke-[3]" />
            <span>Add Your Motorcycle</span>
          </button>

          <button
            type="button"
            onClick={() => {
              sounds.playSuccess();
              onQuickLoadSample();
            }}
            className="text-xs font-bold text-[#00ACC1] hover:underline"
          >
            Quick Load Sample: Yamaha NMAX 155
          </button>
        </div>
      </div>
    </div>
  );
};
