import { LtoRenewalInfo } from '../types';

const LTO_MONTHS: Record<number, string> = {
  1: 'January',
  2: 'February',
  3: 'March',
  4: 'April',
  5: 'May',
  6: 'June',
  7: 'July',
  8: 'August',
  9: 'September',
  0: 'October',
};

const LTO_WEEK_RANGES: Record<number, { range: string; startDay: number; endDay: number }> = {
  1: { range: '1st to 7th working day of the month', startDay: 1, endDay: 7 },
  2: { range: '1st to 7th working day of the month', startDay: 1, endDay: 7 },
  3: { range: '1st to 7th working day of the month', startDay: 1, endDay: 7 },
  4: { range: '8th to 14th working day of the month', startDay: 8, endDay: 14 },
  5: { range: '8th to 14th working day of the month', startDay: 8, endDay: 14 },
  6: { range: '8th to 14th working day of the month', startDay: 8, endDay: 14 },
  7: { range: '15th to 21st working day of the month', startDay: 15, endDay: 21 },
  8: { range: '15th to 21st working day of the month', startDay: 15, endDay: 21 },
  9: { range: '22nd to last working day of the month', startDay: 22, endDay: 30 },
  0: { range: '22nd to last working day of the month', startDay: 22, endDay: 30 },
};

/**
 * Parses a Philippine motorcycle plate number and calculates renewal schedule.
 * Example plates: "ND 8492", "1234 NA", "123ABC", "MC 4567"
 */
export function calculateLtoRenewal(plateNumber: string, referenceDate: Date = new Date()): LtoRenewalInfo {
  const cleaned = plateNumber.replace(/[^0-9]/g, '');

  let lastDigit: number | null = null;
  let middleDigit: number | null = null;

  if (cleaned.length >= 1) {
    lastDigit = parseInt(cleaned[cleaned.length - 1], 10);
  }
  if (cleaned.length >= 2) {
    middleDigit = parseInt(cleaned[cleaned.length - 2], 10);
  } else if (lastDigit !== null) {
    // If only one digit found, default middle to 1
    middleDigit = 1;
  }

  // If no digits found in plate (e.g. temporary unassigned plate)
  if (lastDigit === null || middleDigit === null) {
    return {
      plateNumber,
      lastDigit: null,
      middleDigit: null,
      renewalMonthName: 'Plate Digits Needed',
      renewalWeekRange: 'Check MV File / Temp Plate',
      renewalDeadlineDate: 'TBD',
      daysRemaining: 999,
      status: 'safe',
      penaltyFeeEstimate: 0,
    };
  }

  const monthName = LTO_MONTHS[lastDigit] || 'October (Default)';
  const targetMonthIndex = lastDigit === 0 ? 9 : lastDigit - 1; // 0-indexed month (0 = Jan, 9 = Oct)
  const weekInfo = LTO_WEEK_RANGES[middleDigit] || LTO_WEEK_RANGES[1];

  const currentYear = referenceDate.getFullYear();
  const currentMonth = referenceDate.getMonth();
  const currentDay = referenceDate.getDate();

  // Determine deadline year
  let targetYear = currentYear;
  if (currentMonth > targetMonthIndex || (currentMonth === targetMonthIndex && currentDay > weekInfo.endDay)) {
    targetYear = currentYear + 1;
  }

  // Construct target deadline date
  const deadline = new Date(targetYear, targetMonthIndex, Math.min(weekInfo.endDay, 28));
  const diffTime = deadline.getTime() - referenceDate.getTime();
  const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  let status: 'safe' | 'due-this-month' | 'overdue' = 'safe';
  let penaltyFeeEstimate = 0;

  if (currentYear === targetYear && currentMonth === targetMonthIndex) {
    if (currentDay > weekInfo.endDay) {
      status = 'overdue';
      const daysOverdue = currentDay - weekInfo.endDay;
      penaltyFeeEstimate = daysOverdue <= 7 ? 200 : 400;
    } else {
      status = 'due-this-month';
    }
  } else if (daysRemaining <= 30) {
    status = 'due-this-month';
  }

  return {
    plateNumber,
    lastDigit,
    middleDigit,
    renewalMonthName: monthName,
    renewalWeekRange: weekInfo.range,
    renewalDeadlineDate: deadline.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }),
    daysRemaining,
    status,
    penaltyFeeEstimate,
  };
}
