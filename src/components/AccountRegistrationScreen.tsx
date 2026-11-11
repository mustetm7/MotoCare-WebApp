import React, { useState } from 'react';
import {
  ArrowLeft,
  User,
  Mail,
  Lock,
  Eye,
  EyeOff,
  AlertCircle,
  CheckCircle2,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { sounds } from '../utils/audio';

export const REMEMBERED_EMAIL_STORAGE_KEY = 'motocare_remembered_email';

export interface AccountRegistrationScreenProps {
  initialMode?: 'register' | 'signin';
  onBack?: () => void;
  onSuccess?: () => void;
}

export const AccountRegistrationScreen: React.FC<AccountRegistrationScreenProps> = ({
  initialMode = 'register',
  onBack,
  onSuccess,
}) => {
  const { signIn, signInWithEmail, signUpWithEmail, resetPassword } = useAuth();

  const [mode, setMode] = useState<'register' | 'signin'>(initialMode);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState(() => {
    try {
      return localStorage.getItem(REMEMBERED_EMAIL_STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });
  const [rememberMe, setRememberMe] = useState<boolean>(() => {
    try {
      return Boolean(localStorage.getItem(REMEMBERED_EMAIL_STORAGE_KEY));
    } catch {
      return false;
    }
  });
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  const [errorMessage, setErrorMessage] = useState('');
  const [infoMessage, setInfoMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [legalDocModal, setLegalDocModal] = useState<'terms' | 'privacy' | null>(null);

  const switchMode = (nextMode: 'register' | 'signin') => {
    sounds.playClick();
    setMode(nextMode);
    setErrorMessage('');
    setInfoMessage('');
    if (nextMode === 'signin' && !email) {
      try {
        const savedEmail = localStorage.getItem(REMEMBERED_EMAIL_STORAGE_KEY);
        if (savedEmail) {
          setEmail(savedEmail);
          setRememberMe(true);
        }
      } catch {
        // ignore storage read error
      }
    }
  };

  const formatFirebaseAuthError = (err: unknown): string => {
    const raw = err instanceof Error ? err.message : String(err);
    const lower = raw.toLowerCase();
    if (lower.includes('email-already-in-use')) {
      return 'An account with this email already exists. Please sign in instead.';
    }
    if (
      lower.includes('user-not-found') ||
      lower.includes('wrong-password') ||
      lower.includes('invalid-credential')
    ) {
      return 'Invalid email address or password. Please check your credentials and try again.';
    }
    if (lower.includes('invalid-email')) {
      return 'Please enter a valid email address.';
    }
    if (lower.includes('weak-password')) {
      return 'Password must be at least 6 characters long.';
    }
    if (lower.includes('too-many-requests')) {
      return 'Too many attempts. Please wait a moment before trying again.';
    }
    if (lower.includes('popup-closed-by-user')) {
      return 'Google Sign-In was cancelled before completion.';
    }
    return raw || 'Authentication failed. Please check your details and try again.';
  };

  const isValidEmail = (value: string): boolean => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    setErrorMessage('');
    setInfoMessage('');

    const trimmedName = fullName.trim();
    const trimmedEmail = email.trim();

    if (mode === 'register') {
      if (!trimmedName) {
        setErrorMessage('Please enter your full name.');
        return;
      }
      if (!trimmedEmail || !isValidEmail(trimmedEmail)) {
        setErrorMessage('Please enter a valid email address.');
        return;
      }
      if (!password || password.length < 6) {
        setErrorMessage('Password must be at least 6 characters.');
        return;
      }
      if (password !== confirmPassword) {
        setErrorMessage('Passwords do not match. Please re-enter your password.');
        return;
      }
      if (!agreedToTerms) {
        setErrorMessage('Please agree to the Terms of Service and Privacy Policy to continue.');
        return;
      }

      setIsSubmitting(true);
      try {
        await signUpWithEmail(trimmedEmail, password, trimmedName);
        sounds.playSuccess();
        onSuccess?.();
      } catch (err) {
        setErrorMessage(formatFirebaseAuthError(err));
      } finally {
        setIsSubmitting(false);
      }
    } else {
      if (!trimmedEmail || !isValidEmail(trimmedEmail)) {
        setErrorMessage('Please enter a valid email address.');
        return;
      }
      if (!password) {
        setErrorMessage('Please enter your password.');
        return;
      }

      try {
        if (rememberMe) {
          localStorage.setItem(REMEMBERED_EMAIL_STORAGE_KEY, trimmedEmail);
        } else {
          localStorage.removeItem(REMEMBERED_EMAIL_STORAGE_KEY);
        }
      } catch {
        // ignore storage write error
      }

      setIsSubmitting(true);
      try {
        await signInWithEmail(trimmedEmail, password);
        sounds.playSuccess();
        onSuccess?.();
      } catch (err) {
        setErrorMessage(formatFirebaseAuthError(err));
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  const handleGoogleContinue = async () => {
    if (isSubmitting) return;
    setErrorMessage('');
    setInfoMessage('');
    setIsSubmitting(true);
    try {
      const loggedUser = await signIn();
      if (loggedUser) {
        sounds.playSuccess();
        onSuccess?.();
      }
    } catch (err) {
      setErrorMessage(formatFirebaseAuthError(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleForgotPassword = async () => {
    if (isSubmitting) return;
    setErrorMessage('');
    setInfoMessage('');

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !isValidEmail(trimmedEmail)) {
      setErrorMessage('Enter your email address above first so we can send a password reset link.');
      return;
    }

    setIsSubmitting(true);
    try {
      await resetPassword(trimmedEmail);
      sounds.playSuccess();
      setInfoMessage(`Password reset instructions have been sent to ${trimmedEmail}.`);
    } catch (err) {
      setErrorMessage(formatFirebaseAuthError(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      data-testid="account-registration-screen"
      className="w-full max-w-md mx-auto my-2 pb-10 overflow-y-auto overscroll-y-contain animate-in fade-in duration-200"
    >
      {/* Top Navy-Blue Gradient Hero Section */}
      <div className="relative rounded-t-3xl bg-gradient-to-b from-[#08152C] via-[#0E2248] to-[#153166] px-6 pt-5 pb-14 text-white overflow-hidden shadow-lg">
        {/* Back Arrow Button */}
        {onBack && (
          <div className="flex items-center justify-start mb-3">
            <button
              type="button"
              onClick={() => {
                sounds.playClick();
                onBack();
              }}
              title="Back to Welcome Screen"
              aria-label="Back to Welcome Screen"
              className="min-h-[44px] min-w-[44px] -ml-2 rounded-full flex items-center justify-center text-white/90 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
            </button>
          </div>
        )}

        {/* MotoCare Official Logo & Brand Name */}
        <div className="flex flex-col items-center text-center space-y-2.5">
          <div className="w-16 h-16 rounded-2xl bg-[#0B0F19] p-1.5 shadow-xl shadow-black/30 border border-white/15 flex items-center justify-center">
            <img
              src="/logo.png"
              alt="MotoCare Official Logo"
              referrerPolicy="no-referrer"
              className="w-full h-full object-contain rounded-xl"
            />
          </div>

          <div className="text-2xl font-black tracking-tight leading-none">
            <span className="text-white">Moto</span>
            <span className="text-[#FF6B00]">Care</span>
          </div>

          <div className="space-y-1 pt-1">
            <h1 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
              {mode === 'register'
                ? 'Create Your MotoCare Account'
                : 'Sign In to MotoCare'}
            </h1>
            <p className="text-xs sm:text-sm text-slate-200/90 font-medium">
              {mode === 'register'
                ? 'Start taking better care of your motorcycle.'
                : 'Welcome back! Access your motorcycle maintenance garage.'}
            </p>
          </div>
        </div>
      </div>

      {/* Rounded White Form Card Overlapping Navy Header */}
      <div className="relative z-10 -mt-7 bg-white rounded-3xl shadow-xl border border-slate-100 px-5 sm:px-7 py-6 space-y-5">
        {errorMessage && (
          <div
            role="alert"
            className="p-3.5 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-xs font-medium flex items-start gap-2.5"
          >
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        {infoMessage && (
          <div
            role="status"
            className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-medium flex items-start gap-2.5"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <span>{infoMessage}</span>
          </div>
        )}

        <form onSubmit={handleFormSubmit} noValidate className="space-y-4">
          {mode === 'register' && (
            <div className="space-y-1.5 text-left">
              <label
                htmlFor="auth-full-name"
                className="block text-xs font-bold text-slate-800"
              >
                Full Name
              </label>
              <div className="relative flex items-center">
                <User className="w-4 h-4 text-slate-400 absolute left-3.5 pointer-events-none" />
                <input
                  id="auth-full-name"
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Juan Dela Cruz"
                  autoComplete="name"
                  className="w-full min-h-[48px] pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#FF6B00] focus:border-transparent transition-all"
                />
              </div>
            </div>
          )}

          <div className="space-y-1.5 text-left">
            <label
              htmlFor="auth-email"
              className="block text-xs font-bold text-slate-800"
            >
              Email Address
            </label>
            <div className="relative flex items-center">
              <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 pointer-events-none" />
              <input
                id="auth-email"
                type="email"
                value={email}
                onChange={(e) => {
                  const nextVal = e.target.value;
                  setEmail(nextVal);
                  if (mode === 'signin' && rememberMe) {
                    try {
                      if (nextVal.trim()) {
                        localStorage.setItem(REMEMBERED_EMAIL_STORAGE_KEY, nextVal.trim());
                      } else {
                        localStorage.removeItem(REMEMBERED_EMAIL_STORAGE_KEY);
                      }
                    } catch {
                      // ignore storage error
                    }
                  }
                }}
                placeholder="you@example.com"
                autoComplete="email"
                className="w-full min-h-[48px] pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#FF6B00] focus:border-transparent transition-all"
              />
            </div>
          </div>

          <div className="space-y-1.5 text-left">
            <div className="flex items-center justify-between">
              <label
                htmlFor="auth-password"
                className="block text-xs font-bold text-slate-800"
              >
                Password
              </label>
              {mode === 'signin' && (
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  className="text-xs font-bold text-[#FF6B00] hover:underline cursor-pointer"
                >
                  Forgot Password?
                </button>
              )}
            </div>
            <div className="relative flex items-center">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 pointer-events-none" />
              <input
                id="auth-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={
                  mode === 'register' ? 'At least 6 characters' : 'Enter your password'
                }
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                className="w-full min-h-[48px] pl-10 pr-11 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#FF6B00] focus:border-transparent transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                title={showPassword ? 'Hide password' : 'Show password'}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="min-h-[44px] min-w-[44px] absolute right-1 flex items-center justify-center text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                {showPassword ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          {mode === 'signin' && (
            <div className="flex items-center justify-between pt-0.5 text-left">
              <label
                htmlFor="auth-remember-me"
                className="inline-flex items-center gap-2 text-xs font-medium text-slate-600 cursor-pointer select-none"
              >
                <input
                  id="auth-remember-me"
                  data-testid="remember-me-checkbox"
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setRememberMe(checked);
                    try {
                      if (checked && email.trim()) {
                        localStorage.setItem(REMEMBERED_EMAIL_STORAGE_KEY, email.trim());
                      } else if (!checked) {
                        localStorage.removeItem(REMEMBERED_EMAIL_STORAGE_KEY);
                      }
                    } catch {
                      // ignore storage error
                    }
                  }}
                  className="w-4 h-4 rounded border-slate-300 text-[#FF6B00] focus:ring-[#FF6B00] cursor-pointer shrink-0"
                />
                <span>Remember Me</span>
              </label>
            </div>
          )}

          {mode === 'register' && (
            <div className="space-y-1.5 text-left">
              <label
                htmlFor="auth-confirm-password"
                className="block text-xs font-bold text-slate-800"
              >
                Confirm Password
              </label>
              <div className="relative flex items-center">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 pointer-events-none" />
                <input
                  id="auth-confirm-password"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter your password"
                  autoComplete="new-password"
                  className="w-full min-h-[48px] pl-10 pr-11 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#FF6B00] focus:border-transparent transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((prev) => !prev)}
                  title={
                    showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'
                  }
                  aria-label={
                    showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'
                  }
                  className="min-h-[44px] min-w-[44px] absolute right-1 flex items-center justify-center text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  {showConfirmPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
          )}

          {mode === 'register' && (
            <div className="flex items-start gap-2.5 pt-1 text-left">
              <input
                id="auth-terms-checkbox"
                type="checkbox"
                checked={agreedToTerms}
                onChange={(e) => setAgreedToTerms(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-slate-300 text-[#FF6B00] focus:ring-[#FF6B00] cursor-pointer shrink-0"
              />
              <label
                htmlFor="auth-terms-checkbox"
                className="text-xs text-slate-600 leading-relaxed cursor-pointer"
              >
                I agree to the{' '}
                <button
                  type="button"
                  onClick={() => setLegalDocModal('terms')}
                  className="font-bold text-[#FF6B00] hover:underline cursor-pointer"
                >
                  Terms of Service
                </button>{' '}
                and{' '}
                <button
                  type="button"
                  onClick={() => setLegalDocModal('privacy')}
                  className="font-bold text-[#FF6B00] hover:underline cursor-pointer"
                >
                  Privacy Policy
                </button>
              </label>
            </div>
          )}

          <button
            type="submit"
            data-testid="auth-submit-btn"
            disabled={isSubmitting}
            className="w-full min-h-[48px] py-3.5 px-6 rounded-2xl bg-[#FF6B00] hover:bg-[#EA580C] disabled:opacity-60 text-white font-extrabold text-sm shadow-lg shadow-[#FF6B00]/25 transition-all active:scale-98 cursor-pointer"
          >
            {isSubmitting
              ? mode === 'register'
                ? 'Creating Account...'
                : 'Signing In...'
              : mode === 'register'
              ? 'Create Account'
              : 'Sign In'}
          </button>
        </form>

        {/* Divider with "or continue with" */}
        <div className="relative flex items-center justify-center py-1">
          <div className="border-t border-slate-200 w-full" />
          <span className="bg-white px-3 text-xs font-medium text-slate-400 whitespace-nowrap">
            or continue with
          </span>
          <div className="border-t border-slate-200 w-full" />
        </div>

        {/* White "Continue with Google" Button */}
        <button
          type="button"
          disabled={isSubmitting}
          onClick={handleGoogleContinue}
          className="w-full min-h-[48px] py-3 px-4 rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-60 text-slate-800 font-bold text-sm shadow-xs transition-all flex items-center justify-center gap-2.5 active:scale-98 cursor-pointer"
        >
          <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
            />
          </svg>
          <span>Continue with Google</span>
        </button>

        <p className="text-[11px] text-slate-400 text-center leading-relaxed">
          By continuing with Google, you agree to MotoCare&apos;s{' '}
          <button
            type="button"
            onClick={() => setLegalDocModal('terms')}
            className="text-slate-600 font-semibold hover:underline cursor-pointer"
          >
            Terms of Service
          </button>{' '}
          and{' '}
          <button
            type="button"
            onClick={() => setLegalDocModal('privacy')}
            className="text-slate-600 font-semibold hover:underline cursor-pointer"
          >
            Privacy Policy
          </button>
          .
        </p>
      </div>

      {/* Bottom Mode Toggle Prompt */}
      <div className="pt-5 text-center text-sm text-slate-700 font-medium">
        {mode === 'register' ? (
          <span>
            Already have an account?{' '}
            <button
              type="button"
              data-testid="switch-to-signin-btn"
              onClick={() => switchMode('signin')}
              className="font-extrabold text-[#FF6B00] hover:underline cursor-pointer"
            >
              Sign In
            </button>
          </span>
        ) : (
          <span>
            Don&apos;t have an account?{' '}
            <button
              type="button"
              data-testid="switch-to-register-btn"
              onClick={() => switchMode('register')}
              className="font-extrabold text-[#FF6B00] hover:underline cursor-pointer"
            >
              Create Account
            </button>
          </span>
        )}
      </div>

      {/* Terms of Service & Privacy Policy Modal */}
      {legalDocModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-white rounded-3xl p-6 shadow-2xl border border-slate-100 space-y-4 text-left">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-[#FF6B00]" />
                <h3 className="text-base font-extrabold text-slate-900">
                  {legalDocModal === 'terms'
                    ? 'MotoCare Terms of Service'
                    : 'MotoCare Privacy Policy'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setLegalDocModal(null)}
                title="Close legal document"
                aria-label="Close legal document"
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-xs text-slate-600 space-y-2.5 leading-relaxed max-h-72 overflow-y-auto pr-1">
              {legalDocModal === 'terms' ? (
                <>
                  <p>
                    Welcome to <strong>MotoCare PH</strong>. By creating an account, you can track your motorcycle odometer readings, routine PMS intervals, service history logbook, and LTO registration renewal schedules.
                  </p>
                  <p>
                    Free accounts support 1 motorcycle in your digital garage. MotoCare Pro (₱49/month via GCash) unlocks multi-bike storage and GPS Auto-Odometer ride tracking.
                  </p>
                  <p>
                    Maintenance intervals are provided as general guidance based on standard Philippine motorcycle schedules. Always consult your official owner&apos;s manual or trusted mechanic.
                  </p>
                </>
              ) : (
                <>
                  <p>
                    <strong>MotoCare PH</strong> scopes your motorcycle profiles, maintenance reminders, and service records strictly to your authenticated account UID.
                  </p>
                  <p>
                    Your email address and profile name are used solely for account authentication, cloud synchronization across your devices, and verifying Pro subscription references. We never sell or share your personal data with third-party advertisers.
                  </p>
                </>
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                setAgreedToTerms(true);
                setLegalDocModal(null);
              }}
              className="w-full py-2.5 rounded-xl bg-[#FF6B00] hover:bg-[#EA580C] text-white font-bold text-xs transition-colors cursor-pointer"
            >
              I Understand &amp; Agree
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
