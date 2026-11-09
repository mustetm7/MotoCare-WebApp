import React, { createContext, useContext, useEffect, useState } from 'react';
import { User as FirebaseUser, onAuthStateChanged } from 'firebase/auth';
import {
  auth,
  signInWithGoogle,
  signInWithEmail,
  signUpWithEmail,
  resetPassword,
  logOut,
} from '../utils/firebase';
import {
  syncUserProfile,
  subscribeToUserDoc,
  subscribeToUserPaymentSubmission,
  submitPaymentReferenceToFirestore,
  PaymentSubmission,
  parseExpiryToDate,
} from '../utils/firestoreService';
import { UserSubscription, PaymentMethod } from '../types';
import { INITIAL_SUBSCRIPTION } from '../data/initialData';
import { loadSubscription } from '../utils/storage';

export function computeAuthoritativeSubscription(
  latestUserData: Record<string, unknown> | null,
  latestSubmission: PaymentSubmission | null,
  now: Date = new Date()
): UserSubscription {
  const storedTier = (latestUserData?.subscriptionTier as string) || 'free';
  const storedStatus = (latestUserData?.subscriptionStatus as string) || 'free';
  const expiryDate = parseExpiryToDate(latestUserData?.expiryDate);

  const hasExpiry = expiryDate !== null;
  // Expired if expiryDate is set and is in the past, or if storedTier is 'pro' without a valid expiryDate
  const isExpired = hasExpiry ? expiryDate.getTime() <= now.getTime() : storedTier === 'pro';
  const expiryDateIso = expiryDate ? expiryDate.toISOString() : undefined;

  // Effective entitlement: Pro ONLY if storedTier is 'pro', has a valid future expiryDate, and is not revoked
  const isEffectivelyPro =
    storedTier === 'pro' &&
    hasExpiry &&
    !isExpired &&
    storedStatus !== 'revoked' &&
    storedStatus !== 'expired' &&
    storedStatus !== 'free';

  // Pending renewal check: submission status is pending_approval
  const hasPendingSubmission = latestSubmission?.status === 'pending_approval';

  // Determine effective subscription status
  let effectiveStatus: 'active' | 'trial' | 'free' | 'expired' | 'revoked' = 'free';
  if (storedStatus === 'revoked') {
    effectiveStatus = 'revoked';
  } else if (isEffectivelyPro) {
    effectiveStatus = 'active';
  } else if (storedTier === 'pro' && isExpired) {
    effectiveStatus = 'expired';
  } else if (hasPendingSubmission) {
    effectiveStatus = 'trial';
  } else {
    effectiveStatus = 'free';
  }

  // Calculate days remaining
  let daysRemaining: number | undefined = undefined;
  if (expiryDate && !isExpired) {
    const diffMs = expiryDate.getTime() - now.getTime();
    daysRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  } else if (isExpired) {
    daysRemaining = 0;
  }

  return {
    tier: isEffectivelyPro ? 'pro' : 'free',
    plan: isEffectivelyPro ? 'monthly' : null,
    status: effectiveStatus,
    paymentMethod:
      (isEffectivelyPro
        ? (latestUserData?.paymentMethod as PaymentMethod)
        : latestSubmission?.paymentMethod) || undefined,
    referenceNumber:
      (isEffectivelyPro
        ? (latestUserData?.referenceNumber as string)
        : latestSubmission?.referenceNumber) || undefined,
    subscriptionStartDate: (latestUserData?.subscriptionStartDate as string) || undefined,
    expiryDate: expiryDateIso,
    billingAnchorDay:
      typeof latestUserData?.billingAnchorDay === 'number'
        ? (latestUserData.billingAnchorDay as number)
        : undefined,
    lastPaymentId: (latestUserData?.lastPaymentId as string) || undefined,
    daysRemaining,
    isExpired: hasExpiry ? expiryDate.getTime() <= now.getTime() : false,
  };
}

export const OWNER_ADMIN_EMAIL = 'mustetm7@gmail.com';

/**
 * Authoritative verified owner/admin identity check.
 * Requires the authenticated Firebase user to have:
 * - exact email match: mustetm7@gmail.com
 * - emailVerified === true
 * Never trusts LocalStorage, unverified client flags, or role === 'admin' alone.
 */
export function isVerifiedOwnerAccount(
  user: { email?: string | null; emailVerified?: boolean } | null | undefined
): boolean {
  return (
    Boolean(user) &&
    user?.email?.toLowerCase() === OWNER_ADMIN_EMAIL &&
    user?.emailVerified === true
  );
}

/**
 * Separates administrative owner identity from paid Pro subscription status.
 * - isVerifiedOwnerAdmin: true ONLY for verified mustetm7@gmail.com (emailVerified === true)
 * - isActivePaidProSubscriber: true ONLY when subscription reflects an active, non-expired paid Pro plan
 * - hasProAccess: isVerifiedOwnerAdmin || isActivePaidProSubscriber
 */
