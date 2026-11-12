import {
  Motorcycle,
  MaintenanceReminder,
  ServiceRecord,
  PreRideItem,
  UserSubscription,
  UserAccount,
  OfflineMutationItem,
  QuarantinedMutationItem,
  MutationFailureClassification,
  MigrationLedger,
  PreMigrationBackupPayload,
  LegacyMigrationDryRun,
  SyncConflictItem,
  CloudSyncLogEntry,
} from '../types';
import {
  INITIAL_PRE_RIDE_ITEMS,
  INITIAL_SUBSCRIPTION,
} from '../data/initialData';
import { jsPDF } from 'jspdf';

export const STORAGE_KEYS = {
  MOTORCYCLES: 'motocare_app_motorcycles_v4',
  REMINDERS: 'motocare_app_reminders_v4',
  SERVICE_RECORDS: 'motocare_app_records_v4',
  ACTIVE_BIKE_ID: 'motocare_app_active_bike_id_v4',
  PRE_RIDE: 'motocare_app_preride_v4',
  SUBSCRIPTION: 'motocare_app_subscription_v4',
  CUSTOM_PRESETS: 'motocare_app_quick_km_presets_v4',
  USER_ACCOUNTS: 'motocare_app_admin_users_v5',
};

export function getUserScopedKey(
  userId: string,
  domain: 'motorcycles' | 'reminders' | 'records' | 'active_bike_id'
): string {
  return `motocare_cache_${userId}_${domain}_v4`;
}

export function getPreMigrationBackupKey(userId: string): string {
  return `motocare_pre_cloud_migration_backup_v1_${userId}`;
}

export function getMigrationLedgerKey(userId: string): string {
  return `motocare_migration_ledger_v1_${userId}`;
}

export function getOfflineMutationQueueKey(userId: string): string {
  return `motocare_offline_queue_v1_${userId}`;
}

export function getQuarantinedMutationQueueKey(userId: string): string {
  return `motocare_quarantined_queue_v1_${userId}`;
}

export function getCloudSyncLogKey(userId: string): string {
  return `motocare_sync_ops_log_v1_${userId}`;
}

// --- Storage Load / Save ---

export const CONFIRMED_SAMPLE_MOTORCYCLE_IDS = new Set([
  'bike-ph-1',
  'bike-ph-2',
]);

export const CONFIRMED_SAMPLE_REMINDER_IDS = new Set([
  'rem-nmax-1',
  'rem-nmax-2',
  'rem-nmax-3',
  'rem-nmax-4',
  'rem-nmax-5',
  'rem-nmax-6',
  'rem-nmax-7',
  'rem-nmax-8',
  'rem-nmax-9',
  'rem-click-1',
  'rem-click-2',
]);

export const CONFIRMED_SAMPLE_SERVICE_RECORD_IDS = new Set([
  'rec-ph-1',
  'rec-ph-2',
  'rec-ph-3',
]);

export function pruneCachedSampleData(): void {
  try {
    const rawBikes = localStorage.getItem(STORAGE_KEYS.MOTORCYCLES);
    if (rawBikes) {
      const parsed = JSON.parse(rawBikes);
      if (Array.isArray(parsed)) {
        const cleaned = parsed.filter((b) => b && !CONFIRMED_SAMPLE_MOTORCYCLE_IDS.has(b.id));
        if (cleaned.length !== parsed.length) {
          localStorage.setItem(STORAGE_KEYS.MOTORCYCLES, JSON.stringify(cleaned));
        }
      }
    }

    const rawReminders = localStorage.getItem(STORAGE_KEYS.REMINDERS);
    if (rawReminders) {
      const parsed = JSON.parse(rawReminders);
      if (Array.isArray(parsed)) {
        const cleaned = parsed.filter((r) => r && !CONFIRMED_SAMPLE_REMINDER_IDS.has(r.id));
        if (cleaned.length !== parsed.length) {
          localStorage.setItem(STORAGE_KEYS.REMINDERS, JSON.stringify(cleaned));
        }
      }
    }

    const rawRecords = localStorage.getItem(STORAGE_KEYS.SERVICE_RECORDS);
    if (rawRecords) {
      const parsed = JSON.parse(rawRecords);
      if (Array.isArray(parsed)) {
        const cleaned = parsed.filter((r) => r && !CONFIRMED_SAMPLE_SERVICE_RECORD_IDS.has(r.id));
        if (cleaned.length !== parsed.length) {
          localStorage.setItem(STORAGE_KEYS.SERVICE_RECORDS, JSON.stringify(cleaned));
        }
      }
    }
  } catch (err) {
    console.error('Failed to prune cached sample data', err);
  }
}

export function loadMotorcycles(): Motorcycle[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.MOTORCYCLES);
    if (raw) {
      const parsed: Motorcycle[] = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const cleaned = parsed
          .filter((b) => b && !CONFIRMED_SAMPLE_MOTORCYCLE_IDS.has(b.id))
          .map((b) => ({
            ...b,
            model: b.model ? b.model.replace(/\s*V3/gi, '') : b.model,
          }));
        if (cleaned.length !== parsed.length) {
          localStorage.setItem(STORAGE_KEYS.MOTORCYCLES, JSON.stringify(cleaned));
        }
        return cleaned;
      }
    }
  } catch (err) {
    console.error('Failed to load motorcycles', err);
  }
  return [];
}

export function saveMotorcycles(bikes: Motorcycle[]) {
  try {
    const cleaned = bikes.filter((b) => b && !CONFIRMED_SAMPLE_MOTORCYCLE_IDS.has(b.id));
    localStorage.setItem(STORAGE_KEYS.MOTORCYCLES, JSON.stringify(cleaned));
  } catch (err) {
    console.error('Failed to save motorcycles', err);
  }
}

export function loadReminders(): MaintenanceReminder[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.REMINDERS);
    if (raw) {
      const parsed: MaintenanceReminder[] = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const cleaned = parsed.filter((r) => r && !CONFIRMED_SAMPLE_REMINDER_IDS.has(r.id));
        if (cleaned.length !== parsed.length) {
          localStorage.setItem(STORAGE_KEYS.REMINDERS, JSON.stringify(cleaned));
        }
        return cleaned;
      }
    }
  } catch (err) {
    console.error('Failed to load reminders', err);
  }
  return [];
}

export function saveReminders(reminders: MaintenanceReminder[]) {
  try {
    const cleaned = reminders.filter((r) => r && !CONFIRMED_SAMPLE_REMINDER_IDS.has(r.id));
    localStorage.setItem(STORAGE_KEYS.REMINDERS, JSON.stringify(cleaned));
  } catch (err) {
    console.error('Failed to save reminders', err);
  }
}

export function loadServiceRecords(): ServiceRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SERVICE_RECORDS);
    if (raw) {
      const parsed: ServiceRecord[] = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const cleaned = parsed.filter((r) => r && !CONFIRMED_SAMPLE_SERVICE_RECORD_IDS.has(r.id));
        if (cleaned.length !== parsed.length) {
          localStorage.setItem(STORAGE_KEYS.SERVICE_RECORDS, JSON.stringify(cleaned));
        }
        return cleaned;
      }
    }
  } catch (err) {
    console.error('Failed to load service records', err);
  }
  return [];
}

export function saveServiceRecords(records: ServiceRecord[]) {
  try {
    const cleaned = records.filter((r) => r && !CONFIRMED_SAMPLE_SERVICE_RECORD_IDS.has(r.id));
    localStorage.setItem(STORAGE_KEYS.SERVICE_RECORDS, JSON.stringify(cleaned));
  } catch (err) {
    console.error('Failed to save service records', err);
  }
}

export function loadActiveBikeId(bikes: Motorcycle[]): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.ACTIVE_BIKE_ID);
    if (saved && !CONFIRMED_SAMPLE_MOTORCYCLE_IDS.has(saved) && bikes.some((b) => b.id === saved)) {
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
  // LocalStorage must never independently grant Pro entitlement.
  // Authoritative Pro entitlement is derived strictly from verified Firestore records in AuthContext.
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SUBSCRIPTION);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && (parsed.tier === 'pro' || parsed.status === 'active')) {
        localStorage.setItem(STORAGE_KEYS.SUBSCRIPTION, JSON.stringify(INITIAL_SUBSCRIPTION));
      }
    }
  } catch {
    // fallback
  }
  return { ...INITIAL_SUBSCRIPTION };
}

