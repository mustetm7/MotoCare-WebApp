import React, { useState } from 'react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { Download, Share, PlusSquare, X, Smartphone, CheckCircle2 } from 'lucide-react';

export const PWAInstallButton: React.FC<{ variant?: 'header' | 'banner' | 'card' }> = ({ variant = 'header' }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // If already installed, hide prompt
  if (isInstalled || dismissed) {
    return null;
  }

  // Variant: Header Pill
  if (variant === 'header') {
    if (isInstallable) {
      return (
        <button
          type="button"
          onClick={install}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-orange-50 border border-orange-200 text-[#FF6B00] text-xs font-bold hover:bg-orange-100 transition-all shadow-sm shrink-0"
          title="Install MotoCare App on your device"
        >
          <Download className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Install App</span>
          <span className="sm:hidden">Install</span>
        </button>
      );
    }

    if (isIOS) {
      return (
        <>
          <button
            type="button"
            onClick={() => setShowIOSGuide(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-100 border border-slate-200 text-slate-700 text-xs font-bold hover:bg-slate-200 transition-all shadow-sm shrink-0"
            title="Install on iPhone / iPad"
          >
            <Smartphone className="w-3.5 h-3.5 text-[#FF6B00]" />
            <span className="hidden sm:inline">Add to Home</span>
            <span className="sm:hidden">iOS App</span>
          </button>

          {showIOSGuide && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150">
              <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl border border-slate-100 space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <img src="/logo.png" alt="MotoCare Logo" className="w-8 h-8 rounded-xl object-contain shadow-sm" />
                    <div>
                      <h3 className="text-base font-extrabold text-slate-900 leading-tight">Install MotoCare on iOS</h3>
                      <p className="text-[11px] text-slate-400 font-medium">Add to your iPhone / iPad Home Screen</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowIOSGuide(false)}
                    title="Close install guide"
                    aria-label="Close install guide"
                    className="p-1 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="space-y-3 text-xs text-slate-600">
                  <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-2xl border border-slate-100">
                    <div className="p-2 bg-blue-50 text-blue-600 rounded-xl shrink-0">
                      <Share className="w-5 h-5" />
                    </div>
                    <div>
                      <span className="font-bold text-slate-800">1. Tap the Share button</span>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        In Safari bottom toolbar (or top right on iPad), tap the Share icon.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-2xl border border-slate-100">
                    <div className="p-2 bg-orange-50 text-[#FF6B00] rounded-xl shrink-0">
                      <PlusSquare className="w-5 h-5" />
                    </div>
                    <div>
                      <span className="font-bold text-slate-800">2. Tap "Add to Home Screen"</span>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Scroll down the menu list and select <strong>Add to Home Screen</strong>.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 p-3 bg-emerald-50 rounded-2xl border border-emerald-100">
                    <div className="p-2 bg-emerald-100 text-emerald-700 rounded-xl shrink-0">
                      <CheckCircle2 className="w-5 h-5" />
                    </div>
                    <div>
                      <span className="font-bold text-emerald-900">3. Launch as Native App</span>
                      <p className="text-[11px] text-emerald-700 mt-0.5">
                        Enjoy full-screen standalone motorcycle garage tracking without browser borders!
                      </p>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="w-full py-2.5 rounded-xl bg-[#FF6B00] hover:bg-[#e05000] text-white text-xs font-bold transition-colors shadow-md shadow-orange-500/20"
                >
                  Got It, Thanks!
                </button>
              </div>
            </div>
          )}
        </>
      );
    }

    return null;
  }

  // Variant: Banner (shown on Welcome or Top of page)
  return (
    <div className="p-3.5 bg-gradient-to-r from-[#FFF9F0] to-[#FFF3E2] border border-[#F5D0A9] rounded-2xl shadow-sm flex items-center justify-between gap-2.5 text-xs text-left">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-11 h-11 rounded-xl bg-white border border-orange-100 shadow-sm flex items-center justify-center p-1 shrink-0">
          <img
            src="/logo.png"
            alt="MotoCare"
            referrerPolicy="no-referrer"
            className="w-full h-full rounded-lg object-contain"
          />
        </div>
        <div className="min-w-0">
          <div className="font-extrabold text-[#0B132B] text-[14px] tracking-tight truncate flex items-center gap-1.5">
            <span>Install MotoCare App</span>
            <span className="px-2 py-0.5 rounded-md bg-[#FF6B00] text-white text-[10px] uppercase font-extrabold tracking-wide shrink-0">
              PWA
            </span>
          </div>
          <div className="text-xs text-slate-500 truncate mt-0.5">
            Fast offline access for Android &amp; iOS riders
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={isInstallable ? install : () => setShowIOSGuide(true)}
          className="px-4 py-2 rounded-full bg-gradient-to-b from-[#FF7A00] to-[#EA580C] hover:from-[#FF6B00] hover:to-[#D9460F] text-white font-bold text-xs shadow-sm shadow-[#FF6B00]/25 flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer whitespace-nowrap shrink-0"
        >
          <Download className="w-3.5 h-3.5 stroke-[2.5]" />
          <span>Install</span>
        </button>

        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="p-1.5 text-slate-500 hover:text-slate-700 rounded-lg transition-colors cursor-pointer"
          title="Dismiss install banner"
          aria-label="Dismiss install banner"
        >
          <X className="w-4 h-4 stroke-[2.2]" />
        </button>
      </div>

      {showIOSGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <img
                  src="/logo.png"
                  alt="MotoCare Logo"
                  referrerPolicy="no-referrer"
                  className="w-8 h-8 rounded-xl object-contain shadow-sm"
                />
                <div>
                  <h3 className="text-base font-extrabold text-slate-900 leading-tight">
                    Install MotoCare App
                  </h3>
                  <p className="text-[11px] text-slate-400 font-medium">
                    Add to your phone&apos;s Home Screen
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                title="Close install guide"
                aria-label="Close install guide"
                className="p-1 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-600">
              <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-2xl border border-slate-100">
                <div className="p-2 bg-blue-50 text-blue-600 rounded-xl shrink-0">
                  <Share className="w-5 h-5" />
                </div>
                <div>
                  <span className="font-bold text-slate-800">
                    1. Open Browser Menu or Share
                  </span>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Tap the browser menu in Chrome/Android or the <strong>Share</strong> icon in Safari.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-2xl border border-slate-100">
                <div className="p-2 bg-orange-50 text-[#FF6B00] rounded-xl shrink-0">
                  <PlusSquare className="w-5 h-5" />
                </div>
                <div>
                  <span className="font-bold text-slate-800">
                    2. Tap &quot;Install App&quot; or &quot;Add to Home Screen&quot;
                  </span>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Confirm to install MotoCare for instant offline garage access.
                  </p>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowIOSGuide(false)}
              className="w-full py-2.5 rounded-xl bg-[#FF6B00] hover:bg-[#e05000] text-white text-xs font-bold transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
