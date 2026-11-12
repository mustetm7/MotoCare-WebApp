import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  auth,
  OWNER_ADMIN_EMAIL,
  onAuthStateChanged,
  signInWithGoogle,
  signUpWithEmail as firebaseSignUpWithEmail,
  signInWithEmail as firebaseSignInWithEmail,
  resetPasswordForEmail as firebaseResetPassword,
  logOut,
  User,
} from '../utils/firebase';
import {
  syncUserProfile,
  subscribeToUserProfile,
  subscribeToUserPaymentSubmissions,
  submitPaymentReferenceToFirestore,
  parseExpiryToDate,
  calculateDaysRemaining,
  permanentlyDeleteUserAccount,
} from '../utils/firestoreService';
import { UserSubscription, PaymentProvider, PaymentSubmissionRecord } from '../types';
import { INITIAL_SUBSCRIPTION } from '../data/initialData';

export { OWNER_ADMIN_EMAIL };

/**
 * Pure helper to compute authoritative subscription state from Firestore profile & payment records.
 * Used by AuthProvider and unit tests to guarantee zero privilege escalation from LocalStorage.
 */
export function computeAuthoritativeSubscription(
  userProfile: Record<string, any> | null,
  latestSubmission: PaymentSubmissionRecord | null,
  now: Date = new Date()
): UserSubscription {
  if (!userProfile) {
    return { ...INITIAL_SUBSCRIPTION };
  }

  const storedTier = userProfile.subscriptionTier === 'pro' ? 'pro' : 'free';
  const storedStatus = userProfile.subscriptionStatus;
  const expiryDateObj = parseExpiryToDate(userProfile.expiryDate);
  const expiryIso = expiryDateObj ? expiryDateObj.toISOString() : undefined;
  const daysRemaining = calculateDaysRemaining(expiryDateObj, now);

  const isRevoked = storedStatus === 'revoked';
  // Active paid Pro requires tier === 'pro', not revoked, and a valid future expiryDate
  const isExpired = storedTier === 'pro' && (!expiryDateObj || expiryDateObj.getTime() <= now.getTime());
  const isActivePro = storedTier === 'pro' && !isRevoked && !isExpired;

  const hasPendingSubmission = latestSubmission?.status === 'pending_approval';

  const effectiveTier: 'free' | 'pro' = isActivePro ? 'pro' : 'free';

  let effectiveStatus: UserSubscription['status'] = 'free';
  if (isRevoked) {
    effectiveStatus = 'revoked';
  } else if (isActivePro) {
    effectiveStatus = 'active';
  } else if (hasPendingSubmission) {
    effectiveStatus = 'trial';
  } else if (isExpired || storedStatus === 'expired') {
    effectiveStatus = 'expired';
  }

  return {
    tier: effectiveTier,
    plan: isActivePro ? 'monthly' : null,
    status: effectiveStatus,
    paymentMethod: latestSubmission?.paymentMethod,
    referenceNumber: latestSubmission?.referenceNumber,
    expiryDate: expiryIso,
    subscriptionStartDate: parseExpiryToDate(userProfile.subscriptionStartDate)?.toISOString(),
    billingAnchorDay:
      typeof userProfile.billingAnchorDay === 'number' ? userProfile.billingAnchorDay : undefined,
    daysRemaining: isActivePro ? daysRemaining : 0,
    isExpired,
  };
}

/**
 * Verifies whether the authenticated Firebase user is the verified MotoCare owner/admin.
 */
export function isVerifiedOwnerAccount(
  authUser: { email?: string | null; emailVerified?: boolean } | null | undefined
): boolean {
  return (
    Boolean(authUser) &&
    authUser?.email?.toLowerCase() === OWNER_ADMIN_EMAIL &&
    authUser?.emailVerified === true
  );
}

/**
 * Resolves effective Pro feature entitlement across the application.
 */
