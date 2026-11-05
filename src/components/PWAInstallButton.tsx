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

  // Variant: Banner (shown on Welcome or Top of page when installable)
  return (
    <div className="p-3 bg-gradient-to-r from-orange-50 to-amber-50 border border-orange-200/80 rounded-2xl shadow-sm flex items-center justify-between gap-3 text-xs">
      <div className="flex items-center gap-2.5 min-w-0">
        <img src="/logo.png" alt="MotoCare" className="w-8 h-8 rounded-xl object-contain shadow-sm shrink-0" />
        <div className="min-w-0">
          <div className="font-bold text-slate-800 truncate flex items-center gap-1.5">
            Install MotoCare App
            <span className="px-1.5 py-0.2 rounded bg-[#FF6B00] text-white text-[9px] uppercase font-bold">PWA</span>
          </div>
          <div className="text-[11px] text-slate-500 truncate">Fast offline access for Android & iOS riders</div>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {isInstallable ? (
          <button
            type="button"
            onClick={install}
            className="px-3 py-1.5 rounded-xl bg-[#FF6B00] hover:bg-[#e05000] text-white font-bold text-xs shadow-sm flex items-center gap-1 transition-all"
          >
            <Download className="w-3.5 h-3.5" />
            Install
          </button>
        ) : isIOS ? (
          <button
            type="button"
            onClick={() => setShowIOSGuide(true)}
            className="px-3 py-1.5 rounded-xl bg-[#FF6B00] hover:bg-[#e05000] text-white font-bold text-xs shadow-sm flex items-center gap-1 transition-all"
          >
            <Smartphone className="w-3.5 h-3.5" />
            Install
          </button>
        ) : null}

        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
          title="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {showIOSGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <img src="/logo.png" alt="MotoCare Logo" className="w-8 h-8 rounded-xl object-contain shadow-sm" />
                <div>
                  <h3 className="text-base font-extrabold text-slate-900 leading-tight">Install on iOS</h3>
                  <p className="text-[11px] text-slate-400 font-medium">Add to your iPhone / iPad Home Screen</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
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
                    In Safari bottom toolbar, tap the <strong>Share</strong> icon.
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
                    Scroll down and choose <strong>Add to Home Screen</strong>.
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