export function saveSubscription(_sub: UserSubscription) {
  // Never persist Pro entitlement to LocalStorage to prevent client-side manipulation.
  try {
    localStorage.setItem(STORAGE_KEYS.SUBSCRIPTION, JSON.stringify(INITIAL_SUBSCRIPTION));
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
  localStorage.removeItem('motocare_app_payment_submissions_v4');
  localStorage.removeItem('motocare_app_notifications_v4');
  localStorage.removeItem('motocare_app_auto_km_config_v4');
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

// --- Casa Service History & Maintenance Records Export (CSV & Formatted PDF) ---

function triggerBrowserDownload(blob: Blob, filename: string): void {
  if (typeof document === 'undefined') return;
  let url = `blob:motocare/${filename}`;
  let createdObjectUrl = false;
  try {
    if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      url = URL.createObjectURL(blob);
      createdObjectUrl = true;
    }
  } catch {
    url = `blob:motocare/${filename}`;
  }

  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    if (createdObjectUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
    }
  }
}

export function exportCasaServiceCsv(
  bike: Motorcycle,
  records: ServiceRecord[],
  reminders: MaintenanceReminder[] = []
): string {
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
    const partsCost = (r.parts || []).reduce((sum, p) => sum + p.costPhp, 0);
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

  const sections: string[] = [
    `# MotoCare PH — Service History & Maintenance Records (${bike.year} ${bike.brand} ${bike.model} - Plate: ${bike.licensePlate || 'N/A'})`,
    headers.join(','),
    ...rows.map((row) => row.join(',')),
  ];

  if (reminders.length > 0) {
    const reminderHeaders = [
      'Maintenance Task',
      'Category',
      'Interval (km)',
      'Last Completed Odo (km)',
      'Next Due Odo (km)',
      'Remaining (km)',
      'Status',
      'OEM Spec Note',
    ];
    const reminderRows = reminders.map((rem) => {
      const analysis = analyzeReminder(rem, bike.odometer);
      return [
        `"${rem.title.replace(/"/g, '""')}"`,
        `"${(rem.category || 'General').replace(/"/g, '""')}"`,
        rem.intervalKm,
        rem.lastCompletedOdo,
        rem.nextDueOdo,
        analysis.remainingKm,
        `"${analysis.status.toUpperCase()}"`,
        `"${(rem.manualSpecNote || '').replace(/"/g, '""')}"`,
      ].join(',');
    });
    sections.push('', '# Scheduled Maintenance Records', reminderHeaders.join(','), ...reminderRows);
  }

  const csvContent = sections.join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const filename = `motocare-ph-service-records-${bike.brand}-${bike.model}-${bike.licensePlate || 'bike'}.csv`
    .toLowerCase()
    .replace(/\s+/g, '-');
  triggerBrowserDownload(blob, filename);
  return csvContent;
}

export function exportServiceAndMaintenanceCsv(
  bike: Motorcycle,
  records: ServiceRecord[],
  reminders: MaintenanceReminder[] = []
): string {
  return exportCasaServiceCsv(bike, records, reminders);
}

export const THEME_STORAGE_KEY = 'motocare_theme_preference';
export type ThemeMode = 'light' | 'dark';

export function loadThemePreference(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') {
      return saved;
    }
  } catch {
    // ignore storage errors
  }
  return 'light';
}

export function saveThemePreference(theme: ThemeMode): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // ignore storage errors
  }
}

export interface PrintableMaintenanceReportSummary {
  generatedAtIso: string;
  bikeLabel: string;
  licensePlate: string;
  currentOdometerKm: number;
  totalServiceRecords: number;
  totalSpentPhp: number;
  diySavedPhp: number;
  casaVerifiedCount: number;
  totalReminders: number;
  overdueCount: number;
  dueSoonCount: number;
  goodCount: number;
  overallHealthStatus: 'OVERDUE ATTENTION REQUIRED' | 'DUE SOON' | 'ALL INTERVALS GOOD';
}

export interface PrintableMaintenanceReportResult {
  pdfContent: string;
  filename: string;
  summary: PrintableMaintenanceReportSummary;
}

/**
 * Aggregates all service records and current maintenance status into a clean,
 * multi-page printable PDF 1.4 report that users can download from their
 * profile or service history tab.
 */