export function resolveProEntitlement(
  authUser: { email?: string | null; emailVerified?: boolean } | null | undefined,
  subscription: UserSubscription
): {
  isVerifiedOwnerAdmin: boolean;
  isActivePaidProSubscriber: boolean;
  hasProAccess: boolean;
} {
  const isVerifiedOwnerAdmin = isVerifiedOwnerAccount(authUser);
  const isActivePaidProSubscriber =
    subscription.tier === 'pro' &&
    subscription.status === 'active' &&
    !subscription.isExpired;

  return {
    isVerifiedOwnerAdmin,
    isActivePaidProSubscriber,
    hasProAccess: isVerifiedOwnerAdmin || isActivePaidProSubscriber,
  };
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAdmin: boolean;
  hasProAccess?: boolean;
  subscription: UserSubscription;
  signIn: () => Promise<User | null>;
  signInWithEmail: (email: string, pass: string) => Promise<User | null>;
  signUpWithEmail: (email: string, pass: string, displayName?: string) => Promise<User | null>;
  resetPassword: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  deleteAccount?: (password?: string) => Promise<void>;
  submitPaymentRef: (
    paymentMethod: PaymentProvider,
    referenceNumber: string,
    bikeModel: string,
    bikePlate?: string
  ) => Promise<string>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  isAdmin: false,
  hasProAccess: false,
  subscription: INITIAL_SUBSCRIPTION,
  signIn: async () => null,
  signInWithEmail: async () => null,
  signUpWithEmail: async () => null,
  resetPassword: async () => {},
  signOut: async () => {},
  deleteAccount: async () => {},
  submitPaymentRef: async () => '',
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [latestSubmission, setLatestSubmission] = useState<PaymentSubmissionRecord | null>(null);
  const [nowTick, setNowTick] = useState<Date>(() => new Date());

  // Periodic 60-second clock tick so client UI immediately reflects expiration if expiryDate passes while open
  useEffect(() => {
    const timer = setInterval(() => {
      setNowTick(new Date());
    }, 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let unsubProfile: (() => void) | null = null;
    let unsubPayments: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);

      if (unsubProfile) {
        unsubProfile();
        unsubProfile = null;
      }
      if (unsubPayments) {
        unsubPayments();
        unsubPayments = null;
      }

      if (currentUser) {
        await syncUserProfile(currentUser);
        unsubProfile = subscribeToUserProfile(currentUser.uid, (profile) => {
          setUserProfile(profile);
        });
        unsubPayments = subscribeToUserPaymentSubmissions(currentUser.uid, (subs) => {
          setLatestSubmission(subs.length > 0 ? subs[0] : null);
        });
      } else {
        setUserProfile(null);
        setLatestSubmission(null);
      }

      setLoading(false);
    });

    return () => {
      unsubscribeAuth();
      if (unsubProfile) unsubProfile();
      if (unsubPayments) unsubPayments();
    };
  }, []);

  const isAdmin = isVerifiedOwnerAccount(user);

  const subscription: UserSubscription = React.useMemo(() => {
    if (!user) return INITIAL_SUBSCRIPTION;
    return computeAuthoritativeSubscription(userProfile, latestSubmission, nowTick);
  }, [user, userProfile, latestSubmission, nowTick]);

  const { hasProAccess } = React.useMemo(
    () => resolveProEntitlement(user, subscription),
    [user, subscription]
  );

  const handleSignIn = async () => {
    return await signInWithGoogle();
  };

  const handleSignInWithEmail = async (email: string, pass: string) => {
    return await firebaseSignInWithEmail(email, pass);
  };

  const handleSignUpWithEmail = async (email: string, pass: string, displayName?: string) => {
    const createdUser = await firebaseSignUpWithEmail(email, pass, displayName);
    if (createdUser) {
      await syncUserProfile(createdUser);
    }
    return createdUser;
  };

  const handleResetPassword = async (email: string) => {
    await firebaseResetPassword(email);
  };

  const handleSignOut = async () => {
    await logOut();
    setUser(null);
    setUserProfile(null);
    setLatestSubmission(null);
  };

  /**
   * Permanently deletes the current user's account by performing a clean sweep
   * of all associated Firestore documents (reminders, service records, payment reference
   * submissions, motorcycles via atomic bikeCount decrement, and the user profile document)
   * before invoking Firebase Auth deleteUser so the email is released for future re-registration.
   */
  const handleDeleteAccount = async (password?: string) => {
    const activeUser = user || auth.currentUser;
    if (!activeUser) {
      throw new Error('No authenticated user found to delete.');
    }
    await permanentlyDeleteUserAccount(activeUser, password);
    setUser(null);
    setUserProfile(null);
    setLatestSubmission(null);
  };

  const handleSubmitPaymentRef = async (
    paymentMethod: PaymentProvider,
    referenceNumber: string,
    bikeModel: string,
    bikePlate?: string
  ) => {
    if (!user) throw new Error('Must be signed in to submit payment reference');
    return await submitPaymentReferenceToFirestore({
      userId: user.uid,
      userEmail: user.email || '',
      userName: user.displayName || 'MotoCare Rider',
      bikeModel,
      bikePlate,
      paymentMethod,
      referenceNumber,
    });
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isAdmin,
        hasProAccess,
        subscription,
        signIn: handleSignIn,
        signInWithEmail: handleSignInWithEmail,
        signUpWithEmail: handleSignUpWithEmail,
        resetPassword: handleResetPassword,
        signOut: handleSignOut,
        deleteAccount: handleDeleteAccount,
        submitPaymentRef: handleSubmitPaymentRef,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
