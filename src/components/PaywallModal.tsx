import React from 'react';
import { UserSubscription, PaymentProvider } from '../types';
import {
  X,
  Check,
  Sparkles,
  Bike,
  FileSpreadsheet,
  BellRing,
  ShieldCheck,
  Crown,
  QrCode,
  Download,
  Copy,
  Clock,
  CheckCircle2,
  Send,
  Camera,
  CameraOff,
  MailWarning,
} from 'lucide-react';
import { sounds } from '../utils/audio';
import { useAuth } from '../context/AuthContext';
import { resendVerificationEmail } from '../utils/firebase';
import { validatePaymentReferenceNumber } from '../utils/firestoreService';

const GCASH_QR_IMAGE_URL = '/assets/aistudio/gcash_37c30549.jpg';

interface PaywallModalProps {
  isOpen: boolean;
  onClose: () => void;
  subscription: UserSubscription;
  hasProAccess?: boolean;
  onSubmitReference: (provider: PaymentProvider, referenceCode: string) => void | Promise<void>;
  onCancelSubscription: () => void;
}

export const PaywallModal: React.FC<PaywallModalProps> = ({
  isOpen,
  onClose,
  subscription,
  hasProAccess: propHasProAccess,
  onSubmitReference,
  onCancelSubscription,
}) => {
  const { user, hasProAccess: contextHasProAccess } = useAuth();
  const [showQRView, setShowQRView] = React.useState(false);
  const [copiedAmount, setCopiedAmount] = React.useState(false);
  const [qrActionFeedback, setQrActionFeedback] = React.useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = React.useState(false);
  const [scannerStatus, setScannerStatus] = React.useState<string | null>(null);
  const [referenceInput, setReferenceInput] = React.useState('');
  const [inputError, setInputError] = React.useState(false);
  const [inputErrorMessage, setInputErrorMessage] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [toastNotification, setToastNotification] = React.useState<string | null>(null);
  const [resendingVerification, setResendingVerification] = React.useState(false);
  const [verificationFeedback, setVerificationFeedback] = React.useState<string | null>(null);
  const downloadAnchorRef = React.useRef<HTMLAnchorElement | null>(null);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const mediaStreamRef = React.useRef<MediaStream | null>(null);

  const stopCameraScanner = React.useCallback(() => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    setScannerOpen(false);
  }, []);

  React.useEffect(() => {
    if (!isOpen || !showQRView) {
      stopCameraScanner();
    }
    return () => {
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      }
    };
  }, [isOpen, showQRView, stopCameraScanner]);

  if (!isOpen) return null;

  const isEmailUnverified = Boolean(user && !user.emailVerified);
  const isPro =
    propHasProAccess ??
    contextHasProAccess ??
    (subscription.tier === 'pro' &&
      subscription.status === 'active' &&
      !subscription.isExpired);
  const isPendingVerification = subscription.status === 'trial' && !isPro;

  const handleCopyAmount = () => {
    sounds.playClick();
    setCopiedAmount(true);
    setQrActionFeedback('Amount ₱49 copied to clipboard');
    try {
      navigator.clipboard?.writeText('49')?.catch?.(() => {});
    } catch {
      // Fallback if clipboard API is restricted
    }
    setTimeout(() => {
      setCopiedAmount(false);
      setQrActionFeedback(null);
    }, 2200);
  };

  const handleDownloadQR = () => {
    sounds.playClick();
    if (downloadAnchorRef.current) {
      downloadAnchorRef.current.click();
    } else {
      const link = document.createElement('a');
      link.href = GCASH_QR_IMAGE_URL;
      link.download = 'MotoCare-GCash-QR-49PHP.jpg';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
    setQrActionFeedback('GCash QR image downloaded to your device');
    setTimeout(() => setQrActionFeedback(null), 2500);
  };

  const handleToggleCameraScanner = async () => {
    sounds.playClick();
    if (scannerOpen) {
      stopCameraScanner();
      setScannerStatus(null);
      return;
    }

    setScannerOpen(true);
    setScannerStatus('Point your camera at a GCash QR or receipt code...');

    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        mediaStreamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setScannerStatus('Camera active — align GCash QR code inside the frame.');
      } catch {
        setScannerStatus(
          'Camera permission unavailable on this browser. Please scan using your GCash app or save the QR image.'
        );
      }
    } else {
      setScannerStatus(
        'Camera scanner ready — open your GCash app or grant camera permission to scan.'
      );
    }
  };

  const handleResendVerification = async () => {
    if (!user || resendingVerification) return;
    setResendingVerification(true);
    setVerificationFeedback(null);
    try {
      await resendVerificationEmail(user);
      setVerificationFeedback('Verification email sent! Please check your inbox and refresh once verified.');
    } catch (err: any) {
      setVerificationFeedback(err?.message || 'Unable to send verification email right now.');
    } finally {
      setResendingVerification(false);
    }
  };

  const handleSubmitRef = async (e: React.FormEvent) => {
    e.preventDefault();
    setInputError(false);
    setInputErrorMessage(null);

    if (isEmailUnverified) {
      setInputError(true);
      setInputErrorMessage('Verify your email before submitting a payment reference.');
      return;
    }

    const validation = validatePaymentReferenceNumber(referenceInput);
    if (!validation.valid) {
      setInputError(true);
      setInputErrorMessage(
        validation.error || 'Please enter a valid 8–64 character alphanumeric GCash reference number.'
      );
      return;
    }

    setSubmitting(true);
    try {
      sounds.playSuccess();
      await onSubmitReference('gcash', validation.trimmed);
      setToastNotification(
        `GCash Payment Reference Submitted! Reference #${validation.trimmed} received. Admin verification typically completes within 5–15 minutes.`
      );
      setShowQRView(false);
      setReferenceInput('');
      setTimeout(() => {
        setToastNotification(null);
      }, 6000);
    } catch (err: any) {
      setInputError(true);
      setInputErrorMessage(
        err instanceof Error ? err.message : 'Could not submit payment reference.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const proBenefits = [
    {
      icon: <Bike className="w-4 h-4 text-[#FF6B00]" />,
      title: 'Unlimited Garage Bikes',
      desc: 'Track scooters, big bikes, and commuter fleets without the 1-bike Free limit.',
    },
    {
      icon: <BellRing className="w-4 h-4 text-amber-500" />,
      title: 'Unlimited Smart PMS Reminders',
      desc: 'Never miss Engine Oil, CVT Belt, Valve Clearance, or Coolant intervals.',
    },
    {
      icon: <FileSpreadsheet className="w-4 h-4 text-emerald-600" />,
      title: 'CSV & Verified Casa Service Booklet',
      desc: 'Export complete maintenance history to boost resale value when selling.',
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
      {toastNotification && (
        <div
          role="status"
          aria-live="polite"
          className="fixed top-4 left-1/2 -translate-x-1/2 z-[70] w-[92%] max-w-md p-4 rounded-2xl bg-slate-900 text-white border border-emerald-500/50 shadow-2xl flex items-start gap-3 animate-fade-in"
        >
          <div className="w-8 h-8 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center shrink-0 text-emerald-400 mt-0.5">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div className="flex-1 text-xs leading-relaxed">
            <div className="font-extrabold text-emerald-300 text-sm">
              GCash Payment Reference Submitted!
            </div>
            <p className="text-slate-200 mt-0.5">{toastNotification}</p>
          </div>
          <button
            type="button"
            onClick={() => setToastNotification(null)}
            className="text-slate-400 hover:text-white p-1"
            aria-label="Dismiss notification"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="w-full max-w-lg rounded-3xl overflow-hidden border border-slate-200 shadow-2xl bg-white relative max-h-[92vh] flex flex-col">
        {/* Top Banner */}
        <div className="relative p-5 sm:p-6 bg-gradient-to-br from-[#FF6B00]/10 via-amber-50/70 to-white border-b border-slate-100 shrink-0">
          <button
            type="button"
            onClick={() => {
              setShowQRView(false);
              onClose();
            }}
            className="absolute top-4 right-4 p-2 rounded-full bg-slate-100 text-slate-500 hover:text-slate-800 hover:bg-slate-200 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-100 border border-amber-200 text-amber-800 text-xs font-bold uppercase tracking-wider mb-2">
            <Crown className="w-3.5 h-3.5 text-[#FF6B00]" />
            <span>MotoCare Pro</span>
          </div>

          <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
            {isPro
              ? 'Your MotoCare Pro Membership'
              : isPendingVerification
              ? 'Payment Verification in Progress'
              : showQRView
              ? 'Scan to Pay ₱49.00 via GCash'
              : 'Upgrade to MotoCare Pro'}
          </h2>
          <p className="text-xs sm:text-sm text-slate-600 mt-0.5">
            {isPro
              ? 'Verified by Admin! All Pro garage features are unlocked.'
              : isPendingVerification
              ? 'Your ₱49 payment reference has been submitted and is awaiting Admin approval.'
              : showQRView
              ? 'Scan the official GCash QR code below and submit your reference number.'
              : 'Unlock unlimited motorcycles, smart PMS alerts, GPS ride tracking & exports.'}
          </p>
        </div>

        {/* Hidden anchor for direct QR image download */}
        <a
          ref={downloadAnchorRef}
          href={GCASH_QR_IMAGE_URL}
          download="MotoCare-GCash-QR-49PHP.jpg"
          className="hidden"
          data-testid="hidden-gcash-qr-download-anchor"
        >
          Download GCash QR
        </a>

        {/* Body */}
        <div className="p-5 sm:p-6 space-y-5 overflow-y-auto">
          {isEmailUnverified && !isPro && (
            <div
              data-testid="paywall-verify-email-banner"
              className="p-4 rounded-2xl bg-amber-50 border border-amber-300 space-y-2.5 text-xs text-amber-950"
            >
              <div className="flex items-center gap-2 font-extrabold text-amber-900 text-sm">
                <MailWarning className="w-5 h-5 text-[#FF6B00] shrink-0" />
                <span>Verify your email</span>
              </div>
              <p className="text-amber-800 leading-relaxed">
                Please verify your email address ({user?.email}) before submitting a GCash payment reference.
              </p>
              <button
                type="button"
                data-testid="paywall-resend-verification-btn"
                disabled={resendingVerification}
                onClick={handleResendVerification}
                className="w-full py-2.5 px-4 rounded-xl bg-[#FF6B00] hover:bg-[#e05e00] disabled:opacity-60 text-white font-extrabold text-xs transition-colors cursor-pointer"
              >
                {resendingVerification ? 'Sending Verification Email...' : 'Resend Verification Email'}
              </button>
              {verificationFeedback && (
                <p className="text-[11px] font-bold text-emerald-700">{verificationFeedback}</p>
              )}
            </div>
          )}

          {!showQRView ? (
            <>
              {/* Benefits List */}
              <div className="space-y-2.5">
                {proBenefits.map((b, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-3 p-3 rounded-2xl bg-slate-50 border border-slate-200/80"
                  >
                    <div className="p-2 rounded-xl bg-white border border-slate-200/60 shrink-0 mt-0.5 shadow-2xs">
                      {b.icon}
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-slate-900">{b.title}</h4>
                      <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{b.desc}</p>
                    </div>
                  </div>
                ))}
              </div>

              {!isPro && !isPendingVerification ? (
                <>
                  {/* Pricing Card */}
                  <div className="p-4 rounded-2xl border-2 border-[#FF6B00] bg-orange-50/70 flex items-center justify-between relative">
                    <div>
                      <span className="inline-block text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#FF6B00] text-white mb-1">
                        Monthly Pro Pass
                      </span>
                      <div className="text-base font-extrabold text-slate-900">
                        Full Pro Access
                      </div>
                      <div className="text-xs text-slate-600 mt-0.5">
                        Pay easily via GCash QR
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-3xl font-black text-slate-900 font-mono">₱49</div>
                      <div className="text-xs text-slate-500 font-semibold">per month</div>
                    </div>
                  </div>

                  {/* Proceed to GCash QR Button */}
                  <button
                    type="button"
                    disabled={isEmailUnverified}
                    onClick={() => {
                      sounds.playClick();
                      setShowQRView(true);
                    }}
                    className="w-full py-3.5 px-6 rounded-xl bg-gradient-to-r from-[#0057E7] to-[#0041B3] hover:from-[#0047C2] hover:to-[#003594] disabled:opacity-50 disabled:cursor-not-allowed text-white font-extrabold text-sm shadow-lg shadow-blue-600/25 transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <QrCode className="w-4 h-4" />
                    <span>Pay with GCash (₱49/month)</span>
                  </button>
                </>
              ) : isPendingVerification ? (
                /* Pending Admin Approval State */
                <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-10 h-10 rounded-xl bg-amber-100 border border-amber-300 flex items-center justify-center text-amber-700 shrink-0">
                        <Clock className="w-5 h-5 animate-pulse" />
                      </div>
                      <div>
                        <div className="text-xs text-amber-800 font-extrabold uppercase tracking-wider">
                          Pending Admin Verification
                        </div>
                        <div className="text-sm font-bold text-slate-900 mt-0.5">
                          ₱49.00 via GCash
                        </div>
                      </div>
                    </div>
                    <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-amber-200/80 text-amber-900">
                      Awaiting Review
                    </span>
                  </div>

                  {subscription.referenceNumber && (
                    <div className="p-2.5 rounded-xl bg-white border border-amber-200/80 flex items-center justify-between text-xs">
                      <span className="text-slate-500 font-medium">Submitted Ref No:</span>
                      <span className="font-mono font-bold text-slate-900">
                        {subscription.referenceNumber}
                      </span>
                    </div>
                  )}

                  <p className="text-xs text-amber-900/80 leading-relaxed">
                    Our admin is verifying your ₱49 GCash transfer. Once approved in the Admin Portal, your account will automatically unlock <strong>MotoCare Pro</strong>.
                  </p>

                  <div className="flex items-center justify-between pt-2 border-t border-amber-200/60">
                    <button
                      type="button"
                      onClick={() => setShowQRView(true)}
                      className="text-xs text-[#0057E7] hover:underline font-bold cursor-pointer"
                    >
                      Update Reference Number
                    </button>
                    <button
                      type="button"
                      onClick={onCancelSubscription}
                      className="text-xs text-red-600 hover:text-red-700 font-semibold cursor-pointer"
                    >
                      Cancel Request
                    </button>
                  </div>
                </div>
              ) : (
                /* Active Pro State */
                <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-10 h-10 rounded-xl bg-emerald-100 border border-emerald-300 flex items-center justify-center text-emerald-700 shrink-0">
                        <CheckCircle2 className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="text-xs text-emerald-700 font-bold uppercase tracking-wider">
                          Verified Active Plan
                        </div>
                        <div className="text-base font-extrabold text-slate-900 mt-0.5">
                          MotoCare Pro (₱49/month)
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={onCancelSubscription}
                      className="text-xs text-red-600 hover:text-red-700 font-semibold underline cursor-pointer"
                    >
                      Cancel Plan
                    </button>
                  </div>

                  {subscription.expiryDate && (
                    <div className="p-2.5 rounded-xl bg-white border border-emerald-200/80 flex items-center justify-between text-xs">
                      <span className="text-slate-500 font-medium">Valid Until (Asia/Manila):</span>
                      <span className="font-mono font-bold text-emerald-800">
                        {new Date(subscription.expiryDate).toLocaleDateString('en-PH', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })}
                        {typeof subscription.daysRemaining === 'number' &&
                          ` (${subscription.daysRemaining} days left)`}
                      </span>
                    </div>
                  )}

                  <div className="pt-1 border-t border-emerald-200/60 flex items-center justify-between">
                    <span className="text-[11px] text-emerald-800">
                      Want to renew early? Extends from your current expiry date.
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowQRView(true)}
                      className="text-xs font-extrabold text-[#0057E7] hover:underline cursor-pointer shrink-0 ml-2"
                    >
                      Renew (+1 Month)
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            /* QR Code & Reference Submission View (GCash Only) */
            <div className="space-y-4 animate-fade-in">
              {/* Official GCash Badge Header */}
              <div className="flex items-center justify-between p-3 rounded-2xl bg-[#0057E7]/10 border border-[#0057E7]/25">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-[#0057E7] text-white font-black text-sm flex items-center justify-center shadow-sm">
                    G
                  </div>
                  <div>
                    <div className="text-xs font-extrabold text-[#0057E7] uppercase tracking-wider">
                      Official GCash QR Ph
                    </div>
                    <div className="text-[11px] text-slate-600 font-medium">
                      Instant ₱49.00 Monthly Pro Pass
                    </div>
                  </div>
                </div>
                <span className="text-lg font-black text-slate-900 font-mono">₱49.00</span>
              </div>

              {/* QR Display Card */}
              <div className="p-4 rounded-3xl border-2 border-slate-200 bg-slate-50 flex flex-col items-center text-center">
                <div className="flex items-center justify-between w-full mb-2 px-1">
                  <span className="font-extrabold text-xs uppercase tracking-wider text-[#0057E7]">
                    GCash InstaPay QR Code
                  </span>
                  <span className="text-xs font-black text-slate-900 bg-white px-2.5 py-0.5 rounded-full border border-slate-200">
                    ₱49.00
                  </span>
                </div>

                <div className="w-full max-w-[230px] rounded-2xl overflow-hidden border border-slate-200 bg-white shadow-md">
                  <img
                    src={GCASH_QR_IMAGE_URL}
                    alt="Official GCash QR Code"
                    className="w-full h-auto object-contain block"
                  />
                </div>

                {/* Primary QR Action Toolbar */}
                <div className="mt-3 grid grid-cols-2 gap-2 w-full">
                  <button
                    type="button"
                    onClick={handleDownloadQR}
                    className="py-2 px-3 rounded-xl bg-[#0057E7] hover:bg-[#0047C2] text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-colors shadow-xs cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download QR Code</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleToggleCameraScanner}
                    className={`py-2 px-3 rounded-xl border font-bold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                      scannerOpen
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white hover:bg-slate-100 border-slate-200 text-slate-700'
                    }`}
                  >
                    {scannerOpen ? (
                      <>
                        <CameraOff className="w-3.5 h-3.5 text-amber-400" />
                        <span>Close Scanner</span>
                      </>
                    ) : (
                      <>
                        <Camera className="w-3.5 h-3.5 text-[#0057E7]" />
                        <span>Scan GCash QR</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="mt-2 flex items-center gap-2 w-full">
                  <button
                    type="button"
                    onClick={handleDownloadQR}
                    className="flex-1 py-2 px-3 rounded-xl bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 font-bold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5 text-[#0057E7]" />
                    <span>Save QR Image</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyAmount}
                    aria-label="Copy to Clipboard"
                    className="py-2 px-3 rounded-xl bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 font-bold text-xs flex items-center justify-center gap-1 transition-colors cursor-pointer"
                  >
                    {copiedAmount ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        <span className="text-emerald-700">Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy ₱49</span>
                      </>
                    )}
                  </button>
                </div>

                {qrActionFeedback && (
                  <div className="mt-2 w-full py-1.5 px-3 rounded-xl bg-emerald-50 border border-emerald-200 text-[11px] font-bold text-emerald-700">
                    {qrActionFeedback}
                  </div>
                )}

                {scannerOpen && (
                  <div
                    data-testid="gcash-qr-camera-scanner"
                    className="mt-3 w-full p-3 rounded-2xl bg-slate-900 text-white space-y-2 text-left"
                  >
                    <div className="flex items-center justify-between text-[11px] font-bold text-cyan-300">
                      <span className="flex items-center gap-1.5">
                        <Camera className="w-3.5 h-3.5" />
                        <span>GCash QR Camera Scanner</span>
                      </span>
                      <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-200">
                        Active
                      </span>
                    </div>
                    <div className="w-full h-36 rounded-xl bg-slate-950 border border-slate-800 overflow-hidden flex items-center justify-center relative">
                      <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        muted
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-4 border-2 border-dashed border-cyan-400/70 rounded-xl pointer-events-none" />
                    </div>
                    {scannerStatus && (
                      <p className="text-[11px] text-slate-300 leading-relaxed">{scannerStatus}</p>
                    )}
                  </div>
                )}

                {/* Clear Step-by-Step GCash Instructions */}
                <div className="mt-3 w-full text-left p-3 rounded-2xl bg-white border border-slate-200/90 text-[11px] text-slate-600 space-y-1">
                  <div className="font-extrabold text-slate-800 text-xs">
                    How to Pay with GCash:
                  </div>
                  <ol className="list-decimal list-inside space-y-0.5">
                    <li>Open your <strong>GCash</strong> app and tap <strong>QR</strong>.</li>
                    <li>Scan the QR code above or tap <strong>Save QR Image</strong> and upload from your phone gallery.</li>
                    <li>Send <strong>₱49.00</strong> and copy the <strong>Ref. No.</strong> from your receipt.</li>
                  </ol>
                </div>
              </div>

              {/* Submit Reference Number Form */}
              <form onSubmit={handleSubmitRef} className="space-y-3">
                <div>
                  <label className="block text-xs font-extrabold text-slate-800 mb-1">
                    Step 2: Enter Your GCash Reference Number
                  </label>
                  <input
                    type="text"
                    value={referenceInput}
                    onChange={(e) => {
                      setReferenceInput(e.target.value);
                      if (inputError) {
                        setInputError(false);
                        setInputErrorMessage(null);
                      }
                    }}
                    placeholder="Enter GCash Ref No. (e.g. 9001827364512)"
                    maxLength={64}
                    className={`w-full px-3.5 py-2.5 rounded-xl border text-xs font-mono text-slate-900 placeholder-slate-400 focus:outline-none transition-colors ${
                      inputError
                        ? 'border-red-500 bg-red-50/50 focus:border-red-600'
                        : 'border-slate-300 bg-white focus:border-[#0057E7]'
                    }`}
                  />
                  {inputError && (
                    <p role="alert" className="text-[11px] text-red-600 font-semibold mt-1">
                      {inputErrorMessage ||
                        'Please enter your valid 8–64 character alphanumeric GCash reference number from your receipt.'}
                    </p>
                  )}
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowQRView(false)}
                    className="py-3 px-4 rounded-xl border border-slate-200 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition-colors cursor-pointer"
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    disabled={submitting || isEmailUnverified}
                    className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-[#FF6B00] to-amber-500 hover:from-[#e05e00] hover:to-amber-600 disabled:opacity-50 text-slate-950 font-extrabold text-xs shadow-md shadow-orange-500/20 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>
                      {submitting
                        ? 'Submitting Reference...'
                        : 'Submit Reference for Admin Verification'}
                    </span>
                  </button>
                </div>
              </form>
            </div>
          )}

          <div className="flex items-center justify-center gap-2 text-xs text-slate-400 pt-1">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Verified by MotoCare Admin • Instant Pro Activation upon Check</span>
          </div>
        </div>
      </div>
    </div>
  );
};