export function generatePrintableMaintenancePdfReport(
  bike: Motorcycle | null | undefined,
  records: ServiceRecord[] = [],
  reminders: MaintenanceReminder[] = []
): PrintableMaintenanceReportResult {
  const safeBike: Motorcycle = bike || {
    id: 'garage-summary',
    nickname: 'MotoCare Garage',
    brand: 'MotoCare',
    model: 'All Motorcycles',
    year: new Date().getFullYear(),
    licensePlate: 'N/A',
    color: 'Standard',
    odometer: 0,
    specs: {
      transmission: 'Automatic Scooter',
      cooling: 'Air-Cooled',
      displacementCc: 125,
      tirePressureFrontPsi: 29,
      tirePressureRearPsi: 33,
      oilViscosity: '10W-40',
      oilCapacityLiters: 0.8,
      recommendedServiceIntervalKm: 3000,
    },
  };

  const bikeRecords = [...records]
    .filter((r) => (!bike?.id ? true : r.bikeId === bike.id || !r.bikeId))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const bikeReminders = [...reminders].filter((rem) =>
    !bike?.id ? true : rem.bikeId === bike.id || !rem.bikeId
  );

  const totalSpentPhp = bikeRecords.reduce((sum, r) => sum + (r.totalCostPhp || 0), 0);
  const diyRecordsCount = bikeRecords.filter((r) => r.type === 'DIY').length;
  const diySavedPhp = diyRecordsCount * 250;
  const casaVerifiedCount = bikeRecords.filter(
    (r) => r.isCasaVerified || r.type === 'Casa / Official 3S'
  ).length;

  const analyzedReminders = bikeReminders.map((rem) => ({
    reminder: rem,
    analysis: analyzeReminder(rem, safeBike.odometer),
  }));

  const overdueCount = analyzedReminders.filter((x) => x.analysis.status === 'overdue').length;
  const dueSoonCount = analyzedReminders.filter((x) => x.analysis.status === 'due-soon').length;
  const goodCount = analyzedReminders.filter((x) => x.analysis.status === 'ok').length;

  const overallHealthStatus: PrintableMaintenanceReportSummary['overallHealthStatus'] =
    overdueCount > 0
      ? 'OVERDUE ATTENTION REQUIRED'
      : dueSoonCount > 0
      ? 'DUE SOON'
      : 'ALL INTERVALS GOOD';

  const generatedAtIso = new Date().toISOString();
  const generatedDateLabel = generatedAtIso.split('T')[0];
  const bikeLabel = `${safeBike.year} ${safeBike.brand} ${safeBike.model}${
    safeBike.nickname ? ` ("${safeBike.nickname}")` : ''
  }`;

  const summary: PrintableMaintenanceReportSummary = {
    generatedAtIso,
    bikeLabel,
    licensePlate: safeBike.licensePlate || 'N/A',
    currentOdometerKm: safeBike.odometer || 0,
    totalServiceRecords: bikeRecords.length,
    totalSpentPhp,
    diySavedPhp,
    casaVerifiedCount,
    totalReminders: bikeReminders.length,
    overdueCount,
    dueSoonCount,
    goodCount,
    overallHealthStatus,
  };

  const lines: Array<{ text: string; bold?: boolean; size?: number }> = [
    { text: 'MOTOCARE PH - SERVICE HISTORY & MAINTENANCE RECORDS', bold: true, size: 13 },
    {
      text: 'OFFICIAL PRINTABLE VEHICLE MAINTENANCE & SERVICE STATUS REPORT',
      bold: true,
      size: 10,
    },
    { text: `Report Generated: ${generatedDateLabel} | Overall Status: ${overallHealthStatus}`, size: 9 },
    { text: '================================================================================', size: 8 },
    { text: `Motorcycle: ${bikeLabel}`, bold: true, size: 10 },
    {
      text: `License Plate: ${summary.licensePlate} | Current Odometer: ${summary.currentOdometerKm.toLocaleString()} ${
        safeBike.unit || 'km'
      }`,
      size: 9,
    },
    {
      text: `Specs: ${safeBike.specs?.transmission || 'Standard'} | ${
        safeBike.specs?.cooling || 'Air-Cooled'
      } | Oil: ${safeBike.specs?.oilViscosity || '10W-40'} (${
        safeBike.specs?.oilCapacityLiters || 0.8
      }L)`,
      size: 9,
    },
    {
      text: `Total Documented Spend: PHP ${totalSpentPhp.toLocaleString()} | DIY Saved: +PHP ${diySavedPhp.toLocaleString()} | Casa 3S Verified: ${casaVerifiedCount}`,
      bold: true,
      size: 9,
    },
    {
      text: `Current Maintenance Status: ${overdueCount} Overdue | ${dueSoonCount} Due Soon | ${goodCount} Good (${bikeReminders.length} Total Tasks)`,
      bold: true,
      size: 9,
    },
    { text: '--------------------------------------------------------------------------------', size: 8 },
    { text: '1. CURRENT MAINTENANCE STATUS & SCHEDULED REMINDERS', bold: true, size: 11 },
  ];

  if (analyzedReminders.length === 0) {
    lines.push({ text: 'No active maintenance reminders configured.', size: 9 });
  } else {
    analyzedReminders.forEach(({ reminder: rem, analysis }, idx) => {
      const badge =
        analysis.status === 'overdue'
          ? 'OVERDUE'
          : analysis.status === 'due-soon'
          ? 'DUE SOON'
          : 'GOOD';
      lines.push({
        text: `${idx + 1}. [${badge}] ${rem.title} (${rem.category || 'Maintenance'}) - Next Due: ${rem.nextDueOdo.toLocaleString()} km (${analysis.statusLabel})`,
        bold: true,
        size: 9,
      });
      lines.push({
        text: `   Interval: Every ${rem.intervalKm.toLocaleString()} km | Last Done: ${rem.lastCompletedOdo.toLocaleString()} km${
          rem.manualSpecNote ? ` | Spec: ${rem.manualSpecNote}` : ''
        }`,
        size: 8,
      });
    });
  }

  lines.push(
    { text: '--------------------------------------------------------------------------------', size: 8 },
    { text: '2. COMPLETE SERVICE HISTORY LOGBOOK', bold: true, size: 11 }
  );

  if (bikeRecords.length === 0) {
    lines.push({ text: 'No service history records logged yet.', size: 9 });
  } else {
    bikeRecords.forEach((r, idx) => {
      const partsCost = (r.parts || []).reduce((sum, p) => sum + (p.costPhp || 0), 0);
      lines.push({
        text: `${idx + 1}. [${r.date}] ${r.title} @ ${r.odometer.toLocaleString()} km - PHP ${r.totalCostPhp.toLocaleString()} (${r.type})`,
        bold: true,
        size: 9,
      });
      const details = [
        `Shop: ${r.shopName || 'Workshop'}`,
        r.oilBrandGrade ? `Oil: ${r.oilBrandGrade}` : '',
        `Parts: PHP ${partsCost.toLocaleString()}`,
        `Labor: PHP ${(r.laborCostPhp || 0).toLocaleString()}`,
        r.receiptNumber ? `OR#: ${r.receiptNumber}` : '',
        r.isCasaVerified ? 'Casa 3S Verified' : '',
        r.notes ? `Notes: ${r.notes}` : '',
      ]
        .filter(Boolean)
        .join(' | ');
      if (details) {
        lines.push({ text: `   ${details}`, size: 8 });
      }
    });
  }

  // Generate formatted multi-page PDF document using jsPDF
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'letter',
    compress: false,
  });

  // Draw top accent header bar
  doc.setFillColor(11, 19, 43); // Navy #0B132B
  doc.rect(0, 0, 612, 24, 'F');
  doc.setFillColor(255, 107, 0); // MotoCare Orange #FF6B00
  doc.rect(0, 24, 612, 4, 'F');

  let currentY = 52;
  for (const line of lines) {
    const fontSize = line.size || 9;
    const lineHeight = fontSize + 6;
    if (currentY + lineHeight > 748) {
      doc.addPage();
      currentY = 48;
    }
    doc.setFont('helvetica', line.bold ? 'bold' : 'normal');
    doc.setFontSize(fontSize);
    const sanitizedText = line.text.replace(/₱/g, 'PHP ').replace(/[^\x20-\x7E]/g, ' ');
    doc.text(sanitizedText, 42, currentY);
    currentY += lineHeight;
  }

  const rawJsPdfOutput = doc.output();
  const pdfDocument = rawJsPdfOutput.replace(/^%PDF-1\.\d/, '%PDF-1.4');

  const filename = `motocare-ph-maintenance-report-${safeBike.brand}-${safeBike.model}-${
    safeBike.licensePlate || 'bike'
  }.pdf`
    .toLowerCase()
    .replace(/\s+/g, '-');

  const blob = new Blob([pdfDocument], { type: 'application/pdf' });
  triggerBrowserDownload(blob, filename);

  return {
    pdfContent: pdfDocument,
    filename,
    summary,
  };
}

export function exportServiceAndMaintenancePdf(
  bike: Motorcycle,
  records: ServiceRecord[],
  reminders: MaintenanceReminder[] = []
): string {
  return generatePrintableMaintenancePdfReport(bike, records, reminders).pdfContent;
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

// --- Admin User Accounts Management ---

const CONFIRMED_MOCK_USER_IDS = new Set([
  'user-001',
  'user-002',
  'user-003',
  'user-004',
  'user-005',
]);

const CONFIRMED_MOCK_REFERENCE_NUMBERS = new Set([
  'GCASH-881920',
  'GCASH-982143',
  'GOTYME-449120',
  'GCASH-339102',
]);

const CONFIRMED_MOCK_EMAILS = new Set([
  'mark.bautista@gmail.com',
  'juan.delacruz@gotyme.ph',
  'pat.santos@yahoo.com',
  'jerome.rider@gmail.com',
]);

export function isConfirmedMockUserAccount(account: Partial<UserAccount> | null | undefined): boolean {
  if (!account) return false;
  if (account.id && CONFIRMED_MOCK_USER_IDS.has(account.id)) return true;
  if (account.referenceNumber && CONFIRMED_MOCK_REFERENCE_NUMBERS.has(account.referenceNumber)) return true;
  if (account.email && CONFIRMED_MOCK_EMAILS.has(account.email.toLowerCase())) return true;
  return false;
}

export const INITIAL_USER_ACCOUNTS: UserAccount[] = [];

export function loadUserAccounts(): UserAccount[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.USER_ACCOUNTS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const cleaned = parsed.filter((u) => !isConfirmedMockUserAccount(u));
        if (cleaned.length !== parsed.length) {
          saveUserAccounts(cleaned);
        }
        return cleaned;
      }
    }
  } catch (err) {
    console.error('Failed to load user accounts', err);
  }
  return INITIAL_USER_ACCOUNTS;
}

export function saveUserAccounts(users: UserAccount[]) {
  try {
    const cleaned = users.filter((u) => !isConfirmedMockUserAccount(u));
    localStorage.setItem(STORAGE_KEYS.USER_ACCOUNTS, JSON.stringify(cleaned));
  } catch (err) {
    console.error('Failed to save user accounts', err);
  }
}

// ============================================================================
// UID-SCOPED READ-THROUGH CACHE HELPERS (Phase 1.5 & 1.6)
// ============================================================================

export function loadUserScopedMotorcycles(userId: string): Motorcycle[] {
  if (!userId) return [];
  try {
    const raw = localStorage.getItem(getUserScopedKey(userId, 'motorcycles'));
    if (raw) {
      const parsed: Motorcycle[] = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (b) =>
            b &&
            !CONFIRMED_SAMPLE_MOTORCYCLE_IDS.has(b.id) &&
            (!b.userId || b.userId === userId)
        );
      }
    }
  } catch (err) {
    console.error('Failed to load UID-scoped motorcycles', err);
  }
  return [];
}

export function saveUserScopedMotorcycles(userId: string, bikes: Motorcycle[]): void {
  if (!userId) return;
  try {
    const cleaned = bikes
      .filter(
        (b) =>
          b &&
          !CONFIRMED_SAMPLE_MOTORCYCLE_IDS.has(b.id) &&
          (!b.userId || b.userId === userId)
      )
      .map((b) => ({ ...b, userId }));
    localStorage.setItem(getUserScopedKey(userId, 'motorcycles'), JSON.stringify(cleaned));
  } catch (err) {
    console.error('Failed to save UID-scoped motorcycles', err);
  }
}

