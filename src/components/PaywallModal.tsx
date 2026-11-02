import React, { useState } from 'react';
import { UserSubscription, PaymentMethod } from '../types';
import { X, Zap, Bike, Headphones, FileText, Shield, QrCode, CheckCircle2, Copy, Check, Sparkles, ArrowRight, ExternalLink, Download, Smartphone } from 'lucide-react';
import confetti from 'canvas-confetti';
import { sounds } from '../utils/audio';

interface PaywallModalProps {
  isOpen: boolean;
  onClose: () => void;
  subscription: UserSubscription;
  onSubscribe: (
    plan: 'monthly',
    paymentMethod: PaymentMethod,
    referenceNumber?: string
  ) => void;
  onCancelSubscription: () => void;
}

export const PaywallModal: React.FC<PaywallModalProps> = ({
  isOpen,
  onClose,
  subscription,
  onSubscribe,
  onCancelSubscription,
}) => {
  const [paymentMethod, setPaymentMethod] = useState<'gcash' | 'gotyme'>('gcash');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [copiedAccount, setCopiedAccount] = useState(false);
  const [copiedRef, setCopiedRef] = useState(false);
  const [qrSaved, setQrSaved] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeStep, setActiveStep] = useState<'details' | 'qr'>('details');
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const isPro = subscription.tier === 'pro';
  const planAmount = 49;
  const planLabel = '₱49 / month';

  const handleOpenPaymentApp = () => {
    sounds.playClick();
    if (paymentMethod === 'gcash') {
      const isAndroid = /android/i.test(navigator.userAgent);
      if (isAndroid) {
        window.location.href = 'intent://#Intent;scheme=gcash;package=com.globe.gcash.android;end';
      } else {
        window.location.href = 'gcash://';
      }
    } else {
      window.location.href = 'gotyme://';
    }
  };

  const handleSaveQrImage = () => {
    sounds.playSuccess();
    const link = document.createElement('a');
    link.href = '/assets/aistudio/gcash_37c30549.jpg';
    link.download = 'MotoCare-GCash-QR.jpg';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setQrSaved(true);
    setTimeout(() => setQrSaved(false), 3000);
  };

  if (!isOpen) return null;

  // Payment details per provider (Only GCash and GoTyme)
  const providerDetails = {
    gcash: {
      name: 'GCash',
      color: '#007DFE',
      badgeBg: 'bg-blue-50 text-[#007DFE] border-blue-200',
      accountName: 'Official GCash / QRPH Merchant',
      accountNumber: 'Scan QR with GCash App',
      qrPrompt: 'Scan QR using GCash or any InstaPay / QRPH banking app',
      tagline: 'Instant GCash QRPH Payment',
      qrImage: '/assets/aistudio/gcash_37c30549.jpg',
      isQrScanOnly: true,
    },
    gotyme: {
      name: 'GoTyme Bank',
      color: '#00BFA5',
      badgeBg: 'bg-teal-50 text-teal-700 border-teal-200',
      accountName: 'MotoCare PH (GoTyme)',
      accountNumber: '0124-8839-2041',
      qrPrompt: 'Scan QR with your GoTyme Bank App or QRPH app',
      tagline: 'Zero-Fee QRPH Bank Transfer',
      qrImage: null,
    },
  };

  const currentProvider = providerDetails[paymentMethod];
  const sampleRefCode = `MC-${paymentMethod.toUpperCase()}-${Math.floor(100000 + Math.random() * 900000)}`;

  const handleCopyAccount = () => {
    navigator.clipboard?.writeText(currentProvider.accountNumber);
    setCopiedAccount(true);
    setTimeout(() => setCopiedAccount(false), 2000);
  };

  const handleCopyRef = () => {
    navigator.clipboard?.writeText(sampleRefCode);
    setCopiedRef(true);
    setTimeout(() => setCopiedRef(false), 2000);
  };

  const handleConfirmPayment = () => {
    setIsProcessing(true);
    sounds.playClick();

    setTimeout(() => {
      setIsProcessing(false);
      onSubscribe(
        'monthly',
        paymentMethod,
        referenceNumber.trim() || sampleRefCode
      );

      try {
        confetti({
          particleCount: 90,
          spread: 80,
          origin: { y: 0.6 },
          colors: ['#F95A00', '#00C5FF', '#10B981', '#EAB308'],
        });
      } catch {
        // ignore
      }

      sounds.playSuccess();
      onClose();
    }, 1000);
  };

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
            className="p-1.5 text-slate-400 hover:text-slate-800 rounded-xl hover:bg-slate-100 transition-colors"
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
                  className="w-full py-3 bg-[#F95A00] hover:bg-[#ea5300] text-white font-bold text-xs rounded-2xl transition-all shadow-md shadow-orange-500/20"
                >
                  Return to Garage
                </button>

                {!showCancelConfirm ? (
                  <button
                    type="button"
                    onClick={() => setShowCancelConfirm(true)}
                    className="text-xs text-slate-400 hover:text-red-500 underline"
                  >
                    Cancel Pro Subscription (Revert to Free)
                  </button>
                ) : (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-2xl text-center space-y-2 animate-in fade-in">
                    <p className="text-xs font-bold text-red-800">Revert back to Free tier for evaluation?</p>
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
                        className="flex-1 py-1.5 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl"
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
                    <div className="font-bold text-slate-800">Unlimited Multi-Bike Garage</div>
                    <div className="text-[11px] text-slate-500 leading-normal">
                      Track multiple scooters, underbones, and big bikes. Free tier is limited to 1 motorcycle.
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="p-1 text-slate-700 shrink-0 mt-0.5">
                    <Headphones className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="font-bold text-slate-800">Helmet Bluetooth Auto-Detect</div>
                    <div className="text-[11px] text-slate-500 leading-normal">
                      Auto-prompts ride tracking when connected to FreedConn, Cardo, Sena, or bike console.
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="p-1 text-cyan-600 shrink-0 mt-0.5">
                    <FileText className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="font-bold text-slate-800">Export Casa-Maintained PDF Booklet</div>
                    <div className="text-[11px] text-slate-500 leading-normal">
                      Generate a verified Philippine service record with OEM specs to maximize bike resale value.
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="p-1 text-teal-600 shrink-0 mt-0.5">
                    <Shield className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="font-bold text-slate-800">LTO Vault & Plate Expiry Reminders</div>
                    <div className="text-[11px] text-slate-500 leading-normal">
                      Plate renewal alerts based on last digit and middle digit rules.
                    </div>
                  </div>
                </div>
              </div>

              {/* Monthly Pricing Card (Annual Removed) */}
              <div className="pt-1">
                <div className="p-4 rounded-2xl border-2 border-[#F95A00] bg-orange-50/40 shadow-sm relative flex items-center justify-between">
                  <div>
                    <span className="inline-block px-2.5 py-0.5 rounded-md bg-[#F95A00] text-white text-[10px] font-bold uppercase tracking-wider mb-1.5">
                      Cancel Anytime
                    </span>
                    <div className="text-xs font-bold text-slate-600">Monthly Pro Subscription</div>
                    <div className="text-2xl font-black text-slate-900 mt-0.5">
                      ₱49 <span className="text-xs font-semibold text-slate-500">/ month</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                      <Check className="w-3.5 h-3.5" /> Full Access
                    </span>
                  </div>
                </div>
              </div>

              {/* Payment Channel Selector (GCash & GoTyme only - MariBank removed) */}
              <div className="space-y-2 pt-1">
                <span className="text-xs font-bold text-slate-700 flex items-center justify-between">
                  <span>Select Philippine Payment Channel:</span>
                  <span className="text-[10px] font-semibold text-slate-400">QRPH / InstaPay</span>
                </span>

                <div className="grid grid-cols-2 gap-2.5">
                  {/* GCash */}
                  <button
                    type="button"
                    onClick={() => {
                      sounds.playClick();
                      setPaymentMethod('gcash');
                    }}
                    className={`py-2.5 px-3 rounded-2xl border flex items-center justify-center gap-2 transition-all ${
                      paymentMethod === 'gcash'
                        ? 'border-[#007DFE] bg-blue-50/80 text-[#007DFE] font-bold shadow-sm ring-2 ring-[#007DFE]'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <div className="w-6 h-6 rounded-full bg-[#007DFE] text-white flex items-center justify-center text-xs font-extrabold shrink-0">
                      G
                    </div>
                    <div className="text-left">
                      <div className="text-xs font-extrabold leading-tight">GCash</div>
                      <div className="text-[9px] text-slate-500">Official QR Code</div>
                    </div>
                  </button>

                  {/* GoTyme */}
                  <button
                    type="button"
                    onClick={() => {
                      sounds.playClick();
                      setPaymentMethod('gotyme');
                    }}
                    className={`py-2.5 px-3 rounded-2xl border flex items-center justify-center gap-2 transition-all ${
                      paymentMethod === 'gotyme'
                        ? 'border-[#00BFA5] bg-teal-50/80 text-teal-800 font-bold shadow-sm ring-2 ring-[#00BFA5]'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <div className="w-6 h-6 rounded-full bg-[#00BFA5] text-white flex items-center justify-center text-[10px] font-extrabold shrink-0">
                      Go
                    </div>
                    <div className="text-left">
                      <div className="text-xs font-extrabold leading-tight">GoTyme</div>
                      <div className="text-[9px] text-slate-500">Zero-Fee QRPH</div>
                    </div>
                  </button>
                </div>
              </div>

              {/* Proceed to QR Payment Button */}
              <div className="pt-2 space-y-2">
                <button
                  type="button"
                  onClick={() => {
                    sounds.playClick();
                    setActiveStep('qr');
                  }}
                  className="w-full py-3.5 bg-[#F95A00] hover:bg-[#EA580C] text-white rounded-2xl font-bold text-sm shadow-lg shadow-[#F95A00]/25 transition-all active:scale-98 flex items-center justify-center gap-2"
                >
                  <QrCode className="w-4 h-4" />
                  <span>Pay {planLabel} via {currentProvider.name} QR</span>
                  <ArrowRight className="w-4 h-4" />
                </button>

                <p className="text-[10px] text-center text-slate-400">
                  Instant activation upon payment verification. No recurring credit card lock-in.
                </p>
              </div>
            </>
          ) : (
            /* Step 2: Realistic QR Code & Payment Verification */
            <div className="space-y-4 animate-in fade-in zoom-in-95 duration-150">
              {/* Back to plans button */}
              <button
                type="button"
                onClick={() => setActiveStep('details')}
                className="text-xs font-semibold text-slate-500 hover:text-slate-900 flex items-center gap-1"
              >
                ← Back to Subscription Details
              </button>

              {/* QRPH Card Container */}
              <div className="p-5 bg-gradient-to-b from-slate-50 to-white rounded-3xl border border-slate-200 shadow-sm text-center space-y-4">
                {/* QRPH Header */}
                <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                  <div className="flex items-center gap-2 text-left">
                    <div
                      className="w-8 h-8 rounded-xl text-white flex items-center justify-center font-black text-xs shadow-sm"
                      style={{ backgroundColor: currentProvider.color }}
                    >
                      {paymentMethod === 'gcash' ? 'G' : 'Go'}
                    </div>
                    <div>
                      <div className="font-extrabold text-sm text-slate-900">{currentProvider.name} QRPH</div>
                      <div className="text-[10px] text-slate-400 font-medium">{currentProvider.tagline}</div>
                    </div>
                  </div>

                  <span className="px-2.5 py-1 rounded-full text-xs font-extrabold bg-slate-900 text-amber-300">
                    ₱{planAmount}.00 / mo
                  </span>
                </div>

                {/* QR Code Graphic matching Philippine QR standards */}
                {paymentMethod === 'gcash' ? (
                  /* Connected User-Provided Official GCash QR Code */
                  <div className="space-y-2">
                    <div className="relative mx-auto w-56 h-56 bg-white p-2 rounded-2xl border-2 border-[#007DFE]/40 shadow-md flex items-center justify-center overflow-hidden">
                      <img
                        src="/assets/aistudio/gcash_37c30549.jpg"
                        alt="Official GCash InstaPay QR Code"
                        className="w-full h-full object-contain rounded-xl"
                      />
                    </div>
                    <div className="flex items-center justify-center gap-1.5 text-[10px] font-bold text-blue-600 bg-blue-50 py-1 px-3 rounded-full mx-auto w-fit border border-blue-200">
                      <span>✓ Official GCash InstaPay QR Code Connected</span>
                    </div>
                  </div>
                ) : (
                  /* GoTyme QR Code */
                  <div className="relative mx-auto w-52 h-52 bg-white p-3 rounded-2xl border-2 border-teal-200 shadow-inner flex flex-col items-center justify-center">
                    <svg className="w-full h-full text-slate-900" viewBox="0 0 100 100" fill="currentColor">
                      <rect x="5" y="5" width="24" height="24" rx="3" fill="none" stroke="currentColor" strokeWidth="6" />
                      <rect x="11" y="11" width="12" height="12" rx="1" />
                      <rect x="71" y="5" width="24" height="24" rx="3" fill="none" stroke="currentColor" strokeWidth="6" />
                      <rect x="77" y="11" width="12" height="12" rx="1" />
                      <rect x="5" y="71" width="24" height="24" rx="3" fill="none" stroke="currentColor" strokeWidth="6" />
                      <rect x="11" y="77" width="12" height="12" rx="1" />
                      <rect x="35" y="8" width="8" height="8" />
                      <rect x="47" y="8" width="8" height="8" />
                      <rect x="35" y="20" width="8" height="8" />
                      <rect x="55" y="20" width="8" height="8" />
                      <rect x="8" y="35" width="8" height="8" />
                      <rect x="20" y="35" width="8" height="8" />
                      <rect x="35" y="35" width="8" height="8" />
                      <rect x="57" y="35" width="8" height="8" />
                      <rect x="75" y="35" width="8" height="8" />
                      <rect x="8" y="47" width="8" height="8" />
                      <rect x="25" y="47" width="8" height="8" />
                      <rect x="67" y="47" width="8" height="8" />
                      <rect x="85" y="47" width="8" height="8" />
                      <rect x="35" y="60" width="8" height="8" />
                      <rect x="55" y="60" width="8" height="8" />
                      <rect x="75" y="60" width="8" height="8" />
                      <rect x="35" y="75" width="8" height="8" />
                      <rect x="48" y="75" width="8" height="8" />
                      <rect x="65" y="75" width="8" height="8" />
                      <rect x="80" y="75" width="8" height="8" />
                      <rect x="40" y="87" width="8" height="8" />
                      <rect x="60" y="87" width="8" height="8" />
                      <rect x="78" y="87" width="8" height="8" />
                    </svg>
                    <div className="absolute inset-auto w-10 h-10 rounded-xl p-1 bg-white shadow-md flex items-center justify-center border-2 border-white">
                      <div
                        className="w-full h-full rounded-lg text-white font-extrabold text-[11px] flex items-center justify-center shadow-inner"
                        style={{ backgroundColor: currentProvider.color }}
                      >
                        Go
                      </div>
                    </div>
                  </div>
                )}

                {/* Mobile Quick Action Buttons: Open App & Save QR */}
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleOpenPaymentApp}
                    className="py-2.5 px-3 rounded-2xl bg-[#007DFE] hover:bg-[#0066cc] text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-md shadow-blue-500/20 transition-all active:scale-95"
                    title={`Redirect directly to ${currentProvider.name} app`}
                  >
                    <Smartphone className="w-3.5 h-3.5" />
                    <span>Open {currentProvider.name}</span>
                    <ExternalLink className="w-3 h-3 opacity-80" />
                  </button>

                  <button
                    type="button"
                    onClick={handleSaveQrImage}
                    className="py-2.5 px-3 rounded-2xl bg-white hover:bg-slate-50 border border-slate-200 text-slate-800 font-bold text-xs flex items-center justify-center gap-1.5 shadow-2xs transition-all active:scale-95"
                    title="Save QR code to your phone gallery"
                  >
                    {qrSaved ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Download className="w-3.5 h-3.5" />}
                    <span>{qrSaved ? 'Saved to Photos!' : 'Save QR Photo'}</span>
                  </button>
                </div>

                {/* Account Details & Quick Mobile Guide */}
                <div className="space-y-2 text-xs">
                  {paymentMethod === 'gcash' ? (
                    <div className="p-3 bg-blue-50/80 border border-blue-200 rounded-2xl text-left space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-blue-700 font-bold uppercase tracking-wider">
                          Easiest Mobile Payment
                        </span>
                        <span className="text-[10px] text-blue-600 font-semibold">Same phone flow</span>
                      </div>
                      <div className="text-xs font-semibold text-slate-700 leading-relaxed">
                        1. Tap <strong className="text-blue-700">&apos;Save QR Photo&apos;</strong> above<br />
                        2. Tap <strong className="text-blue-700">&apos;Open GCash&apos;</strong> → tap <em>Scan QR</em> → pick photo from gallery
                      </div>
                    </div>
                  ) : (
                    <div className="p-2.5 bg-slate-100/70 rounded-xl flex items-center justify-between text-left">
                      <div>
                        <span className="text-[10px] text-slate-400 font-semibold uppercase">Account / Mobile No:</span>
                        <div className="font-mono font-bold text-slate-800 text-xs">
                          {currentProvider.accountNumber}
                        </div>
                        <div className="text-[10px] text-slate-500">{currentProvider.accountName}</div>
                      </div>
                      <button
                        type="button"
                        onClick={handleCopyAccount}
                        className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-slate-700 text-[11px] font-bold hover:bg-slate-50 flex items-center gap-1 shadow-sm shrink-0"
                      >
                        {copiedAccount ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedAccount ? 'Copied' : 'Copy'}</span>
                      </button>
                    </div>
                  )}

                  <div className="p-2.5 bg-slate-100/70 rounded-xl flex items-center justify-between text-left">
                    <div>
                      <span className="text-[10px] text-slate-400 font-semibold uppercase">Payment Reference:</span>
                      <div className="font-mono font-bold text-slate-800 text-xs">{sampleRefCode}</div>
                    </div>
                    <button
                      type="button"
                      onClick={handleCopyRef}
                      className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-slate-700 text-[11px] font-bold hover:bg-slate-50 flex items-center gap-1 shadow-sm shrink-0"
                    >
                      {copiedRef ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedRef ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                </div>

                {/* Reference Number input */}
                <div className="text-left space-y-1">
                  <label className="text-[11px] font-bold text-slate-600">
                    Input Your Transaction Reference (Optional):
                  </label>
                  <input
                    type="text"
                    value={referenceNumber}
                    onChange={(e) => setReferenceNumber(e.target.value)}
                    placeholder={`e.g. 104829482 or ${currentProvider.name} Ref`}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono font-bold text-slate-800 focus:outline-none focus:border-[#F95A00]"
                  />
                </div>
              </div>

              {/* Unlock Button */}
              <div className="space-y-2">
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={handleConfirmPayment}
                  className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-bold text-sm shadow-lg shadow-emerald-600/25 transition-all active:scale-98 flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isProcessing ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Verifying {currentProvider.name} Payment...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 text-amber-200" />
                      <span>I Have Paid ₱49 via {currentProvider.name} — Unlock Pro</span>
                    </>
                  )}
                </button>

                <p className="text-[10px] text-center text-slate-400">
                  Clicking confirms your payment and instantly unlocks all MotoCare Pro features.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
