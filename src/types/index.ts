export type TransmissionType = 'Automatic Scooter' | 'Manual' | 'Semi-Auto Underbone';
export type EngineCooling = 'Liquid-Cooled' | 'Air-Cooled' | 'Oil-Cooled';
export type DistanceUnit = 'km';

export type ServiceCategory =
  | 'Engine Oil'
  | 'Gear Oil'
  | 'CVT & Belt'
  | 'Drive Chain'
  | 'Brakes'
  | 'Spark Plug'
  | 'Coolant'
  | 'Air Filter'
  | 'Valve Clearance'
  | 'Tires'
  | 'Battery'
  | 'LTO Registration'
  | 'General Inspection';

export interface MotorcycleSpecs {
  transmission: TransmissionType;
  cooling: EngineCooling;
  displacementCc: number;
  tirePressureFrontPsi: number;
  tirePressureRearPsi: number;
  oilViscosity: string; // e.g. "10W-40 JASO MB" or "10W-40 JASO MA2"
  oilCapacityLiters: number;
  gearOilCapacityMl?: number; // for scooters (e.g. 100ml / 120ml / 150ml)
  recommendedServiceIntervalKm: number;
}

export type TimestampSource = 'server' | 'client_pending' | 'legacy_local';

export type CustomMotorcycleType =
  | 'Scooter'
  | 'Underbone'
  | 'Manual'
  | 'Sport Bike'
  | 'Standard'
  | 'Adventure'
  | 'Other';

export interface Motorcycle {
  id: string;
  userId?: string;
  nickname: string;
  brand: string; // Yamaha, Honda, Suzuki, Kawasaki, Bajaj, KTM, CFMoto, or Custom
  model: string; // NMAX 155, Click 125i, etc.
  year: number;
  licensePlate: string; // e.g. "ND 8492" or "123ABC"
  color: string;
  odometer: number; // in km
  photoUrl?: string;
  purchaseDate?: string;
  specs: MotorcycleSpecs;
  notes?: string;
  customColorBadge?: string; // hex code or preset
  motorcycleType?: CustomMotorcycleType | 'Scooter / AT' | 'Backbone / Commuter' | string;
  isCustom?: boolean;
  unit?: 'km' | 'mi';
  createdAt?: string;
  updatedAt?: string;
  cloudVersion?: number;
  timestampSource?: TimestampSource;
}

export interface MaintenanceReminder {
  id: string;
  userId?: string;
  bikeId: string;
  title: string;
  category: ServiceCategory;
  categoryTag?: 'ENGINE' | 'FLUIDS' | 'CVT & DRIVE' | 'ELECTRICAL' | 'BRAKES' | 'COOLING' | string;
  intervalKm: number; // recurring interval
  lastCompletedOdo: number;
  nextDueOdo: number;
  lastCompletedDate: string;
  priority: 'high' | 'medium' | 'low';
  notes: string;
  manualSpecNote?: string;
  customAccentColor?: string;
  estimatedCostPhp: number;
  createdAt?: string;
  updatedAt?: string;
  cloudVersion?: number;
  timestampSource?: TimestampSource;
}

export interface ServicePart {
  name: string;
  brand?: string;
  costPhp: number;
}

export interface ServiceRecord {
  id: string;
  userId?: string;
  bikeId: string;
  bikeLabelSnapshot?: string; // Preserves bike brand/model/plate if bike is later retired or sold
  date: string;
  odometer: number;
  title: string;
  category: ServiceCategory;
  type: 'DIY' | 'Casa / Official 3S' | 'Independent Shop';
  shopName?: string; // Motoworld, Shell Helix / Advance Station, Yamaha 3S, Honda Desmark, DIY Garage
  oilBrandGrade?: string; // Yamalube Blue Core, Shell Advance Ultra, Motul Scooter Expert, Castrol Power1
  parts: ServicePart[];
  laborCostPhp: number;
  totalCostPhp: number;
  notes: string;
  receiptNumber?: string;
  isCasaVerified?: boolean;
  linkedReminderId?: string;
  createdAt?: string;
  updatedAt?: string;
  cloudVersion?: number;
  timestampSource?: TimestampSource;
}

