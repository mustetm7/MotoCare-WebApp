import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from './firebase';
import { User } from 'firebase/auth';
import { Motorcycle, MaintenanceReminder, ServiceRecord, UserSubscription, PaymentMethod } from '../types';

export interface PaymentSubmission {
  id: string;
  userId: string;
  userEmail: string;
  userName: string;
  userPhone?: string;
  bikeModel: string;
  bikePlate?: string;
  paymentMethod: PaymentMethod;
  referenceNumber: string;
  amountPhp: number;
  status: 'pending_approval' | 'active_pro' | 'rejected';
  submittedAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
  notes?: string;
}

// 1. User Profile & Subscription Sync
export async function syncUserProfile(user: User): Promise<void> {
  const path = `users/${user.uid}`;
  try {
    const userDocRef = doc(db, 'users', user.uid);
    const existing = await getDoc(userDocRef);

    const isAdminEmail = user.email?.toLowerCase() === 'mustetm7@gmail.com';

    if (!existing.exists()) {
      await setDoc(userDocRef, {
        id: user.uid,
        email: user.email || '',
        displayName: user.displayName || 'MotoCare Rider',
        photoURL: user.photoURL || '',
        role: isAdminEmail ? 'admin' : 'rider',
        subscriptionTier: 'free',
        subscriptionStatus: 'free',
        paymentStatus: 'unpaid_free',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // If owner, bootstrap admin document
      if (isAdminEmail) {
        await setDoc(doc(db, 'admins', user.uid), {
          email: user.email,
          role: 'owner',
          createdAt: new Date().toISOString(),
        });
      }
    } else {
      await updateDoc(userDocRef, {
        displayName: user.displayName || existing.data().displayName || 'MotoCare Rider',
        photoURL: user.photoURL || existing.data().photoURL || '',
        updatedAt: new Date().toISOString(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

// 2. Listen to active User Document (for live subscription status updates)
export function subscribeToUserDoc(
  userId: string,
  onUpdate: (userData: Record<string, unknown> | null) => void
): () => void {
  const path = `users/${userId}`;
  return onSnapshot(
    doc(db, 'users', userId),
    (docSnap) => {
      if (docSnap.exists()) {
        onUpdate(docSnap.data() as Record<string, unknown>);
      } else {
        onUpdate(null);
      }
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    }
  );
}

// 3. Submit Payment Reference to Firestore
export async function submitPaymentReferenceToFirestore(data: {
  userId: string;
  userEmail: string;
  userName: string;
  userPhone?: string;
  bikeModel: string;
  bikePlate?: string;
  paymentMethod: PaymentMethod;
  referenceNumber: string;
  amountPhp?: number;
}): Promise<string> {
  const submissionId = `pay_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const path = `paymentSubmissions/${submissionId}`;

  try {
    const submission: PaymentSubmission = {
      id: submissionId,
      userId: data.userId,
      userEmail: data.userEmail,
      userName: data.userName,
      userPhone: data.userPhone || '',
      bikeModel: data.bikeModel || 'Motorcycle',
      bikePlate: data.bikePlate || '',
      paymentMethod: data.paymentMethod,
      referenceNumber: data.referenceNumber,
      amountPhp: data.amountPhp || 49,
      status: 'pending_approval',
      submittedAt: new Date().toISOString(),
      notes: `Submitted via ${data.paymentMethod.toUpperCase()} QRPH. Awaiting owner admin approval.`,
    };

    await setDoc(doc(db, 'paymentSubmissions', submissionId), submission);

    // Also update rider user doc
    const userDocRef = doc(db, 'users', data.userId);
    await updateDoc(userDocRef, {
      paymentStatus: 'pending_approval',
      paymentMethod: data.paymentMethod,
      referenceNumber: data.referenceNumber,
      amountPhp: data.amountPhp || 49,
      lastPaymentDate: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).catch(() => {});

    return submissionId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

// 4. Admin: Subscribe to All Payment Submissions Live
export function subscribeToAllPaymentSubmissions(
  callback: (submissions: PaymentSubmission[]) => void
): () => void {
  const path = 'paymentSubmissions';
  return onSnapshot(
    collection(db, 'paymentSubmissions'),
    (snapshot) => {
      const items: PaymentSubmission[] = [];
      snapshot.forEach((docSnap) => {
        items.push(docSnap.data() as PaymentSubmission);
      });
      // Sort newest first
      items.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
      callback(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

// 5. Admin: Approve Pro Access
export async function approveProAccessInFirestore(
  submissionId: string,
  riderUserId: string,
  adminIdentifier: string = 'Owner Admin'
): Promise<void> {
  const path = `paymentSubmissions/${submissionId}`;
  try {
    const approvedAt = new Date().toISOString();

    // 1. Update submission record
    await updateDoc(doc(db, 'paymentSubmissions', submissionId), {
      status: 'active_pro',
      reviewedAt: approvedAt,
      reviewedBy: adminIdentifier,
      notes: `Approved by ${adminIdentifier}. PRO unlocked.`,
    });

    // 2. Update user profile to PRO
    await updateDoc(doc(db, 'users', riderUserId), {
      subscriptionTier: 'pro',
      subscriptionStatus: 'active',
      paymentStatus: 'active_pro',
      approvedAt: approvedAt,
      approvedBy: adminIdentifier,
      updatedAt: approvedAt,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

// 6. Admin: Revoke Pro Access
export async function revokeProAccessInFirestore(
  submissionId: string,
  riderUserId: string
): Promise<void> {
  const path = `paymentSubmissions/${submissionId}`;
  try {
    await updateDoc(doc(db, 'paymentSubmissions', submissionId), {
      status: 'rejected',
      reviewedAt: new Date().toISOString(),
      notes: 'PRO access revoked by Admin.',
    });

    await updateDoc(doc(db, 'users', riderUserId), {
      subscriptionTier: 'free',
      subscriptionStatus: 'free',
      paymentStatus: 'unpaid_free',
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

// 7. Sync Motorcycles to Firestore
export async function saveMotorcycleToFirestore(bike: Motorcycle, userId: string): Promise<void> {
  const path = `motorcycles/${bike.id}`;
  try {
    await setDoc(doc(db, 'motorcycles', bike.id), {
      ...bike,
      userId,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteMotorcycleFromFirestore(bikeId: string): Promise<void> {
  const path = `motorcycles/${bikeId}`;
  try {
    await deleteDoc(doc(db, 'motorcycles', bikeId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function subscribeToUserMotorcycles(
  userId: string,
  callback: (bikes: Motorcycle[]) => void
): () => void {
  const path = 'motorcycles';
  const q = query(collection(db, 'motorcycles'), where('userId', '==', userId));
  return onSnapshot(
    q,
    (snapshot) => {
      const bikes: Motorcycle[] = [];
      snapshot.forEach((docSnap) => {
        bikes.push(docSnap.data() as Motorcycle);
      });
      callback(bikes);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}
