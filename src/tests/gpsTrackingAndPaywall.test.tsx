// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import {
  GpsRideTrackerSheet,
  AUTO_PAUSE_STATIONARY_THRESHOLD_SECONDS,
} from '../components/GpsRideTrackerSheet';
import { PaywallModal } from '../components/PaywallModal';
import { Motorcycle, UserSubscription } from '../types';

const TEST_BIKE: Motorcycle = {
  id: 'bike-nmax-gps-1',
  userId: 'user-pro-1',
  nickname: 'Trocket',
  brand: 'Yamaha',
  model: 'NMAX 155',
  year: 2026,
  licensePlate: 'NDA 2026',
  color: 'Matte Black',
  odometer: 3000,
  specs: {
    transmission: 'Automatic Scooter',
    cooling: 'Liquid-Cooled',
    displacementCc: 155,
    tirePressureFrontPsi: 29,
    tirePressureRearPsi: 33,
    oilViscosity: '10W-40 JASO MB',
    oilCapacityLiters: 0.9,
    recommendedServiceIntervalKm: 3000,
  },
};

const PRO_SUBSCRIPTION: UserSubscription = {
  tier: 'pro',
  plan: 'monthly',
  status: 'active',
  isExpired: false,
};

const FREE_SUBSCRIPTION: UserSubscription = {
  tier: 'free',
  plan: null,
  status: 'free',
  isExpired: false,
};

function createGeoPosition(params: {
  latitude: number;
  longitude: number;
  speed?: number | null;
  accuracy?: number;
  timestamp?: number;
}): GeolocationPosition {
  return {
    coords: {
      latitude: params.latitude,
      longitude: params.longitude,
      accuracy: params.accuracy ?? 5,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: params.speed ?? null,
      toJSON: () => ({}),
    },
    timestamp: params.timestamp ?? Date.now(),
    toJSON: () => ({}),
  };
}

