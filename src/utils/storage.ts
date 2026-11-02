import { Motorcycle, MaintenanceReminder, ServiceRecord, PreRideItem, UserSubscription } from '../types';
import {
  INITIAL_MOTORCYCLES,
  INITIAL_REMINDERS,
  INITIAL_SERVICE_RECORDS,
  INITIAL_PRE_RIDE_ITEMS,
  INITIAL_SUBSCRIPTION,
} from '../data/initialData';

const STORAGE_KEYS = {
  MOTORCYCLES: 'motocare_app_motorcycles_v4',
  REMINDERS: 'motocare_app_reminders_v4',
  SERVICE_RECORDS: 'motocare_app_records_v4',
  ACTIVE_BIKE_ID: 'motocare_app_active_bike_id_v4',
  PRE_RIDE: 'motocare_app_preride_v4',
  SUBSCRIPTION: 'motocare_app_subscription_v4',
  CUSTOM_PRESETS: 'motocare_app_quick_km_presets_v4',
};

// --- Storage Load / Save ---

export function loadMotorcycles(): Motorcycle[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.MOTORCYCLES);
    if (raw) {
      const parsed: Motorcycle[] = JSON.parse(raw);
      return parsed.map((b) => ({
        ...b,
        model: b.model ? b.model.replace(/\s*V3/gi, '') : b.model,
      }));
    }
  } catch (err) {
    console.error('Failed to load motorcycles', err);
  }
  return [];
}

export function saveMotorcycles(bikes: Motorcycle[]) {
  try {
    localStorage.setItem(STORAGE_KEYS.MOTORCYCLES, JSON.stringify(bikes));
  } catch (err) {
    console.error('Failed to save motorcycles', err);
  }
}

export function loadReminders(): MaintenanceReminder[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.REMINDERS);
    if (raw) return JSON.parse(raw);
  } catch (err) {
    console.error('Failed to load reminders', err);
  }
  return INITIAL_REMINDERS;
}

export function saveReminders(reminders: MaintenanceReminder[]) {
  try {
    localStorage.setItem(STORAGE_KEYS.REMINDERS, JSON.stringify(reminders));
  } catch (err) {
    console.error('Failed to save reminders', err);
  }
}

export function loadServiceRecords(): ServiceRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SERVICE_RECORDS);
    if (raw) return JSON.parse(raw);
  } catch (err) {
    console.error('Failed to load service records', err);
  }
  return INITIAL_SERVICE_RECORDS;
}

export function saveServiceRecords(records: ServiceRecord[]) {
  try {
    localStorage.setItem(STORAGE_KEYS.SERVICE_RECORDS, JSON.stringify(records));
  } catch (err) {
    console.error('Failed to save service records', err);
  }
}

export function loadActiveBikeId(bikes: Motorcycle[]): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.ACTIVE_BIKE_ID);
    if (saved && bikes.some((b) => b.id === saved)) {
      return saved;
    }
  } catch {
    // fallback
  }
  return bikes[0]?.id || '';
}

export function saveActiveBikeId(id: string) {
  try {
    localStorage.setItem(STORAGE_KEYS.ACTIVE_BIKE_ID, id);
  } catch {
    // ignore
  }
}

export function loadPreRideItems(): PreRideItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.PRE_RIDE);
    if (raw) return JSON.parse(raw);
  } catch {
    // fallback
  }
  return INITIAL_PRE_RIDE_ITEMS;
}

export function savePreRideItems(items: PreRideItem[]) {
  try {
    localStorage.setItem(STORAGE_KEYS.PRE_RIDE, JSON.stringify(items));
  } catch {
    // ignore
  }
}

export function loadSubscription(): UserSubscription {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SUBSCRIPTION);
    if (raw) return JSON.parse(raw);
  } catch {
    // fallback
  }
  return INITIAL_SUBSCRIPTION;
}

export function saveSubscription(sub: UserSubscription) {
  try {
    localStorage.setItem(STORAGE_KEYS.SUBSCRIPTION, JSON.stringify(sub));
  } catch {
    // ignore
  }
}

export function loadQuickKmPresets(): number[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CUSTOM_PRESETS);
    if (raw) return JSON.parse(raw);
  } catch {
    // fallback
  }
  return [15, 38, 5, 80]; // Default: +15km (commute), +38km (Marilaque loop), +5km (errand), +80km (touring)
}

