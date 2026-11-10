import { UserAccount } from '../types';
import { parseExpiryToDate } from './firestoreService';
import { isNotificationSupported, vibratePhone } from './notifications';
import { sounds } from './audio';

export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export interface RecentlyExpiredProUser {
  userId: string;
  name: string;
  email: string;
  bikeModel?: string;
  expiryDateIso: string;
  daysSinceExpired: number;
  expiredHoursAgo: number;
}

export interface RenewalReminderResult {
  userId: string;
  email: string;
  sent: boolean;
  manualOverride: boolean;
  message: string;
  timestampIso: string;
}

/**
 * Checks whether a user's Pro subscription expired within the last 7 days
 * relative to `now` (0ms <= now - expiryDate <= 7 days).
 */
export function isProExpiredWithinLast7Days(
  user: {
    expiryDate?: unknown;
    subscriptionTier?: string;
    paymentStatus?: string;
    effectiveStatus?: string;
  },
  now: Date = new Date()
): boolean {
  const expiry = parseExpiryToDate(user.expiryDate);
  if (!expiry) return false;

  const diffMs = now.getTime() - expiry.getTime();
  // Must be in the past (diffMs >= 0) and within the last 7 days (diffMs <= SEVEN_DAYS_MS)
  return diffMs >= 0 && diffMs <= SEVEN_DAYS_MS;
}

/**
 * Identifies all users whose Pro subscription expired in the last 7 days.
 */
export function getRecentlyExpiredProUsers(
  users: Array<UserAccount | Record<string, any>>,
  now: Date = new Date()
): RecentlyExpiredProUser[] {
  const results: RecentlyExpiredProUser[] = [];

  for (const u of users) {
    if (!isProExpiredWithinLast7Days(u, now)) continue;

    const expiry = parseExpiryToDate(u.expiryDate);
    if (!expiry) continue;

    const diffMs = Math.max(0, now.getTime() - expiry.getTime());
    const daysSinceExpired = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
    const expiredHoursAgo = Math.max(1, Math.round(diffMs / (1000 * 60 * 60)));

    results.push({
      userId: String(u.id || (u as any).uid || ''),
      name: String(u.name || (u as any).displayName || 'MotoCare Rider'),
      email: String(u.email || ''),
      bikeModel: u.bikeModel ? String(u.bikeModel) : undefined,
      expiryDateIso: expiry.toISOString(),
      daysSinceExpired,
      expiredHoursAgo,
    });
  }

  // Sort by most recently expired first
  return results.sort(
    (a, b) => new Date(b.expiryDateIso).getTime() - new Date(a.expiryDateIso).getTime()
  );
}

/**
 * Triggers a 'Renewal Reminder' notification for a single user (supports manual admin override).
 */
export function triggerRenewalReminderNotification(
  target: RecentlyExpiredProUser | UserAccount | Record<string, any>,
  options: { manualOverride?: boolean; now?: Date } = {}
): RenewalReminderResult {
  const now = options.now || new Date();
  const manualOverride = Boolean(options.manualOverride);
  const userId = String((target as any).userId || (target as any).id || (target as any).uid || '');
  const name = String((target as any).name || (target as any).displayName || 'MotoCare Rider');
  const email = String((target as any).email || '');
  const expiry = parseExpiryToDate((target as any).expiryDate || (target as any).expiryDateIso);

  const diffMs = expiry ? Math.max(0, now.getTime() - expiry.getTime()) : 0;
  const daysAgo = expiry ? Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24))) : 1;

  const title = '🔔 Renewal Reminder: MotoCare Pro Expired';
  const message = `${name} (${email || userId}) — Pro subscription expired ${daysAgo} day${
    daysAgo === 1 ? '' : 's'
  } ago. ${
    manualOverride ? '[Manual Admin Override]' : '[Auto 7-Day Window]'
  } Renewal reminder dispatched.`;

  // Trigger audio and haptic feedback
  vibratePhone([200, 100, 200]);
  sounds.playSuccess();

  // Trigger browser Notification if available and permitted
  if (isNotificationSupported() && Notification.permission === 'granted') {
    try {
      new Notification(title, {
        body: message,
        icon: '/logo.png',
        badge: '/logo.png',
        tag: `motocare-renewal-reminder-${userId}`,
      });
    } catch {
      // Ignore notification errors in headless/restricted environments
    }
  }

  return {
    userId,
    email,
    sent: true,
    manualOverride,
    message,
    timestampIso: now.toISOString(),
  };
}

/**
 * Helper function that identifies users whose Pro subscription expired in the last 7 days
 * and triggers a 'Renewal Reminder' notification for each, returning the dispatch report.
 */
export function triggerRecentExpiryRenewalReminders(
  users: Array<UserAccount | Record<string, any>>,
  options: { manualOverride?: boolean; now?: Date } = {}
): {
  expiredUsers: RecentlyExpiredProUser[];
  notifications: RenewalReminderResult[];
  summaryMessage: string;
} {
  const now = options.now || new Date();
  const expiredUsers = getRecentlyExpiredProUsers(users, now);
  const notifications = expiredUsers.map((u) =>
    triggerRenewalReminderNotification(u, {
      manualOverride: options.manualOverride,
      now,
    })
  );

  const summaryMessage =
    expiredUsers.length > 0
      ? `Renewal Reminder triggered for ${expiredUsers.length} rider${
          expiredUsers.length === 1 ? '' : 's'
        } whose Pro subscription expired in the last 7 days.`
      : 'No riders found with a Pro subscription that expired within the last 7 days.';

  return {
    expiredUsers,
    notifications,
    summaryMessage,
  };
}