export function loadUserScopedReminders(userId: string): MaintenanceReminder[] {
  if (!userId) return [];
  try {
    const raw = localStorage.getItem(getUserScopedKey(userId, 'reminders'));
    if (raw) {
      const parsed: MaintenanceReminder[] = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (r) =>
            r &&
            !CONFIRMED_SAMPLE_REMINDER_IDS.has(r.id) &&
            (!r.userId || r.userId === userId)
        );
      }
    }
  } catch (err) {
    console.error('Failed to load UID-scoped reminders', err);
  }
  return [];
}

export function saveUserScopedReminders(userId: string, reminders: MaintenanceReminder[]): void {
  if (!userId) return;
  try {
    const cleaned = reminders
      .filter(
        (r) =>
          r &&
          !CONFIRMED_SAMPLE_REMINDER_IDS.has(r.id) &&
          (!r.userId || r.userId === userId)
      )
      .map((r) => ({ ...r, userId }));
    localStorage.setItem(getUserScopedKey(userId, 'reminders'), JSON.stringify(cleaned));
  } catch (err) {
    console.error('Failed to save UID-scoped reminders', err);
  }
}

export function loadUserScopedServiceRecords(userId: string): ServiceRecord[] {
  if (!userId) return [];
  try {
    const raw = localStorage.getItem(getUserScopedKey(userId, 'records'));
    if (raw) {
      const parsed: ServiceRecord[] = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (r) =>
            r &&
            !CONFIRMED_SAMPLE_SERVICE_RECORD_IDS.has(r.id) &&
            (!r.userId || r.userId === userId)
        );
      }
    }
  } catch (err) {
    console.error('Failed to load UID-scoped service records', err);
  }
  return [];
}

export function saveUserScopedServiceRecords(userId: string, records: ServiceRecord[]): void {
  if (!userId) return;
  try {
    const cleaned = records
      .filter(
        (r) =>
          r &&
          !CONFIRMED_SAMPLE_SERVICE_RECORD_IDS.has(r.id) &&
          (!r.userId || r.userId === userId)
      )
      .map((r) => ({ ...r, userId }));
    localStorage.setItem(getUserScopedKey(userId, 'records'), JSON.stringify(cleaned));
  } catch (err) {
    console.error('Failed to save UID-scoped service records', err);
  }
}

export function loadUserScopedActiveBikeId(userId: string, bikes: Motorcycle[]): string {
  if (!userId) return bikes[0]?.id || '';
  try {
    const saved = localStorage.getItem(getUserScopedKey(userId, 'active_bike_id'));
    if (saved && !CONFIRMED_SAMPLE_MOTORCYCLE_IDS.has(saved) && bikes.some((b) => b.id === saved)) {
      return saved;
    }
  } catch {
    // fallback
  }
  return bikes[0]?.id || '';
}

export function saveUserScopedActiveBikeId(userId: string, bikeId: string): void {
  if (!userId) return;
  try {
    localStorage.setItem(getUserScopedKey(userId, 'active_bike_id'), bikeId);
  } catch {
    // ignore
  }
}

// ============================================================================
// DURABLE OFFLINE MUTATION QUEUE (Phase 1.8 & Phase 6)
// ============================================================================

export function getOfflineMutationQueue(userId: string): OfflineMutationItem[] {
  if (!userId) return [];
  try {
    const raw = localStorage.getItem(getOfflineMutationQueueKey(userId));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((item) => item && item.userId === userId);
      }
    }
  } catch (err) {
    console.error('Failed to read offline mutation queue', err);
  }
  return [];
}

export function saveOfflineMutationQueue(userId: string, items: OfflineMutationItem[]): void {
  if (!userId) return;
  try {
    localStorage.setItem(getOfflineMutationQueueKey(userId), JSON.stringify(items));
  } catch (err) {
    console.error('Failed to save offline mutation queue', err);
  }
}

export function getCloudVersionRegistryKey(userId: string): string {
  return `motocare_cloud_versions_v1_${userId}`;
}

export function getKnownCloudVersion(
  userId: string,
  entity: 'motorcycle' | 'reminder' | 'serviceRecord',
  targetId: string
): string | null {
  if (!userId || !targetId) return null;
  try {
    const raw = localStorage.getItem(getCloudVersionRegistryKey(userId));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const val = parsed[`${entity}:${targetId}`];
        if (typeof val === 'string' && val.length > 0) {
          return val;
        }
      }
    }
  } catch {
    // ignore storage errors
  }

  // Fallback to UID-scoped read-through cache if the cached record carries a server-confirmed timestamp
  try {
    const cachedList =
      entity === 'motorcycle'
        ? loadUserScopedMotorcycles(userId)
        : entity === 'reminder'
        ? loadUserScopedReminders(userId)
        : loadUserScopedServiceRecords(userId);
    const match = cachedList.find((item) => item && item.id === targetId);
    if (match && match.updatedAt && match.timestampSource !== 'client_pending') {
      return match.updatedAt;
    }
  } catch {
    // ignore
  }
  return null;
}

export function getKnownCloudRevision(
  userId: string,
  entity: 'motorcycle' | 'reminder' | 'serviceRecord',
  targetId: string
): number | null {
  if (!userId || !targetId) return null;
  try {
    const raw = localStorage.getItem(getCloudVersionRegistryKey(userId));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const rev = parsed[`${entity}:${targetId}:rev`];
        if (typeof rev === 'number' && Number.isFinite(rev)) {
          return rev;
        }
      }
    }
  } catch {
    // ignore storage errors
  }

  try {
    const cachedList =
      entity === 'motorcycle'
        ? loadUserScopedMotorcycles(userId)
        : entity === 'reminder'
        ? loadUserScopedReminders(userId)
        : loadUserScopedServiceRecords(userId);
    const match = cachedList.find((item) => item && item.id === targetId);
    if (
      match &&
      typeof match.cloudVersion === 'number' &&
      Number.isFinite(match.cloudVersion) &&
      match.timestampSource !== 'client_pending'
    ) {
      return match.cloudVersion;
    }
  } catch {
    // ignore
  }
  return null;
}

export function recordKnownCloudVersion(
  userId: string,
  entity: 'motorcycle' | 'reminder' | 'serviceRecord',
  targetId: string,
  updatedAtIso: string | undefined | null,
  cloudVersion?: number | null
): void {
  if (!userId || !targetId || !updatedAtIso) return;
  // Do not overwrite local device's known cloud version while browser is offline
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return;
  }
  try {
    const key = getCloudVersionRegistryKey(userId);
    const raw = localStorage.getItem(key);
    const map: Record<string, string | number> = raw ? JSON.parse(raw) || {} : {};
    map[`${entity}:${targetId}`] = updatedAtIso;
    if (typeof cloudVersion === 'number' && Number.isFinite(cloudVersion)) {
      map[`${entity}:${targetId}:rev`] = cloudVersion;
    } else {
      delete map[`${entity}:${targetId}:rev`];
    }
    localStorage.setItem(key, JSON.stringify(map));
  } catch {
    // ignore
  }
}

export function removeKnownCloudVersion(
  userId: string,
  entity: 'motorcycle' | 'reminder' | 'serviceRecord',
  targetId: string
): void {
  if (!userId || !targetId) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return;
  }
  try {
    const key = getCloudVersionRegistryKey(userId);
    const raw = localStorage.getItem(key);
    if (!raw) return;
    const map: Record<string, string | number> = JSON.parse(raw) || {};
    delete map[`${entity}:${targetId}`];
    delete map[`${entity}:${targetId}:rev`];
    localStorage.setItem(key, JSON.stringify(map));
  } catch {
    // ignore
  }
}

/**
 * Enqueues or coalesces a mutation for durable offline/debounced synchronization.
 * If an existing pending update_fields or upsert exists for the same entity + targetId,
 * coalesces the payload while strictly preserving the original baseCloudUpdatedAt,
 * baseCloudVersion, and expectedCloudAbsent captured before local edits began, and
 * increments `mutationGeneration` so an earlier in-flight write can never remove a newer edit.
 */