export function saveQuickKmPresets(presets: number[]) {
  try {
    localStorage.setItem(STORAGE_KEYS.CUSTOM_PRESETS, JSON.stringify(presets));
  } catch {
    // ignore
  }
}

export function resetAllToDefault() {
  localStorage.removeItem(STORAGE_KEYS.MOTORCYCLES);
  localStorage.removeItem(STORAGE_KEYS.REMINDERS);
  localStorage.removeItem(STORAGE_KEYS.SERVICE_RECORDS);
  localStorage.removeItem(STORAGE_KEYS.ACTIVE_BIKE_ID);
  localStorage.removeItem(STORAGE_KEYS.PRE_RIDE);
  localStorage.removeItem(STORAGE_KEYS.SUBSCRIPTION);
  localStorage.removeItem(STORAGE_KEYS.CUSTOM_PRESETS);
}

// --- Reminder Status Analysis ---

export type ReminderStatus = 'overdue' | 'due-soon' | 'ok';

export interface ReminderAnalysis {
  status: ReminderStatus;
  remainingKm: number; // positive = km left, negative = overdue km
  percentUsed: number; // 0 to 100+
  statusLabel: string;
}

export function analyzeReminder(reminder: MaintenanceReminder, currentOdo: number): ReminderAnalysis {
  const remainingKm = reminder.nextDueOdo - currentOdo;
  const elapsed = currentOdo - reminder.lastCompletedOdo;
  const totalSpan = reminder.intervalKm || 1;
  const percentUsed = Math.min(Math.max((elapsed / totalSpan) * 100, 0), 150);

  let status: ReminderStatus = 'ok';
  let statusLabel = `Due in ${remainingKm.toLocaleString()} km`;

  if (remainingKm <= 0) {
    status = 'overdue';
    statusLabel = `Overdue by ${Math.abs(remainingKm).toLocaleString()} km`;
  } else if (remainingKm <= 350) {
    status = 'due-soon';
    statusLabel = `Due soon in ${remainingKm.toLocaleString()} km`;
  }

  return {
    status,
    remainingKm,
    percentUsed: Math.min(percentUsed, 100),
    statusLabel,
  };
}

// --- Casa Service History Booklet Export (CSV / Print) ---

export function exportCasaServiceCsv(bike: Motorcycle, records: ServiceRecord[]) {
  const headers = [
    'Date',
    'Odometer (km)',
    'Service Task',
    'Category',
    'Service Center / Shop',
    'Type',
    'Oil Grade / Brand',
    'Parts Invoiced (PHP)',
    'Labor (PHP)',
    'Total Cost (PHP)',
    'Official Receipt #',
    'Casa Verified',
    'Mechanic Notes',
  ];

  const rows = records.map((r) => {
    const partsCost = r.parts.reduce((sum, p) => sum + p.costPhp, 0);
    return [
      `"${r.date}"`,
      r.odometer,
      `"${r.title.replace(/"/g, '""')}"`,
      `"${r.category}"`,
      `"${(r.shopName || 'Casa / Workshop').replace(/"/g, '""')}"`,
      `"${r.type}"`,
      `"${(r.oilBrandGrade || 'N/A').replace(/"/g, '""')}"`,
      partsCost.toFixed(2),
      r.laborCostPhp.toFixed(2),
      r.totalCostPhp.toFixed(2),
      `"${r.receiptNumber || 'N/A'}"`,
      r.isCasaVerified ? 'YES' : 'NO',
      `"${(r.notes || '').replace(/"/g, '""')}"`,
    ];
  });

  const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `motocare-ph-casa-booklet-${bike.brand}-${bike.model}-${bike.licensePlate || 'bike'}.csv`.toLowerCase().replace(/\s+/g, '-');
  a.click();
  URL.revokeObjectURL(url);
}

export function exportFullBackupJson(
  bikes: Motorcycle[],
  reminders: MaintenanceReminder[],
  records: ServiceRecord[],
  subscription: UserSubscription
) {
  const payload = {
    appName: 'MotoCare PH',
    version: '2.0-ph',
    exportTimestamp: new Date().toISOString(),
    subscription,
    motorcycles: bikes,
    reminders,
    serviceRecords: records,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `motocare-ph-garage-backup-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
