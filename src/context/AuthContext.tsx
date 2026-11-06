import React, { createContext, useContext, useEffect, useState } from 'react';
import { User as FirebaseUser, onAuthStateChanged } from 'firebase/auth';
import { auth, signInWithGoogle, logOut } from '../utils/firebase';
import { syncUserProfile, subscribeToUserDoc, submitPaymentReferenceToFirestore } from '../utils/firestoreService';
import { UserSubscription, PaymentMethod } from '../types';
import { loadSubscription, saveSubscription } from '../utils/storage';

interface AuthContextType {
  user: FirebaseUser | null;
  loading: boolean;
  isAdmin: boolean;
  subscription: UserSubscription;
  setSubscription: React.Dispatch<React.SetStateAction<UserSubscription>>;
  signIn: () => Promise<FirebaseUser | null>;
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
    user?.email?.toLowerCase() === 'mustetm7@gmail.com' ||
    user?.email?.toLowerCase() === 'admin@motocare.ph';

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

  // 2. Listen to real-time User Doc in Firestore if logged in
  useEffect(() => {
    if (!user) return;

    const unsubscribe = subscribeToUserDoc(user.uid, (userData) => {
      if (userData) {
        const isPro = userData.subscriptionTier === 'pro';
        const sub: UserSubscription = {
          tier: isPro ? 'pro' : 'free',
          plan: isPro ? 'monthly' : null,
          status: isPro ? 'active' : 'free',
          paymentMethod: (userData.paymentMethod as PaymentMethod) || undefined,
          referenceNumber: (userData.referenceNumber as string) || undefined,
        };
        setSubscription(sub);
        saveSubscription(sub);
      }
    });

    return () => unsubscribe();
  }, [user]);

  const handleSignIn = async () => {
    const loggedUser = await signInWithGoogle();
    return loggedUser;
  };

  const handleSignOut = async () => {
    await logOut();
    setUser(null);
  };

  const submitPaymentRef = async (
    method: PaymentMethod,
    referenceNumber: string,
    bikeModel?: string,
    bikePlate?: string
  ): Promise<string> => {
    const userId = user ? user.uid : `guest_${Date.now()}`;
    const userEmail = user?.email || 'guest@motocare.ph';
    const userName = user?.displayName || 'MotoCare Rider';

    return await submitPaymentReferenceToFirestore({
      userId,
      userEmail,
      userName,
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
