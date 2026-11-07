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
import { loadSubscription, saveSubscription } from '../utils/storage';

interface AuthContextType {
  user: FirebaseUser | null;
  loading: boolean;
  isAdmin: boolean;
  subscription: UserSubscription;
  setSubscription: React.Dispatch<React.SetStateAction<UserSubscription>>;
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
  const [subscription, setSubscription] = useState<UserSubscription>(() => loadSubscription());

  const isAdmin =
    user?.email?.toLowerCase() === 'mustetm7@gmail.com' && user?.emailVerified === true;

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
          console.error('Error syncing user profile:', err);
        }
      }
    });

    return () => unsubscribe();
  }, []);

  // 2. Listen to real-time User Doc and Payment Submissions in Firestore if logged in
  useEffect(() => {
    if (!user) return;

    let latestUserData: Record<string, unknown> | null = null;
    let latestSubmission: PaymentSubmission | null = null;

    const updateCombinedState = () => {
      const storedTier = (latestUserData?.subscriptionTier as string) || 'free';
      const storedStatus = (latestUserData?.subscriptionStatus as string) || 'free';
      const expiryDate = parseExpiryToDate(latestUserData?.expiryDate);
      const now = new Date();

      const hasExpiry = expiryDate !== null;
      // Expired if expiryDate is set and is in the past
      const isExpired = hasExpiry ? expiryDate.getTime() <= now.getTime() : false;
      const expiryDateIso = expiryDate ? expiryDate.toISOString() : undefined;

      // Effective entitlement: Pro only if storedTier is pro, not expired, and not revoked
      const isEffectivelyPro = storedTier === 'pro' && !isExpired && storedStatus !== 'revoked';

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

      const sub: UserSubscription = {
        tier: isEffectivelyPro ? 'pro' : 'free',
        plan: isEffectivelyPro ? 'monthly' : null,
        status: effectiveStatus,
        paymentMethod: (isEffectivelyPro ? (latestUserData?.paymentMethod as PaymentMethod) : latestSubmission?.paymentMethod) || undefined,
        referenceNumber: (isEffectivelyPro ? (latestUserData?.referenceNumber as string) : latestSubmission?.referenceNumber) || undefined,
        subscriptionStartDate: (latestUserData?.subscriptionStartDate as string) || undefined,
        expiryDate: expiryDateIso,
        billingAnchorDay: typeof latestUserData?.billingAnchorDay === 'number' ? (latestUserData.billingAnchorDay as number) : undefined,
        lastPaymentId: (latestUserData?.lastPaymentId as string) || undefined,
        daysRemaining,
        isExpired,
      };

      setSubscription(sub);
      saveSubscription(sub);
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
        subscription,
        setSubscription,
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
