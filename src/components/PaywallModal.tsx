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
  Check,
  Calendar,
  Cloud,
  ChevronRight,
  Smartphone,
  Navigation,
  Camera,
  Clock,
  XCircle,
} from 'lucide-react';
import { sounds } from '../utils/audio';
import { PaymentGateway } from './PaymentGateway';
import { useAuth } from '../context/AuthContext';
import {
  subscribeToUserPaymentSubmission,
  subscribeToUserDoc,
  PaymentSubmission,
} from '../utils/firestoreService';

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
  const { user } = useAuth();
  const isPro = subscription.tier === 'pro';
  const planAmount = 49;

  // For non-pro users, default to 'details' (Pro Features Checklist) to showcase the value checklist,
  // while allowing quick 1-click jump to 'qr' payment. For active pro users, default to 'status'.
  const [activeTab, setActiveTab] = useState<'details' | 'qr' | 'status'>(() =>
    isPro ? 'status' : 'details'
  );
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [autoDownloadedQr, setAutoDownloadedQr] = useState(false);
  const [qrBlobUrl, setQrBlobUrl] = useState<string>('/assets/aistudio/gcash_37c30549.jpg');
  const [submissionToast, setSubmissionToast] = useState<{
    visible: boolean;
    referenceNumber: string;
  }>({ visible: false, referenceNumber: '' });

  // Live Firestore verification status state
  const [firestoreSubmission, setFirestoreSubmission] = useState<PaymentSubmission | null>(null);
  const [firestoreUserStatus, setFirestoreUserStatus] = useState<string | null>(null);
  const [localSubmittedRef, setLocalSubmittedRef] = useState<string>(existingPendingRef || '');

  // 'Scan GCash QR' camera scanner state
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const scannerVideoRef = React.useRef<HTMLVideoElement | null>(null);
  const cameraStreamRef = React.useRef<MediaStream | null>(null);

  const hasAutoDownloadedRef = React.useRef(false);
  const hiddenQrAnchorRef = React.useRef<HTMLAnchorElement | null>(null);

  // Stop camera stream helper
  const stopCameraScanner = React.useCallback(() => {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
    }
    if (scannerVideoRef.current) {
      scannerVideoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
  }, []);

  // Attempt to open the device camera for 'Scan GCash QR'
  const handleStartQrScanner = React.useCallback(async () => {
    sounds.playClick();
    setIsScannerOpen(true);
    setCameraError(null);

    try {
      if (
        typeof navigator !== 'undefined' &&
        navigator.mediaDevices &&
        typeof navigator.mediaDevices.getUserMedia === 'function'
      ) {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        cameraStreamRef.current = stream;
        setIsCameraActive(true);
        if (scannerVideoRef.current) {
          scannerVideoRef.current.srcObject = stream;
        }
      } else {
        setCameraError(
          'Camera access is unavailable on this browser or device. Use the GCash QR displayed below or tap Download QR Code.'
        );
      }
    } catch {
      setCameraError(
        'Unable to access camera (permission denied or no camera detected). You can scan or download the GCash QR code directly below.'
      );
    }
  }, []);

  const handleCloseQrScanner = React.useCallback(() => {
    stopCameraScanner();
    setIsScannerOpen(false);
    setCameraError(null);
  }, [stopCameraScanner]);

  // Subscribe to real-time Firestore payment verification status updates when modal is open
  React.useEffect(() => {
    if (!isOpen || !user?.uid) {
      return;
    }

    let unsubSubmission: (() => void) | undefined;
    let unsubUser: (() => void) | undefined;

    try {
      unsubSubmission = subscribeToUserPaymentSubmission(user.uid, (submission) => {
        setFirestoreSubmission(submission);
      });
    } catch {
      // Safe fallback in test/offline environments
    }

    try {
      unsubUser = subscribeToUserDoc(user.uid, (userData) => {
        if (userData && typeof userData.subscriptionStatus === 'string') {
          setFirestoreUserStatus(userData.subscriptionStatus);
        }
      });
    } catch {
      // Safe fallback in test/offline environments
    }

    return () => {
      if (typeof unsubSubmission === 'function') unsubSubmission();
      if (typeof unsubUser === 'function') unsubUser();
    };
  }, [isOpen, user?.uid]);

  // Compute authoritative Verification Status stage for the progress bar:
  // 'idle' | 'submitted' | 'verifying' | 'approved' | 'rejected'
  const verificationStage = React.useMemo<
    'idle' | 'submitted' | 'verifying' | 'approved' | 'rejected'
  >(() => {
    if (
      firestoreSubmission?.status === 'rejected' ||
      firestoreUserStatus === 'revoked' ||
      subscription.status === 'revoked'
    ) {
      return 'rejected';
    }
    if (
      isPro ||
      firestoreSubmission?.status === 'active_pro' ||
      firestoreUserStatus === 'active' ||
      subscription.status === 'active'
    ) {
      return 'approved';
    }
    if (
      firestoreSubmission?.status === 'pending_approval' ||
      isAlreadyPending ||
      subscription.status === 'trial'
    ) {
      return 'verifying';
    }
    if (Boolean(localSubmittedRef) || submissionToast.visible) {
      return 'verifying';
    }
    return 'idle';
  }, [
    firestoreSubmission?.status,
    firestoreUserStatus,
    subscription.status,
    isPro,
    isAlreadyPending,
    localSubmittedRef,
    submissionToast.visible,
  ]);

  const verificationProgressPercent =
    verificationStage === 'approved' || verificationStage === 'rejected'
      ? 100
      : verificationStage === 'verifying'
      ? 66
      : verificationStage === 'submitted'
      ? 35
      : 0;

  const activeReferenceDisplay =
    localSubmittedRef ||
    firestoreSubmission?.referenceNumber ||
    existingPendingRef ||
    subscription.referenceNumber ||
    '';

  // Prepare blob URL from the existing GCash QR asset for direct gallery saving via hidden anchor tag
  React.useEffect(() => {
    let createdObjectUrl: string | null = null;
    let isMounted = true;

    const loadQrBlob = async () => {
      try {
        if (typeof fetch === 'function') {
          const response = await fetch('/assets/aistudio/gcash_37c30549.jpg');
          if (response.ok && typeof response.blob === 'function') {
            const blob = await response.blob();
            if (isMounted && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
              createdObjectUrl = URL.createObjectURL(blob);
              setQrBlobUrl(createdObjectUrl);
            }
          }
        }
      } catch {
        // Fallback to direct asset path if blob fetch fails in offline/test environments
      }
    };

    if (isOpen) {
      loadQrBlob();
    }

    return () => {
      isMounted = false;
      if (createdObjectUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(createdObjectUrl);
      }
    };
  }, [isOpen]);

  const triggerGcashQrDownload = React.useCallback(() => {
    if (hiddenQrAnchorRef.current) {
      hiddenQrAnchorRef.current.click();
    } else {
      const link = document.createElement('a');
      link.href = qrBlobUrl || '/assets/aistudio/gcash_37c30549.jpg';
      link.download = 'MotoCare-GCash-QR.jpg';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
    setAutoDownloadedQr(true);
  }, [qrBlobUrl]);

  const triggerSubmissionToast = React.useCallback((refNum: string) => {
    setLocalSubmittedRef(refNum);
    setSubmissionToast({ visible: true, referenceNumber: refNum });
  }, []);

  React.useEffect(() => {
    if (!submissionToast.visible) return;
    const timer = setTimeout(() => {
      setSubmissionToast((prev) => ({ ...prev, visible: false }));
    }, 6000);
    return () => clearTimeout(timer);
  }, [submissionToast.visible]);

  React.useEffect(() => {
    if (isOpen) {
      if (isPro) {
        setActiveTab('status');
      } else {
        // Show features checklist first so rider sees all Pro superpowers
        setActiveTab('details');
      }
    } else {
      hasAutoDownloadedRef.current = false;
      setAutoDownloadedQr(false);
      setSubmissionToast({ visible: false, referenceNumber: '' });
      stopCameraScanner();
      setIsScannerOpen(false);
      setCameraError(null);
    }
  }, [isOpen, isPro, stopCameraScanner]);

  // Automatically trigger download of the verified GCash QR image when it appears in PaywallModal
  React.useEffect(() => {
    if (isOpen && activeTab === 'qr' && !isAlreadyPending && !hasAutoDownloadedRef.current) {
      hasAutoDownloadedRef.current = true;
      triggerGcashQrDownload();
    }
  }, [isOpen, activeTab, isAlreadyPending, triggerGcashQrDownload]);

  if (!isOpen) return null;

  // Pro features checklist items
  const proFeaturesChecklist = [
    {
      id: 'bikes',
      title: 'Unlimited Garage Bikes',
      pill: 'UNLIMITED FLEET',
      pillColor: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      icon: Bike,
      iconColor: 'text-emerald-500 bg-emerald-50 border-emerald-100',
      freeVsPro: 'Free: 1 Bike Limit • Pro: Unlimited Motorcycles',
      description:
        'Add and monitor all your daily scooters, weekend big bikes, and underbones in one seamless digital garage.',
    },
    {
      id: 'odometer',
      title: 'Zero-Touch GPS Auto-Odometer',
      pill: 'HANDS-FREE GPS',
      pillColor: 'bg-orange-50 text-[#FF6B00] border-orange-200',
      icon: Zap,
      iconColor: 'text-[#FF6B00] bg-orange-50 border-orange-100',
      freeVsPro: 'Free: Manual Entry • Pro: Real-time GPS Auto-Sync',
      description:
        'Real-time ride tracking telemetry automatically logs kilometers and increments your bike odometer when you finish your ride.',
    },
    {
      id: 'pdf',
      title: 'Official CASA PDF Service Booklet Export',
      pill: 'OFFICIAL EXPORT',
      pillColor: 'bg-blue-50 text-blue-700 border-blue-200',
      icon: FileText,
      iconColor: 'text-blue-500 bg-blue-50 border-blue-100',
      freeVsPro: 'Free: In-app View • Pro: Dealership-grade PDF Export',
      description:
        'Generate high-resolution printable CASA maintenance booklets with dealer inspection stamps to maximize your motorcycle resale value.',
    },
    {
      id: 'alerts',
      title: 'Unlimited Overdue Push & Haptic Alerts',
      pill: 'UNLIMITED ALERTS',
      pillColor: 'bg-purple-50 text-purple-700 border-purple-200',
      icon: Headphones,
      iconColor: 'text-purple-500 bg-purple-50 border-purple-100',
      freeVsPro: 'Free: Standard In-App • Pro: Urgent Phone Push & Vibration',
      description:
        'Priority notifications and haptic phone vibration alerts whenever engine oil, CVT belt, coolant, brake pads, or chain maintenance are due.',
    },
    {
      id: 'lto',
      title: 'Smart LTO Plate Ending & Renewal Tracker',
      pill: 'LEGAL PROTECTION',
      pillColor: 'bg-amber-50 text-amber-700 border-amber-200',
      icon: Shield,
      iconColor: 'text-amber-500 bg-amber-50 border-amber-100',
      freeVsPro: 'Free: Manual Reminder • Pro: Auto-computed LTO Schedule',
      description:
        'Calculates your exact LTO registration renewal month from your plate ending digits and notifies you weeks before penalty deadlines.',
    },
    {
      id: 'cloud',
      title: 'Multi-Device Cloud Garage Sync',
      pill: 'ENCRYPTED CLOUD',
      pillColor: 'bg-cyan-50 text-cyan-700 border-cyan-200',
      icon: Cloud,
      iconColor: 'text-cyan-500 bg-cyan-50 border-cyan-100',
      freeVsPro: 'Free: Local Cache • Pro: Real-time Cloud Sync',
      description:
        'Encrypted continuous Firestore sync preserves your motorcycle specs and full maintenance history safely across all devices.',
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/65 backdrop-blur-sm overflow-y-auto animate-in fade-in duration-150">
      {/* Hidden anchor tag bound to the GCash QR blob object for direct gallery downloads */}
      <a
        ref={hiddenQrAnchorRef}
        href={qrBlobUrl}
        download="MotoCare-GCash-QR.jpg"
        className="hidden"
        aria-hidden="true"
        data-testid="hidden-gcash-qr-download-anchor"
      />

      {/* Toast Notification on Successful GCash Payment Reference Submission */}
      {submissionToast.visible && (
        <div
          role="status"
          aria-live="polite"
          className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] w-[92%] max-w-md bg-slate-900 text-white px-4 py-3.5 rounded-2xl shadow-2xl border border-emerald-500/40 flex items-start gap-3 animate-in fade-in slide-in-from-top-3 duration-200"
        >
          <div className="w-8 h-8 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
            <CheckCircle2 className="w-4 h-4" />
          </div>
          <div className="flex-1 text-left space-y-0.5">
            <div className="text-xs font-extrabold text-white">
              GCash Payment Reference Submitted!
            </div>
            <p className="text-[11px] text-slate-300 leading-relaxed">
              Ref <span className="font-mono font-bold text-emerald-400">{submissionToast.referenceNumber}</span> received. Typical verification timeframe: <strong>within 5–15 minutes</strong> (up to 24 hours).
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSubmissionToast((prev) => ({ ...prev, visible: false }))}
            className="text-slate-400 hover:text-white p-1 rounded-lg transition-colors cursor-pointer"
            aria-label="Dismiss notification"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="w-full max-w-lg bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden my-auto max-h-[95vh] flex flex-col">
        {/* Top Header */}
        <div className="p-4 px-5 flex items-center justify-between border-b border-slate-100 shrink-0 bg-white">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="MotoCare Logo" className="w-6 h-6 rounded-lg object-contain" />
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl border border-amber-300 bg-amber-50/70 text-amber-700 font-bold text-xs">
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              <span className="tracking-wide">MOTOCARE PRO VIP</span>
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

        {/* Top Segmented Tabs Navigation */}
        <div className="px-5 pt-3 pb-2 border-b border-slate-100 bg-slate-50/80 shrink-0">
          <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-200/70 rounded-2xl">
            <button
              type="button"
              onClick={() => {
                sounds.playClick();
                setActiveTab('details');
              }}
              className={`py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                activeTab === 'details'
                  ? 'bg-white text-slate-900 shadow-sm border border-slate-200/60'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
              <span>★ Pro Checklist</span>
            </button>

            <button
              type="button"
              onClick={() => {
                sounds.playClick();
                setActiveTab(isPro ? 'status' : 'qr');
              }}
              className={`py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                activeTab === 'qr' || activeTab === 'status'
                  ? 'bg-white text-slate-900 shadow-sm border border-slate-200/60'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {isPro ? (
                <>
                  <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                  <span>VIP Status</span>
                </>
              ) : (
                <>
                  <QrCode className="w-3.5 h-3.5 text-[#007DFE]" />
                  <span>Pay with GCash (₱49)</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-4">
          {/* ======================================================== */}
          {/* TAB 1: PRO FEATURES CHECKLIST (INCENTIVIZE SUBSCRIPTION) */}
          {/* ======================================================== */}
          {activeTab === 'details' && (
            <div className="space-y-4 animate-in fade-in duration-150">
              {/* Header Banner */}
              <div className="p-4 rounded-2xl bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 text-white border border-slate-800 shadow-lg relative overflow-hidden">
                <div className="absolute top-0 right-0 -mr-6 -mt-6 w-28 h-28 bg-[#FF6B00]/15 rounded-full blur-2xl pointer-events-none" />
                <div className="flex items-start justify-between gap-3 relative z-10">
                  <div className="space-y-1">
                    <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#FF6B00]/20 border border-[#FF6B00]/40 text-[#FF6B00] text-[10px] font-black uppercase tracking-wider">
                      <Sparkles className="w-3 h-3" />
                      All Superpowers Unlocked
                    </div>
                    <h2 className="text-xl font-black text-white tracking-tight leading-snug">
                      MotoCare Pro Membership
                    </h2>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      Upgrade your motorcycle experience with our complete suite of intelligent rider tools for just ₱49/month.
                    </p>
                  </div>

                  <div className="text-right shrink-0 bg-white/10 backdrop-blur-md px-3 py-2 rounded-xl border border-white/15">
                    <div className="text-2xl font-black text-[#FF6B00] font-mono leading-none">₱49</div>
                    <div className="text-[10px] text-slate-300 font-medium">per month</div>
                  </div>
                </div>

                {/* Free vs Pro quick pill */}
                <div className="mt-3 pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
                  <span>Free: 1 Bike • Manual Tracking</span>
                  <span className="text-emerald-400 font-bold flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    Pro: All 6 Features Unlimited
                  </span>
                </div>
              </div>

              {/*Checklist Section Title */}
              <div className="flex items-center justify-between pt-1">
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  What You Get in MotoCare Pro Checklist:
                </h3>
                <span className="text-[11px] font-bold text-slate-500">6 of 6 Included</span>
              </div>

              {/* Comprehensive Features Checklist */}
              <div className="space-y-2.5">
                {proFeaturesChecklist.map((feature) => {
                  const Icon = feature.icon;
                  return (
                    <div
                      key={feature.id}
                      className="p-3.5 rounded-2xl border border-slate-200/90 bg-white hover:border-[#FF6B00]/40 hover:shadow-md transition-all space-y-1.5 group"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                          <div className={`p-2 rounded-xl border ${feature.iconColor} shrink-0`}>
                            <Icon className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-extrabold text-sm text-slate-900 group-hover:text-[#FF6B00] transition-colors">
                                {feature.title}
                              </span>
                              <span
                                className={`px-2 py-0.5 rounded-md text-[9px] font-black border uppercase tracking-wider ${feature.pillColor}`}
                              >
                                {feature.pill}
                              </span>
                            </div>
                            <div className="text-[10px] font-semibold text-emerald-600">
                              ✓ {feature.freeVsPro}
                            </div>
                          </div>
                        </div>

                        <div className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0 mt-0.5">
                          <Check className="w-3 h-3 stroke-[3]" />
                        </div>
                      </div>

                      <p className="text-xs text-slate-500 leading-relaxed pl-11">
                        {feature.description}
                      </p>
                    </div>
                  );
                })}
              </div>

              {/* Direct CTA Button to GCash Payment Tab */}
              <div className="pt-2 space-y-2">
                <button
                  type="button"
                  onClick={() => {
                    sounds.playClick();
                    setActiveTab('qr');
                  }}
                  className="w-full py-3.5 bg-[#007DFE] hover:bg-[#0066D6] text-white rounded-2xl font-black text-sm shadow-lg shadow-blue-500/25 transition-all active:scale-[0.99] flex items-center justify-center gap-2 cursor-pointer"
                >
                  <QrCode className="w-4 h-4" />
                  <span>Pay with GCash (₱49/month)</span>
                  <ArrowRight className="w-4 h-4" />
                </button>

                <p className="text-[11px] text-center text-slate-400">
                  Pay ₱49/month via official GCash QR code. Cancel anytime.
                </p>
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* TAB 2: GCASH QR PAYMENT GATEWAY                          */}
          {/* ======================================================== */}
          {activeTab === 'qr' && (
            <div className="space-y-4 animate-in fade-in duration-150">
              {/* Upgrade Tips & Quick Perks Reminder Banner above QR */}
              <div className="p-3.5 bg-amber-50/80 border border-amber-200/90 rounded-2xl space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-extrabold text-amber-900 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                    Upgrade Tips: Unlock Pro for ₱49/mo
                  </span>
                  <button
                    type="button"
                    onClick={() => setActiveTab('details')}
                    className="text-[11px] font-bold text-amber-700 underline hover:text-amber-900 cursor-pointer"
                  >
                    View Checklist
                  </button>
                </div>
                <p className="text-[11px] text-amber-900/90 leading-relaxed">
                  Upgrade to enjoy <strong>Unlimited Bike Storage</strong> across all your motorcycles and <strong>Advanced Ride Tracking Statistics</strong> with GPS auto-odometer sync.
                </p>
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <div className="flex flex-wrap gap-1 text-[10px] text-slate-600">
                    <span className="bg-white px-2 py-0.5 rounded-md border border-amber-200/60 font-semibold text-slate-700">
                      ✓ Unlimited Bike Storage
                    </span>
                    <span className="bg-white px-2 py-0.5 rounded-md border border-amber-200/60 font-semibold text-slate-700">
                      ✓ Advanced Ride Tracking Statistics
                    </span>
                    <span className="bg-white px-2 py-0.5 rounded-md border border-amber-200/60 font-semibold text-slate-700">
                      ✓ CASA PDF Export
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={handleStartQrScanner}
                      className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-black text-white font-bold text-[11px] flex items-center gap-1 shadow-2xs transition-all cursor-pointer"
                      title="Open device camera to scan GCash QR code directly"
                    >
                      <Camera className="w-3 h-3" />
                      <span>Scan GCash QR</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        sounds.playSuccess();
                        triggerGcashQrDownload();
                      }}
                      className="px-2.5 py-1 rounded-lg bg-[#007DFE] hover:bg-[#0066D6] text-white font-bold text-[11px] flex items-center gap-1 shadow-2xs transition-all cursor-pointer"
                      title="Download QR Code directly to your gallery"
                    >
                      <QrCode className="w-3 h-3" />
                      <span>Download QR Code</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Direct Camera QR Scanner Panel */}
              {isScannerOpen && (
                <div
                  data-testid="gcash-qr-camera-scanner"
                  className="p-4 rounded-2xl bg-slate-900 text-white border border-slate-700 space-y-3 animate-in fade-in duration-150"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-extrabold">
                      <Camera className="w-4 h-4 text-[#007DFE]" />
                      <span>Scan GCash QR Camera</span>
                    </div>
                    <button
                      type="button"
                      onClick={handleCloseQrScanner}
                      className="text-xs font-bold text-slate-300 hover:text-white px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 cursor-pointer"
                    >
                      Close Scanner
                    </button>
                  </div>

                  <div className="relative w-full h-48 bg-black rounded-xl overflow-hidden border border-slate-700 flex items-center justify-center">
                    <video
                      ref={scannerVideoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-6 border-2 border-dashed border-[#007DFE]/80 rounded-xl pointer-events-none flex items-center justify-center">
                      <span className="text-[10px] font-bold bg-black/70 text-blue-300 px-2.5 py-1 rounded-full">
                        {isCameraActive
                          ? 'Camera Active • Align GCash QR inside frame'
                          : 'Initializing Camera...'}
                      </span>
                    </div>
                  </div>

                  {cameraError && (
                    <p className="text-[11px] text-amber-300 leading-relaxed">
                      {cameraError}
                    </p>
                  )}
                </div>
              )}

              {/* Dedicated Payment Gateway Component */}
              <PaymentGateway
                planAmount={planAmount}
                onSubmitReference={async (method, ref) => {
                  await onSubmitReference(method, ref);
                  triggerSubmissionToast(ref);
                }}
                onClose={onClose}
                isAlreadyPending={isAlreadyPending}
                existingPendingRef={existingPendingRef}
                autoDownloadedQr={autoDownloadedQr}
                qrBlobUrl={qrBlobUrl}
                onDownloadQrCode={triggerGcashQrDownload}
                onScanQrCode={handleStartQrScanner}
              />
            </div>
          )}

          {/* ======================================================== */}
          {/* TAB 3: PRO STATUS (WHEN USER IS ALREADY PRO)             */}
          {/* ======================================================== */}
          {activeTab === 'status' && isPro && (
            <div className="space-y-4 text-center py-2 animate-in fade-in duration-150">
              <div className="w-16 h-16 rounded-3xl bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto shadow-md">
                <CheckCircle2 className="w-8 h-8" />
              </div>

              <div>
                <h3 className="text-xl font-extrabold text-slate-900">MotoCare Pro is Active!</h3>
                <p className="text-xs text-slate-500 mt-1">
                  You have full unlimited access to all Pro features across your entire motorcycle garage.
                </p>
              </div>

              {/* Checklist of active features */}
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs space-y-2 text-left">
                <div className="font-extrabold text-slate-800 text-[11px] uppercase tracking-wider mb-1 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
                  Your Unlocked VIP Perks:
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[11px] text-slate-700">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>Unlimited Garage Bikes</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>Zero-Touch GPS Odometer</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>CASA PDF Service Booklets</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>Priority Overdue Alerts</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>Smart LTO Plate Tracker</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>Continuous Cloud Backup</span>
                  </div>
                </div>
              </div>

              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs space-y-1.5 text-left">
                <div className="flex justify-between">
                  <span className="text-slate-500">Subscription Tier:</span>
                  <span className="font-bold text-emerald-600">Active Pro Member (₱49/mo)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Payment Channel:</span>
                  <span className="font-bold text-slate-800 uppercase">
                    {subscription.paymentMethod || 'GCash'}
                  </span>
                </div>
                {subscription.referenceNumber && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Verified Reference:</span>
                    <span className="font-mono text-slate-800 font-semibold">
                      {subscription.referenceNumber}
                    </span>
                  </div>
                )}
                {subscription.expiryDate && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Expires On:</span>
                    <span className="font-semibold text-slate-800">
                      {new Date(subscription.expiryDate).toLocaleDateString('en-PH', {
                        timeZone: 'Asia/Manila',
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                  </div>
                )}
                {subscription.daysRemaining !== undefined && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Days Remaining:</span>
                    <span className="font-bold text-emerald-600 font-mono">
                      {subscription.daysRemaining} days left
                    </span>
                  </div>
                )}
              </div>

              <div className="pt-2 space-y-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full py-3 bg-slate-900 hover:bg-black text-white font-bold text-xs rounded-2xl transition-all shadow-md cursor-pointer"
                >
                  Return to Garage
                </button>

                <button
                  type="button"
                  onClick={() => {
                    sounds.playClick();
                    setActiveTab('details');
                  }}
                  className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-2xl transition-all cursor-pointer"
                >
                  Review Pro Features Checklist
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
                        className="flex-1 py-1.5 text-xs font-bold text-slate-600 bg-white border border-slate-200 rounded-xl cursor-pointer"
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
          )}
        </div>
      </div>
    </div>
  );
};