export function enqueueOfflineMutation(
  item: Omit<OfflineMutationItem, 'id' | 'createdAtIso' | 'retryCount'> & {
    id?: string;
    createdAtIso?: string;
    retryCount?: number;
  }
): OfflineMutationItem {
  const queue = getOfflineMutationQueue(item.userId);
  const nowIso = item.createdAtIso || new Date().toISOString();

  const existingIdx = queue.findIndex(
    (q) => q.entity === item.entity && q.targetId === item.targetId
  );

  if (existingIdx >= 0) {
    const existing = queue[existingIdx];
    const nextGeneration = (existing.mutationGeneration ?? 1) + 1;
    // If deleting a record that was queued, replace with delete while preserving original base version
    if (item.action === 'delete') {
      const updated: OfflineMutationItem = {
        id: existing.id,
        userId: item.userId,
        entity: item.entity,
        action: 'delete',
        targetId: item.targetId,
        payload: item.payload ?? existing.payload,
        createdAtIso: nowIso,
        retryCount: 0,
        baseCloudUpdatedAt: existing.baseCloudUpdatedAt,
        baseCloudVersion: existing.baseCloudVersion,
        expectedCloudAbsent: existing.expectedCloudAbsent,
        baseVersionUntrusted: existing.baseVersionUntrusted,
        mutationGeneration: nextGeneration,
      };
      queue[existingIdx] = updated;
      saveOfflineMutationQueue(item.userId, queue);
      return updated;
    }

    // Coalesce payload into existing upsert or update_fields while preserving original baseCloudUpdatedAt & baseCloudVersion
    const mergedAction =
      existing.action === 'upsert' || item.action === 'upsert' ? 'upsert' : item.action;
    const updated: OfflineMutationItem = {
      ...existing,
      action: mergedAction,
      payload: { ...(existing.payload || {}), ...(item.payload || {}) },
      createdAtIso: nowIso,
      baseCloudUpdatedAt: existing.baseCloudUpdatedAt,
      baseCloudVersion: existing.baseCloudVersion,
      expectedCloudAbsent: existing.expectedCloudAbsent,
      baseVersionUntrusted: existing.baseVersionUntrusted,
      mutationGeneration: nextGeneration,
    };
    queue[existingIdx] = updated;
    saveOfflineMutationQueue(item.userId, queue);
    return updated;
  }

  let resolvedBaseCloudUpdatedAt: string | null | undefined = item.baseCloudUpdatedAt;
  let resolvedBaseCloudVersion: number | null | undefined = item.baseCloudVersion;
  let resolvedExpectedCloudAbsent: boolean | undefined = item.expectedCloudAbsent;
  const resolvedBaseVersionUntrusted: boolean | undefined = item.baseVersionUntrusted;

  if (resolvedBaseVersionUntrusted) {
    resolvedBaseCloudUpdatedAt = undefined;
    resolvedBaseCloudVersion = undefined;
    resolvedExpectedCloudAbsent = false;
  } else if (
    resolvedBaseCloudUpdatedAt === undefined &&
    resolvedExpectedCloudAbsent === undefined
  ) {
    const knownCloudVersion = getKnownCloudVersion(item.userId, item.entity, item.targetId);
    const knownCloudRev = getKnownCloudRevision(item.userId, item.entity, item.targetId);
    if (knownCloudVersion) {
      resolvedBaseCloudUpdatedAt = knownCloudVersion;
      if (resolvedBaseCloudVersion === undefined && knownCloudRev !== null) {
        resolvedBaseCloudVersion = knownCloudRev;
      }
      resolvedExpectedCloudAbsent = false;
    } else if (item.action === 'upsert') {
      resolvedBaseCloudUpdatedAt = null;
      resolvedBaseCloudVersion = null;
      resolvedExpectedCloudAbsent = true;
    } else {
      resolvedBaseCloudUpdatedAt = undefined;
      resolvedBaseCloudVersion = undefined;
      resolvedExpectedCloudAbsent = false;
    }
  } else if (resolvedExpectedCloudAbsent === true && resolvedBaseCloudUpdatedAt === undefined) {
    resolvedBaseCloudUpdatedAt = null;
    if (resolvedBaseCloudVersion === undefined) {
      resolvedBaseCloudVersion = null;
    }
  } else if (typeof resolvedBaseCloudUpdatedAt === 'string') {
    if (resolvedExpectedCloudAbsent === undefined) {
      resolvedExpectedCloudAbsent = false;
    }
    if (resolvedBaseCloudVersion === undefined) {
      const knownIso = getKnownCloudVersion(item.userId, item.entity, item.targetId);
      const knownRev = getKnownCloudRevision(item.userId, item.entity, item.targetId);
      if (knownIso === resolvedBaseCloudUpdatedAt && knownRev !== null) {
        resolvedBaseCloudVersion = knownRev;
      }
    }
  }

  const created: OfflineMutationItem = {
    id: item.id || `mut_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    userId: item.userId,
    entity: item.entity,
    action: item.action,
    targetId: item.targetId,
    payload: item.payload,
    createdAtIso: nowIso,
    retryCount: item.retryCount ?? 0,
    baseCloudUpdatedAt: resolvedBaseCloudUpdatedAt,
    ...(resolvedBaseCloudVersion !== undefined ? { baseCloudVersion: resolvedBaseCloudVersion } : {}),
    expectedCloudAbsent: resolvedExpectedCloudAbsent,
    ...(resolvedBaseVersionUntrusted ? { baseVersionUntrusted: true } : {}),
    mutationGeneration: item.mutationGeneration ?? 1,
  };
  queue.push(created);
  saveOfflineMutationQueue(item.userId, queue);
  return created;
}

export function removeOfflineMutation(userId: string, mutationId: string): void {
  if (!userId) return;
  const queue = getOfflineMutationQueue(userId);
  const filtered = queue.filter((q) => q.id !== mutationId);
  saveOfflineMutationQueue(userId, filtered);
}

// ============================================================================
// RECOVERABLE QUARANTINED MUTATION QUEUE (UID-Scoped Data-Loss Prevention)
// ============================================================================

export function classifyMutationFailure(
  errorMessage: string,
  retryCountAfterAttempt: number,
  maxRetries: number = 5,
  isNavigatorOffline: boolean = typeof navigator !== 'undefined' && navigator.onLine === false
): MutationFailureClassification {
  if (isNavigatorOffline) {
    return 'offline';
  }
  const msg = errorMessage || '';
  if (msg.includes('CONCURRENCY_CONFLICT')) {
    return 'version_conflict';
  }
  if (msg.includes('QUOTA_EXCEEDED')) {
    return 'quota_exceeded';
  }
  if (
    msg.includes('PERMISSION_DENIED') ||
    msg.includes('Missing or insufficient permissions') ||
    msg.includes('INVALID_ARGUMENT')
  ) {
    return 'permission_or_validation_error';
  }
  if (retryCountAfterAttempt >= maxRetries) {
    return 'retry_exhausted';
  }
  return 'temporary_network_error';
}

export function getQuarantinedMutationQueue(userId: string): QuarantinedMutationItem[] {
  if (!userId) return [];
  try {
    const raw = localStorage.getItem(getQuarantinedMutationQueueKey(userId));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return (parsed as QuarantinedMutationItem[]).filter(
          (item) => item && item.userId === userId
        );
      }
    }
  } catch (err) {
    console.error('Failed to read quarantined mutation queue', err);
  }
  return [];
}

export function saveQuarantinedMutationQueue(
  userId: string,
  items: QuarantinedMutationItem[]
): void {
  if (!userId) return;
  try {
    const scopedItems = items.filter((item) => item && item.userId === userId);
    localStorage.setItem(getQuarantinedMutationQueueKey(userId), JSON.stringify(scopedItems));
  } catch (err) {
    console.error('Failed to save quarantined mutation queue', err);
  }
}

/**
 * Preserves the complete original mutation payload and base version in
 * `motocare_quarantined_queue_v1_${userId}` before an item is removed from the active queue.
 */
export function quarantineOfflineMutation(params: {
  item: OfflineMutationItem;
  lastError: string;
  retryCount: number;
  failureClassification: MutationFailureClassification;
  quarantinedAtIso?: string;
  conflictCloudUpdatedAt?: string | null;
  conflictCloudVersion?: number | null;
  conflictReason?: string;
}): QuarantinedMutationItem | null {
  const {
    item,
    lastError,
    retryCount,
    failureClassification,
    quarantinedAtIso,
    conflictCloudUpdatedAt,
    conflictCloudVersion,
    conflictReason,
  } = params;
  if (!item || !item.userId) return null;

  const existingQuarantine = getQuarantinedMutationQueue(item.userId);
  const nowIso = quarantinedAtIso || new Date().toISOString();

  const quarantinedItem: QuarantinedMutationItem = {
    id: item.id,
    userId: item.userId,
    entity: item.entity,
    action: item.action,
    targetId: item.targetId,
    payload: item.payload ? JSON.parse(JSON.stringify(item.payload)) : undefined,
    createdAtIso: item.createdAtIso,
    retryCount,
    lastError,
    quarantinedAtIso: nowIso,
    failureClassification,
    baseCloudUpdatedAt: item.baseCloudUpdatedAt,
    ...(item.baseCloudVersion !== undefined ? { baseCloudVersion: item.baseCloudVersion } : {}),
    expectedCloudAbsent: item.expectedCloudAbsent,
    ...(item.baseVersionUntrusted ? { baseVersionUntrusted: true } : {}),
    ...(conflictCloudUpdatedAt !== undefined ? { conflictCloudUpdatedAt } : {}),
    ...(conflictCloudVersion !== undefined ? { conflictCloudVersion } : {}),
    ...(conflictReason ? { conflictReason } : {}),
    ...(item.mutationGeneration !== undefined ? { mutationGeneration: item.mutationGeneration } : {}),
  };

  const existingIdx = existingQuarantine.findIndex((q) => q.id === item.id);
  if (existingIdx >= 0) {
    existingQuarantine[existingIdx] = quarantinedItem;
  } else {
    existingQuarantine.unshift(quarantinedItem);
  }

  saveQuarantinedMutationQueue(item.userId, existingQuarantine);
  return quarantinedItem;
}

/**
 * Re-queues a quarantined mutation back into the active UID-scoped offline queue
 * with retryCount reset to 0 while preserving its original baseCloudUpdatedAt,
 * baseCloudVersion, and expectedCloudAbsent metadata so the decisive replay transaction
 * still enforces version protection.
 * Strictly enforces UID ownership so User B can never recover User A's mutation.
 */
export function requeueQuarantinedMutation(
  userId: string,
  mutationId: string
): OfflineMutationItem | null {
  if (!userId || !mutationId) return null;
  const quarantinedList = getQuarantinedMutationQueue(userId);
  const found = quarantinedList.find((q) => q.id === mutationId && q.userId === userId);
  if (!found) return null;

  // Never automatically requeue a mutation that lacks trustworthy base-version information
  const hasTrustworthyBaseVersion =
    !found.baseVersionUntrusted &&
    ((typeof found.baseCloudUpdatedAt === 'string' && found.baseCloudUpdatedAt.length > 0) ||
      typeof found.baseCloudVersion === 'number' ||
      found.expectedCloudAbsent === true);
  if (!hasTrustworthyBaseVersion) {
    return null;
  }

  const requeued = enqueueOfflineMutation({
    id: found.id,
    userId: found.userId,
    entity: found.entity,
    action: found.action,
    targetId: found.targetId,
    payload: found.payload ? JSON.parse(JSON.stringify(found.payload)) : undefined,
    createdAtIso: found.createdAtIso,
    retryCount: 0,
    baseCloudUpdatedAt: found.baseCloudUpdatedAt,
    baseCloudVersion: found.baseCloudVersion,
    expectedCloudAbsent: found.expectedCloudAbsent,
    baseVersionUntrusted: found.baseVersionUntrusted,
    mutationGeneration: found.mutationGeneration ?? 1,
  });

  const remainingQuarantine = quarantinedList.filter((q) => q.id !== mutationId);
  saveQuarantinedMutationQueue(userId, remainingQuarantine);
  return requeued;
}

export function removeQuarantinedMutation(userId: string, mutationId: string): void {
  if (!userId || !mutationId) return;
  const quarantinedList = getQuarantinedMutationQueue(userId);
  const remaining = quarantinedList.filter((q) => q.id !== mutationId);
  saveQuarantinedMutationQueue(userId, remaining);
}

// ============================================================================
// CLOUD SYNC OPERATION TELEMETRY LOG (Last 5 Successful vs Failed Operations)
// ============================================================================

const MAX_STORED_SYNC_LOGS_PER_USER = 50;

export function recordCloudSyncOperation(
  entry: Omit<CloudSyncLogEntry, 'id' | 'timestampIso'> & {
    id?: string;
    timestampIso?: string;
  }
): CloudSyncLogEntry | null {
  if (!entry.userId) return null;
  const fullEntry: CloudSyncLogEntry = {
    id: entry.id || `sync_op_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    userId: entry.userId,
    timestampIso: entry.timestampIso || new Date().toISOString(),
    status: entry.status,
    operation: entry.operation,
    entity: entry.entity,
    targetId: entry.targetId,
    detail: entry.detail,
    errorMessage: entry.errorMessage,
  };

  try {
    const key = getCloudSyncLogKey(entry.userId);
    const raw = localStorage.getItem(key);
    let existing: CloudSyncLogEntry[] = [];
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        existing = parsed.filter((item) => item && item.userId === entry.userId);
      }
    }
    const updated = [fullEntry, ...existing].slice(0, MAX_STORED_SYNC_LOGS_PER_USER);
    localStorage.setItem(key, JSON.stringify(updated));
  } catch (err) {
    console.error('Failed to record cloud sync operation log', err);
  }

  return fullEntry;
}

