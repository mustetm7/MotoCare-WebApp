import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as firebaseSignOut,
  User as FirebaseUser,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
  updateProfile,
} from 'firebase/auth';
import * as firestoreModule from 'firebase/firestore';
import {
  getFirestore,
  doc,
  collection,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  where,
  onSnapshot,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

// Initialize Firebase App
export const app = initializeApp(firebaseConfig);

// Silence noisy internal @firebase/firestore WebChannel fallback logs in iframe/offline environments
try {
  const maybeSetLogLevel = (firestoreModule as Record<string, unknown>).setLogLevel;
  if (typeof maybeSetLogLevel === 'function') {
    maybeSetLogLevel('silent');
  }
} catch {
  // ignore if unsupported in mock environment
}

// Initialize Firestore with custom databaseId and auto-detected long polling for proxy/iframe reliability
// CRITICAL: The app will break without passing firebaseConfig.firestoreDatabaseId
export const db = (() => {
  try {
    const maybeInitFirestore = (firestoreModule as Record<string, unknown>).initializeFirestore;
    if (typeof maybeInitFirestore === 'function') {
      return maybeInitFirestore(
        app,
        { experimentalAutoDetectLongPolling: true },
        firebaseConfig.firestoreDatabaseId
      ) as ReturnType<typeof getFirestore>;
    }
  } catch {
    // Fallback if already initialized or running in a test mock
  }
  return getFirestore(app, firebaseConfig.firestoreDatabaseId);
})();

// Initialize Firebase Authentication
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Standard Firestore Error Handling Specification
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errMsg = error instanceof Error ? error.message : String(error);
  const errInfo: FirestoreErrorInfo = {
    error: errMsg,
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  const isTransientOffline =
    errMsg.toLowerCase().includes('unavailable') ||
    errMsg.toLowerCase().includes('offline');
  if (isTransientOffline) {
    console.warn('MotoCare Firestore offline/cached fallback:', JSON.stringify(errInfo));
  } else {
    console.error('Firestore Error: ', JSON.stringify(errInfo));
  }
  throw new Error(JSON.stringify(errInfo));
}

// On-demand connection check (does not fire unsolicited server RPCs on module import)
export async function testConnection(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return false;
  }
  return true;
}

// Authentication Helpers
export async function signInWithGoogle(): Promise<FirebaseUser | null> {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (err) {
    console.error('Google Sign In Error:', err);
    throw err;
  }
}

export async function signInWithEmail(email: string, pass: string): Promise<FirebaseUser | null> {
  try {
    const cred = await signInWithEmailAndPassword(auth, email, pass);
    return cred.user;
  } catch (err) {
    console.error('Email Sign In Error:', err);
    throw err;
  }
}

export async function signUpWithEmail(
  email: string,
  pass: string,
  displayName?: string
): Promise<FirebaseUser | null> {
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    if (displayName && cred.user) {
      await updateProfile(cred.user, { displayName });
    }
    if (cred.user) {
      await sendEmailVerification(cred.user).catch((e) =>
        console.warn('Could not send verification email:', e)
      );
    }
    return cred.user;
  } catch (err) {
    console.error('Email Sign Up Error:', err);
    throw err;
  }
}

export async function resetPassword(email: string): Promise<void> {
  try {
    await sendPasswordResetEmail(auth, email);
  } catch (err) {
    console.error('Password Reset Error:', err);
    throw err;
  }
}

export async function logOut(): Promise<void> {
  await firebaseSignOut(auth);
}
