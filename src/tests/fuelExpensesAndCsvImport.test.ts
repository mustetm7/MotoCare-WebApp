import { describe, it, expect } from 'vitest';
import { parseAndValidateMaintenanceCsv } from '../utils/storage';
import {
  calculateBikeFuelStats,
  validateGasOdometerForBike,
  getCurrentManilaDateStr,
  shiftManilaMonthKey,
} from '../utils/firestoreService';
import { Motorcycle, ExpenseEntry } from '../types';

const TEST_BIKE: Motorcycle = {
  id: 'bike-nmax-1',
  userId: 'user-123',
  nickname: 'Daily NMAX',
  brand: 'Yamaha',
  model: 'NMAX 155',
  year: 2024,
  licensePlate: 'NDA 1234',
  color: 'Matte Black',
  odometer: 5000,
  specs: {
    transmission: 'Automatic Scooter',
    cooling: 'Liquid-Cooled',
    displacementCc: 155,
    tirePressureFrontPsi: 22,
    tirePressureRearPsi: 33,
    oilViscosity: '10W-40 JASO MB',
    oilCapacityLiters: 0.9,
    recommendedServiceIntervalKm: 1500,
  },
};

describe('CSV Import for Maintenance History (parseAndValidateMaintenanceCsv)', () => {
  it('validates presence of expected Date, Kilometer, and Service Description columns', () => {
    const missingColsCsv = 'Date,Cost,Shop\n2025-10-01,450,Yamaha 3S';
    const result = parseAndValidateMaintenanceCsv(missingColsCsv, TEST_BIKE, 'user-123');
    expect(result.validRecords).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('kilometer');
    expect(result.errors[0]).toContain('service description');
  });

  it('rejects rows with invalid dates, negative kilometers, or empty descriptions while importing valid rows', () => {
    const csv = [
      'Date,Kilometer,Service Description,Total Cost (PHP)',
      '2025-09-10,3500,Engine Oil Change,480',
      'invalid-date,4000,Gear Oil Change,180',
      '2025-10-15,-200,Spark Plug Replacement,350',
      '2025-11-01,4800,,500',
      '2025-11-05,"5,200 km","CVT Cleaning, Belt Inspection",650',
    ].join('\n');

    const result = parseAndValidateMaintenanceCsv(csv, TEST_BIKE, 'user-123');
    expect(result.validRecords).toHaveLength(2);
    expect(result.errors).toHaveLength(3);

    expect(result.validRecords[0].date).toBe('2025-09-10');
    expect(result.validRecords[0].odometer).toBe(3500);
    expect(result.validRecords[0].title).toBe('Engine Oil Change');
    expect(result.validRecords[0].totalCostPhp).toBe(480);

    expect(result.validRecords[1].date).toBe('2025-11-05');
    expect(result.validRecords[1].odometer).toBe(5200);
    expect(result.validRecords[1].title).toBe('CVT Cleaning, Belt Inspection');
    expect(result.validRecords[1].totalCostPhp).toBe(650);
  });
});

describe('Fuel Log & Per-Bike Fuel Stats', () => {
  it('returns Kulang pa ang data (hasEnoughData: false) when fewer than 2 full-tank entries exist', () => {
    const entries: ExpenseEntry[] = [
      {
        id: 'exp-1',
        userId: 'user-123',
        bikeId: 'bike-nmax-1',
        type: 'Gas',
        date: '2026-11-01',
        monthKey: '2026-11',
        amountPhp: 250,
        liters: 4.0,
        odometerKm: 5000,
        isFullTank: true,
        createdAt: '2026-11-01T00:00:00Z',
        updatedAt: '2026-11-01T00:00:00Z',
      },
    ];

    const stats = calculateBikeFuelStats(entries, 'bike-nmax-1');
    expect(stats.hasEnoughData).toBe(false);
    expect(stats.kmPerLiter).toBeNull();
    expect(stats.costPerKmPhp).toBeNull();
  });

  it('calculates km per liter and gastos kada kilometro across consecutive Full tank fill-ups and explains skipped partial fill-ups', () => {
    const entries: ExpenseEntry[] = [
      {
        id: 'exp-1',
        userId: 'user-123',
        bikeId: 'bike-nmax-1',
        type: 'Gas',
        date: '2026-11-01',
        monthKey: '2026-11',
        amountPhp: 240,
        liters: 4.0,
        odometerKm: 5000,
        isFullTank: true,
        createdAt: '2026-11-01T00:00:00Z',
        updatedAt: '2026-11-01T00:00:00Z',
      },
      {
        id: 'exp-partial',
        userId: 'user-123',
        bikeId: 'bike-nmax-1',
        type: 'Gas',
        date: '2026-11-03',
        monthKey: '2026-11',
        amountPhp: 100,
        liters: 1.6,
        odometerKm: 5080,
        isFullTank: false,
        createdAt: '2026-11-03T00:00:00Z',
        updatedAt: '2026-11-03T00:00:00Z',
      },
      {
        id: 'exp-2',
        userId: 'user-123',
        bikeId: 'bike-nmax-1',
        type: 'Gas',
        date: '2026-11-08',
        monthKey: '2026-11',
        amountPhp: 300,
        liters: 5.0,
        odometerKm: 5200,
        isFullTank: true,
        createdAt: '2026-11-08T00:00:00Z',
        updatedAt: '2026-11-08T00:00:00Z',
      },
    ];

    const stats = calculateBikeFuelStats(entries, 'bike-nmax-1');
    expect(stats.hasEnoughData).toBe(true);
    expect(stats.skippedEntriesCount).toBe(1);
    expect(stats.skippedReasonText).toContain('hindi naka-Full tank');
    // Distance between 5000 and 5200 is 200 km; later fill-up is 5.0 L -> 40 km/L
    expect(stats.kmPerLiter).toBeCloseTo(40, 2);
    // Spend on later fill-up is 300 PHP over 200 km -> 1.50 PHP/km
    expect(stats.costPerKmPhp).toBeCloseTo(1.5, 2);
  });

  it('enforces monotonic odometer readings per bike', () => {
    const existing: ExpenseEntry[] = [
      {
        id: 'exp-1',
        userId: 'user-123',
        bikeId: 'bike-nmax-1',
        type: 'Gas',
        date: '2026-11-01',
        monthKey: '2026-11',
        amountPhp: 240,
        liters: 4.0,
        odometerKm: 5000,
        isFullTank: true,
        createdAt: '2026-11-01T00:00:00Z',
        updatedAt: '2026-11-01T00:00:00Z',
      },
    ];

    const invalidCheck = validateGasOdometerForBike(existing, 'bike-nmax-1', 4950);
    expect(invalidCheck.valid).toBe(false);
    expect(invalidCheck.error).toContain('5,000 km');

    const validCheck = validateGasOdometerForBike(existing, 'bike-nmax-1', 5150);
    expect(validCheck.valid).toBe(true);
  });

  it('handles Manila date and month shifting accurately', () => {
    const todayManila = getCurrentManilaDateStr(new Date('2026-11-10T18:00:00Z')); // Nov 11, 2026 02:00 AM Manila
    expect(todayManila).toBe('2026-11-11');
    expect(shiftManilaMonthKey('2026-01', -1)).toBe('2025-12');
    expect(shiftManilaMonthKey('2026-12', 1)).toBe('2027-01');
  });
});
