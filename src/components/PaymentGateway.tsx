import React, { useState } from 'react';
import { PaymentProvider } from '../types';
import {
  CheckCircle2,
  ShieldCheck,
  ArrowLeft,
  Lock,
  Sparkles,
  Copy,
  Check,
  Smartphone,
  QrCode,
  Download,
  MailWarning,
} from 'lucide-react';
import { sounds } from '../utils/audio';
import { useAuth } from '../context/AuthContext';
import { resendVerificationEmail } from '../utils/firebase';
import { validatePaymentReferenceNumber } from '../utils/firestoreService';

// Verified GCash InstaPay QR Code uploaded by Owner
const GCASH_QR_IMAGE_URL = '/assets/aistudio/gcash_37c30549.jpg';

interface PaymentGatewayProps {
  onSuccess: (provider: PaymentProvider, referenceCode: string) => void;
  onCancel: () => void;
}

export const PaymentGateway: React.FC<PaymentGatewayProps> = ({
  onSuccess,
  onCancel,
}) => {
  const { user } = useAuth();
  const [step, setStep] = useState<'scan_qr' | 'verifying' | 'success'>('scan_qr');
  const [copiedAmount, setCopiedAmount] = useState(false);
  const [referenceInput, setReferenceInput] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [resendStatus, setResendStatus] = useState<string | null>(null);
  const [resendingEmail, setResendingEmail] = useState(false);

  const isEmailUnverified = Boolean(user && !user.emailVerified);

  const handleCopyAmount = () => {
    navigator.clipboard?.writeText('49');
    setCopiedAmount(true);
    sounds.playClick();
    setTimeout(() => setCopiedAmount(false), 2000);
  };

  const handleDownloadQR = () => {
    sounds.playClick();
    const link = document.createElement('a');
    link.href = GCASH_QR_IMAGE_URL;
    link.download = 'MotoCare-GCash-QR-49PHP.jpg';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleResendVerification = async () => {
    if (!user || resendingEmail) return;
    setResendingEmail(true);
    setResendStatus(null);
    try {
      await resendVerificationEmail(user);
      setResendStatus('Verification email sent! Please check your inbox and refresh after verifying.');
    } catch (err: any) {
      setResendStatus(err?.message || 'Could not resend verification email. Please try again later.');
    } finally {
      setResendingEmail(false);
    }
  };

  const handleConfirmPayment = () => {
    setValidationError(null);
    if (isEmailUnverified) {
      setValidationError('Verify your email before submitting a payment reference.');
      return;
    }

    const check = validatePaymentReferenceNumber(referenceInput);
    if (!check.valid) {
      setValidationError(
        check.error || 'Please enter a valid 8–64 character alphanumeric GCash reference number.'
      );
      return;
    }

    sounds.playClick();
    setStep('verifying');
    setTimeout(() => {
      sounds.playSuccess();
      setStep('success');
      setTimeout(() => {
        onSuccess('gcash', check.trimmed);
      }, 1400);
    }, 1800);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4 bg-slate-950/90 backdrop-blur-xl animate-fade-in">
      <div className="w-full max-w-md rounded-3xl overflow-hidden border border-slate-700/80 shadow-2xl bg-[#0D131F] text-white relative max-h-[94vh] flex flex-col">
        {/* Top Security Bar */}
        <div className="px-5 py-3.5 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between text-xs text-slate-400 shrink-0">
          <button
            type="button"
            onClick={onCancel}
            className="flex items-center gap-1.5 text-slate-300 hover:text-white transition-colors font-medium"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back</span>
          </button>
          <div className="flex items-center gap-1.5 text-emerald-400 font-semibold">
            <Lock className="w-3.5 h-3.5" />
            <span>GCash InstaPay QR</span>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="overflow-y-auto p-5 sm:p-6 space-y-5">
          {step === 'scan_qr' && (
            <>
              {/* Merchant & Plan Summary */}
              <div className="p-4 rounded-2xl bg-gradient-to-br from-[#0057E7]/25 to-[#002D72]/40 border border-blue-500/30 flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-blue-500/30 text-blue-200 border border-blue-400/30">
                    Official GCash QR
                  </span>
                  <h3 className="text-base font-extrabold text-white mt-1.5">
                    MotoCare Pro Membership
                  </h3>
                  <p className="text-xs text-blue-200/80">
                    Unlimited Bikes • GPS Tracker • Cloud Backup
                  </p>
                </div>
                <div className="text-right shrink-0 pl-3">
                  <div className="text-2xl font-black text-white font-mono">₱49.00</div>
                  <div className="text-[10px] text-blue-300 font-bold uppercase tracking-wider">
                    Per Month
                  </div>
                </div>
              </div>

              {isEmailUnverified ? (
                <div
                  data-testid="payment-gateway-verify-email-banner"
                  className="p-4 rounded-2xl bg-amber-500/15 border border-amber-500/40 text-xs text-amber-100 space-y-3"
                >
                  <div className="flex items-center gap-2 font-extrabold text-amber-300 text-sm">
                    <MailWarning className="w-5 h-5 shrink-0" />
                    <span>Verify your email</span>
                  </div>
                  <p className="text-amber-200/90 leading-relaxed">
                    Please verify your email address ({user?.email}) before submitting a GCash payment reference so your Pro subscription can be linked securely.
                  </p>
                  <button
                    type="button"
                    data-testid="resend-verification-email-btn"
                    disabled={resendingEmail}
                    onClick={handleResendVerification}
                    className="w-full py-2.5 px-4 rounded-xl bg-amber-400 hover:bg-amber-300 disabled:opacity-60 text-slate-950 font-black text-xs transition-colors cursor-pointer"
                  >
                    {resendingEmail ? 'Sending Verification Email...' : 'Resend Verification Email'}
                  </button>
                  {resendStatus && (
                    <p className="text-[11px] font-bold text-emerald-300">{resendStatus}</p>
                  )}
                </div>
              ) : (
                <>
                  {/* QR Code Card */}
                  <div className="bg-white rounded-3xl p-4 sm:p-5 text-slate-900 shadow-xl flex flex-col items-center text-center relative">
                    <div className="flex items-center justify-between w-full mb-2 px-1">
                      <div className="flex items-center gap-1.5">
                        <div className="w-6 h-6 rounded-lg bg-[#0057E7] text-white font-black text-xs flex items-center justify-center">
                          G
                        </div>
                        <span className="font-extrabold text-sm text-[#0057E7] tracking-tight">
                          GCash InstaPay
                        </span>
                      </div>
                      <span className="text-[11px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                        Verified Merchant
                      </span>
                    </div>

                    {/* User's Actual GCash QR Image */}
                    <div className="w-full max-w-[260px] rounded-2xl overflow-hidden border-2 border-blue-100 shadow-md bg-white my-1">
                      <img
                        src={GCASH_QR_IMAGE_URL}
                        alt="Official GCash QR Code"
                        className="w-full h-auto object-contain block"
                      />
                    </div>

                    <div className="mt-3 flex items-center justify-center gap-2 w-full">
                      <button
                        type="button"
                        onClick={handleDownloadQR}
                        className="flex-1 py-2 px-3 rounded-xl bg-blue-50 hover:bg-blue-100 text-[#0057E7] font-bold text-xs flex items-center justify-center gap-1.5 transition-colors border border-blue-200"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Save QR Image to Phone</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleCopyAmount}
                        className="py-2 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs flex items-center justify-center gap-1 transition-colors"
                      >
                        {copiedAmount ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-600" />
                            <span className="text-emerald-700">Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>₱49</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Step-by-step Instructions */}
                  <div className="p-3.5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-2 text-xs text-slate-300">
                    <div className="font-bold text-white flex items-center gap-1.5">
                      <Smartphone className="w-4 h-4 text-[#0057E7]" />
                      <span>How to Pay via GCash:</span>
                    </div>
                    <ol className="list-decimal list-inside space-y-1 text-slate-400 text-[11px]">
                      <li>
                        Open your <strong className="text-white">GCash App</strong> and tap{' '}
                        <strong className="text-white">QR</strong>.
                      </li>
                      <li>
                        Scan the QR code above (or tap{' '}
                        <strong className="text-white">Save QR Image</strong> &amp; upload from gallery).
                      </li>
                      <li>
                        Enter exact amount <strong className="text-emerald-400">₱49.00</strong> and complete
                        payment.
                      </li>
                      <li>
                        Enter your 8–64 character <strong className="text-white">GCash Ref. No.</strong> from your receipt below.
                      </li>
                    </ol>
                  </div>

                  {/* Real GCash Reference Number Input */}
                  <div className="space-y-1.5">
                    <label
                      htmlFor="gateway-gcash-ref-input"
                      className="block text-xs font-bold text-slate-200"
                    >
                      GCash Reference Number (Required)
                    </label>
                    <input
                      id="gateway-gcash-ref-input"
                      type="text"
                      value={referenceInput}
                      onChange={(e) => {
                        setReferenceInput(e.target.value);
                        if (validationError) setValidationError(null);
                      }}
                      placeholder="e.g. 9001827364512"
                      maxLength={64}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-[#0057E7]"
                    />
                    {validationError && (
                      <p role="alert" className="text-xs font-bold text-red-400">
                        {validationError}
                      </p>
                    )}
                  </div>

                  {/* Confirm Payment Button */}
                  <button
                    type="button"
                    onClick={handleConfirmPayment}
                    className="w-full py-3.5 rounded-xl font-extrabold text-sm text-white bg-gradient-to-r from-[#0057E7] to-[#0041B3] hover:from-[#0047C2] hover:to-[#003594] shadow-lg shadow-blue-600/30 transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <QrCode className="w-4 h-4" />
                    <span>Submit GCash Reference (₱49.00)</span>
                  </button>
                </>
              )}
            </>
          )}

          {step === 'verifying' && (
            <div className="py-12 text-center space-y-4">
              <div className="w-16 h-16 rounded-full border-4 border-[#0057E7]/30 border-t-[#0057E7] animate-spin mx-auto" />
              <div>
                <h4 className="text-base font-bold text-white">
                  Submitting GCash Payment Reference...
                </h4>
                <p className="text-xs text-slate-400 mt-1">
                  Confirming reference {referenceInput.trim()}
                </p>
              </div>
            </div>
          )}

          {step === 'success' && (
            <div className="py-10 text-center space-y-4 animate-fade-in">
              <div className="w-16 h-16 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center mx-auto text-emerald-400">
                <CheckCircle2 className="w-10 h-10" />
              </div>
              <div>
                <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 mb-2">
                  <Sparkles className="w-3 h-3" /> Reference Submitted
                </span>
                <h4 className="text-xl font-extrabold text-white">
                  GCash Payment Submitted!
                </h4>
                <p className="text-xs text-slate-400 mt-1">
                  Ref: <span className="font-mono text-slate-300">{referenceInput.trim()}</span>
                </p>
              </div>
            </div>
          )}

          <div className="pt-2 border-t border-slate-800/80 flex items-center justify-center gap-2 text-[11px] text-slate-500">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Secured via Official GCash InstaPay QR Ph</span>
          </div>
        </div>
      </div>
    </div>
  );
};