describe('MotoCare Pro Upgrade Modal & 1-Minute GPS Auto-Pause Suite', () => {
  let watchCallback: PositionCallback | null = null;
  let watchPositionSpy: ReturnType<typeof vi.fn>;
  let clearWatchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-15T10:00:00Z'));
    watchCallback = null;

    watchPositionSpy = vi.fn((success: PositionCallback) => {
      watchCallback = success;
      return 101;
    });
    clearWatchSpy = vi.fn();

    Object.defineProperty(globalThis.navigator, 'geolocation', {
      configurable: true,
      writable: true,
      value: {
        watchPosition: watchPositionSpy,
        clearWatch: clearWatchSpy,
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('configures AUTO_PAUSE_STATIONARY_THRESHOLD_SECONDS to exactly 60 seconds (1 minute)', () => {
    expect(AUTO_PAUSE_STATIONARY_THRESHOLD_SECONDS).toBe(60);
  });

  it('updates PaywallModal Pro benefits list with Automatic GPS Ride Odometer and Plate-Based LTO Renewal Reminders in exact order', () => {
    render(
      <PaywallModal
        isOpen={true}
        onClose={vi.fn()}
        subscription={FREE_SUBSCRIPTION}
        hasProAccess={false}
        onSubmitReference={vi.fn()}
        onCancelSubscription={vi.fn()}
      />
    );

    const benefitHeadings = screen
      .getAllByRole('heading', { level: 4 })
      .map((el) => el.textContent);

    expect(benefitHeadings).toEqual([
      'Unlimited Garage Bikes',
      'Unlimited Smart PMS Reminders',
      'Automatic GPS Ride Odometer',
      'Plate-Based LTO Renewal Reminders',
      'CSV & Verified Casa Service Booklet',
    ]);

    expect(
      screen.getByText(
        /Automatically pauses after 1 minute of inactivity or idling and resumes when you start moving again/i
      )
    ).toBeTruthy();
    expect(
      screen.getByText(
        /Get timely reminders for motorcycle registration renewal based on your plate number/i
      )
    ).toBeTruthy();
    expect(screen.getByText('₱49')).toBeTruthy();
    expect(screen.getByText(/Pay with GCash \(₱49\/month\)/i)).toBeTruthy();
  });

  it('1. Tracking continues normally while the motorcycle is moving', () => {
    render(
      <GpsRideTrackerSheet
        bike={TEST_BIKE}
        subscription={PRO_SUBSCRIPTION}
        hasProAccess={true}
        onFinishRide={vi.fn()}
      />
    );

    expect(watchCallback).not.toBeNull();

    // Anchor fix at t=0
    act(() => {
      watchCallback!(
        createGeoPosition({
          latitude: 14.5995,
          longitude: 120.9842,
          speed: 10, // 36 km/h
          timestamp: Date.now(),
        })
      );
    });

    // Advance 20 seconds and send a moving fix (~500m north)
    act(() => {
      vi.advanceTimersByTime(20000);
      watchCallback!(
        createGeoPosition({
          latitude: 14.604,
          longitude: 120.9842,
          speed: 11, // 40 km/h
          timestamp: Date.now(),
        })
      );
    });

    // Advance another 30 seconds while moving
    act(() => {
      vi.advanceTimersByTime(30000);
      watchCallback!(
        createGeoPosition({
          latitude: 14.6085,
          longitude: 120.9842,
          speed: 11,
          timestamp: Date.now(),
        })
      );
    });

    expect(screen.getByTestId('gps-active-tracking-badge').textContent).toBe('Tracking');
    expect(screen.queryByTestId('gps-auto-paused-badge')).toBeNull();
    expect(screen.getByTestId('gps-accumulated-distance').textContent).toBe('+1.00 km');
    // Initial 8s + 50s = 58s (00:58)
    expect(screen.getByTestId('gps-elapsed-duration').textContent).toBe('00:58');
  });

  it('2 & 3. Stationary periods shorter than 60s do not auto-pause, and continuous stationary detection for 60s triggers automatic pause', () => {
    render(
      <GpsRideTrackerSheet
        bike={TEST_BIKE}
        subscription={PRO_SUBSCRIPTION}
        hasProAccess={true}
        onFinishRide={vi.fn()}
      />
    );

    // Anchor stationary fix
    act(() => {
      watchCallback!(
        createGeoPosition({
          latitude: 14.5995,
          longitude: 120.9842,
          speed: 0,
          timestamp: Date.now(),
        })
      );
    });

    // Advance 59 seconds (shorter than 60s threshold)
    act(() => {
      vi.advanceTimersByTime(59000);
    });

    expect(screen.queryByTestId('gps-auto-paused-badge')).toBeNull();
    expect(screen.getByTestId('gps-active-tracking-badge').textContent).toBe('Tracking');
    // Duration incremented for all 59 seconds (8 + 59 = 67s -> 01:07)
    expect(screen.getByTestId('gps-elapsed-duration').textContent).toBe('01:07');

    // Advance the 60th second -> triggers automatic pause at exactly 60s
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.getByTestId('gps-auto-paused-badge').textContent).toBe(
      'Paused - Motorcycle Stationary'
    );
    expect(screen.getByTestId('gps-auto-pause-banner')).toBeTruthy();

    // Advance another 30 seconds while stationary -> timer stays frozen at 01:07
    act(() => {
      vi.advanceTimersByTime(30000);
    });
    expect(screen.getByTestId('gps-elapsed-duration').textContent).toBe('01:07');
  });

  it('4, 5 & 6. Preserves accumulated mileage across pauses, rejects GPS jitter while paused, and resumes the same ride session on genuine movement', () => {
    const onFinishRide = vi.fn();
    render(
      <GpsRideTrackerSheet
        bike={TEST_BIKE}
        subscription={PRO_SUBSCRIPTION}
        hasProAccess={true}
        onFinishRide={onFinishRide}
      />
    );

    // Start moving and accumulate ~1.00 km
    act(() => {
      watchCallback!(
        createGeoPosition({
          latitude: 14.5995,
          longitude: 120.9842,
          speed: 10,
          timestamp: Date.now(),
        })
      );
    });

    act(() => {
      vi.advanceTimersByTime(10000);
      watchCallback!(
        createGeoPosition({
          latitude: 14.6085, // ~1.00 km north
          longitude: 120.9842,
          speed: 10,
          timestamp: Date.now(),
        })
      );
    });

    expect(screen.getByTestId('gps-accumulated-distance').textContent).toBe('+1.00 km');

    // Stop at traffic light (speed = 0, same coords)
    act(() => {
      vi.advanceTimersByTime(1000);
      watchCallback!(
        createGeoPosition({
          latitude: 14.6085,
          longitude: 120.9842,
          speed: 0,
          timestamp: Date.now(),
        })
      );
    });

    // Wait 60 seconds to trigger automatic pause
    act(() => {
      vi.advanceTimersByTime(60000);
    });

    expect(screen.getByTestId('gps-auto-paused-badge').textContent).toBe(
      'Paused - Motorcycle Stationary'
    );
    expect(screen.getByTestId('gps-accumulated-distance').textContent).toBe('+1.00 km');
    const durationAtPause = screen.getByTestId('gps-elapsed-duration').textContent;

    // 6. Send minor GPS jitter/drift (~4 meters and ~8 meters with low/zero speed) while auto-paused
    act(() => {
      vi.advanceTimersByTime(5000);
      watchCallback!(
        createGeoPosition({
          latitude: 14.608535, // ~3.9m drift
          longitude: 120.9842,
          speed: 0.3, // ~1 km/h noise
          timestamp: Date.now(),
        })
      );
      watchCallback!(
        createGeoPosition({
          latitude: 14.60857, // ~7.8m drift from anchor
          longitude: 120.9842,
          speed: 0.5, // ~2 km/h noise
          timestamp: Date.now(),
        })
      );
    });

    // Must remain auto-paused and mileage must not change
    expect(screen.getByTestId('gps-auto-paused-badge').textContent).toBe(
      'Paused - Motorcycle Stationary'
    );
    expect(screen.getByTestId('gps-accumulated-distance').textContent).toBe('+1.00 km');
    expect(screen.getByTestId('gps-elapsed-duration').textContent).toBe(durationAtPause);

    // 4 & 5. Genuine movement occurs (~500m north at 36 km/h) -> automatically resumes the same session
    act(() => {
      vi.advanceTimersByTime(5000);
      watchCallback!(
        createGeoPosition({
          latitude: 14.613, // +0.50 km from 14.6085
          longitude: 120.9842,
          speed: 10, // 36 km/h
          timestamp: Date.now(),
        })
      );
    });

    // Immediately shows "Resuming Tracking" and preserves + adds distance (+1.50 km total)
    expect(screen.queryByTestId('gps-auto-paused-badge')).toBeNull();
    expect(screen.getByTestId('gps-resuming-badge').textContent).toBe('Resuming Tracking');
    expect(screen.getByTestId('gps-accumulated-distance').textContent).toBe('+1.50 km');

    // After 2 seconds, status settles back to "Tracking" and duration continues incrementing in the same session
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByTestId('gps-active-tracking-badge').textContent).toBe('Tracking');
    expect(screen.getByTestId('gps-accumulated-distance').textContent).toBe('+1.50 km');
    expect(screen.getByTestId('gps-elapsed-duration').textContent).not.toBe(durationAtPause);
  });

  it('7. Manual pause and resume still work and preserve accumulated mileage', () => {
    render(
      <GpsRideTrackerSheet
        bike={TEST_BIKE}
        subscription={PRO_SUBSCRIPTION}
        hasProAccess={true}
        onFinishRide={vi.fn()}
      />
    );

    // Anchor and move ~1.00 km
    act(() => {
      watchCallback!(
        createGeoPosition({
          latitude: 14.5995,
          longitude: 120.9842,
          speed: 10,
          timestamp: Date.now(),
        })
      );
      vi.advanceTimersByTime(5000);
      watchCallback!(
        createGeoPosition({
          latitude: 14.6085,
          longitude: 120.9842,
          speed: 10,
          timestamp: Date.now(),
        })
      );
    });

    expect(screen.getByTestId('gps-accumulated-distance').textContent).toBe('+1.00 km');

    // Click Manual Pause
    const pauseResumeBtn = screen.getByTestId('gps-manual-pause-resume-btn');
    act(() => {
      fireEvent.click(pauseResumeBtn);
    });

    expect(screen.getByTestId('gps-manual-paused-badge').textContent).toBe('Paused');
    const pausedDuration = screen.getByTestId('gps-elapsed-duration').textContent;

    // Advance 90 seconds while manually paused -> duration does not change and auto-pause does not overwrite manual pause
    act(() => {
      vi.advanceTimersByTime(90000);
    });
    expect(screen.getByTestId('gps-elapsed-duration').textContent).toBe(pausedDuration);

    // Click Manual Resume
    act(() => {
      fireEvent.click(pauseResumeBtn);
    });

    expect(screen.getByTestId('gps-active-tracking-badge').textContent).toBe('Tracking');
    expect(screen.getByTestId('gps-accumulated-distance').textContent).toBe('+1.00 km');

    // Advance 5 seconds -> duration resumes incrementing
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByTestId('gps-elapsed-duration').textContent).not.toBe(pausedDuration);
  });

  it('8. Free users cannot access Pro GPS tracking', () => {
    const onOpenPaywall = vi.fn();
    render(
      <GpsRideTrackerSheet
        bike={TEST_BIKE}
        subscription={FREE_SUBSCRIPTION}
        hasProAccess={false}
        onFinishRide={vi.fn()}
        onOpenPaywall={onOpenPaywall}
      />
    );

    expect(
      screen.getByText(/Zero-Touch GPS Auto-Odometer is a Pro Feature/i)
    ).toBeTruthy();
    expect(watchPositionSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText(/Upgrade to Pro \(₱49\/mo\)/i));
    expect(onOpenPaywall).toHaveBeenCalledTimes(1);
  });

  it('9. Avoids duplicate GPS listeners and timers across speed changes and auto-pause transitions', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    const { unmount } = render(
      <GpsRideTrackerSheet
        bike={TEST_BIKE}
        subscription={PRO_SUBSCRIPTION}
        hasProAccess={true}
        onFinishRide={vi.fn()}
      />
    );

    expect(watchPositionSpy).toHaveBeenCalledTimes(1);
    const initialIntervalCount = setIntervalSpy.mock.calls.length;

    // Emit multiple moving fixes, then stationary fixes, trigger auto-pause, then auto-resume
    act(() => {
      watchCallback!(
        createGeoPosition({
          latitude: 14.5995,
          longitude: 120.9842,
          speed: 8,
          timestamp: Date.now(),
        })
      );
      vi.advanceTimersByTime(5000);
      watchCallback!(
        createGeoPosition({
          latitude: 14.604,
          longitude: 120.9842,
          speed: 12,
          timestamp: Date.now(),
        })
      );
      vi.advanceTimersByTime(5000);
      watchCallback!(
        createGeoPosition({
          latitude: 14.604,
          longitude: 120.9842,
          speed: 0,
          timestamp: Date.now(),
        })
      );
      // Trigger auto-pause at 60s
      vi.advanceTimersByTime(60000);
      // Resume with movement
      watchCallback!(
        createGeoPosition({
          latitude: 14.6085,
          longitude: 120.9842,
          speed: 10,
          timestamp: Date.now(),
        })
      );
    });

    // Still only 1 geolocation watchPosition listener and no extra setInterval timers created
    expect(watchPositionSpy).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy.mock.calls.length).toBe(initialIntervalCount);

    unmount();
    expect(clearWatchSpy).toHaveBeenCalledWith(101);
  });
});
