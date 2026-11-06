import React, { useState } from 'react';
import { UserSubscription, PaymentMethod } from '../types';
import {
  X,
  Zap,
  Bike,
  Headphones,
  FileText,
  Shield,
  QrCode,
  CheckCircle2,
  Sparkles,
  ArrowRight,
  Download,
} from 'lucide-react';
import { sounds } from '../utils/audio';
import { PaymentGateway } from './PaymentGateway';

interface PaywallModalProps {
  isOpen: boolean;
  onClose: () => void;
  subscription: UserSubscription;
  onSubmitReference: (
    paymentMethod: PaymentMethod,
    referenceNumber: string
  ) => void;
  onCancelSubscription: () => void;
  isAlreadyPending?: boolean;
  existingPendingRef?: string;
}

export const PaywallModal: React.FC<PaywallModalProps> = ({
  isOpen,
  onClose,
  subscription,
  onSubmitReference,
  onCancelSubscription,
  isAlreadyPending = false,
  existingPendingRef,
}) => {
  const [activeStep, setActiveStep] = useState<'details' | 'qr'>('details');
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const isPro = subscription.tier === 'pro';
  const planAmount = 49;
  const planLabel = '₱49 / month';

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm overflow-y-auto animate-in fade-in duration-150">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden my-auto max-h-[95vh] flex flex-col">
        {/* Top Header */}
        <div className="p-4 px-5 flex items-center justify-between border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="MotoCare Logo" className="w-6 h-6 rounded-lg object-contain" />
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl border border-amber-300 bg-amber-50/70 text-amber-700 font-bold text-xs">
              <span className="text-amber-500">★</span>
              <span className="tracking-wide">MOTOCARE PRO</span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-800 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-5">
          {isPro ? (
            <div className="space-y-4 text-center py-4">
              <div className="w-16 h-16 rounded-3xl bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto shadow-md">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <div>
                <h3 className="text-xl font-extrabold text-slate-900">MotoCare Pro is Active!</h3>
                <p className="text-xs text-slate-500 mt-1">
                  Enjoy unlimited garage bikes, zero-touch GPS trip odometer tracking, Casa PDF exports, and LTO reminders.
                </p>
              </div>

              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs space-y-1.5 text-left">
                <div className="flex justify-between">
                  <span className="text-slate-500">Subscription:</span>
                  <span className="font-bold text-slate-800">Monthly (₱49/mo)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Payment Channel:</span>
                  <span className="font-bold text-slate-800 uppercase">{subscription.paymentMethod || 'GCash'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Status:</span>
                  <span className="font-bold text-emerald-600">VIP Pro Member</span>
                </div>
              </div>

              <div className="pt-2 space-y-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full py-3 bg-[#FF6B00] hover:bg-[#ea5300] text-white font-bold text-xs rounded-2xl transition-all shadow-md shadow-orange-500/20 cursor-pointer"
                >
                  Return to Garage
                </button>

                {!showCancelConfirm ? (
                  <button
                    type="button"
                    onClick={() => setShowCancelConfirm(true)}
                    className="text-xs text-slate-400 hover:text-red-500 underline cursor-pointer"
                  >
                    Cancel Pro Subscription (Revert to Free)
                  </button>
                ) : (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-2xl text-center space-y-2 animate-in fade-in">
                    <p className="text-xs font-bold text-red-800">Revert back to Free tier?</p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setShowCancelConfirm(false)}
                        className="flex-1 py-1.5 text-xs font-bold text-slate-600 bg-white border border-slate-200 rounded-xl"
                      >
                        Keep Pro
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onCancelSubscription();
                          setShowCancelConfirm(false);
                          onClose();
                        }}
                        className="flex-1 py-1.5 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl cursor-pointer"
                      >
                        Yes, Revert
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : activeStep === 'details' ? (
            <>
              {/* Headline */}
              <div>
                <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight leading-tight">
                  Ride Smarter.<br />Zero-Hassle Odometer.
                </h2>
                <p className="text-xs text-slate-500 leading-relaxed mt-1.5">
                  Never forget to log your mileage before & after your ride. MotoCare Pro tracks your trip via GPS and increments your odometer automatically.
                </p>
              </div>

              {/* 5 Pro Features List */}
              <div className="space-y-3 text-xs">
                <div className="flex items-start gap-3">
                  <div className="p-1 text-amber-500 shrink-0 mt-0.5">
                    <Zap className="w-4 h-4 fill-amber-400" />
                  </div>
                  <div>
                    <div className="font-bold text-slate-800">Zero-Touch GPS Auto-Odometer</div>
                    <div className="text-[11px] text-slate-500 leading-normal">
                      Track rides in real-time. Finished kilometers automatically add to your motorcycle odometer without typing.
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="p-1 text-red-500 shrink-0 mt-0.5">
                    <Bike className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="font-bold text-slate-800">Unlimited Garage Motorcycles</div>
                    <div className="text-[11px] text-slate-500 leading-normal">
                      Free accounts are limited to 1 motorcycle. Pro unlocks unlimited bikes, scooters, and underbones in your digital garage.
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="p-1 text-blue-500 shrink-0 mt-0.5">
                    <FileText className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="font-bold text-slate-800">Casa Maintenance Booklet & PDF Export</div>
                    <div className="text-[11px] text-slate-500 leading-normal">
                      Generate official CASA maintenance booklets with Casa dealer stamps for maximum motorcycle resale value.
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="p-1 text-emerald-500 shrink-0 mt-0.5">
                    <Shield className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="font-bold text-slate-800">Automatic LTO Registration & Plate Reminders</div>
                    <div className="text-[11px] text-slate-500 leading-normal">
                      Calculates renewal month from plate ending digits and notifies you before penalties.
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="p-1 text-purple-500 shrink-0 mt-0.5">
                    <Headphones className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="font-bold text-slate-800">Automotive Overdue Push & Vibration Alerts</div>
                    <div className="text-[11px] text-slate-500 leading-normal">
                      Serious reminders that buzz your phone when overdue service intervals are breached.
                    </div>
                  </div>
                </div>
              </div>

              {/* Pricing Card */}
              <div className="p-4 rounded-2xl bg-amber-50/70 border-2 border-amber-300 relative overflow-hidden">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl bg-[#FF6B00] text-white flex items-center justify-center font-bold shadow-sm">
                      ★
                    </div>
                    <div>
                      <div className="text-xs font-bold text-amber-900 uppercase tracking-wider">
                        Monthly Pass
                      </div>
                      <div className="text-[11px] text-amber-700">Scan & Pay via GCash / GoTyme QR</div>
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-xl font-black text-slate-900 font-mono">₱49</div>
                    <div className="text-[10px] text-slate-500">per month</div>
                  </div>
                </div>
              </div>

              {/* Proceed to Payment Gateway Button */}
              <div className="pt-2 space-y-2">
                <button
                  type="button"
                  onClick={() => {
                    sounds.playClick();
                    setActiveStep('qr');
                  }}
                  className="w-full py-3.5 bg-[#FF6B00] hover:bg-[#EA580C] text-white rounded-2xl font-bold text-sm shadow-lg shadow-[#FF6B00]/25 transition-all active:scale-98 flex items-center justify-center gap-2 cursor-pointer"
                >
                  <QrCode className="w-4 h-4" />
                  <span>Proceed to QR Payment (₱49)</span>
                  <ArrowRight className="w-4 h-4" />
                </button>

                <p className="text-[10px] text-center text-slate-400">
                  Scan and submit your transaction reference for owner admin verification.
                </p>
              </div>
            </>
          ) : (
            /* Step 2: Dedicated Payment Gateway Component */
            <div className="space-y-4 animate-in fade-in zoom-in-95 duration-150">
              {/* Back to plans button */}
              <button
                type="button"
                onClick={() => {
                  sounds.playClick();
                  setActiveStep('details');
                }}
                className="text-xs font-semibold text-slate-500 hover:text-slate-900 flex items-center gap-1 cursor-pointer"
              >
                ← Back to Subscription Details
              </button>

              {/* Dedicated Payment Gateway Component */}
              <PaymentGateway
                planAmount={planAmount}
                onSubmitReference={(method, ref) => {
                  onSubmitReference(method, ref);
                }}
                onClose={onClose}
                isAlreadyPending={isAlreadyPending}
                existingPendingRef={existingPendingRef}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