export interface LtoRenewalInfo {
  plateNumber: string;
  lastDigit: number | null;
  middleDigit: number | null;
  renewalMonthName: string;
  renewalWeekRange: string;
  renewalDeadlineDate: string;
  daysRemaining: number;
  status: 'safe' | 'due-this-month' | 'overdue';
  penaltyFeeEstimate: number;
}

export interface PreRideItem {
  id: string;
  group: 'Tires & Wheels' | 'Controls' | 'Lights & Electrics' | 'Oil & Fluids' | 'Chassis & Chain/CVT' | 'Stands';
  label: string;
  detail: string;
  checked: boolean;
}

export type ActiveTab = 'garage' | 'reminders' | 'logbook' | 'gps-ride' | 'lto' | 'analytics';

export type UserSubscriptionTier = 'free' | 'pro';
export type PaymentMethod = 'gcash' | 'gotyme' | 'maribank' | 'maya' | 'card';

export interface UserSubscription {
  tier: UserSubscriptionTier;
  plan: 'monthly' | 'annual' | null;
  status: 'active' | 'trial' | 'free' | 'expired' | 'revoked';
  trialEndDate?: string;
  paymentMethod?: PaymentMethod;
  gcashNumber?: string;
  referenceNumber?: string;
  subscriptionStartDate?: string;
  expiryDate?: string; // ISO 8601 string in UI state (stored as native Firestore Timestamp)
  billingAnchorDay?: number;
  lastPaymentId?: string;
  daysRemaining?: number;
  isExpired?: boolean;
}

export type AccountPaymentStatus = 'pending_approval' | 'active_pro' | 'unpaid_free' | 'rejected';
export type DashboardSubscriptionStatus = 'FREE' | 'ACTIVE' | 'PENDING RENEWAL' | 'EXPIRED' | 'REJECTED';

export interface UserAccount {
  id: string;
  name: string;
  email: string;
  registeredAt: string;
  bikeModel: string;
  bikeNickname?: string;
  bikePlate?: string;
  bikeCount?: number;
  lastBikeId?: string;
  lastBikeAction?: 'create' | 'delete';
  subscriptionTier: UserSubscriptionTier;
  paymentStatus: AccountPaymentStatus;
  paymentMethod?: PaymentMethod;
  referenceNumber?: string;
  amountPhp?: number;
  lastPaymentDate?: string;
  subscriptionStartDate?: string;
  expiryDate?: string;
  billingAnchorDay?: number;
  lastPaymentId?: string;
  daysRemaining?: number;
  effectiveStatus?: DashboardSubscriptionStatus;
  hasPendingRenewal?: boolean;
  approvedAt?: string;
  approvedBy?: string;
  notes?: string;
}

export interface ActiveGpsRide {
  isActive: boolean;
  isPaused: boolean;
  startTime: number | null;
  elapsedSeconds: number;
  distanceKm: number;
  currentSpeedKmh: number;
  maxSpeedKmh: number;
  avgSpeedKmh: number;
  routeCoordinates: Array<{ lat: number; lng: number; time: number }>;
}

export interface BluetoothDevicePreset {
  id: string;
  name: string;
  type: 'helmet_intercom' | 'motorcycle_display';
  brand: 'Cardo' | 'Sena' | 'FreedConn' | 'EJEAS' | 'Yamaha Y-Connect' | 'Honda RoadSync';
  connected: boolean;
  batteryLevel?: number;
}

export type CloudSyncStatus = 'synced' | 'syncing' | 'offline_cache' | 'sync_error';

export type OfflineMutationEntity = 'motorcycle' | 'reminder' | 'serviceRecord';
export type OfflineMutationAction = 'upsert' | 'update_fields' | 'delete';

