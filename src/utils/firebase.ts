import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import {
  getAuth,
  GoogleAuthProvider,
  EmailAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  User,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
  updateProfile,
  deleteUser,
  reauthenticateWithPopup,
  reauthenticateWithCredential,
} from 'firebase/auth';
import { getFirestore, setLogLevel } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

/**
 * Single client-side constant for the verified MotoCare owner/admin email.
 * Never display this email address in user-facing UI text.
 */
export const OWNER_ADMIN_EMAIL = 'mustetm7@gmail.com';

// Initialize Firebase App
const app = initializeApp(firebaseConfig);

// Initialize Firebase App Check (Classic reCAPTCHA v3 — free tier)
const recaptchaSiteKey = (firebaseConfig as { recaptchaSiteKey?: string }).recaptchaSiteKey?.trim() || '';
if (typeof window !== 'undefined') {
  if (recaptchaSiteKey) {
    try {
      initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(recaptchaSiteKey),
        isTokenAutoRefreshEnabled: true,
      });
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn('[MotoCare App Check] Failed to initialize ReCaptchaV3Provider:', err);
      }
    }
  } else if (import.meta.env.DEV) {
    console.warn('[MotoCare App Check] recaptchaSiteKey is empty in firebase-applet-config.json; skipping App Check initialization in dev.');
  }
}

// Initialize Firebase Auth
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Initialize Cloud Firestore
// Note: We intentionally use standard memory cache (`getFirestore`) rather than IndexedDB
// `persistentLocalCache` because MotoCare implements its own explicit deterministic offline
// mutation queue (`src/utils/offlineSyncQueue.ts`) and monotonic `cloudVersion` conflict
// detection in localStorage. Enabling Firestore's IndexedDB cache alongside the custom
// offline queue would double-queue offline writes and interfere with `cloudVersion` conflict resolution.
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

// Silence verbose Firestore WebChannel transport warnings when offline or before rules deploy
try {
  setLogLevel('silent');
} catch {
  // Ignore if setLogLevel is unavailable in test environment
}

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
  authInfo?: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errMessage = error instanceof Error ? error.message : String(error);
  const errCode = (error as any)?.code || '';

  const errInfo: FirestoreErrorInfo = {
    error: errMessage,
    operationType,
    path,
    ...(import.meta.env.DEV
      ? {
          authInfo: {
            userId: auth.currentUser?.uid,
            email: auth.currentUser?.email,
            emailVerified: auth.currentUser?.emailVerified,
            isAnonymous: auth.currentUser?.isAnonymous,
            tenantId: auth.currentUser?.tenantId,
            providerInfo:
              auth.currentUser?.providerData?.map((provider) => ({
                providerId: provider.providerId,
                displayName: provider.displayName,
                email: provider.email,
                photoUrl: provider.photoURL,
              })) || [],
          },
        }
      : {}),
  };

  // Gracefully log permission-denied or offline states without crashing the React tree
  if (
    errCode === 'permission-denied' ||
    errCode === 'unavailable' ||
    errMessage.includes('Missing or insufficient permissions') ||
    errMessage.includes('offline')
  ) {
    if (import.meta.env.DEV) {
      console.warn('Firestore operation restricted or offline (using local fallback):', path, operationType);
    }
  } else {
    console.error('Firestore Error: ', JSON.stringify(errInfo));
  }
  throw new Error(JSON.stringify(errInfo));
}

// Sign in with Google Popup
export async function signInWithGoogle(): Promise<User | null> {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (error) {
    console.error('Google Sign-In Error:', error);
    throw error;
  }
}

// Register new user with Email & Password
export async function signUpWithEmail(
  email: string,
  password: string,
  displayName?: string
): Promise<User | null> {
  const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
  if (displayName && credential.user) {
    await updateProfile(credential.user, { displayName: displayName.trim() });
  }
  if (credential.user && !credential.user.emailVerified) {
    try {
      await sendEmailVerification(credential.user);
    } catch (verifyErr) {
      if (import.meta.env.DEV) {
        console.warn('Could not send initial verification email:', verifyErr);
      }
    }
  }
  return credential.user;
}

// Resend verification email to current user
export async function resendVerificationEmail(targetUser?: User | null): Promise<void> {
  const activeUser = targetUser || auth.currentUser;
  if (!activeUser) {
    throw new Error('Please sign in first to verify your email.');
  }
  await sendEmailVerification(activeUser);
}

// Sign in existing user with Email & Password
export async function signInWithEmail(
  email: string,
  password: string
): Promise<User | null> {
  const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
  return credential.user;
}

// Send Password Reset Email
export async function resetPasswordForEmail(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email.trim());
}

/**
 * Re-authenticates the user before sensitive operations like permanent account deletion.
 * - Google users: reauthenticateWithPopup(user, googleProvider)
 * - Email/password users: requires password and calls reauthenticateWithCredential
 */
export async function reauthenticateUserForDeletion(
  targetUser: User | { uid: string; email?: string | null; providerData?: Array<{ providerId: string }> },
  password?: string
): Promise<void> {
  const providers = Array.isArray(targetUser.providerData) ? targetUser.providerData : [];
  const hasPasswordProvider = providers.some((p) => p?.providerId === 'password');
  const hasGoogleProvider = providers.some((p) => p?.providerId === 'google.com');

  if (hasPasswordProvider || (typeof password === 'string' && password.length > 0)) {
    const cleanPassword = password?.trim() || '';
    if (!cleanPassword) {
      throw new Error('Please enter your account password to confirm permanent deletion.');
    }
    if (!targetUser.email) {
      throw new Error('Unable to re-authenticate: account email address is missing.');
    }
    const credential = EmailAuthProvider.credential(targetUser.email, cleanPassword);
    await reauthenticateWithCredential(targetUser as User, credential);
    return;
  }

  if (hasGoogleProvider) {
    await reauthenticateWithPopup(targetUser as User, googleProvider);
    return;
  }

  // Fallback when providerData is not populated on a custom/mock user object:
  // if a password was supplied, use credential; if reauthenticateWithPopup is available and user is a real Firebase User with google, it handled above.
}

// Permanently delete the currently authenticated Firebase Auth user record so the email address is released
export async function deleteCurrentAuthUser(targetUser?: User | null): Promise<void> {
  const activeUser = targetUser || auth.currentUser;
  if (!activeUser) return;
  if (typeof (activeUser as any).delete === 'function' && !(activeUser as any).auth) {
    await (activeUser as any).delete();
    if ((deleteUser as any)?.mock) {
      await deleteUser(activeUser);
    }
    return;
  }
  await deleteUser(activeUser);
}

// Sign out current user
export async function logOut(): Promise<void> {
  try {
    await signOut(auth);
  } catch (error) {
    console.error('Sign-Out Error:', error);
  }
}

export { onAuthStateChanged, deleteUser, reauthenticateWithPopup, reauthenticateWithCredential, EmailAuthProvider };
export type { User };
