/**
 * Notification & Haptic Vibration Utility for MotoCare PH
 * Handles Web Notifications API, mobile vibration, audio alert, and in-app alerts
 */

import { MaintenanceReminder, Motorcycle } from '../types';
import { sounds } from './audio';

export interface OverdueAlertData {
  reminder: MaintenanceReminder;
  bike: Motorcycle;
  overdueKm: number;
  timestamp: number;
}

// Check if browser notifications are supported
export function isNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

// Get current permission status
export function getNotificationPermission(): NotificationPermission {
  if (!isNotificationSupported()) return 'denied';
  return Notification.permission;
}

// Request permission from the user
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!isNotificationSupported()) return 'denied';
  try {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      vibratePhone([100, 50, 100]);
      sounds.playSuccess();
    }
    return permission;
  } catch {
    return Notification.permission;
  }
}

// Trigger haptic phone vibration
export function vibratePhone(pattern: number | number[] = [300, 150, 300, 150, 500]): boolean {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      return navigator.vibrate(pattern);
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Trigger an Overdue Alert:
 * 1. Haptic phone vibration
 * 2. Urgent audible buzzer/warning chime
 * 3. Browser-based Push / OS Notification (if permitted)
 */
export function triggerOverdueAlert(
  reminder: MaintenanceReminder,
  bike: Motorcycle,
  overdueKm: number
): void {
  // 1. Vibrate phone with urgent warning pulse (Buzz - Pause - Buzz - Pause - Long Buzz)
  vibratePhone([300, 150, 300, 150, 500]);

  // 2. Play urgent automotive chime
  sounds.playUrgentAlert();

  // 3. Fire real browser/OS notification
  if (isNotificationSupported() && Notification.permission === 'granted') {
    try {
      const bikeName = bike.nickname ? `"${bike.nickname}"` : `${bike.brand} ${bike.model}`;
      const title = `⚠️ MotoCare Alert: ${reminder.title} is OVERDUE!`;
      const body = `${bikeName} odometer reached ${bike.odometer.toLocaleString()} km. This maintenance task is overdue by ${Math.abs(
        overdueKm
      ).toLocaleString()} km! Inspect immediately.`;

      const notification = new Notification(title, {
        body,
        icon: '/logo.png',
        badge: '/logo.png',
        tag: `motocare-overdue-${reminder.id}`,
        requireInteraction: true, // keeps notification active until user interacts
      });

      notification.onclick = () => {
        window.focus();
        notification.close();
      };
    } catch {
      // Ignore background or notification errors
    }
  }
}

/**
 * Test alert to let users preview the vibration and notification
 */
export async function testOverdueAlert(): Promise<boolean> {
  // Request permission if default
  if (isNotificationSupported() && Notification.permission === 'default') {
    await requestNotificationPermission();
  }

  // Strong vibration pattern
  vibratePhone([350, 150, 350, 150, 600]);
  sounds.playUrgentAlert();

  if (isNotificationSupported() && Notification.permission === 'granted') {
    try {
      new Notification('🔔 MotoCare Alert Test: Phone Vibration & Push Working!', {
        body: 'Overdue maintenance alerts will vibrate your phone and pop up whenever your motorcycle reaches due mileage.',
        icon: '/logo.png',
        badge: '/logo.png',
        tag: 'motocare-test-alert',
      });
    } catch {
      // ignore
    }
  }

  return true;
}