export function getCloudSyncOperationLogs(userId: string): {
  allLogs: CloudSyncLogEntry[];
  last5Successful: CloudSyncLogEntry[];
  last5Failed: CloudSyncLogEntry[];
} {
  if (!userId) {
    return { allLogs: [], last5Successful: [], last5Failed: [] };
  }
  try {
    const raw = localStorage.getItem(getCloudSyncLogKey(userId));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const valid = (parsed as CloudSyncLogEntry[])
          .filter((item) => item && item.userId === userId)
          .sort(
            (a, b) =>
              new Date(b.timestampIso).getTime() - new Date(a.timestampIso).getTime()
          );
        const last5Successful = valid.filter((item) => item.status === 'success').slice(0, 5);
        const last5Failed = valid.filter((item) => item.status === 'failed').slice(0, 5);
        return {
          allLogs: valid,
          last5Successful,
          last5Failed,
        };
      }
    }
  } catch (err) {
    console.error('Failed to read cloud sync operation logs', err);
  }
  return { allLogs: [], last5Successful: [], last5Failed: [] };
}

export function clearCloudSyncOperationLogs(userId: string): void {
  if (!userId) return;
  try {
    localStorage.removeItem(getCloudSyncLogKey(userId));
  } catch {
    // ignore
  }
}

// ============================================================================
// PRE-MIGRATION IMMUTABLE BACKUP & MIGRATION LEDGER (Phase 2 & Phase 3)
// ============================================================================

/**
 * Creates an immutable UID-specific backup of all legacy LocalStorage keys
 * BEFORE any migration or cloud merge occurs.
 * Never modifies or deletes the original legacy LocalStorage keys.
 */