export type MutationFailureClassification =
  | 'offline'
  | 'temporary_network_error'
  | 'permission_or_validation_error'
  | 'quota_exceeded'
  | 'version_conflict'
  | 'retry_exhausted';

export interface OfflineMutationItem {
  id: string;
  userId: string;
  entity: OfflineMutationEntity;
  action: OfflineMutationAction;
  targetId: string;
  payload?: Record<string, unknown>;
  createdAtIso: string;
  retryCount: number;
  lastError?: string;
  /**
   * Authoritative cloud `updatedAt` ISO timestamp captured from the last synchronized
   * Firestore document before local optimistic edits occurred.
   * `null` when `expectedCloudAbsent === true` (newly created document).
   */
  baseCloudUpdatedAt?: string | null;
  /**
   * Authoritative transactional integer revision (`cloudVersion`) captured before local edits.
   */
  baseCloudVersion?: number | null;
  /**
   * True when the mutation was created for a new document that did not yet exist in Firestore.
   */
  expectedCloudAbsent?: boolean;
  /**
   * Optional flag marking a legacy/untrusted queue item that lacks a verified base cloud version.
   */
  baseVersionUntrusted?: boolean;
  /**
   * Monotonically incremented generation counter for this queued item whenever rapid edits coalesce.
   * Prevents an earlier in-flight or debounced direct write from accidentally removing a newer mutation.
   */
  mutationGeneration?: number;
}

export interface QuarantinedMutationItem {
  id: string;
  userId: string;
  entity: OfflineMutationEntity;
  action: OfflineMutationAction;
  targetId: string;
  payload?: Record<string, unknown>;
  createdAtIso: string;
  retryCount: number;
  lastError: string;
  quarantinedAtIso: string;
  failureClassification: MutationFailureClassification;
  baseCloudUpdatedAt?: string | null;
  baseCloudVersion?: number | null;
  expectedCloudAbsent?: boolean;
  baseVersionUntrusted?: boolean;
  conflictCloudUpdatedAt?: string | null;
  conflictCloudVersion?: number | null;
  conflictReason?: string;
  mutationGeneration?: number;
}

export interface SyncConflictItem<T = Motorcycle | MaintenanceReminder | ServiceRecord> {
  id: string;
  entity: OfflineMutationEntity;
  targetId: string;
  reason: 'ambiguous_odometer' | 'divergent_timestamps' | 'concurrent_edit';
  localRecord: T;
  cloudRecord: T;
  detectedAtIso: string;
}

export interface MigrationLedger {
  userId: string;
  userEmail: string;
  status: 'pending_confirmation' | 'in_progress' | 'completed' | 'skipped';
  selectedBikeIds?: string[];
  motorcyclesCompletedIds: string[];
  remindersCompletedIds: string[];
  serviceRecordsCompletedIds: string[];
  bikeIdRemap: Record<string, string>;
  backupKey: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
}

export interface PreMigrationBackupPayload {
  backupVersion: '1.0';
  createdAtIso: string;
  userId: string;
  userEmail: string;
  motorcycles: Motorcycle[];
  reminders: MaintenanceReminder[];
  serviceRecords: ServiceRecord[];
  activeBikeId: string | null;
}

export interface LegacyMigrationDryRun {
  userId: string;
  userEmail: string;
  eligibleMotorcycles: Motorcycle[];
  eligibleReminders: MaintenanceReminder[];
  eligibleServiceRecords: ServiceRecord[];
  rejectedForeignUidCount: number;
  excludedMockSampleCount: number;
  requiresQuotaSelection: boolean;
  maxAllowedCloudBikes: number;
  conflictsDetected: SyncConflictItem[];
  hasLegacyDataToReview: boolean;
}

export interface CloudSyncLogEntry {
  id: string;
  userId: string;
  timestampIso: string;
  status: 'success' | 'failed';
  operation: string;
  entity: OfflineMutationEntity | 'queue_flush' | 'migration';
  targetId?: string;
  detail?: string;
  errorMessage?: string;
}


