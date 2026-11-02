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

export interface Motorcycle {
  id: string;
  nickname: string;
  brand: string; // Yamaha, Honda, Suzuki, Kawasaki, Bajaj, KTM, CFMoto
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
  motorcycleType?: 'Scooter / AT' | 'Underbone' | 'Backbone / Commuter' | string;
  unit?: 'km' | 'mi';
}

export interface MaintenanceReminder {
  id: string;
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
}

export interface ServicePart {
  name: string;
  brand?: string;
  costPhp: number;
}

export interface ServiceRecord {
  id: string;
  bikeId: string;
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
  status: 'active' | 'trial' | 'free';
  trialEndDate?: string;
  paymentMethod?: PaymentMethod;
  gcashNumber?: string;
  referenceNumber?: string;
  expiryDate?: string;
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