export function createImmutablePreMigrationBackup(
  userId: string,
  userEmail: string
): PreMigrationBackupPayload {
  const backupKey = getPreMigrationBackupKey(userId);
  try {
    const existingRaw = localStorage.getItem(backupKey);
    if (existingRaw) {
      const parsed = JSON.parse(existingRaw) as PreMigrationBackupPayload;
      if (parsed && parsed.userId === userId && Array.isArray(parsed.motorcycles)) {
        return parsed;
      }
    }
  } catch {
    // proceed to create fresh backup
  }

  let rawMotorcycles: Motorcycle[] = [];
  let rawReminders: MaintenanceReminder[] = [];
  let rawServiceRecords: ServiceRecord[] = [];
  let rawActiveBikeId: string | null = null;

  try {
    const bStr = localStorage.getItem(STORAGE_KEYS.MOTORCYCLES);
    if (bStr) {
      const parsed = JSON.parse(bStr);
      if (Array.isArray(parsed)) rawMotorcycles = parsed;
    }
    const rStr = localStorage.getItem(STORAGE_KEYS.REMINDERS);
    if (rStr) {
      const parsed = JSON.parse(rStr);
      if (Array.isArray(parsed)) rawReminders = parsed;
    }
    const sStr = localStorage.getItem(STORAGE_KEYS.SERVICE_RECORDS);
    if (sStr) {
      const parsed = JSON.parse(sStr);
      if (Array.isArray(parsed)) rawServiceRecords = parsed;
    }
    rawActiveBikeId = localStorage.getItem(STORAGE_KEYS.ACTIVE_BIKE_ID);
  } catch (err) {
    console.error('Failed reading legacy keys for pre-migration backup', err);
  }

  const payload: PreMigrationBackupPayload = {
    backupVersion: '1.0',
    createdAtIso: new Date().toISOString(),
    userId,
    userEmail,
    motorcycles: rawMotorcycles,
    reminders: rawReminders,
    serviceRecords: rawServiceRecords,
    activeBikeId: rawActiveBikeId,
  };

  try {
    localStorage.setItem(backupKey, JSON.stringify(payload));
  } catch (err) {
    console.error('Failed saving immutable pre-migration backup', err);
  }

  return payload;
}

export function loadPreMigrationBackup(userId: string): PreMigrationBackupPayload | null {
  if (!userId) return null;
  try {
    const raw = localStorage.getItem(getPreMigrationBackupKey(userId));
    if (raw) {
      return JSON.parse(raw) as PreMigrationBackupPayload;
    }
  } catch {
    // ignore
  }
  return null;
}