export function resolveProEntitlement(
  user: { email?: string | null; emailVerified?: boolean } | null | undefined,
  subscription: UserSubscription | null | undefined
): {
  isVerifiedOwnerAdmin: boolean;
  isActivePaidProSubscriber: boolean;
  hasProAccess: boolean;
} {
  const isVerifiedOwnerAdmin = isVerifiedOwnerAccount(user);
  const isActivePaidProSubscriber =
    Boolean(subscription) &&
    subscription?.tier === 'pro' &&
    subscription?.status === 'active' &&
    !subscription?.isExpired;
  const hasProAccess = isVerifiedOwnerAdmin || isActivePaidProSubscriber;
  return {
    isVerifiedOwnerAdmin,
    isActivePaidProSubscriber,
    hasProAccess,
  };
}

interface AuthContextType {
  user: FirebaseUser | null;
  loading: boolean;
  isAdmin: boolean;
  isVerifiedOwnerAdmin?: boolean;
  isActivePaidProSubscriber?: boolean;
  hasProAccess?: boolean;
  subscription: UserSubscription;
  signIn: () => Promise<FirebaseUser | null>;
  signInWithEmail: (email: string, pass: string) => Promise<FirebaseUser | null>;
  signUpWithEmail: (email: string, pass: string, displayName?: string) => Promise<FirebaseUser | null>;
  resetPassword: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  submitPaymentRef: (
    method: PaymentMethod,
    referenceNumber: string,
    bikeModel?: string,
    bikePlate?: string
  ) => Promise<string>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  // Always initialize as Free and sanitize any stale LocalStorage value
  const [subscription, setSubscription] = useState<UserSubscription>(() => loadSubscription());

  const { isVerifiedOwnerAdmin, isActivePaidProSubscriber, hasProAccess } =
    resolveProEntitlement(user, subscription);
  const isAdmin = isVerifiedOwnerAdmin;

  // 1. Listen to Firebase Auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      setLoading(false);

      if (firebaseUser) {
        // Sync profile to Firestore
        try {
          await syncUserProfile(firebaseUser);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.toLowerCase().includes('offline') || msg.toLowerCase().includes('unavailable')) {
            console.warn('User profile sync deferred (client offline):', msg);
          } else {
            console.error('Error syncing user profile:', err);
          }
        }
      } else {
        setSubscription({ ...INITIAL_SUBSCRIPTION });
      }
    });

    return () => unsubscribe();
  }, []);

  // 2. Listen to real-time User Doc and Payment Submissions in Firestore if logged in
  useEffect(() => {
    if (!user) {
      setSubscription({ ...INITIAL_SUBSCRIPTION });
      return;
    }

    let latestUserData: Record<string, unknown> | null = null;
    let latestSubmission: PaymentSubmission | null = null;

    const updateCombinedState = () => {
      const sub = computeAuthoritativeSubscription(latestUserData, latestSubmission);
      setSubscription(sub);
    };

    const unsubUser = subscribeToUserDoc(user.uid, (userData: Record<string, unknown> | null) => {
      latestUserData = userData;
      updateCombinedState();
    });

    const unsubSub = subscribeToUserPaymentSubmission(user.uid, (submission: PaymentSubmission | null) => {
      latestSubmission = submission;
      updateCombinedState();
    });

    return () => {
      unsubUser();
      unsubSub();
    };
  }, [user]);

  const handleSignIn = async () => {
    const loggedUser = await signInWithGoogle();
    return loggedUser;
  };

  const handleSignInWithEmail = async (email: string, pass: string) => {
    return await signInWithEmail(email, pass);
  };

  const handleSignUpWithEmail = async (email: string, pass: string, displayName?: string) => {
    return await signUpWithEmail(email, pass, displayName);
  };

  const handleResetPassword = async (email: string) => {
    return await resetPassword(email);
  };

  const handleSignOut = async () => {
    await logOut();
    setUser(null);
    setSubscription({ ...INITIAL_SUBSCRIPTION });
  };

  // Secure payment submission: Requires valid authenticated Firebase UID (no guest fallback)
  const submitPaymentRef = async (
    method: PaymentMethod,
    referenceNumber: string,
    bikeModel?: string,
    bikePlate?: string
  ): Promise<string> => {
    if (!user) {
      throw new Error('AUTH_REQUIRED: Please sign in or register before submitting your payment reference.');
    }

    return await submitPaymentReferenceToFirestore({
      userId: user.uid,
      userEmail: user.email || '',
      userName: user.displayName || 'MotoCare Rider',
      bikeModel: bikeModel || 'Motorcycle',
      bikePlate: bikePlate || '',
      paymentMethod: method,
      referenceNumber,
    });
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isAdmin,
        isVerifiedOwnerAdmin,
        isActivePaidProSubscriber,
        hasProAccess,
        subscription,
        signIn: handleSignIn,
        signInWithEmail: handleSignInWithEmail,
        signUpWithEmail: handleSignUpWithEmail,
        resetPassword: handleResetPassword,
        signOut: handleSignOut,
        submitPaymentRef,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}