export function downloadPreMigrationBackupJson(userId: string, userEmail: string): void {
  const backup = createImmutablePreMigrationBackup(userId, userEmail);
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `motocare-legacy-backup-${userId.slice(0, 8)}-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function loadMigrationLedger(userId: string): MigrationLedger | null {
  if (!userId) return null;
  try {
    const raw = localStorage.getItem(getMigrationLedgerKey(userId));
    if (raw) {
      const parsed = JSON.parse(raw) as MigrationLedger;
      if (parsed && parsed.userId === userId) {
        return parsed;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

export function saveMigrationLedger(ledger: MigrationLedger): void {
  if (!ledger?.userId) return;
  try {
    localStorage.setItem(getMigrationLedgerKey(ledger.userId), JSON.stringify(ledger));
  } catch (err) {
    console.error('Failed to save migration ledger', err);
  }
}

export function skipLegacyMigrationForUser(userId: string, userEmail: string): MigrationLedger {
  createImmutablePreMigrationBackup(userId, userEmail);
  const nowIso = new Date().toISOString();
  const ledger: MigrationLedger = {
    userId,
    userEmail,
    status: 'skipped',
    motorcyclesCompletedIds: [],
    remindersCompletedIds: [],
    serviceRecordsCompletedIds: [],
    bikeIdRemap: {},
    backupKey: getPreMigrationBackupKey(userId),
    completedAt: nowIso,
    updatedAt: nowIso,
  };
  saveMigrationLedger(ledger);
  return ledger;
}

// ============================================================================
// TIMESTAMP & CONFLICT DETECTION ENGINE (Phase 2, Phase 4)
// ============================================================================

export function parseTimestampToMillis(val: unknown): number | null {
  if (!val) return null;
  if (typeof (val as any)?.toMillis === 'function') {
    return (val as any).toMillis();
  }
  if (typeof (val as any)?.toDate === 'function') {
    return (val as any).toDate().getTime();
  }
  if (typeof val === 'object' && val !== null && 'seconds' in val && typeof (val as any).seconds === 'number') {
    const nanos = typeof (val as any).nanoseconds === 'number' ? (val as any).nanoseconds : 0;
    return (val as any).seconds * 1000 + Math.floor(nanos / 1_000_000);
  }
  if (typeof val === 'string') {
    const ms = new Date(val).getTime();
    return isNaN(ms) ? null : ms;
  }
  if (typeof val === 'number') {
    return val;
  }
  return null;
}

/**
 * Evaluates a local record and a cloud record for the same motorcycle ID.
 * - Never blindly uses the highest odometer if timestamps are ambiguous or contradictory.
 * - Never overwrites a newer cloud record with an older local record.
 * - Returns { winner: 'cloud' | 'local', conflict?: SyncConflictItem<Motorcycle> }.
 */
export function resolveMotorcycleConflict(
  localBike: Motorcycle,
  cloudBike: Motorcycle
): { resolved: Motorcycle; winner: 'cloud' | 'local'; conflict?: SyncConflictItem<Motorcycle> } {
  const localMs = parseTimestampToMillis(localBike.updatedAt);
  const cloudMs = parseTimestampToMillis(cloudBike.updatedAt);

  // If identical odometer, plate, brand, model, nickname -> no conflict, cloud canonical wins
  const isIdentical =
    localBike.odometer === cloudBike.odometer &&
    (localBike.licensePlate || '') === (cloudBike.licensePlate || '') &&
    localBike.brand === cloudBike.brand &&
    localBike.model === cloudBike.model &&
    (localBike.nickname || '') === (cloudBike.nickname || '');

  if (isIdentical) {
    return { resolved: cloudBike, winner: 'cloud' };
  }

  // Case 1: Local has no timestamp (legacy unscoped record), while Cloud has a confirmed timestamp
  if (localMs === null && cloudMs !== null) {
    // If odometer differs, do NOT blindly take the higher odometer; preserve cloud and surface conflict for review
    if (localBike.odometer !== cloudBike.odometer) {
      return {
        resolved: cloudBike,
        winner: 'cloud',
        conflict: {
          id: `conflict_bike_${cloudBike.id}`,
          entity: 'motorcycle',
          targetId: cloudBike.id,
          reason: 'ambiguous_odometer',
          localRecord: localBike,
          cloudRecord: cloudBike,
          detectedAtIso: new Date().toISOString(),
        },
      };
    }
    return { resolved: cloudBike, winner: 'cloud' };
  }

  // Case 2: Both have timestamps
  if (localMs !== null && cloudMs !== null) {
    // Ambiguous odometer conflict: e.g., local has a NEWER timestamp but a LOWER odometer,
    // or local has an OLDER timestamp but a HIGHER odometer
    const localNewerButLowerOdo = localMs > cloudMs && localBike.odometer < cloudBike.odometer;
    const cloudNewerButLowerOdo = cloudMs > localMs && cloudBike.odometer < localBike.odometer;

    if (localNewerButLowerOdo || cloudNewerButLowerOdo) {
      return {
        resolved: cloudBike,
        winner: 'cloud',
        conflict: {
          id: `conflict_bike_${cloudBike.id}`,
          entity: 'motorcycle',
          targetId: cloudBike.id,
          reason: 'ambiguous_odometer',
          localRecord: localBike,
          cloudRecord: cloudBike,
          detectedAtIso: new Date().toISOString(),
        },
      };
    }

    if (localMs > cloudMs && localBike.timestampSource === 'client_pending') {
      return { resolved: localBike, winner: 'local' };
    }

    // Default: Newer or equal Firestore record is protected
    return { resolved: cloudBike, winner: 'cloud' };
  }

  // Fallback: protect existing cloud record and surface conflict if values differ
  return {
    resolved: cloudBike,
    winner: 'cloud',
    conflict: {
      id: `conflict_bike_${cloudBike.id}`,
      entity: 'motorcycle',
      targetId: cloudBike.id,
      reason: 'divergent_timestamps',
      localRecord: localBike,
      cloudRecord: cloudBike,
      detectedAtIso: new Date().toISOString(),
    },
  };
}

/**
 * Generates a strictly READ-ONLY dry-run migration preview for a signed-in user.
 * - Filters out known sample/mock records.
 * - Rejects any record carrying a foreign userId (record.userId !== userId).
 * - Never assigns unscoped legacy records automatically; requires explicit user confirmation.
 * - Identifies if Free-tier 1-motorcycle selection is required.
 */
export function inspectLegacyDataDryRun(params: {
  userId: string;
  userEmail: string;
  hasProAccess: boolean;
  cloudMotorcycles?: Motorcycle[];
  cloudReminders?: MaintenanceReminder[];
  cloudServiceRecords?: ServiceRecord[];
}): LegacyMigrationDryRun {
  const {
    userId,
    userEmail,
    hasProAccess,
    cloudMotorcycles = [],
    cloudReminders = [],
    cloudServiceRecords = [],
  } = params;

  let rawMotorcycles: Motorcycle[] = [];
  let rawReminders: MaintenanceReminder[] = [];
  let rawServiceRecords: ServiceRecord[] = [];

  try {
    const bStr = localStorage.getItem(STORAGE_KEYS.MOTORCYCLES);
    if (bStr) {
      const parsed = JSON.parse(bStr);
      if (Array.isArray(parsed)) rawMotorcycles = parsed;
    }
    const rStr = localStorage.getItem(STORAGE_KEYS.REMINDERS);
    if (rStr) {
      const parsed = JSON.parse(rStr);
      if (Array.isArray(parsed)) rawReminders = parsed;
    }
    const sStr = localStorage.getItem(STORAGE_KEYS.SERVICE_RECORDS);
    if (sStr) {
      const parsed = JSON.parse(sStr);
      if (Array.isArray(parsed)) rawServiceRecords = parsed;
    }
  } catch {
    // ignore parse errors
  }

  let rejectedForeignUidCount = 0;
  let excludedMockSampleCount = 0;

  const eligibleMotorcycles: Motorcycle[] = [];
  for (const bike of rawMotorcycles) {
    if (!bike || !bike.id) continue;
    if (CONFIRMED_SAMPLE_MOTORCYCLE_IDS.has(bike.id)) {
      excludedMockSampleCount++;
      continue;
    }
    if (bike.userId && bike.userId !== userId) {
      rejectedForeignUidCount++;
      continue;
    }
    eligibleMotorcycles.push(bike);
  }

  const eligibleBikeIds = new Set([
    ...eligibleMotorcycles.map((b) => b.id),
    ...cloudMotorcycles.map((b) => b.id),
  ]);

  const eligibleReminders: MaintenanceReminder[] = [];
  for (const rem of rawReminders) {
    if (!rem || !rem.id) continue;
    if (CONFIRMED_SAMPLE_REMINDER_IDS.has(rem.id)) {
      excludedMockSampleCount++;
      continue;
    }
    if (rem.userId && rem.userId !== userId) {
      rejectedForeignUidCount++;
      continue;
    }
    if (rem.bikeId && !eligibleBikeIds.has(rem.bikeId) && eligibleMotorcycles.length > 0) {
      continue;
    }
    eligibleReminders.push(rem);
  }

  const eligibleServiceRecords: ServiceRecord[] = [];
  for (const rec of rawServiceRecords) {
    if (!rec || !rec.id) continue;
    if (CONFIRMED_SAMPLE_SERVICE_RECORD_IDS.has(rec.id)) {
      excludedMockSampleCount++;
      continue;
    }
    if (rec.userId && rec.userId !== userId) {
      rejectedForeignUidCount++;
      continue;
    }
    // Note: Service records for retired/sold motorcycles are preserved even if bikeId is no longer in active motorcycles
    eligibleServiceRecords.push(rec);
  }

  const conflictsDetected: SyncConflictItem[] = [];
  const cloudBikesById = new Map(cloudMotorcycles.map((b) => [b.id, b]));
  for (const localBike of eligibleMotorcycles) {
    const cloudBike = cloudBikesById.get(localBike.id);
    if (cloudBike) {
      const res = resolveMotorcycleConflict(localBike, cloudBike);
      if (res.conflict) {
        conflictsDetected.push(res.conflict);
      }
    }
  }

  // Count how many net-new motorcycles would be added to cloud
  const newLocalBikesNotYetInCloud = eligibleMotorcycles.filter((b) => !cloudBikesById.has(b.id));
  const totalBikesIfAllMigrated = cloudMotorcycles.length + newLocalBikesNotYetInCloud.length;
  const maxAllowedCloudBikes = hasProAccess ? 999 : 1;
  const requiresQuotaSelection = !hasProAccess && totalBikesIfAllMigrated > 1 && eligibleMotorcycles.length > 0;

  // Check if all eligible items are already identical in cloud
  const cloudReminderIds = new Set(cloudReminders.map((r) => r.id));
  const cloudRecordIds = new Set(cloudServiceRecords.map((r) => r.id));
  const hasUnmigratedItems =
    newLocalBikesNotYetInCloud.length > 0 ||
    eligibleReminders.some((r) => !cloudReminderIds.has(r.id)) ||
    eligibleServiceRecords.some((r) => !cloudRecordIds.has(r.id)) ||
    conflictsDetected.length > 0;

  const existingLedger = loadMigrationLedger(userId);
  const isAlreadyHandled =
    existingLedger?.status === 'skipped' || existingLedger?.status === 'completed';

  const hasLegacyDataToReview =
    !isAlreadyHandled &&
    (eligibleMotorcycles.length > 0 ||
      eligibleReminders.length > 0 ||
      eligibleServiceRecords.length > 0) &&
    hasUnmigratedItems;

  return {
    userId,
    userEmail,
    eligibleMotorcycles,
    eligibleReminders,
    eligibleServiceRecords,
    rejectedForeignUidCount,
    excludedMockSampleCount,
    requiresQuotaSelection,
    maxAllowedCloudBikes,
    conflictsDetected,
    hasLegacyDataToReview,
  };
}

/**
 * Purges all local storage caches, sync queues, migration ledgers/backups, and unscoped
 * session data associated with a permanently deleted user account.
 *
 * IMPORTANT: Never retains a blacklist, tombstone, or email-based registration restriction,
 * ensuring the deleted user can return and register a fresh account with the same email anytime.
 */
export function purgeDeletedUserAccountLocalData(
  userId: string,
  userEmail?: string | null
): void {
  try {
    if (userId) {
      localStorage.removeItem(getUserScopedKey(userId, 'motorcycles'));
      localStorage.removeItem(getUserScopedKey(userId, 'reminders'));
      localStorage.removeItem(getUserScopedKey(userId, 'records'));
      localStorage.removeItem(getUserScopedKey(userId, 'active_bike_id'));
      localStorage.removeItem(getPreMigrationBackupKey(userId));
      localStorage.removeItem(getMigrationLedgerKey(userId));
      localStorage.removeItem(getOfflineMutationQueueKey(userId));
      localStorage.removeItem(getQuarantinedMutationQueueKey(userId));
      localStorage.removeItem(getCloudSyncLogKey(userId));
      localStorage.removeItem(`motocare_known_cloud_versions_v1_${userId}`);
    }

    // Clear unscoped session/legacy keys so old motorcycles, reminders, or service records
    // cannot automatically reappear or trigger migration when re-registering on the same device
    localStorage.removeItem(STORAGE_KEYS.MOTORCYCLES);
    localStorage.removeItem(STORAGE_KEYS.REMINDERS);
    localStorage.removeItem(STORAGE_KEYS.SERVICE_RECORDS);
    localStorage.removeItem(STORAGE_KEYS.ACTIVE_BIKE_ID);
    localStorage.removeItem(STORAGE_KEYS.SUBSCRIPTION);
    localStorage.removeItem('motocare_motorcycles_v4');
    localStorage.removeItem('motocare_reminders_v4');
    localStorage.removeItem('motocare_records_v4');
    localStorage.removeItem('motocare_active_bike_id_v4');
    localStorage.removeItem('motocare_remembered_email');

    // Remove the deleted account's entry from local user accounts list (if present)
    // without storing any ban or email restriction
    const rawAccounts = localStorage.getItem(STORAGE_KEYS.USER_ACCOUNTS);
    if (rawAccounts) {
      const parsed = JSON.parse(rawAccounts);
      if (Array.isArray(parsed)) {
        const normalizedEmail = userEmail?.trim().toLowerCase();
        const filtered = parsed.filter((acc: any) => {
          if (!acc) return false;
          if (userId && acc.id === userId) return false;
          if (
            normalizedEmail &&
            typeof acc.email === 'string' &&
            acc.email.trim().toLowerCase() === normalizedEmail
          ) {
            return false;
          }
          return true;
        });
        localStorage.setItem(STORAGE_KEYS.USER_ACCOUNTS, JSON.stringify(filtered));
      }
    }
  } catch (err) {
    console.error('Failed to purge deleted user local data', err);
  }
}




